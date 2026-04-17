import { cn } from '@/lib/utils';

interface ConfidenceIndicatorProps {
  sources: number;
  className?: string;
}

export const ConfidenceIndicator = ({ sources, className }: ConfidenceIndicatorProps) => {
  if (sources <= 0) return null;

  let label = 'Niedrige Quellenabdeckung';
  let dot = 'bg-red-500';
  let text = 'text-red-500';
  if (sources >= 4) {
    label = 'Hohe Quellenabdeckung';
    dot = 'bg-green-500';
    text = 'text-green-500';
  } else if (sources >= 2) {
    label = 'Mittlere Quellenabdeckung';
    dot = 'bg-yellow-500';
    text = 'text-yellow-500';
  }

  return (
    <div className={cn('flex items-center gap-1.5 text-[11px]', text, className)} title={`${sources} Quelle${sources === 1 ? '' : 'n'}`}>
      <span className={cn('h-2 w-2 rounded-full animate-pulse-glow', dot)} />
      <span>{label}</span>
      <span className="text-muted-foreground">· {sources}</span>
    </div>
  );
};
