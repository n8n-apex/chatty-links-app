import { Md, DraftLetter, CiteStaticContext } from "./StructuredResponse";
import { splitComplete } from "@/lib/answerStream";
import { Loader2 } from "lucide-react";

/** The answer while it is being written; same renderer/layout as the finished card. */
export const StreamingAnswer = ({ text, draft, checking = false }: { text: string; draft: string | null; checking?: boolean }) => {
  const t = splitComplete(text);
  const d = draft ? splitComplete(draft) : null;
  return (
    <div data-stream-answer className="w-full min-w-0 text-foreground">
      <div aria-live="polite" className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {checking ? <>
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none text-muted-foreground" />
          <span>Antwort fertig, Quellen und Zitate werden geprüft …</span>
        </> : "Antwort wird geschrieben und anschließend geprüft"}
      </div>
      {text && (
        <div className="text-foreground break-words">
          <Md>{t.done}</Md>
          {t.tail && <p className="answer-tail whitespace-pre-line">{t.tail}</p>}
        </div>
      )}
      {d && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">Entwurf (wird geprüft)</div>
          <DraftLetter text={d.done + (d.tail ? "\n" + d.tail : "")} />
        </div>
      )}
    </div>
  );
};
