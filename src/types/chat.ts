export interface MessageAttachment {
  fileName: string;
  fileBase64: string;
}

export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  imageUrl?: string;
  durationMs?: number;
  attachment?: MessageAttachment;
}

export interface ChatConfig {
  webhookUrl: string;
}
