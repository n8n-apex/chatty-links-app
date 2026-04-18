ALTER TABLE public.chat_messages ADD COLUMN conversation_id uuid;
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON public.chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_email ON public.chat_messages(user_email);