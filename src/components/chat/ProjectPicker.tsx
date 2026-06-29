import { useState } from "react";
import { FolderOpen, Loader2, X, Link as LinkIcon, Check } from "lucide-react";

export type ProjectStatus = "idle" | "loading" | "linked" | "error";

interface ProjectPickerProps {
  projectRef: string | null;
  status: ProjectStatus;
  onBind: (ref: string) => void;
  onUnlink: () => void;
}

// Extract folder id from a Google Drive folder URL, or pass through raw IDs.
const extractFolderId = (input: string): string => {
  const s = (input || "").trim();
  if (!s) return "";
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // strip any query string from a bare token
  return s.split("?")[0].split("/")[0];
};

export const ProjectPicker = ({ projectRef, status, onBind, onUnlink }: ProjectPickerProps) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const handleConfirm = () => {
    const id = extractFolderId(value);
    if (!id) return;
    onBind(id);
    setOpen(false);
    setValue("");
  };

  return (
    <div className="border-b border-border bg-background/40 px-4 py-2 backdrop-blur-xl">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 text-xs">
        {projectRef ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-primary">
            {status === "loading" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            <span className="max-w-[260px] truncate font-mono">
              {status === "loading" ? "Projekt wird eingelesen…" : "Projekt verknüpft:"} {projectRef.slice(0, 16)}{projectRef.length > 16 ? "…" : ""}
            </span>
            <button
              type="button"
              onClick={onUnlink}
              className="ml-1 rounded p-0.5 hover:bg-primary/20"
              aria-label="Projekt entfernen"
              title="entfernen"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : open ? (
          <div className="flex flex-1 items-center gap-2">
            <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirm();
                if (e.key === "Escape") { setOpen(false); setValue(""); }
              }}
              placeholder="Google-Drive-Ordnerlink oder ID einfügen…"
              className="flex-1 rounded-md border border-border bg-background/60 px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
            />
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!value.trim()}
              className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/20 disabled:opacity-40"
            >
              Verknüpfen
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setValue(""); }}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted/40"
              aria-label="Abbrechen"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/50 px-3 py-1 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground"
          >
            <FolderOpen className="h-3 w-3" />
            Projekt verknüpfen
          </button>
        )}
        {status === "error" && !projectRef && (
          <span className="text-destructive">Fehler beim Einlesen</span>
        )}
      </div>
    </div>
  );
};
