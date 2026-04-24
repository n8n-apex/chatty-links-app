import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, Copy, Check } from 'lucide-react';
import logo from '@/assets/logo.png';

interface ChatHeaderProps {
  onLogoClick?: () => void;
}

export const ChatHeader = ({ onLogoClick }: ChatHeaderProps) => {
  const [sessionId, setSessionId] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const read = () => setSessionId(localStorage.getItem('chat-session-id') || '');
    read();
    // Poll so the displayed shortId reflects the current conversation's
    // sessionId (the 'storage' event doesn't fire in the same tab).
    const interval = setInterval(read, 500);
    return () => clearInterval(interval);
  }, []);

  const shortId = sessionId.slice(0, 8);

  const handleCopySessionId = async () => {
    await navigator.clipboard.writeText(sessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-border bg-background/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 pl-16 md:pl-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={onLogoClick}
            className="flex h-10 w-auto items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
          >
            <img 
              src={logo} 
              alt="Umnutzung.de - Fewolizenz GmbH" 
              className="h-10 w-auto object-contain"
              style={{ imageRendering: 'auto' }}
              loading="eager"
            />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <h1 className="font-semibold text-foreground">Baurecht GPT</h1>
            <span className="text-xs text-muted-foreground">
              KI-Assistent für deutsches Baurecht
            </span>
          </div>

          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              <button
                onClick={onLogoClick}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/50 text-muted-foreground hover:text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                title="Neuer Chat"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>

            <button
              onClick={handleCopySessionId}
              className="group/sid flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors relative"
              title="Für Datenbank-Referenz"
            >
              <span className="font-mono">{shortId}</span>
              {copied ? (
                <Check className="h-2.5 w-2.5 text-green-500" />
              ) : (
                <Copy className="h-2.5 w-2.5 opacity-0 group-hover/sid:opacity-100 transition-opacity" />
              )}
              <span className="absolute -bottom-5 right-0 whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[9px] text-popover-foreground shadow-md opacity-0 group-hover/sid:opacity-100 transition-opacity pointer-events-none border border-border">
                Für Datenbank-Referenz
              </span>
            </button>
          </div>
        </div>
      </div>
    </motion.header>
  );
};
