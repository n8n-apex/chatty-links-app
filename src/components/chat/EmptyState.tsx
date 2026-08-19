import { motion } from 'framer-motion';
import { Scale } from 'lucide-react';

export const EmptyState = () => {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="text-center"
      >
        <div className="mb-4 flex justify-center">
          <div className="relative animate-float-gentle">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl" aria-hidden />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary shadow-glow">
              <Scale className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
        </div>
        <h2 className="mb-2 text-2xl font-semibold text-foreground">
          Baurecht GPT
        </h2>
        <p className="mx-auto max-w-xl text-center text-muted-foreground">
          KI-Assistent für deutsches Baurecht — Stellen Sie Rechtsfragen, erstellen Sie Stellungnahmen oder analysieren Sie Behördenschreiben
        </p>
      </motion.div>
    </div>
  );
};

