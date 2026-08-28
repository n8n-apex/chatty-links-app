// Edge function: chat-history
// Centralizes all reads/writes to chat_messages so that the table can be locked
// down at the RLS layer (no public anon access). The frontend passes the
// learner email as a parameter; the function uses the service role to scope
// every query/mutation to that email's rows ONLY.
//
// Residual risk (documented honestly): there is no real authentication in this
// app — the email comes from a LearningSuite URL parameter. This function
// therefore cannot prove the caller IS that user. What it DOES prevent vs. the
// previous setup:
//   * Anonymous bulk enumeration of every user's emails + chat content.
//   * Anonymous wipe of the entire chat_messages table.
// An attacker who already knows a specific email can still query/delete that
// user's chats. Fixing that requires introducing real auth (out of scope).

import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-lawgpt-sig',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

const isLegacyOrUuid = (v: unknown): v is string =>
  v === 'legacy' || isUuid(v)

// --- Request attestation -----------------------------------------------
// This proves the request came from a build of THIS app, nothing more. The
// key ships in the browser bundle, so it does not identify the person and is
// not a substitute for a session. It removes drive-by access from the open
// internet; per-member isolation is a separate, still-open piece of work.
const SIG_WINDOW_SECONDS = 300

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const verifySignature = async (
  header: string | null,
  action: unknown,
  email: string,
  secret: string,
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  if (!header) return { ok: false, reason: 'missing_signature' }
  const parts = header.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    return { ok: false, reason: 'malformed_signature' }
  }
  const [, tsRaw, nonce, mac] = parts
  const ts = Number(tsRaw)
  if (!Number.isFinite(ts) || !nonce || !mac) {
    return { ok: false, reason: 'malformed_signature' }
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts)
  if (skew > SIG_WINDOW_SECONDS) return { ok: false, reason: 'stale_signature' }

  const payload = `v1.${tsRaw}.${nonce}.${String(action)}.${email.toLowerCase()}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = toHex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
  )
  if (!timingSafeEqual(expected, mac.toLowerCase())) {
    return { ok: false, reason: 'bad_signature' }
  }
  return { ok: true }
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'server_misconfigured' }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const action = body.action
  const userEmail = body.user_email
  if (!isNonEmptyString(userEmail)) {
    return json({ error: 'missing_user_email' }, 400)
  }
  // Reject placeholder/unresolved LearningSuite tokens.
  if (userEmail.includes('{{') || userEmail.includes('}}')) {
    return json({ error: 'unresolved_user_email' }, 400)
  }

  // Attestation gate. Mode `log` verifies and logs but lets the request
  // through; `enforce` rejects. Flip via the CHAT_HISTORY_AUTH_MODE secret.
  const authMode = (Deno.env.get('CHAT_HISTORY_AUTH_MODE') ?? 'log').toLowerCase()
  const appKey = Deno.env.get('CHAT_HISTORY_APP_KEY')
  if (!appKey) {
    if (authMode === 'enforce') return json({ error: 'server_misconfigured' }, 500)
    console.warn('chat-history: CHAT_HISTORY_APP_KEY not set; signature not checked')
  } else {
    const result = await verifySignature(
      req.headers.get('x-lawgpt-sig'),
      action,
      userEmail,
      appKey,
    )
    if (!result.ok) {
      console.warn(
        `chat-history: signature rejected (${result.reason}) mode=${authMode} action=${String(action)}`,
      )
      if (authMode === 'enforce') {
        return json({ error: 'unauthorized', reason: result.reason }, 401)
      }
    }
  }


  try {
    if (action === 'list_conversations') {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, content, role, conversation_id, created_at')
        .eq('user_email', userEmail)
        .order('created_at', { ascending: true })
      if (error) throw error
      return json({ success: true, rows: data ?? [] })
    }

    if (action === 'load_messages') {
      const cid = body.conversation_id
      if (!isLegacyOrUuid(cid)) {
        return json({ error: 'invalid_conversation_id' }, 400)
      }
      let q = supabase
        .from('chat_messages')
        .select(
          'id, content, role, conversation_id, created_at, response_id, used_chunk_ids, used_paragraphs',
        )
        .eq('user_email', userEmail)
        .order('created_at', { ascending: true })
      q = cid === 'legacy' ? q.is('conversation_id', null) : q.eq('conversation_id', cid)
      const { data, error } = await q
      if (error) throw error
      return json({ success: true, rows: data ?? [] })
    }

    if (action === 'save_message') {
      const role = body.role
      const content = body.content
      const conversationId = body.conversation_id
      if (role !== 'user' && role !== 'ai') {
        return json({ error: 'invalid_role' }, 400)
      }
      if (!isNonEmptyString(content)) {
        return json({ error: 'invalid_content' }, 400)
      }
      if (!isUuid(conversationId)) {
        return json({ error: 'invalid_conversation_id' }, 400)
      }
      const responseId =
        typeof body.response_id === 'string' ? body.response_id : null
      const usedChunkIds = Array.isArray(body.used_chunk_ids)
        ? body.used_chunk_ids
        : null
      const usedParagraphs = Array.isArray(body.used_paragraphs)
        ? body.used_paragraphs
        : null

      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          user_email: userEmail,
          role,
          content,
          conversation_id: conversationId,
          response_id: responseId,
          used_chunk_ids: usedChunkIds,
          used_paragraphs: usedParagraphs,
        })
        .select('id')
        .single()
      if (error) throw error
      return json({ success: true, id: data?.id })
    }

    if (action === 'delete_conversation') {
      const cid = body.conversation_id
      if (!isLegacyOrUuid(cid)) {
        return json({ error: 'invalid_conversation_id' }, 400)
      }
      let q = supabase
        .from('chat_messages')
        .delete()
        .eq('user_email', userEmail)
      q = cid === 'legacy' ? q.is('conversation_id', null) : q.eq('conversation_id', cid)
      const { error } = await q
      if (error) throw error
      return json({ success: true })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('chat-history error:', e)
    return json({ error: 'internal_error', detail: String(e) }, 500)
  }
})
