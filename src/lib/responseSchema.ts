import { z } from "zod";

/**
 * Shape validation for backend payloads.
 *
 * Rules that must not be broken:
 *  - Error envelopes are recognised FIRST, so Prompt A's error cards keep rendering.
 *  - Every member is `.passthrough()`: unknown fields are allowed, never stripped.
 *  - A payload that carries a usable plain-text field is VALID. Plain-text answers
 *    worked before this file existed and must keep working.
 *  - Nothing here rewrites the payload; callers keep passing the original object on.
 */

const nonEmpty = z.string().refine((s) => s.trim().length > 0);

/** 1. Error envelope — checked before anything else. */
const ErrorEnvelope = z
  .object({ status: z.literal("error") })
  .passthrough();

/** 2. Async poll envelope (analyze_pdf request/reply). */
const PollEnvelope = z
  .object({
    status: z.enum(["accepted", "processing", "pending", "queued", "running", "done", "ready", "complete", "completed"]),
  })
  .passthrough();

const ReadyEnvelope = z.object({ ready: z.boolean() }).passthrough();

/** 3. Clarification / Rückfrage. */
const Clarification = z
  .object({ needs_clarification: z.literal(true) })
  .passthrough();

const KontextRueckfrage = z
  .object({ kontext_ausreichend: z.literal(false) })
  .passthrough();

/** 4. B3 — Rechtsfrage answer. */
const B3Answer = z.object({ antwort: z.unknown() }).passthrough().refine(
  (o) => o.antwort !== undefined && o.antwort !== null,
);

/** 5. B4 — Behördenschreiben analysis. */
const B4Analysis = z
  .object({})
  .passthrough()
  .refine((o: Record<string, unknown>) =>
    ["zusammenfassung", "projekt_und_sachverhalt", "analyse_der_forderungen",
     "beurteilung_der_einzelfakten", "schlussfolgerung", "rechtliche_beurteilungsgrundlage"]
      .some((k) => o[k] !== undefined && o[k] !== null),
  );

/** 6. B6 — Stellungnahme draft / revision. */
const B6Draft = z
  .object({})
  .passthrough()
  .refine((o: Record<string, unknown>) =>
    ["entwurf_stellungnahme", "antwortschreiben_entwurf", "revised_draft", "sections_touched"]
      .some((k) => o[k] !== undefined && o[k] !== null),
  );

/** 7. Routed action envelope. */
const ActionEnvelope = z.object({ action: nonEmpty }).passthrough();

/** 8. Plain passthrough — a usable text field is a valid response. */
const PlainText = z
  .object({})
  .passthrough()
  .refine((o: Record<string, unknown>) =>
    ["output", "response", "message", "text"].some(
      (k) => typeof o[k] === "string" && (o[k] as string).trim().length > 0,
    ),
  );

const MEMBERS: Array<{ kind: string; schema: z.ZodTypeAny }> = [
  { kind: "error", schema: ErrorEnvelope },
  { kind: "poll", schema: PollEnvelope },
  { kind: "poll_ready", schema: ReadyEnvelope },
  { kind: "clarification", schema: Clarification },
  { kind: "clarification", schema: KontextRueckfrage },
  { kind: "b3_answer", schema: B3Answer },
  { kind: "b4_analysis", schema: B4Analysis },
  { kind: "b6_draft", schema: B6Draft },
  { kind: "action", schema: ActionEnvelope },
  { kind: "plain_text", schema: PlainText },
];

export type BackendParseResult =
  | { ok: true; kind: string }
  | { ok: false; issuePaths: string[] };

/** True when the payload carries a plain-text field we can render as-is. */
export const hasUsablePlainText = (value: unknown): boolean =>
  PlainText.safeParse(value).success;

/**
 * Validate a backend payload against the known response shapes.
 * Never throws, never mutates, never returns the payload.
 */
export const parseBackendPayload = (value: unknown): BackendParseResult => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issuePaths: ["<root:not-an-object>"] };
  }
  const issuePaths: string[] = [];
  for (const member of MEMBERS) {
    const result = member.schema.safeParse(value);
    if (result.success) return { ok: true, kind: member.kind };
    for (const issue of result.error.issues) {
      issuePaths.push(`${member.kind}:${issue.path.join(".") || "<root>"}`);
    }
  }
  return { ok: false, issuePaths };
};

/**
 * The envelope emitted when a JSON object matches nothing and has no plain text.
 * `status: 'error'` is deliberate: it is the FIRST condition tryParseStructured
 * checks, so this object always reaches the error card renderer.
 */
export const schemaInvalidEnvelope = (issuePaths: string[]) => ({
  status: "error" as const,
  error: "schema_invalid",
  message:
    "Die Antwort des Servers hatte ein unerwartetes Format und konnte nicht dargestellt werden.",
  details: issuePaths.slice(0, 8),
});
