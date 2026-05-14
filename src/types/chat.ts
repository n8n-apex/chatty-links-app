export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  imageUrl?: string;
  durationMs?: number;
  // Metadata for feedback flow (B3/B4/B6 responses)
  usedChunkIds?: string[];
  usedParagraphs?: string[];
  // Track feedback already submitted on this assistant message
  feedbackSubmitted?: 'correct' | 'inaccurate' | 'correction' | 'note';
}

export interface ChatConfig {
  webhookUrl: string;
}
