-- Allow public to delete chat messages (matches existing public select/insert policies)
CREATE POLICY "Public can delete chat messages"
ON public.chat_messages
FOR DELETE
TO public
USING (true);