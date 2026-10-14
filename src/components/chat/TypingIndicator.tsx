import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Bot, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Arbeitsschritte, type Arbeitsschritt } from './Arbeitsschritte';
import { StreamingAnswer } from './StreamingAnswer';

export const TypingIndicator = ({ status, steps = [], open = false, onOpenChange, stream }: {
  status?: string | null;
  steps?: Arbeitsschritt[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  stream?: { text: string; draft: string | null } | null;
} = {}) => {
  const id = useId();
  const reducedMotion = useReducedMotion();
  const dots = <div className="flex shrink-0 gap-1" aria-hidden="true">
    {[0, 1, 2].map((i) => <motion.span key={i} className="h-2 w-2 rounded-full bg-primary"
      animate={reducedMotion ? undefined : { y: [0, -4, 0] }}
      transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }} />)}
  </div>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex gap-3 px-4 py-3"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary border border-border">
        <Bot className="h-4 w-4 text-primary" />
      </div>

      <div className="flex min-w-0 max-w-[75%] flex-col gap-1">
        {steps.length > 0 ? <>
          <Button variant="ghost" className="glass h-auto justify-start whitespace-normal px-4 py-3 text-left text-xs text-muted-foreground" aria-expanded={open} aria-controls={id} aria-label={status || 'Recherche und Prüfung'} onClick={() => onOpenChange?.(!open)}>
            {dots}
            <span aria-live="polite" className="min-w-0 break-words">{status || ""}</span>
            {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
          {open && <div id={id}><Arbeitsschritte steps={steps} /></div>}
        </> : <>
          {!stream?.text && !stream?.draft && <div className="glass rounded-2xl rounded-bl-md px-4 py-3">{dots}</div>}
          <div aria-live="polite" className="px-2 text-xs text-muted-foreground">{status || ""}</div>
        </>}
        {(stream?.text || stream?.draft) && <StreamingAnswer text={stream.text} draft={stream.draft} />}
      </div>
    </motion.div>
  );
};
