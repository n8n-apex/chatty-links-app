import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

export const ChatInput = ({ onSendMessage, isLoading }: ChatInputProps) => {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-t border-border bg-background/80 backdrop-blur-xl p-4"
    >
      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
        <div className="glass rounded-2xl p-2 transition-all duration-200 focus-within:ring-2 focus-within:ring-primary/50">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
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
              disabled={!message.trim() || isLoading}
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
          Press <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">Enter</kbd> to send,{' '}
          <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">Shift + Enter</kbd> for new line
        </p>
      </form>
    </motion.div>
  );
};
