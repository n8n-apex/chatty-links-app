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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  const sendMessage = async (content: string) => {
    if (!WEBHOOK_URL) {
      toast.error('Webhook URL nicht konfiguriert. Bitte VITE_N8N_WEBHOOK_URL setzen.');
      console.error('VITE_N8N_WEBHOOK_URL ist nicht gesetzt');
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      content,
      role: 'user',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    const sessionId = localStorage.getItem('chat-session-id') || crypto.randomUUID();

    try {
      console.log('Sende Nachricht an n8n:', { message: content, sessionId });
      console.log('Webhook URL:', WEBHOOK_URL);
      
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: content,
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
        }),
      });

      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('n8n Antwort:', data);
      
      // Flexible Antwort-Erkennung (n8n kann verschiedene Formate zurückgeben)
      const responseText = data.response || data.message || data.output || data.text || 
                          (typeof data === 'string' ? data : JSON.stringify(data));
      
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        content: responseText,
        role: 'assistant',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Fehler beim Senden:', error);
      toast.error('Nachricht konnte nicht gesendet werden. Überprüfe die Webhook-Verbindung.');
    } finally {
      setIsLoading(false);
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
                <ChatMessage key={message.id} message={message} />
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
