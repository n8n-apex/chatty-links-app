import { useState } from 'react';
import { FolderPlus, Loader2, Check, X, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type ProjectStatus = 'idle' | 'loading' | 'linked' | 'error';

interface ProjectPickerProps {
  projectRef: string | null;
  status: ProjectStatus;
  onBind: (ref: string) => void;
  onUnlink: () => void;
}

const extractFolderId = (input: string): string => {
  const v = (input || '').trim();
  if (!v) return '';
  const m = v.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // raw ID — strip any trailing query/path
  return v.split('?')[0].split('/')[0];
};

export const ProjectPicker = ({ projectRef, status, onBind, onUnlink }: ProjectPickerProps) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  if (status === 'linked' && projectRef) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-end px-4 py-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
          <Check className="h-3 w-3" />
          <span className="font-medium">Projekt verknüpft:</span>
          <span className="max-w-[200px] truncate font-mono text-[11px]" title={projectRef}>
            {projectRef}
          </span>
          <button
            type="button"
            onClick={onUnlink}
            className="ml-1 rounded-full p-0.5 hover:bg-primary/20"
            aria-label="Projekt entfernen"
            title="Projekt entfernen"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-end px-4 py-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
          <Loader2 className="h-3 w-3 animate-spin" />
          Projekt wird eingelesen…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl items-center justify-end gap-2 px-4 py-2">
      {!open ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          className="h-7 gap-1.5 rounded-full border border-border bg-background/50 px-3 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
        >
          <FolderPlus className="h-3 w-3" />
          Projekt verknüpfen
        </Button>
      ) : (
        <div className={cn(
          'flex w-full max-w-md items-center gap-2 rounded-xl border border-border bg-background/70 p-1.5',
          status === 'error' && 'border-destructive/50',
        )}>
          <Link2 className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Google Drive Ordner-Link oder ID"
            className="h-7 flex-1 border-0 bg-transparent px-1 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const id = extractFolderId(value);
                if (id) {
                  onBind(id);
                  setValue('');
                  setOpen(false);
                }
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="glow"
            className="h-7 px-3 text-xs"
            disabled={!extractFolderId(value)}
            onClick={() => {
              const id = extractFolderId(value);
              if (id) {
                onBind(id);
                setValue('');
                setOpen(false);
              }
            }}
          >
            Verknüpfen
          </Button>
          <button
            type="button"
            onClick={() => { setOpen(false); setValue(''); }}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            aria-label="Abbrechen"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
