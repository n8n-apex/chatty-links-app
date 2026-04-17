import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, Paperclip, X, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface PendingAttachment {
  fileName: string;
  fileBase64: string;
}

interface ChatInputProps {
  onSendMessage: (message: string, attachment?: PendingAttachment) => void;
  isLoading: boolean;
  inputValue?: string;
  onInputChange?: (value: string) => void;
  attachment?: PendingAttachment | null;
  onAttachmentChange?: (a: PendingAttachment | null) => void;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip data url prefix
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export const ChatInput = ({
  onSendMessage,
  isLoading,
  inputValue,
  onInputChange,
  attachment,
  onAttachmentChange,
}: ChatInputProps) => {
  const [internalMessage, setInternalMessage] = useState('');
  const [internalAttachment, setInternalAttachment] = useState<PendingAttachment | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const message = inputValue !== undefined ? inputValue : internalMessage;
  const setMessage = (value: string) => {
    if (onInputChange) onInputChange(value);
    else setInternalMessage(value);
  };

  const currentAttachment = attachment !== undefined ? attachment : internalAttachment;
  const setAttachment = (a: PendingAttachment | null) => {
    if (onAttachmentChange) onAttachmentChange(a);
    else setInternalAttachment(a);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((message.trim() || currentAttachment) && !isLoading) {
      onSendMessage(message.trim(), currentAttachment ?? undefined);
      setMessage('');
      setAttachment(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleFileSelected = async (file: File) => {
    if (file.type !== 'application/pdf') {
      toast.error('Nur PDF-Dateien werden unterstützt');
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      setAttachment({ fileName: file.name, fileBase64: base64 });
    } catch {
      toast.error('Datei konnte nicht gelesen werden');
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelected(file);
    e.target.value = '';
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [message]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-t border-border bg-background/80 backdrop-blur-xl p-4"
    >
      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
        <AnimatePresence>
          {currentAttachment && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2"
            >
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <span className="flex-1 truncate text-sm text-foreground">{currentAttachment.fileName}</span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Anhang entfernen"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="glass rounded-2xl p-2 transition-all duration-200 focus-within:ring-2 focus-within:ring-primary/50">
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={onFileChange}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="h-10 w-10 shrink-0 rounded-xl"
              title="PDF anhängen"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Schreibe deine Nachricht..."
              rows={1}
              disabled={isLoading}
              className={cn(
                'flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none',
                'min-h-[40px] max-h-[150px]'
              )}
            />
            <Button
              type="submit"
              size="icon"
              variant="glow"
              disabled={(!message.trim() && !currentAttachment) || isLoading}
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
      </form>
    </motion.div>
  );
};
