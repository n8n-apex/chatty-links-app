import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, MessageSquare, MoreHorizontal, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ConversationSummary {
  id: string;
  title: string;
  lastAt: Date;
}

interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

const groupConversations = (items: ConversationSummary[]) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const groups: Record<string, ConversationSummary[]> = {
    Heute: [],
    Gestern: [],
    'Diese Woche': [],
    Älter: [],
  };

  for (const c of items) {
    const t = c.lastAt.getTime();
    if (t >= startOfToday) groups['Heute'].push(c);
    else if (t >= startOfYesterday) groups['Gestern'].push(c);
    else if (t >= startOfWeek) groups['Diese Woche'].push(c);
    else groups['Älter'].push(c);
  }
  return groups;
};

const formatTime = (d: Date) => {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

export const ConversationSidebar = ({
  conversations,
  activeId,
  open,
  onClose,
  onSelect,
  onNew,
  onDelete,
}: ConversationSidebarProps) => {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Lock body scroll on mobile when open
  useEffect(() => {
    if (open && window.innerWidth < 768) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  // Close menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuId]);

  const groups = groupConversations(conversations);

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm md:hidden"
          />
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {open && (
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
            className="fixed left-0 top-0 z-50 flex h-screen w-[260px] flex-col border-r border-border bg-card/95 backdrop-blur-xl md:relative md:z-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Baurecht GPT</h2>
              <button
                onClick={onClose}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors md:hidden"
                aria-label="Schließen"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* New conversation */}
            <div className="px-3 pt-3">
              <button
                onClick={onNew}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>Neues Gespräch</span>
              </button>
            </div>

            {/* Conversation list */}
            <div className="mt-4 flex-1 overflow-y-auto px-2 pb-4">
              {conversations.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Noch keine Gespräche
                </p>
              ) : (
                Object.entries(groups).map(([label, items]) =>
                  items.length === 0 ? null : (
                    <div key={label} className="mb-4">
                      <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                        {label}
                      </div>
                      <ul className="space-y-0.5">
                        {items.map((c) => (
                          <li key={c.id} className="relative group/item">
                            <button
                              onClick={() => onSelect(c.id)}
                              className={cn(
                                'flex w-full items-start gap-2 rounded-md px-3 py-2 pr-8 text-left text-sm transition-colors',
                                activeId === c.id
                                  ? 'bg-accent text-accent-foreground'
                                  : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground',
                              )}
                            >
                              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium">{c.title}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {formatTime(c.lastAt)}
                                </div>
                              </div>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(openMenuId === c.id ? null : c.id);
                              }}
                              className={cn(
                                'absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-opacity hover:bg-background hover:text-foreground',
                                openMenuId === c.id || activeId === c.id
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover/item:opacity-100',
                              )}
                              aria-label="Optionen"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                            {openMenuId === c.id && (
                              <div
                                ref={menuRef}
                                className="absolute right-1.5 top-full z-50 mt-1 min-w-[140px] overflow-hidden rounded-md border border-border bg-popover shadow-lg"
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId(null);
                                    onDelete(c.id);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Löschen
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ),
                )
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
};
