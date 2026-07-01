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
  onSendMessage: (message: string, files?: File[] | null, ziel?: string, sourceType?: SourceType) => void;
  isLoading: boolean;
  inputValue?: string;
  onInputChange?: (value: string) => void;
  mode?: ChatMode;
}

type AudioStatus = 'idle' | 'recording' | 'transcribing' | 'submitting' | 'done' | 'error';

const MAX_FILES = 8;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB encoded ceiling

/** Downscale an image blob to ~2000px longest side, JPEG q~0.8. Returns original if not an image. */
const downscaleImage = async (file: File): Promise<File> => {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 2000;
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxSide ? maxSide / longest : 1;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.(png|webp|heic|heif|bmp)$/i, '.jpg'), { type: 'image/jpeg' });
  } catch {
    return file;
  }
};

export const ChatInput = ({ onSendMessage, isLoading, inputValue, onInputChange, mode = 'behoerdenschreiben' }: ChatInputProps) => {
  const [internalMessage, setInternalMessage] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [sourceType, setSourceType] = useState<SourceType>(
    mode === 'behoerdenschreiben' ? 'analyze' : 'rechtsquelle'
  );
  useEffect(() => {
    setSourceType((current) => {
      if (mode === 'behoerdenschreiben') return current === 'kontext' || current === 'rechtsquelle' ? current : 'analyze';
      return current === 'analyze' ? 'rechtsquelle' : current;
    });
  }, [mode]);
  const [ziel, setZiel] = useState('');
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('idle');
  const [zielAudioStatus, setZielAudioStatus] = useState<AudioStatus>('idle');
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const [audioTranscript, setAudioTranscript] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const zielMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const zielRecordedChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const zielRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const message = inputValue !== undefined ? inputValue : internalMessage;
  const setMessage = (value: string) => {
    if (onInputChange) onInputChange(value);
    else setInternalMessage(value);
  };

  useEffect(() => {
    // Keep default source type in sync when a new file is attached (only if none yet)
    if (attachedFiles.length === 1) {
      setSourceType(mode === 'behoerdenschreiben' ? 'analyze' : 'rechtsquelle');
    }
  }, [attachedFiles.length, mode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    if (!message.trim() && attachedFiles.length === 0) return;
    const trimmedZiel = ziel.trim();
    onSendMessage(
      message.trim(),
      attachedFiles.length > 0 ? attachedFiles : null,
      trimmedZiel || undefined,
      attachedFiles.length > 0 ? sourceType : undefined,
    );
    setMessage('');
    setAttachedFiles([]);
    setZiel('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (audioStatus !== 'submitting' && audioStatus !== 'transcribing') {
      setAudioStatus('idle');
      setAudioTranscript(null);
      setAudioError(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isLoading) return;
      handleSubmit(e);
    }
  };

  const isAcceptedFile = (file: File): boolean => {
    const name = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/.test(name);
    return isPdf || isImage;
  };

  const addFiles = async (incoming: File[]) => {
    if (incoming.length === 0) return;
    // Multi-file only allowed for analyze mode; otherwise take just the first (upload_source is per-file).
    const allowMulti = sourceType === 'analyze' && mode === 'behoerdenschreiben';
    const list: File[] = [];
    for (const f of incoming) {
      if (!isAcceptedFile(f)) {
        toast.error('Bitte nur PDF- oder Bilddateien hochladen.');
        continue;
      }
      if (f.size > 20 * 1024 * 1024) {
        toast.error(`${f.name}: Datei ist zu groß. Maximal 20 MB.`);
        continue;
      }
      list.push(f);
    }
    if (list.length === 0) return;

    // Downscale images to keep base64 payload manageable
    const processed = await Promise.all(list.map(downscaleImage));

    setAttachedFiles((prev) => {
      const combined = allowMulti ? [...prev, ...processed] : processed.slice(0, 1);
      if (combined.length > MAX_FILES) {
        toast.error(`Maximal ${MAX_FILES} Dateien pro Analyse.`);
        return combined.slice(0, MAX_FILES);
      }
      const total = combined.reduce((s, f) => s + f.size, 0);
      // Base64 inflates ~33% → ~1.34x
      if (total * 1.34 > MAX_TOTAL_BYTES) {
        toast.error('Anhang zu groß (max. ~15 MB nach Kodierung). Bitte weniger/kleinere Dateien.');
        return prev;
      }
      return combined;
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) addFiles(files);
    // Reset so re-picking the same file works
    if (fileInputRef.current) fileInputRef.current.value = '';
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
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) addFiles(files);
  };

  const removeFile = (idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
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

  const transcribe = async (blob: Blob): Promise<string> => {
    const base64 = await blobToBase64(blob);
    const { data, error } = await supabase.functions.invoke('chat-proxy', {
      body: { action: 'transcribe_audio', audio_base64: base64, mime_type: 'audio/webm', language: 'de' },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return (data?.text || '').trim();
  };

  // ---------- Main-input mic ----------
  const startRecording = async () => {
    if (audioStatus === 'recording' || audioStatus === 'transcribing' || audioStatus === 'submitting' || isLoading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recordedChunksRef.current = [];
      setAudioTranscript(null);
      setAudioError(null);
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) {
          setAudioStatus('error');
          setAudioError('Aufnahme leer. Bitte erneut versuchen.');
          return;
        }
        setAudioStatus('transcribing');
        try {
          const text = await transcribe(blob);
          if (!text) {
            setAudioStatus('error');
            setAudioError('Keine Sprache erkannt. Bitte erneut versuchen.');
            return;
          }
          // Insert into field; DO NOT auto-send.
          setMessage(message ? `${message} ${text}` : text);
          setAudioTranscript(text);
          setAudioStatus('idle');
          setTimeout(() => setAudioTranscript(null), 400);
        } catch (err) {
          console.error('Transcription error:', err);
          setAudioStatus('error');
          setAudioError('Transkription fehlgeschlagen. Bitte erneut versuchen.');
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setAudioStatus('recording');
    } catch (err) {
      console.error('Mic access error:', err);
      toast.error('Mikrofon-Zugriff verweigert. Bitte Berechtigungen prüfen.');
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    setAudioStatus('transcribing');
  };

  // ---------- Ziel-field mic ----------
  const startZielRecording = async () => {
    if (zielAudioStatus === 'recording' || zielAudioStatus === 'transcribing' || isLoading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      zielRecordedChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) zielRecordedChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(zielRecordedChunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) { setZielAudioStatus('idle'); return; }
        setZielAudioStatus('transcribing');
        try {
          const text = await transcribe(blob);
          if (text) setZiel((prev) => (prev ? `${prev} ${text}` : text));
          setZielAudioStatus('idle');
        } catch {
          toast.error('Transkription fehlgeschlagen.');
          setZielAudioStatus('idle');
        }
      };
      zielMediaRecorderRef.current = mr;
      mr.start();
      setZielAudioStatus('recording');
    } catch {
      toast.error('Mikrofon-Zugriff verweigert.');
    }
  };
  const stopZielRecording = () => {
    const mr = zielMediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    setZielAudioStatus('transcribing');
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [message]);

  useEffect(() => {
    if (zielRef.current) {
      zielRef.current.style.height = 'auto';
      zielRef.current.style.height = `${Math.min(Math.max(zielRef.current.scrollHeight, 72), 144)}px`;
    }
  }, [ziel, attachedFiles.length]);

  const showStatusBar = audioStatus !== 'idle' && audioStatus !== 'done';
  const recording = audioStatus === 'recording';
  const transcribing = audioStatus === 'transcribing';
  const submitting = audioStatus === 'submitting';
  const hasFiles = attachedFiles.length > 0;

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
        {hasFiles && (
          <div className="mb-2 flex flex-col gap-1.5">
            {attachedFiles.map((f, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[10px] font-mono text-muted-foreground">#{i + 1}</span>
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">({(f.size / 1024).toFixed(0)} KB)</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Datei entfernen"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        {hasFiles && (() => {
          const options: { value: SourceType; label: string }[] = [
            { value: 'rechtsquelle', label: 'Rechtsquelle (verbindliches Ortsrecht)' },
            { value: 'kontext', label: 'Kontext (Sachverhalt, kein Recht)' },
          ];
          if (mode === 'behoerdenschreiben') {
            options.push({ value: 'analyze', label: 'Behördenschreiben analysieren' });
          }
          return (
            <div className="mb-2 rounded-xl border border-border bg-background/40 p-3">
              <div className="mb-1.5 text-xs font-medium text-foreground">Was ist diese Datei?</div>
              <div className="flex flex-col gap-1">
                {options.map((o) => (
                  <label
                    key={o.value}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                      sourceType === o.value
                        ? 'border-primary/50 bg-primary/10 text-foreground'
                        : 'border-border bg-background/40 text-muted-foreground hover:border-border hover:bg-muted/40',
                    )}
                  >
                    <input
                      type="radio"
                      name="source-type"
                      value={o.value}
                      checked={sourceType === o.value}
                      onChange={() => {
                        setSourceType(o.value);
                        // If switching away from analyze, drop extra files
                        if (o.value !== 'analyze') setAttachedFiles((prev) => prev.slice(0, 1));
                      }}
                      className="h-3 w-3 accent-primary"
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
              {sourceType === 'analyze' && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Mehrseitige Schreiben: weitere Bilder/PDFs anhängen — Reihenfolge zählt.
                </p>
              )}
            </div>
          );
        })()}
        {hasFiles && sourceType === 'analyze' && (
          <div className="mb-2 rounded-xl border border-border bg-background/40 p-3">
            <div className="flex items-center justify-between">
              <label htmlFor="ziel-textarea" className="text-xs font-medium text-foreground">
                Ziel der Antwort (optional)
              </label>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={isLoading || zielAudioStatus === 'transcribing'}
                onClick={zielAudioStatus === 'recording' ? stopZielRecording : startZielRecording}
                className={cn(
                  'h-7 w-7 rounded-md',
                  zielAudioStatus === 'recording' ? 'text-red-500' : 'text-muted-foreground hover:text-foreground',
                )}
                aria-label={zielAudioStatus === 'recording' ? 'Aufnahme stoppen' : 'Spracheingabe für Ziel'}
                title={zielAudioStatus === 'recording' ? 'Aufnahme stoppen' : 'Spracheingabe (Deutsch)'}
              >
                {zielAudioStatus === 'recording' ? (
                  <Square className="h-3 w-3 fill-red-500 text-red-500" />
                ) : zielAudioStatus === 'transcribing' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Mic className="h-3 w-3" />
                )}
              </Button>
            </div>
            <textarea
              id="ziel-textarea"
              ref={zielRef}
              value={ziel}
              onChange={(e) => { if (e.target.value.length <= 1000) setZiel(e.target.value); }}
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
              {audioStatus === 'error' && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{audioError || 'Fehler bei der Aufnahme.'}</span>
                </div>
              )}
              {audioTranscript && !transcribing && (
                <div className="mt-1 text-foreground/90 italic">„{audioTranscript}“</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="glass rounded-2xl p-2 transition-all duration-200 focus-within:ring-2 focus-within:ring-primary/50">
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
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
              title="PDF oder Bilder anhängen (mehrere möglich für Behördenschreiben)"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasFiles ? 'Optionale Frage / Anweisung…' : 'Schreibe deine Nachricht…'}
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
              disabled={(!message.trim() && !hasFiles) || isLoading}
              className="h-10 w-10 shrink-0 rounded-xl"
              title={isLoading ? 'Bitte warten…' : 'Senden'}
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
          Unterstützte Formate: PDF, JPG, PNG, WebP. Mehrere Seiten als einzelne Bilder anhängen möglich.
        </p>
      </form>
    </motion.div>
  );
};
