import { motion } from 'framer-motion';
import { RotateCcw } from 'lucide-react';
import logo from '@/assets/logo.webp';

interface ChatHeaderProps {
  onLogoClick?: () => void;
}

export const ChatHeader = ({ onLogoClick }: ChatHeaderProps) => {
  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-border bg-background/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <button 
            onClick={onLogoClick}
            className="flex h-10 w-auto items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
          >
            <img 
              src={logo} 
              alt="PMM Logo" 
              className="h-8 w-auto object-contain"
            />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <h1 className="font-semibold text-foreground">PMM AI Chat Assistant</h1>
            <div className="flex items-center justify-end gap-1.5">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs text-muted-foreground">
                Airtable verbunden
              </span>
            </div>
          </div>
          
          <button
            onClick={onLogoClick}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/50 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Neuer Chat"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.header>
  );
};
