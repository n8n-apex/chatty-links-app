import { Md, DraftLetter } from "./StructuredResponse";
import { splitComplete } from "@/lib/answerStream";

/** The answer while it is being written; same renderer/layout as the finished card. */
export const StreamingAnswer = ({ text, draft }: { text: string; draft: string | null }) => {
  const t = splitComplete(text);
  const d = draft ? splitComplete(draft) : null;
  return (
    <div className="w-full min-w-0 text-foreground">
      <div className="mb-2 text-[11px] text-muted-foreground">Antwort wird geschrieben und anschließend geprüft</div>
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
