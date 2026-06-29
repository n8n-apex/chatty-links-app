import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, Paperclip, X, Mic, Square, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export type SourceType = 'rechtsquelle' | 'kontext' | 'analyze';
export type ChatMode = 'rechtsfrage' | 'stellungnahme' | 'behoerdenschreiben';

interface ChatInputProps {
  onSendMessage: (message: string, file?: File | null, ziel?: string, sourceType?: SourceType) => void;
  isLoading: boolean;
  inputValue?: string;
  onInputChange?: (value: string) => void;
  mode?: ChatMode;
}

type AudioStatus = 'idle' | 'recording' | 'transcribing' | 'submitting' | 'done' | 'error';

export const ChatInput = ({ onSendMessage, isLoading, inputValue, onInputChange, mode = 'behoerdenschreiben' }: ChatInputProps) => {
  const [internalMessage, setInternalMessage] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>(
    mode === 'behoerdenschreiben' ? 'analyze' : 'rechtsquelle'
  );
  const [ziel, setZiel] = useState('');
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('idle');
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const [audioTranscript, setAudioTranscript] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const awaitingAnswerRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const zielRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use controlled input if inputValue is provided
  const message = inputValue !== undefined ? inputValue : internalMessage;
  const setMessage = (value: string) => {
    if (onInputChange) {
      onInputChange(value);
    } else {
      setInternalMessage(value);
    }
  };

  // Watch parent isLoading to transition submitting -> done
  useEffect(() => {
    if (awaitingAnswerRef.current && !isLoading) {
      awaitingAnswerRef.current = false;
      setAudioStatus('done');
      // brief done-flash then clear
      const t = setTimeout(() => {
        setAudioStatus('idle');
        setAudioTranscript(null);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((message.trim() || attachedFile) && !isLoading) {
      const trimmedZiel = ziel.trim();
      onSendMessage(message.trim(), attachedFile, trimmedZiel || undefined);
      setMessage('');
      setAttachedFile(null);
      setZiel('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Clear any prior audio status when user manually sends
      if (audioStatus !== 'submitting' && audioStatus !== 'transcribing') {
        setAudioStatus('idle');
        setAudioTranscript(null);
        setAudioError(null);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/.test(name);
    if (!isPdf && !isImage) {
      toast.error('Bitte nur PDF- oder Bilddateien hochladen.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Datei ist zu groß. Maximal 20 MB erlaubt.');
      return;
    }
    setAttachedFile(file);
  };

  const acceptDroppedFile = (file: File) => {
    const name = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/.test(name);
    if (!isPdf && !isImage) {
      toast.error('Bitte nur PDF- oder Bilddateien hochladen.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Datei ist zu groß. Maximal 20 MB erlaubt.');
      return;
    }
    setAttachedFile(file);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    if (isLoading) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) acceptDroppedFile(file);
  };


  const removeFile = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = r.result as string;
        resolve(s.split(',')[1] || '');
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });

  const startRecording = async () => {
    if (audioStatus === 'recording' || audioStatus === 'transcribing' || audioStatus === 'submitting' || isLoading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recordedChunksRef.current = [];
      // Reset prior state for a fresh recording
      setAudioTranscript(null);
      setAudioError(null);
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) {
          setAudioStatus('error');
          setAudioError('Es ist ein Fehler aufgetreten. Bitte erneut versuchen.');
          return;
        }
        setAudioStatus('transcribing');
        try {
          const base64 = await blobToBase64(blob);
          const { data, error } = await supabase.functions.invoke('chat-proxy', {
            body: { action: 'transcribe_audio', audio_base64: base64, mime_type: 'audio/webm' },
          });
          if (error) throw new Error(error.message);
          if (data?.error) throw new Error(data.error);
          const text = (data?.text || '').trim();
          if (!text) {
            setAudioStatus('error');
            setAudioError('Es ist ein Fehler aufgetreten. Bitte erneut versuchen.');
            return;
          }
          // Keep transcript visible through submitting
          setAudioTranscript(text);
          const combined = message ? `${message} ${text}` : text;
          setMessage(combined);
          // Auto-submit if no file attachment workflow is open
          if (!attachedFile) {
            setAudioStatus('submitting');
            awaitingAnswerRef.current = true;
            onSendMessage(combined, null, undefined);
            setMessage('');
          } else {
            // With attachment, leave it to the user to press send
            setAudioStatus('idle');
          }
        } catch (err) {
          console.error('Transcription error:', err);
          setAudioStatus('error');
          setAudioError('Es ist ein Fehler aufgetreten. Bitte erneut versuchen.');
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setAudioStatus('recording');
    } catch (err) {
      console.error('Mic access error:', err);
      toast.error('Mikrofon-Zugriff verweigert.');
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    // Immediately reflect transition; onstop will set transcribing/error
    setAudioStatus('transcribing');
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        150
      )}px`;
    }
  }, [message]);

  // Auto-grow Ziel textarea (3-6 rows ≈ 72-144 px at text-sm)
  useEffect(() => {
    if (zielRef.current) {
      zielRef.current.style.height = 'auto';
      zielRef.current.style.height = `${Math.min(
        Math.max(zielRef.current.scrollHeight, 72),
        144
      )}px`;
    }
  }, [ziel, attachedFile]);

  const showStatusBar = audioStatus !== 'idle' && audioStatus !== 'done';
  const recording = audioStatus === 'recording';
  const transcribing = audioStatus === 'transcribing';
  const submitting = audioStatus === 'submitting';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-t border-border bg-background/80 backdrop-blur-xl p-4"
    >
      <form
        onSubmit={handleSubmit}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'mx-auto max-w-3xl rounded-2xl transition-all',
          isDragOver && 'ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/5',
        )}
      >
        {attachedFile && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
            <span className="flex min-w-0 items-center gap-2">
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{attachedFile.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                ({(attachedFile.size / 1024).toFixed(0)} KB)
              </span>
            </span>
            <button
              type="button"
              onClick={removeFile}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Datei entfernen"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {attachedFile && (
          <div className="mb-2 rounded-xl border border-border bg-background/40 p-3">
            <label htmlFor="ziel-textarea" className="text-xs font-medium text-foreground">
              Ziel der Antwort (optional)
            </label>
            <textarea
              id="ziel-textarea"
              ref={zielRef}
              value={ziel}
              onChange={(e) => {
                if (e.target.value.length <= 1000) setZiel(e.target.value);
              }}
              maxLength={1000}
              placeholder="Was möchten Sie mit der Antwort erreichen? Z.B. 'Forderung abwehren', 'Auflagen verhandeln', 'Befreiung erwirken'"
              rows={3}
              disabled={isLoading}
              className="mt-1 w-full resize-none rounded-md border border-border bg-background/60 px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              style={{ minHeight: 72, maxHeight: 144 }}
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                Lassen Sie das Feld leer, um eine allgemeine rechtliche Bewertung zu erhalten.
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{ziel.length}/1000</span>
            </div>
          </div>
        )}

        {/* Unified audio status region — single fixed slot, never collapses to blank between phases */}
        <AnimatePresence initial={false} mode="wait">
          {showStatusBar && (
            <motion.div
              key={audioStatus}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              role="status"
              aria-live="polite"
              className={cn(
                'mb-2 rounded-xl border px-3 py-2 text-xs',
                recording && 'border-red-500/30 bg-red-500/10 text-red-500',
                transcribing && 'border-primary/30 bg-primary/10 text-primary',
                submitting && 'border-primary/30 bg-primary/10 text-foreground',
                audioStatus === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
              )}
            >
              {recording && (
                <div className="flex items-center gap-2">
                  <span className="relative inline-flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                  </span>
                  <span>Aufnahme läuft… (klick zum Stoppen)</span>
                </div>
              )}
              {transcribing && (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Wird transkribiert…</span>
                </div>
              )}
              {submitting && (
                <div className="flex flex-col gap-1.5">
                  {audioTranscript && (
                    <div className="text-foreground/90 italic">„{audioTranscript}“</div>
                  )}
                  <div className="flex items-center gap-2 text-primary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Antwort wird erstellt…</span>
                  </div>
                </div>
              )}
              {audioStatus === 'error' && (
                <div className="flex flex-col gap-1.5">
                  {audioTranscript && (
                    <div className="text-foreground/90 italic">„{audioTranscript}“</div>
                  )}
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>{audioError || 'Es ist ein Fehler aufgetreten. Bitte erneut versuchen.'}</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="glass rounded-2xl p-2 transition-all duration-200 focus-within:ring-2 focus-within:ring-primary/50">
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={isLoading}
              onClick={() => fileInputRef.current?.click()}
              className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
              aria-label="Datei anhängen"
              title="PDF oder Bild anhängen (PDF, JPG, PNG, WebP)"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={attachedFile ? 'Optionale Frage zum Schreiben...' : 'Schreibe deine Nachricht...'}
              rows={1}
              disabled={isLoading}
              className={cn(
                'flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none',
                'min-h-[40px] max-h-[150px]'
              )}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={isLoading || transcribing || submitting}
              onClick={recording ? stopRecording : startRecording}
              className={cn(
                'h-10 w-10 shrink-0 rounded-xl',
                recording ? 'text-red-500 hover:text-red-500' : 'text-muted-foreground hover:text-foreground',
              )}
              aria-label={recording ? 'Aufnahme stoppen' : 'Spracheingabe'}
              title={recording ? 'Aufnahme läuft… (klick zum Stoppen)' : 'Spracheingabe (Deutsch)'}
            >
              {recording ? (
                <span className="relative inline-flex h-3 w-3 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/60" />
                  <Square className="h-3 w-3 fill-red-500 text-red-500" />
                </span>
              ) : transcribing || submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="submit"
              size="icon"
              variant="glow"
              disabled={(!message.trim() && !attachedFile) || isLoading}
              className="h-10 w-10 shrink-0 rounded-xl"
            >
              {isLoading ? (
                <Sparkles className="h-4 w-4 animate-pulse" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Drücke <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">Enter</kbd> zum Senden,{' '}
          <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">Shift + Enter</kbd> für neue Zeile
        </p>
        <p className="mt-1 text-center text-[11px] text-muted-foreground/80">
          Unterstützte Formate: PDF, JPG, PNG. Auch Fotos von Bescheiden.
        </p>
      </form>
    </motion.div>
  );
};
