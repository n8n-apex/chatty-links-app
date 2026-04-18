import { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Menu, MessageSquare, FileText, Search } from 'lucide-react';
import { Message } from '@/types/chat';
import { ChatHeader } from './ChatHeader';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { TypingIndicator } from './TypingIndicator';
import { EmptyState } from './EmptyState';
import { ConversationSidebar, ConversationSummary } from './ConversationSidebar';
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
  const isUnresolvedEmail = currentUserEmail.includes('{{') || currentUserEmail.includes('}}');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Privacy: when embedded in an iframe, the email comes from an untrusted URL param
  // and could be spoofed to view someone else's history. Disable history/sidebar entirely.
  const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
  const historyEnabled = !isEmbedded;
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.self !== window.top) return false;
    return window.innerWidth >= 768;
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // Load conversations list for the current user
  const loadConversations = useCallback(async () => {
    if (!currentUserEmail) return [] as ConversationSummary[];
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_email', currentUserEmail)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Fehler beim Laden des Verlaufs:', error);
      return [];
    }

    const map = new Map<string, { firstUserMsg?: string; lastAt: Date }>();
    for (const row of data || []) {
      const cid = (row as any).conversation_id || 'legacy';
      const existing = map.get(cid) || { lastAt: new Date(row.created_at) };
      if (!existing.firstUserMsg && row.role === 'user') {
        existing.firstUserMsg = row.content;
      }
      existing.lastAt = new Date(row.created_at);
      map.set(cid, existing);
    }

    const list: ConversationSummary[] = Array.from(map.entries()).map(([id, v]) => ({
      id,
      title: (v.firstUserMsg || 'Neues Gespräch').slice(0, 40),
      lastAt: v.lastAt,
    }));
    list.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
    setConversations(list);
    return list;
  }, [currentUserEmail]);

  const loadConversationMessages = useCallback(
    async (cid: string) => {
      if (!currentUserEmail) return;
      let query = supabase
        .from('chat_messages')
        .select('*')
        .eq('user_email', currentUserEmail)
        .order('created_at', { ascending: true });

      query = cid === 'legacy'
        ? query.is('conversation_id', null)
        : query.eq('conversation_id', cid);

      const { data, error } = await query;
      if (error) {
        console.error('Fehler beim Laden der Nachrichten:', error);
        return;
      }
      const restored: Message[] = (data || []).map((row: any) => ({
        id: row.id,
        content: row.content,
        role: row.role === 'ai' ? 'assistant' : 'user',
        timestamp: new Date(row.created_at),
      }));
      setMessages(restored);
    },
    [currentUserEmail],
  );

  useEffect(() => {
    (async () => {
      if (historyEnabled) {
        await loadConversations();
      } else {
        setConversations([]);
      }
      // Always start with a fresh empty conversation on mount/refresh
      setConversationId(crypto.randomUUID());
      setMessages([]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserEmail]);

  const persistMessage = async (role: 'user' | 'ai', content: string) => {
    if (!currentUserEmail || !content || !conversationId) return;
    const { error } = await supabase.from('chat_messages').insert({
      user_email: currentUserEmail,
      role,
      content,
      conversation_id: conversationId,
    });
    if (error) console.error('Fehler beim Speichern der Nachricht:', error);
  };

  const handleNewConversation = () => {
    const newId = crypto.randomUUID();
    setConversationId(newId);
    setMessages([]);
    if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleSelectConversation = async (cid: string) => {
    setConversationId(cid);
    await loadConversationMessages(cid);
    if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleDeleteConversation = async (cid: string) => {
    if (!currentUserEmail) return;
    let query = supabase
      .from('chat_messages')
      .delete()
      .eq('user_email', currentUserEmail);
    query = cid === 'legacy' ? query.is('conversation_id', null) : query.eq('conversation_id', cid);
    const { error } = await query;
    if (error) {
      console.error('Fehler beim Löschen:', error);
      toast.error('Gespräch konnte nicht gelöscht werden.');
      return;
    }
    toast.success('Gespräch gelöscht');
    if (conversationId === cid) {
      setMessages([]);
      setConversationId(crypto.randomUUID());
    }
    await loadConversations();
  };

  const sendMessage = async (content: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      content,
      role: 'user',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    persistMessage('user', content);

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
      persistMessage('ai', responseText);
      // Refresh sidebar list (title/lastAt) after a successful exchange
      if (historyEnabled) loadConversations();
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
    <div className="flex h-screen w-full bg-background">
      {historyEnabled && (
        <ConversationSidebar
          conversations={conversations}
          activeId={conversationId}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onSelect={handleSelectConversation}
          onNew={handleNewConversation}
        />
      )}

      <div className="relative flex h-screen flex-1 flex-col">
        {/* Ambient glow effect */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-1/4 top-0 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -right-1/4 bottom-0 h-96 w-96 rounded-full bg-accent/5 blur-3xl" />
        </div>

        {/* Sidebar toggle (only when history is available) */}
        {historyEnabled && !sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/80 text-muted-foreground backdrop-blur hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Seitenleiste öffnen"
            title="Gespräche"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}

        <ChatHeader onLogoClick={handleNewConversation} />

        <div className={`border-b border-border backdrop-blur-xl ${isUnresolvedEmail ? 'bg-destructive/10' : 'bg-background/60'}`}>
          <div className="mx-auto max-w-3xl px-4 py-1.5 text-center">
            {isUnresolvedEmail ? (
              <span className="text-[11px] text-destructive">
                ⚠ E-Mail nicht erkannt. Bitte kontaktieren Sie Ihren Administrator.
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground/70">
                Eingeloggt als: <span className="font-mono text-muted-foreground">{currentUserEmail}</span>
              </span>
            )}
          </div>
        </div>

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

        <div className="border-t border-border bg-background/80 px-4 pt-3 backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
            {[
              { icon: MessageSquare, label: 'Rechtsfrage', prefill: 'Ich habe eine Baurechtsfrage: ' },
              { icon: FileText, label: 'Stellungnahme', prefill: 'Erstelle eine Stellungnahme zum Thema: ' },
              { icon: Search, label: 'Behördenschreiben', prefill: 'Analysiere dieses Behördenschreiben: ' },
            ].map(({ icon: Icon, label, prefill }) => (
              <button
                key={label}
                type="button"
                onClick={() => setInputValue(prefill)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground"
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        </div>
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
    </div>
  );
};
