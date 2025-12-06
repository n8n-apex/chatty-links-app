import { motion } from 'framer-motion';
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
              alt="Chat Logo" 
              className="h-8 w-auto brightness-0 invert object-contain"
            />
          </button>
        </div>

        <div className="text-right">
          <h1 className="font-semibold text-foreground">KI Assistent</h1>
          <div className="flex items-center justify-end gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-muted-foreground">
              Airtable verbunden
            </span>
          </div>
        </div>
      </div>
    </motion.header>
  );
};
