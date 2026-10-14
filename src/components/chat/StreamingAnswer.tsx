import ReactMarkdown from "react-markdown";

/** The answer while it is being written. Replaced by the checked answer card. */
export const StreamingAnswer = ({ text, draft }: { text: string; draft: string | null }) => (
  <div className="glass min-w-0 rounded-2xl rounded-bl-md px-4 py-3">
    <div className="mb-2 text-[11px] text-muted-foreground">Antwort wird geschrieben und anschließend geprüft</div>
    {text && (
      <div className="prose prose-sm max-w-none break-words dark:prose-invert prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-headings:text-foreground">
        <ReactMarkdown>{text}</ReactMarkdown>
      </div>
    )}
    {draft && (
      <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3">
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">Entwurf (wird geprüft)</div>
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">{draft}</div>
      </div>
    )}
  </div>
);
