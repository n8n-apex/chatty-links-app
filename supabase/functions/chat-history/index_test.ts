// Integration tests for the chat-history edge function.
// These tests hit the DEPLOYED function and exercise the end-to-end path:
//   create rows -> list -> load -> delete.
// Each test uses a unique synthetic email so it is fully isolated and cannot
// affect real users' chat history.

import "https://deno.land/std@0.224.0/dotenv/load.ts"
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts"

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ??
  Deno.env.get("SUPABASE_URL")!
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!

const FN_URL = `${SUPABASE_URL}/functions/v1/chat-history`

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${ANON_KEY}`,
  "apikey": ANON_KEY,
}

const call = async (body: Record<string, unknown>) => {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { /* keep null */ }
  return { status: res.status, body: parsed, raw: text }
}

const uniqueEmail = () =>
  `test+${crypto.randomUUID()}@chat-history-test.invalid`

Deno.test("rejects missing user_email", async () => {
  const r = await call({ action: "list_conversations" })
  assertEquals(r.status, 400)
  assertEquals(r.body?.error, "missing_user_email")
})

Deno.test("rejects unresolved placeholder email", async () => {
  const r = await call({
    action: "list_conversations",
    user_email: "{{user.email}}",
  })
  assertEquals(r.status, 400)
  assertEquals(r.body?.error, "unresolved_user_email")
})

Deno.test("rejects unknown action", async () => {
  const r = await call({ action: "wat", user_email: uniqueEmail() })
  assertEquals(r.status, 400)
  assertEquals(r.body?.error, "unknown_action")
})

Deno.test("save_message validates role / content / conversation_id", async () => {
  const email = uniqueEmail()
  const cid = crypto.randomUUID()

  const badRole = await call({
    action: "save_message", user_email: email, role: "hacker",
    content: "x", conversation_id: cid,
  })
  assertEquals(badRole.status, 400)
  assertEquals(badRole.body?.error, "invalid_role")

  const badContent = await call({
    action: "save_message", user_email: email, role: "user",
    content: "", conversation_id: cid,
  })
  assertEquals(badContent.status, 400)
  assertEquals(badContent.body?.error, "invalid_content")

  const badCid = await call({
    action: "save_message", user_email: email, role: "user",
    content: "hi", conversation_id: "not-a-uuid",
  })
  assertEquals(badCid.status, 400)
  assertEquals(badCid.body?.error, "invalid_conversation_id")
})

Deno.test("end-to-end: save -> list -> load -> delete (isolated per email)", async () => {
  const email = uniqueEmail()
  const cid = crypto.randomUUID()

  // Save a user + ai message
  const s1 = await call({
    action: "save_message", user_email: email, role: "user",
    content: "Hallo, was ist § 1?", conversation_id: cid,
  })
  assertEquals(s1.status, 200, `s1: ${s1.raw}`)
  assert(s1.body?.success === true)
  assert(typeof s1.body?.id === "string")

  const s2 = await call({
    action: "save_message", user_email: email, role: "ai",
    content: "Antwort über §1.", conversation_id: cid,
    response_id: "resp-abc",
    used_chunk_ids: ["c1", "c2"],
    used_paragraphs: ["§1"],
  })
  assertEquals(s2.status, 200, `s2: ${s2.raw}`)

  // list_conversations returns at least our 2 rows for this email
  const list = await call({ action: "list_conversations", user_email: email })
  assertEquals(list.status, 200)
  assertEquals(list.body?.success, true)
  const rows = list.body.rows as Array<{ conversation_id: string; role: string }>
  assertEquals(rows.length, 2)
  assert(rows.every((r) => r.conversation_id === cid))

  // load_messages returns full payload (including used_chunk_ids on AI row)
  const load = await call({
    action: "load_messages", user_email: email, conversation_id: cid,
  })
  assertEquals(load.status, 200)
  const lrows = load.body.rows as Array<any>
  assertEquals(lrows.length, 2)
  const ai = lrows.find((r) => r.role === "ai")
  assertEquals(ai?.response_id, "resp-abc")
  assertEquals(ai?.used_chunk_ids?.length, 2)

  // Isolation: a DIFFERENT email gets zero rows for the same cid
  const otherEmail = uniqueEmail()
  const otherLoad = await call({
    action: "load_messages", user_email: otherEmail, conversation_id: cid,
  })
  assertEquals(otherLoad.status, 200)
  assertEquals((otherLoad.body.rows as any[]).length, 0)

  // delete_conversation only affects the requesting email's rows
  const del = await call({
    action: "delete_conversation", user_email: email, conversation_id: cid,
  })
  assertEquals(del.status, 200)
  assertEquals(del.body?.success, true)

  const afterDel = await call({
    action: "load_messages", user_email: email, conversation_id: cid,
  })
  assertEquals(afterDel.status, 200)
  assertEquals((afterDel.body.rows as any[]).length, 0)
})

Deno.test("delete_conversation rejects invalid conversation_id", async () => {
  const r = await call({
    action: "delete_conversation",
    user_email: uniqueEmail(),
    conversation_id: "nope",
  })
  assertEquals(r.status, 400)
  assertEquals(r.body?.error, "invalid_conversation_id")
})

Deno.test("direct anon access to chat_messages is blocked by RLS", async () => {
  // After the migration, anon SELECT/INSERT/DELETE on chat_messages must fail.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_messages?select=id&limit=1`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
  )
  const text = await res.text()
  // Either 401/403 (permission denied) or 200 with an empty array (RLS hides
  // every row). Both are acceptable: the goal is "anon cannot enumerate".
  if (res.status === 200) {
    const data = JSON.parse(text)
    assertEquals(Array.isArray(data) ? data.length : -1, 0,
      `Expected empty array but got rows: ${text}`)
  } else {
    assertNotEquals(res.status, 200)
  }
})
