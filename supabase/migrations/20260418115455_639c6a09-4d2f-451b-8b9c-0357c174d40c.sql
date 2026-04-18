CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'ai')),
  user_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view chat messages"
ON public.chat_messages
FOR SELECT
USING (true);

CREATE POLICY "Public can insert chat messages"
ON public.chat_messages
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Public can update chat messages"
ON public.chat_messages
FOR UPDATE
USING (true);

CREATE POLICY "Public can delete chat messages"
ON public.chat_messages
FOR DELETE
USING (true);

CREATE INDEX idx_chat_messages_user_email ON public.chat_messages(user_email);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages(created_at DESC);