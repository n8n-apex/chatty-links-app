ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS response_id text,
  ADD COLUMN IF NOT EXISTS used_chunk_ids jsonb,
  ADD COLUMN IF NOT EXISTS used_paragraphs jsonb;