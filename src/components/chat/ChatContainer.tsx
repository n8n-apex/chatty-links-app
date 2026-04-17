import { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Upload } from 'lucide-react';
import { Message } from '@/types/chat';
import { ChatHeader } from './ChatHeader';
import { ChatMessage } from './ChatMessage';
import { ChatInput, PendingAttachment } from './ChatInput';
import { TypingIndicator } from './TypingIndicator';
import { EmptyState } from './EmptyState';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export const ChatContainer = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  const sendMessage = async (content: string, pendingAttachment?: PendingAttachment) => {
    const displayContent = pendingAttachment
      ? `📎 ${pendingAttachment.fileName}${content ? ` — ${content}` : ''}`
      : content;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      content: displayContent,
      role: 'user',
      timestamp: new Date(),
      attachment: pendingAttachment
        ? { fileName: pendingAttachment.fileName, fileBase64: pendingAttachment.fileBase64 }
        : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    const sessionId = localStorage.getItem('chat-session-id') || crypto.randomUUID();

    // Action detection
    const msg = content.toLowerCase();
    let action = 'question';
    const extra: Record<string, string> = { question: content };

    if (pendingAttachment) {
      action = 'analyze_pdf';
      delete extra.question;
      extra.file_name = pendingAttachment.fileName;
      extra.file_base64 = pendingAttachment.fileBase64;
    } else if (msg.startsWith('erstelle eine stellungnahme')) {
      action = 'draft_statement';
      extra.topic = content.replace(/erstelle eine stellungnahme zum thema:?/i, '').trim();
      delete extra.question;
    } else if (msg.startsWith('analysiere dieses behördenschreiben')) {
      action = 'analyze_pdf';
      delete extra.question;
    }

    const startTime = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke('chat-proxy', {
        body: {
          message: content,
          action,
          ...extra,
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
        },
      });

      if (error) throw new Error(error.message);

      let responseText: string;
      let imageUrl: string | undefined;
      const parsed = Array.isArray(data) ? data[0] : data;

      if (typeof data === 'string') {
        responseText = data;
      } else if (parsed && typeof parsed === 'object') {
        imageUrl = parsed.imageUrl || parsed.image_url || undefined;
        if (parsed.action === 'question' || parsed.antwort) {
          responseText = JSON.stringify(parsed);
        } else {
          responseText = parsed.output || parsed.response || parsed.message || parsed.text || JSON.stringify(data);
        }
      } else {
        responseText = String(data);
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        content: responseText,
        role: 'assistant',
        timestamp: new Date(),
        imageUrl,
        durationMs: performance.now() - startTime,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Fehler beim Senden:', error);
      toast.error('Nachricht konnte nicht gesendet werden. Überprüfe die Webhook-Verbindung.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedback = async (messageId: string, status: string, correctedText?: string) => {
    try {
      console.log('Sending feedback:', { messageId, status });
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          action: 'submit_feedback',
          response_id: messageId,
          status: status,
          corrected_text: correctedText || null,
          sessionId: localStorage.getItem('chat-session-id')
        })
      });
      console.log('Feedback response:', response.status);
    } catch (e) {
      console.error('Feedback error:', e);
    }
  };

  useEffect(() => {
    if (!localStorage.getItem('chat-session-id')) {
      localStorage.setItem('chat-session-id', crypto.randomUUID());
    }
  }, []);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      dragDepthRef.current += 1;
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      toast.error('Nur PDF-Dateien werden unterstützt');
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      setAttachment({ fileName: file.name, fileBase64: base64 });
      toast.success(`${file.name} angehängt`);
    } catch {
      toast.error('Datei konnte nicht gelesen werden');
    }
  };

  return (
    <div
      className="flex h-screen flex-col bg-background"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Ambient glow effect */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-1/4 top-0 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -right-1/4 bottom-0 h-96 w-96 rounded-full bg-accent/5 blur-3xl" />
      </div>

      <ChatHeader onLogoClick={() => setMessages([])} />

      <main className="relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl">
          {messages.length === 0 ? (
            <EmptyState onSuggestionClick={(text) => setInputValue(text)} />
          ) : (
            <div className="py-4">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} onFeedback={handleFeedback} />
              ))}
              <AnimatePresence>
                {isLoading && <TypingIndicator />}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </main>

      <ChatInput
        onSendMessage={(msg, att) => {
          sendMessage(msg, att);
          setInputValue('');
          setAttachment(null);
        }}
        isLoading={isLoading}
        inputValue={inputValue}
        onInputChange={setInputValue}
        attachment={attachment}
        onAttachmentChange={setAttachment}
      />

      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md pointer-events-none"
          >
            <div className="flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-primary px-12 py-10 bg-card/80 shadow-glow">
              <Upload className="h-12 w-12 text-primary animate-pulse" />
              <p className="text-xl font-semibold text-foreground">PDF hier ablegen zur Analyse</p>
              <p className="text-sm text-muted-foreground">Nur PDF-Dateien werden unterstützt</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
