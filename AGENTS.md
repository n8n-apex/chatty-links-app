# Architecture rules
- Render backend working steps through a shared chat component for pending and completed answers so both views use the same presentation.
- Persist completed working steps inside the existing assistant content payload so history reloads need no separate storage schema.- Chat messages stream directly from n8n (src/lib/answerStream.ts) only behind the ?stream=1 flag; the poll stays the source of truth and fallback, and only the get_result payload is ever stored — edge functions cannot hold long streams on the current plan.
- Chat list items, the answer card and Md are React.memo with module-level Markdown config, and the composer text lives in ChatInput, so typing, streaming and progress never re-render finished answers.
