import { motion } from 'framer-motion';
import { MessageSquare, FileText, Search } from 'lucide-react';

interface EmptyStateProps {
  onSuggestionClick?: (text: string) => void;
}

export const EmptyState = ({ onSuggestionClick }: EmptyStateProps) => {
  const suggestions = [
    {
      icon: MessageSquare,
      title: 'Rechtsfrage stellen',
      description: 'Rechtsfrage mit §-Angaben und Quellen beantwortet bekommen',
      prompt: 'Ich habe eine Baurechtsfrage:',
    },
    {
      icon: FileText,
      title: 'Stellungnahme erstellen',
      description: 'Formelle rechtliche Stellungnahme zu einem Baurechtsthema erstellen',
      prompt: 'Erstelle eine Stellungnahme zum Thema:',
    },
    {
      icon: Search,
      title: 'Behördenschreiben analysieren',
      description: 'Behördenschreiben analysieren und Antwortentwurf erhalten',
      prompt: 'Analysiere dieses Behördenschreiben:',
    },
  ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="text-center"
      >
        <h2 className="mb-2 text-2xl font-semibold text-foreground">
          Baurecht GPT
        </h2>
        <p className="mx-auto mb-8 max-w-xl text-center text-muted-foreground">
          KI-Assistent für deutsches Baurecht — Stellen Sie Rechtsfragen, erstellen Sie Stellungnahmen oder analysieren Sie Behördenschreiben
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          {suggestions.map((suggestion, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              onClick={() => onSuggestionClick?.(suggestion.prompt)}
              className="glass rounded-xl p-4 text-left transition-colors hover:bg-muted/50 cursor-pointer active:scale-95"
            >
              <suggestion.icon className="mb-2 h-5 w-5 text-primary" />
              <div className="text-sm font-medium text-foreground mb-1">
                {suggestion.title}
              </div>
              <div className="text-xs text-muted-foreground">
                {suggestion.description}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};
