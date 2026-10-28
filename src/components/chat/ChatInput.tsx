import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Clock, Sparkles, Paperclip, X, Mic, Square, Loader2, AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getUserEmail } from '@/lib/identity';
import {
  DictationRecorder,
  findUnfinishedRecording,
  resumeRecording,
  discardRecording,
} from '@/lib/dictation';

export type AttachIntent = 'schreiben' | 'quelle';

interface ChatInputProps {
  onSendMessage: (message: string, files?: File[] | null, attachIntent?: AttachIntent) => void;
  isLoading: boolean;
  /** Text handed back by the container (retry, "Zurückholen"); nonce = apply once. */
  restoreText?: { text: string; nonce: number } | null;
  /** A message is already waiting for the running turn; another send adds nothing. */
  queueFull?: boolean;
  /** Files handed back by "Zurückholen"; nonce makes each restore apply once. */
  restoreFiles?: { files: File[]; intent?: AttachIntent; nonce: number } | null;
  /** Chat session, sent with every dictation segment. */
  sessionId?: string;
}

type AudioStatus = 'idle' | 'recording' | 'converting';

const MAX_FILES = 8;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB encoded ceiling
const FILE_LIMITS = `Max. ${MAX_FILES} Dateien, zusammen ca. 11 MB (15 MB nach Kodierung). Max. 20 MB je Originaldatei. PDF oder Bilder.`;

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

export const ChatInput = ({ onSendMessage, isLoading, restoreText, queueFull = false, restoreFiles, sessionId }: ChatInputProps) => {
  const [internalMessage, setInternalMessage] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  // Default is analyse: in a chat product a paperclip means "look at this".
  const [attachIntent, setAttachIntent] = useState<AttachIntent>('schreiben');
  // True while files are being decoded/downscaled. Sending during this window
  // would let the router decide on a turn whose attachment it cannot see.
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('idle');
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  // Dictation state. Segments upload while the user speaks; texts are appended
  // to the box in seq order without touching what the user typed.
  const [audioElapsedMs, setAudioElapsedMs] = useState(0);
  const [pendingSegments, setPendingSegments] = useState(0);
  const [failedSegments, setFailedSegments] = useState(0);
  const [restoreOffer, setRestoreOffer] = useState<{ recordingId: string; startedAt: number } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const recorderRef = useRef<DictationRecorder | null>(null);
  const recStartRef = useRef<number>(0);
  const nextInsertSeqRef = useRef(0);
  const arrivedTextsRef = useRef<Map<number, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const message = internalMessage;
  const setMessage = setInternalMessage;
  useEffect(() => { if (restoreText) setInternalMessage(restoreText.text); }, [restoreText]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((isLoading && queueFull) || isProcessingFiles) return;
    if (!message.trim() && attachedFiles.length === 0) return;
    const files = attachedFiles.length > 0 ? attachedFiles : null;
    onSendMessage(message.trim(), files, files ? attachIntent : undefined);
    setMessage('');
    setAttachedFiles([]);
    setAttachIntent('schreiben');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((isLoading && queueFull) || isProcessingFiles) return;
      handleSubmit(e);
    }
  };

  // Pasting is the fastest way to establish a subject now that the modes are gone.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData?.files || []);
    if (pasted.length === 0) return;
    e.preventDefault();
    addFiles(pasted);
  };

  const isAcceptedFile = (file: File): boolean => {
    const name = file.name.toLowerCase();
    // SVG is refused immediately: it skips the downscaler, cannot be OCR'd as a
    // bitmap, and only fails after a ~10s round trip.
    if (file.type === 'image/svg+xml' || name.endsWith('.svg')) return false;
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/.test(name);
    return isPdf || isImage;
  };

  const addFiles = async (incoming: File[]) => {
    if (incoming.length === 0) return;
    const list: File[] = [];
    for (const f of incoming) {
      if (!isAcceptedFile(f)) {
        toast.error('Bitte nur PDF- oder Bilddateien hochladen.');
        continue;
      }
      if (f.size > 20 * 1024 * 1024) {
        toast.error(`${f.name}: Datei ist zu groß. ${FILE_LIMITS}`);
        continue;
      }
      list.push(f);
    }
    if (list.length === 0) return;

    // Downscale images to keep base64 payload manageable
    setIsProcessingFiles(true);
    let processed: File[];
    try {
      processed = await Promise.all(list.map(downscaleImage));
    } finally {
      setIsProcessingFiles(false);
    }

    setAttachedFiles((prev) => {
      const combined = [...prev, ...processed];
      // Size cap FIRST — otherwise an over-count batch returned early and
      // bypassed the 15 MB ceiling entirely.
      const total = combined.reduce((s, f) => s + f.size, 0);
      // Base64 inflates ~33% → ~1.34x
      if (total * 1.34 > MAX_TOTAL_BYTES) {
        toast.error(`Anhang zu groß. ${FILE_LIMITS} Bitte weniger oder kleinere Dateien auswählen.`);
        return prev;
      }
      if (combined.length > MAX_FILES) {
        toast.error(`Zu viele Dateien. ${FILE_LIMITS}`);
        return combined.slice(0, MAX_FILES);
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
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) addFiles(files);
  };

  const removeFile = (idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // ---------- Dictation ----------

  // Segment texts arrive in upload order, not seq order. Buffer them and append
  // only when the next expected seq is here, so the text reads in spoken order.
  const handleSegmentText = (seq: number, text: string) => {
    arrivedTextsRef.current.set(seq, text);
    let next = nextInsertSeqRef.current;
    const toAppend: string[] = [];
    while (arrivedTextsRef.current.has(next)) {
      toAppend.push(arrivedTextsRef.current.get(next)!);
      arrivedTextsRef.current.delete(next);
      next++;
    }
    nextInsertSeqRef.current = next;
    const addition = toAppend.filter(Boolean).join(' ');
    if (addition) {
      // Functional update: never overwrite what the user typed meanwhile.
      setMessage((prev) => (prev ? `${prev} ${addition}` : addition));
    }
  };

  const startRecording = async () => {
    if (audioStatus !== 'idle') return;
    setRestoreOffer(null);
    try {
      const rec = new DictationRecorder({
        sessionId: sessionId || localStorage.getItem('chat-session-id') || '',
        userEmail: getUserEmail(),
        events: {
          onText: handleSegmentText,
          onPendingChange: setPendingSegments,
          onFailedChange: setFailedSegments,
          onAllDone: () => {
            setAudioStatus('idle');
            setPendingSegments(0);
          },
        },
      });
      await rec.start();
      recorderRef.current = rec;
      nextInsertSeqRef.current = 0;
      arrivedTextsRef.current.clear();
      recStartRef.current = Date.now();
      setAudioStatus('recording');
    } catch (err) {
      console.error('Mic access error:', err);
      toast.error('Mikrofon-Zugriff verweigert. Bitte Berechtigungen prüfen.');
    }
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    rec.stop();
    setAudioStatus('converting');
  };

  const retryFailedUploads = () => {
    recorderRef.current?.retryFailed();
  };

  const saveFailedAudio = () => {
    void recorderRef.current?.downloadFailedAudio();
  };

  // On load: an unfinished recording in IndexedDB means the page was closed or
  // reloaded mid-dictation. Offer to restore it.
  useEffect(() => {
    let cancelled = false;
    findUnfinishedRecording()
      .then((rec) => {
        if (!cancelled && rec) setRestoreOffer({ recordingId: rec.recording_id, startedAt: rec.startedAt });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRestoreDictation = async () => {
    if (!restoreOffer) return;
    setRestoring(true);
    try {
      const text = await resumeRecording(restoreOffer.recordingId);
      if (text) setMessage((prev) => (prev ? `${prev} ${text}` : text));
      setRestoreOffer(null);
    } catch {
      toast.error('Das Diktat konnte nicht wiederhergestellt werden.');
    } finally {
      setRestoring(false);
    }
  };

  const dismissRestoreDictation = () => {
    if (restoreOffer) void discardRecording(restoreOffer.recordingId).catch(() => {});
    setRestoreOffer(null);
  };

  // Elapsed clock for the voice UI: ticks while recording. Shows real seconds.
  useEffect(() => {
    if (audioStatus !== 'recording') return;
    const tick = () => setAudioElapsedMs(recStartRef.current ? Date.now() - recStartRef.current : 0);
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [audioStatus]);

  // Release the recorder when the composer unmounts.
  useEffect(() => () => recorderRef.current?.dispose(), []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [message]);

  // Files dropped anywhere outside the composer arrive via this app-level
  // event (see App.tsx global drop guard). Feed them through the same
  // addFiles path as picker/drop/paste so all three admit the same set.
  useEffect(() => {
    const onGlobalDrop = (e: Event) => {
      const files = (e as CustomEvent<File[]>).detail;
      if (Array.isArray(files) && files.length > 0) addFiles(files);
    };
    window.addEventListener('lawgpt:global-drop', onGlobalDrop);
    return () => window.removeEventListener('lawgpt:global-drop', onGlobalDrop);
  }, []);

  useEffect(() => {
    if (!restoreFiles) return;
    setAttachedFiles(restoreFiles.files);
    setAttachIntent(restoreFiles.intent ?? 'schreiben');
    textareaRef.current?.focus();
  }, [restoreFiles?.nonce]);

  const recording = audioStatus === 'recording';
  const converting = audioStatus === 'converting';
  const showStatusBar = recording || converting;
  const hasFiles = attachedFiles.length > 0;

  const fmtElapsed = (ms: number) => {
    const total = Math.floor(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };
  const pendingLabel =
    pendingSegments === 1
      ? '1 Abschnitt wird noch umgewandelt'
      : `${pendingSegments} Abschnitte werden noch umgewandelt`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-background px-4 pb-4 pt-2"
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

        {restoreOffer && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground" role="status">
            <RotateCcw className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Diktat vom {new Date(restoreOffer.startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr wiederherstellen
            </span>
            <button
              type="button"
              onClick={handleRestoreDictation}
              disabled={restoring}
              className="ml-auto rounded-md px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
            >
              {restoring ? 'Wird wiederhergestellt …' : 'Wiederherstellen'}
            </button>
            <button
              type="button"
              onClick={dismissRestoreDictation}
              className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary"
              aria-label="Wiederherstellung verwerfen"
            >
              Verwerfen
            </button>
          </div>
        )}

        {failedSegments > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>
              {failedSegments === 1
                ? 'Ein Abschnitt konnte nicht gesendet werden.'
                : `${failedSegments} Abschnitte konnten nicht gesendet werden.`}
            </span>
            <button
              type="button"
              onClick={retryFailedUploads}
              className="ml-auto rounded-md px-2 py-0.5 text-xs font-medium hover:bg-destructive/15"
            >
              Erneut versuchen
            </button>
            <button
              type="button"
              onClick={saveFailedAudio}
              className="rounded-md px-2 py-0.5 text-xs font-medium hover:bg-destructive/15"
            >
              Aufnahme speichern
            </button>
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
                converting && 'border-primary/30 bg-primary/10 text-primary',
              )}
            >
              {recording && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="relative inline-flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/70" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                    </span>
                    <span>Aufnahme läuft. Text erscheint, während du sprichst.</span>
                    <span className="ml-auto font-mono tabular-nums" aria-label="Aufnahmedauer">
                      {fmtElapsed(audioElapsedMs)}
                    </span>
                  </div>
                  {pendingSegments > 0 && <div className="text-[11px] opacity-80">{pendingLabel}</div>}
                </div>
              )}
              {converting && (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Wird umgewandelt …</span>
                  {pendingSegments > 0 && <span className="text-[11px] opacity-80">{pendingLabel}</span>}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="rounded-[28px] border border-border bg-card p-2 shadow-soft transition-all duration-200 focus-within:ring-2 focus-within:ring-primary/50">
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="application/pdf,image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
                  aria-label="Datei anhängen"
                  title={FILE_LIMITS}
                >
                  {isProcessingFiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuItem
                  onSelect={() => { setAttachIntent('schreiben'); fileInputRef.current?.click(); }}
                >
                  Als Behördenschreiben analysieren
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => { setAttachIntent('quelle'); fileInputRef.current?.click(); }}
                >
                  Nur als Unterlage ablegen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Frage stellen, Schreiben anhängen oder Änderung am Entwurf beschreiben …"
              rows={1}
              className={cn(
                'flex-1 resize-none bg-transparent px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none',
                'min-h-[40px] max-h-[150px]'
              )}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={converting}
              onClick={recording ? stopRecording : startRecording}
              className={cn(
                'h-10 w-10 shrink-0 rounded-xl',
                recording ? 'text-red-500 hover:text-red-500' : 'text-muted-foreground hover:text-foreground',
              )}
              aria-label={recording ? 'Aufnahme stoppen' : 'Spracheingabe'}
              title={recording ? 'Aufnahme läuft. Klick zum Stoppen.' : 'Spracheingabe (Deutsch)'}
            >
              {recording ? (
                <span className="relative inline-flex h-3 w-3 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/60" />
                  <Square className="h-3 w-3 fill-red-500 text-red-500" />
                </span>
              ) : converting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="submit"
              size="icon"
              variant="glow"
              disabled={(!message.trim() && !hasFiles) || (isLoading && queueFull) || isProcessingFiles}
              className="h-10 w-10 shrink-0 rounded-xl"
              title={isProcessingFiles ? 'Dateien werden vorbereitet…' : isLoading && queueFull ? 'Eine Nachricht wartet bereits' : isLoading ? 'Senden, sobald die aktuelle Antwort fertig ist' : 'Senden'}
              aria-label={isLoading && queueFull ? 'Eine Nachricht wartet bereits' : 'Senden'}
            >
              {isLoading && queueFull ? (
                <Clock className="h-4 w-4" />
              ) : isProcessingFiles ? (
                <Sparkles className="h-4 w-4 animate-pulse" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          LawGPT ist eine KI und kann Fehler machen. Bitte überprüfe die Antworten.
        </p>

      </form>
    </motion.div>
  );
};
