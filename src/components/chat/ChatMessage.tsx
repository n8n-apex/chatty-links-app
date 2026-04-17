import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Message } from '@/types/chat';
import { cn } from '@/lib/utils';
import { User, Bot, Copy, Check, Download, ThumbsUp, Pencil, X, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { StructuredResponse, tryParseStructured } from './StructuredResponse';

export type FeedbackStatus = 'correct' | 'correction' | 'inaccurate' | 'note';

interface ChatMessageProps {
  message: Message;
  onFeedback?: (messageId: string, status: FeedbackStatus, text?: string) => void | Promise<void>;
}

export const ChatMessage = ({ message, onFeedback }: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [activeStatus, setActiveStatus] = useState<FeedbackStatus | null>(null);
  const [textareaOpen, setTextareaOpen] = useState<'correction' | 'note' | null>(null);
  const [feedbackText, setFeedbackText] = useState('');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (url: string) => {
    if (!url) {
      toast.error('Download-Link fehlt');
      return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const submitFeedback = async (status: FeedbackStatus, text?: string) => {
    try {
      await onFeedback?.(message.id, status, text);
      setActiveStatus(status);
      setTimeout(() => setActiveStatus(null), 2000);
    } catch (e) {
      toast.error('Feedback konnte nicht gesendet werden');
    }
  };

  const handleQuickFeedback = (status: 'correct' | 'inaccurate') => {
    submitFeedback(status);
  };

  const handleTextareaSubmit = () => {
    if (!textareaOpen || !feedbackText.trim()) return;
    submitFeedback(textareaOpen, feedbackText.trim());
    setFeedbackText('');
    setTextareaOpen(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn(
        'group flex gap-3 px-4 py-3',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          isUser
            ? 'gradient-primary shadow-glow'
            : 'bg-secondary border border-border'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-primary" />
        )}
      </div>

      <div
        className={cn(
          'flex max-w-[75%] flex-col gap-1',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        <div className="relative">
          <div
            className={cn(
              'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
              isUser
                ? 'gradient-primary text-primary-foreground rounded-br-md'
                : 'glass text-foreground rounded-bl-md'
            )}
          >
            {isUser ? (
              message.content
            ) : (
              <>
                {(message.imageUrl || /<\s*img\s/i.test(message.content)) && (
                  <div className="mb-2 relative group/img">
                    <img
                      src={message.imageUrl || message.content.match(/src=['"](.*?)['"]/)?.[1] || ''}
                      alt="Generated image"
                      className="max-w-full rounded-lg"
                      style={{ maxHeight: '400px' }}
                    />
                    <button
                      onClick={() => handleDownload(message.imageUrl || message.content.match(/src=['"](.*?)['"]/)?.[1] || '')}
                      className="absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-opacity rounded-lg p-2 bg-background/80 backdrop-blur-sm border border-border text-foreground hover:bg-background shadow-sm cursor-pointer"
                      title="Bild herunterladen"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {!/<\s*img\s/i.test(message.content) && (() => {
                  const structured = tryParseStructured(message.content);
                  if (structured) {
                    return <StructuredResponse data={structured} />;
                  }
                  return (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-ol:list-decimal prose-ul:list-disc">
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>,
                          li: ({ children }) => <li className="mb-1">{children}</li>,
                          h1: ({ children }) => <h1 className="mb-2 text-base font-bold">{children}</h1>,
                          h2: ({ children }) => <h2 className="mb-2 text-sm font-bold">{children}</h2>,
                          h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
                          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">{children}</a>,
                          code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>,
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {!isUser && (
            <button
              onClick={handleCopy}
              className="absolute -bottom-1 right-1 translate-y-full opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50"
              title="Text kopieren"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        {!isUser && (
          <div className="mt-1 w-full">
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <button
                onClick={() => handleQuickFeedback('correct')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                  activeStatus === 'correct'
                    ? 'bg-green-500/15 text-green-500'
                    : 'text-muted-foreground hover:bg-green-500/10 hover:text-green-500'
                )}
                title="Korrekt"
              >
                {activeStatus === 'correct' ? <Check className="h-3.5 w-3.5" /> : <ThumbsUp className="h-3.5 w-3.5" />}
                <span>Korrekt</span>
              </button>

              <button
                onClick={() => setTextareaOpen(textareaOpen === 'correction' ? null : 'correction')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                  textareaOpen === 'correction' || activeStatus === 'correction'
                    ? 'bg-yellow-500/15 text-yellow-500'
                    : 'text-muted-foreground hover:bg-yellow-500/10 hover:text-yellow-500'
                )}
                title="Korrektur"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span>Korrektur</span>
              </button>

              <button
                onClick={() => handleQuickFeedback('inaccurate')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                  activeStatus === 'inaccurate'
                    ? 'bg-red-500/15 text-red-500'
                    : 'text-muted-foreground hover:bg-red-500/10 hover:text-red-500'
                )}
                title="Ungenau"
              >
                <X className="h-3.5 w-3.5" />
                <span>Ungenau</span>
              </button>

              <button
                onClick={() => setTextareaOpen(textareaOpen === 'note' ? null : 'note')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                  textareaOpen === 'note' || activeStatus === 'note'
                    ? 'bg-blue-500/15 text-blue-500'
                    : 'text-muted-foreground hover:bg-blue-500/10 hover:text-blue-500'
                )}
                title="Hinweis"
              >
                <StickyNote className="h-3.5 w-3.5" />
                <span>Hinweis</span>
              </button>
            </div>

            <AnimatePresence>
              {textareaOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 overflow-hidden"
                >
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder={textareaOpen === 'correction' ? 'Was ist die Korrektur?' : 'Hinweis hinzufügen...'}
                    className="w-full min-h-[60px] rounded-md border border-border bg-background/50 p-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="mt-1 flex justify-end gap-1">
                    <button
                      onClick={() => {
                        setTextareaOpen(null);
                        setFeedbackText('');
                      }}
                      className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50"
                    >
                      Abbrechen
                    </button>
                    <button
                      onClick={handleTextareaSubmit}
                      disabled={!feedbackText.trim()}
                      className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Senden
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <span className="px-2 text-xs text-muted-foreground">
          {message.timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </motion.div>
  );
};
