import { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Message } from '@/types/chat';
import { ChatHeader } from './ChatHeader';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { TypingIndicator } from './TypingIndicator';
import { EmptyState } from './EmptyState';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export const ChatContainer = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [currentUserEmail, setCurrentUserEmail] = useState(() => {
    if (typeof window === 'undefined') return 'preview@test.com';
    const emailFromUrl = new URLSearchParams(window.location.search).get('email');
    return emailFromUrl || 'preview@test.com';
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  const sendMessage = async (content: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      content,
      role: 'user',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    const sessionId = localStorage.getItem('chat-session-id') || crypto.randomUUID();

    // Action detection
    const msg = content.toLowerCase();
    let action = 'question';
    const extra: Record<string, string> = { question: content };
    if (msg.startsWith('erstelle eine stellungnahme')) {
      action = 'draft_statement';
      extra.topic = content.replace(/erstelle eine stellungnahme zum thema:?/i, '').trim();
      delete extra.question;
    } else if (msg.startsWith('analysiere dieses behördenschreiben')) {
      action = 'analyze_pdf';
      delete extra.question;
    }

    const startTime = performance.now();
    try {
      console.log('Sende Nachricht über Edge Function:', { message: content, sessionId, action });

      const { data, error } = await supabase.functions.invoke('chat-proxy', {
        body: {
          message: content,
          action,
          ...extra,
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      console.log('n8n Antwort:', data);

      // Flexible Antwort-Erkennung: unterstützt verschachtelte JSON und Arrays
      let responseText: string;
      let imageUrl: string | undefined;

      const parsed = Array.isArray(data) ? data[0] : data;

      if (typeof data === 'string') {
        responseText = data;
      } else if (parsed && typeof parsed === 'object') {
        // Extract imageUrl if present
        imageUrl = parsed.imageUrl || parsed.image_url || undefined;
        // Handle Baurecht GPT structured response
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

  // Session ID initialisieren
  useEffect(() => {
    if (!localStorage.getItem('chat-session-id')) {
      localStorage.setItem('chat-session-id', crypto.randomUUID());
    }
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background">
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
        onSendMessage={(msg) => {
          sendMessage(msg);
          setInputValue('');
        }}
        isLoading={isLoading}
        inputValue={inputValue}
        onInputChange={setInputValue}
      />
    </div>
  );
};
