import { useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { Message } from "@/types/chat";
import { cn } from "@/lib/utils";
import { User, Bot, Copy, Check, Download, ThumbsUp, Pencil, X, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { StructuredResponse, tryParseStructured, structuredToPlainText } from "./StructuredResponse";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export type FeedbackStatus = "correct" | "correction" | "inaccurate" | "note";

interface ChatMessageProps {
  message: Message;
  onFeedback?: (messageId: string, status: FeedbackStatus, text?: string) => Promise<boolean> | void | Promise<void>;
  isAdmin?: boolean;
}

export const ChatMessage = ({ message, onFeedback, isAdmin: _isAdminProp = false }: ChatMessageProps) => {
  const isUser = message.role === "user";

  const isAdmin = (() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email') || '';
    const adminEmails = ['sebastian@umnutzung.de', 'utkarsh@apex-consulting.ai', 'preview@test.com'];
    if (adminEmails.includes(email.toLowerCase())) return true;
    return (window as unknown as { __isAdminVerified?: boolean }).__isAdminVerified === true;
  })();
  const [copied, setCopied] = useState(false);
  const [modal, setModal] = useState<null | "correction" | "note">(null);
  const [modalText, setModalText] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitted = !!message.feedbackSubmitted;

  // Feedback gating (CHANGE 6 + 7):
  // - Legacy messages (no backend response_id stored) → disable all 4 buttons
  // - Clarification or chunk-less answers → disable Korrekt/Korrektur/Ungenau, keep Notiz
  const hasResponseId = !!message.responseId;
  const hasChunks = Array.isArray(message.usedChunkIds) && message.usedChunkIds.length > 0;
  const isLegacy = !isUser && !hasResponseId;
  const chunkActionsDisabled = isLegacy || !hasChunks;
  const noteDisabled = isLegacy;
  const legacyTitle = "Feedback nicht verfügbar für ältere Nachrichten";
  const noChunksTitle = "Keine Quellen-Chunks für Feedback verfügbar";

  const structured = !isUser ? tryParseStructured(message.content) : null;

  const sourceCount = (() => {
    if (!structured) return 0;
    let count = 0;
    if (Array.isArray(structured.quellen)) count += structured.quellen.length;
    else if (typeof structured.quellen === "string" && structured.quellen.trim()) count += 1;
    if (Array.isArray(structured.rechtsgrundlage)) count += structured.rechtsgrundlage.length;
    else if (typeof structured.rechtsgrundlage === "string" && structured.rechtsgrundlage.trim()) count += 1;
    return count;
  })();

  const handleCopy = async () => {
    const textToCopy = structured ? structuredToPlainText(structured) : message.content;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (url: string) => {
    if (!url) {
      toast.error("Download-Link fehlt");
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const submit = async (status: FeedbackStatus, text?: string): Promise<boolean> => {
    if (submitting || submitted) return false;
    setSubmitting(true);
    try {
      const result = await onFeedback?.(message.id, status, text);
      // result may be void or boolean; treat anything but explicit false as success
      return result !== false;
    } finally {
      setSubmitting(false);
    }
  };

  const openModal = (kind: "correction" | "note") => {
    setModal(kind);
    setModalText("");
    setModalError(null);
  };

  const handleModalSubmit = async () => {
    const trimmed = modalText.trim();
    if (!trimmed) {
      setModalError(
        modal === "correction"
          ? "Bitte geben Sie die korrigierte Antwort ein"
          : "Bitte geben Sie eine Notiz ein",
      );
      return;
    }
    const ok = await submit(modal as FeedbackStatus, trimmed);
    if (ok) {
      setModal(null);
      setModalText("");
      setModalError(null);
    }
    // On failure: keep modal open + preserve typed text so admin can retry.
  };

  const fbBtnBase =
    "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("group flex gap-3 px-4 py-3", isUser ? "flex-row-reverse" : "flex-row")}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          isUser ? "gradient-primary shadow-glow" : "bg-secondary border border-border",
        )}
      >
        {isUser ? <User className="h-4 w-4 text-primary-foreground" /> : <Bot className="h-4 w-4 text-primary" />}
      </div>

      <div className={cn("flex max-w-[75%] flex-col gap-1", isUser ? "items-end" : "items-start")}>
        <div className="relative">
          <div
            className={cn(
              "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              isUser ? "gradient-primary text-primary-foreground rounded-br-md" : "glass text-foreground rounded-bl-md",
            )}
          >
            {isUser ? (
              message.content
            ) : (
              <>
                {(message.imageUrl || /<\s*img\s/i.test(message.content)) && (
                  <div className="mb-2 relative group/img">
                    <img
                      src={message.imageUrl || message.content.match(/src=['"](.*?)['"]/)?.[1] || ""}
                      alt="Generated image"
                      className="max-w-full rounded-lg"
                      style={{ maxHeight: "400px" }}
                    />
                    <button
                      onClick={() =>
                        handleDownload(message.imageUrl || message.content.match(/src=['"](.*?)['"]/)?.[1] || "")
                      }
                      className="absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-opacity rounded-lg p-2 bg-background/80 backdrop-blur-sm border border-border text-foreground hover:bg-background shadow-sm cursor-pointer"
                      title="Bild herunterladen"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {!/<\s*img\s/i.test(message.content) &&
                  (() => {
                    if (structured) {
                      return <StructuredResponse data={structured} />;
                    }
                    return (
                      <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-ol:list-decimal prose-ul:list-disc">
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                            ul: ({ children }) => <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>,
                            ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>,
                            li: ({ children }) => <li className="mb-1">{children}</li>,
                            h1: ({ children }) => <h1 className="mb-2 text-base font-bold">{children}</h1>,
                            h2: ({ children }) => <h2 className="mb-2 text-sm font-bold">{children}</h2>,
                            h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
                            a: ({ href, children }) => (
                              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                                {children}
                              </a>
                            ),
                            code: ({ children }) => (
                              <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
                            ),
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    );
                  })()}
              </>
            )}
          </div>

          {!isUser && (
            <div className="absolute -bottom-1 right-1 translate-y-full flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleCopy}
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                title="Text kopieren"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
        </div>

        {!isUser && isAdmin && (
          <div className="mt-1 w-full">
            <div className="flex items-center gap-1">
              <button
                onClick={() => submit("correct")}
                disabled={submitted || submitting || chunkActionsDisabled}
                title={isLegacy ? legacyTitle : !hasChunks ? noChunksTitle : "Korrekt"}
                className={cn(
                  fbBtnBase,
                  message.feedbackSubmitted === "correct"
                    ? "bg-green-500/15 text-green-500"
                    : "text-muted-foreground hover:bg-green-500/10 hover:text-green-500",
                )}
              >
                {message.feedbackSubmitted === "correct" ? <Check className="h-3.5 w-3.5" /> : <ThumbsUp className="h-3.5 w-3.5" />}
                <span>Korrekt</span>
              </button>

              <button
                onClick={() => openModal("correction")}
                disabled={submitted || submitting || chunkActionsDisabled}
                title={isLegacy ? legacyTitle : !hasChunks ? noChunksTitle : "Korrektur"}
                className={cn(
                  fbBtnBase,
                  message.feedbackSubmitted === "correction"
                    ? "bg-yellow-500/15 text-yellow-500"
                    : "text-muted-foreground hover:bg-yellow-500/10 hover:text-yellow-500",
                )}
              >
                <Pencil className="h-3.5 w-3.5" />
                <span>Korrektur</span>
              </button>

              <button
                onClick={() => submit("inaccurate")}
                disabled={submitted || submitting || chunkActionsDisabled}
                title={isLegacy ? legacyTitle : !hasChunks ? noChunksTitle : "Ungenau"}
                className={cn(
                  fbBtnBase,
                  message.feedbackSubmitted === "inaccurate"
                    ? "bg-red-500/15 text-red-500"
                    : "text-muted-foreground hover:bg-red-500/10 hover:text-red-500",
                )}
              >
                <X className="h-3.5 w-3.5" />
                <span>Ungenau</span>
              </button>

              <button
                onClick={() => openModal("note")}
                disabled={submitted || submitting || noteDisabled}
                title={noteDisabled ? legacyTitle : "Notiz"}
                className={cn(
                  fbBtnBase,
                  message.feedbackSubmitted === "note"
                    ? "bg-blue-500/15 text-blue-500"
                    : "text-muted-foreground hover:bg-blue-500/10 hover:text-blue-500",
                )}
              >
                <StickyNote className="h-3.5 w-3.5" />
                <span>Notiz</span>
              </button>

            </div>
          </div>
        )}

        {!isUser && sourceCount > 0 && <ConfidenceIndicator sources={sourceCount} className="px-2" />}

        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <span>
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {!isUser && typeof message.durationMs === "number" && (
            <span title="Antwortzeit">· Antwort in {(message.durationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
      </div>

      <Dialog open={modal !== null} onOpenChange={(o) => { if (!o) { setModal(null); setModalText(""); setModalError(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {modal === "correction" ? "Bitte geben Sie die korrekte Antwort ein" : "Notiz für das Team"}
            </DialogTitle>
          </DialogHeader>
          {modal === "correction" && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground max-h-40 overflow-y-auto whitespace-pre-wrap">
              <div className="mb-1 font-medium text-foreground/80">Ursprüngliche Antwort</div>
              {structured ? structuredToPlainText(structured) : message.content}
            </div>
          )}
          <textarea
            value={modalText}
            onChange={(e) => { setModalText(e.target.value); if (modalError) setModalError(null); }}
            rows={5}
            placeholder={
              modal === "correction"
                ? "Geben Sie die korrekte Antwort ein…"
                : "Ihre Notiz für das Team…"
            }
            className="w-full min-h-[120px] rounded-md border border-border bg-background/50 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {modalError && <p className="text-xs text-destructive">{modalError}</p>}
          <DialogFooter>
            <button
              type="button"
              onClick={() => { setModal(null); setModalText(""); setModalError(null); }}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleModalSubmit}
              disabled={submitting || modalText.trim().length === 0}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {modal === "correction" ? "Speichern" : "Senden"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </motion.div>
  );
};
