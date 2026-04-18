DROP POLICY IF EXISTS "Public can insert chat messages" ON public.chat_messages;

CREATE POLICY "Public can insert chat messages with email"
ON public.chat_messages
FOR INSERT
WITH CHECK (user_email IS NOT NULL AND length(trim(user_email)) > 0);