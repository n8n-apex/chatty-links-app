import { useState } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Message } from '@/types/chat';
import { cn } from '@/lib/utils';
import { User, Bot, Copy, Check, Download } from 'lucide-react';
import { toast } from 'sonner';

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage = ({ message }: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'generated-image.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('Download fehlgeschlagen');
    }
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
                {/* Render image from imageUrl or from img tag in content */}
                {(message.imageUrl || /<\s*img\s/i.test(message.content)) && (
                  <div className="mb-2 relative group/img">
                    <img
                      src={message.imageUrl || message.content.match(/src=['"](.*?)['"]/)?.[1] || ''}
                      alt="Generated image"
                      className="max-w-full rounded-lg"
                      style={{ maxHeight: '400px' }}
                    />
                    <a
                      href={message.imageUrl || message.content.match(/src=['"](.*?)['"]/)?.[1] || ''}
                      download="generated-image.jpg"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-opacity rounded-lg p-2 bg-background/80 backdrop-blur-sm border border-border text-foreground hover:bg-background shadow-sm"
                      title="Bild herunterladen"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </div>
                )}
                {/* Render text content only if it's not just an img tag */}
                {!/<\s*img\s/i.test(message.content) && (
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
                )}
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
