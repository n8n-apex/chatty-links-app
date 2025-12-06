import { motion } from 'framer-motion';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import logo from '@/assets/logo.webp';

interface ChatHeaderProps {
  onSettingsClick: () => void;
  isConnected: boolean;
}

export const ChatHeader = ({ onSettingsClick, isConnected }: ChatHeaderProps) => {
  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-border bg-background/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-auto items-center justify-center">
            <img 
              src={logo} 
              alt="Chat Logo" 
              className="h-8 w-auto brightness-0 invert object-contain"
            />
          </div>
          <div>
            <h1 className="font-semibold text-foreground">KI Chat</h1>
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  isConnected ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'
                }`}
              />
              <span className="text-xs text-muted-foreground">
                {isConnected ? 'Mit n8n verbunden' : 'Nicht konfiguriert'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="glass"
            size="icon"
            onClick={onSettingsClick}
            className="rounded-xl"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </motion.header>
  );
};
