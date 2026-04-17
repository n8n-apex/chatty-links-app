export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  imageUrl?: string;
  durationMs?: number;
}

export interface ChatConfig {
  webhookUrl: string;
}
