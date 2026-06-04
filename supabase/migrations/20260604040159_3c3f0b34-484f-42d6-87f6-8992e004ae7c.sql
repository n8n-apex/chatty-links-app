-- Lock down chat_messages: revoke all direct public/anon access.
-- All reads/writes/deletes must go through the chat-history edge function,
-- which uses the service role and scopes every query to a single user_email.

DROP POLICY IF EXISTS "Public can view chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Public can insert chat messages with email" ON public.chat_messages;
DROP POLICY IF EXISTS "Public can delete chat messages" ON public.chat_messages;

-- Revoke Data-API privileges from anon (and authenticated, which this app does
-- not use). service_role bypasses RLS and keeps full access for edge functions.
REVOKE ALL ON public.chat_messages FROM anon;
REVOKE ALL ON public.chat_messages FROM authenticated;
GRANT ALL ON public.chat_messages TO service_role;

-- Keep RLS enabled. With no policies and no GRANTs, anon/authenticated cannot
-- read, insert, update, or delete anything via the Data API.
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;