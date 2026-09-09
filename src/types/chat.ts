export interface VerstandenZustand {
  has_analysis?: boolean;
  has_draft?: boolean;
  has_sources?: boolean;
  draft_is_stale?: boolean;
  subject_file?: string | null;
  source_count?: number;
  [key: string]: unknown;
}

/** Router self-report emitted by `Decide Intent` on every routed turn. */
export interface Verstanden {
  typ?: string;
  grund?: string;
  client_turn_id?: string;
  alternativen?: string[];
  zustand?: VerstandenZustand;
  [key: string]: unknown;
}

export interface Message {

  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  imageUrl?: string;
  durationMs?: number;
  // Metadata for feedback flow (B3/B4/B6 responses)
  responseId?: string;          // backend's response_id (resp_…)
  usedChunkIds?: string[];
  usedParagraphs?: string[];
  needsClarification?: boolean; // true for clarification answers (no chunks)
  // Track feedback already submitted on this assistant message
  feedbackSubmitted?: 'correct' | 'inaccurate' | 'correction' | 'note';
  // Backend routing explanation (e.g. Behördenschreiben without doc answered as Rechtsfrage)
  routingNotice?: string;
  // Router self-report: what the backend understood this turn to be.
  verstanden?: Verstanden;
  /** Row id in the persisted history, when this message has been stored. */
  historyId?: string;

}


export interface ChatConfig {
  webhookUrl: string;
}
