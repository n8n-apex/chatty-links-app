ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS chat_messages_deleted_at_idx ON public.chat_messages (deleted_at);