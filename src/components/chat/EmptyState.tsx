import { motion } from 'framer-motion';
import { Sparkles, Zap, Bot } from 'lucide-react';
import logo from '@/assets/logo.webp';

export const EmptyState = () => {
  const suggestions = [
    { icon: Sparkles, text: 'Kreative Ideen generieren' },
    { icon: Zap, text: 'Workflows automatisieren' },
    { icon: Bot, text: 'Sofortige Antworten erhalten' },
  ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="text-center"
      >
        <div className="relative mx-auto mb-6">
          <div className="mx-auto flex h-20 w-auto items-center justify-center rounded-3xl">
            <img 
              src={logo} 
              alt="Chat Logo" 
              className="h-16 w-auto brightness-0 invert object-contain"
            />
          </div>
          <motion.div
            className="absolute -inset-4 rounded-full gradient-glow -z-10"
            animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <h2 className="mb-2 text-2xl font-semibold text-foreground">
          Starte eine Unterhaltung
        </h2>
        <p className="mb-8 max-w-sm text-muted-foreground">
          Verbinde dich mit deinem n8n-Workflow und chatte mit KI-gestützter
          Automatisierung
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          {suggestions.map((suggestion, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className="glass rounded-xl p-4 text-center transition-colors hover:bg-muted/50"
            >
              <suggestion.icon className="mx-auto mb-2 h-5 w-5 text-primary" />
              <span className="text-sm text-muted-foreground">
                {suggestion.text}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};
