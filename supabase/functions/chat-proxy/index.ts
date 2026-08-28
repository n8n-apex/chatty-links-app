const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// Same pattern as chat-history/index.ts: real HTTP status codes out of an Edge
// Function are a choice, not a platform limitation.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// German, actionable, and safe to show an anonymous caller. Internal detail —
// exception text, upstream bodies — NEVER travels to the client. It is reduced
// to a size/shape note in the server log, tied to the correlation id.
const ERROR_MESSAGES: Record<string, string> = {
  missing_message: 'Bitte geben Sie eine Frage oder Anweisung ein.',
  missing_session_id: 'Die Sitzung ist abgelaufen. Bitte laden Sie die Seite neu und versuchen Sie es erneut.',
  empty_statement: 'Der Entwurf ist leer. Bitte ergänzen Sie den Text und speichern Sie erneut.',
  missing_project_ref: 'Es wurde kein Projektordner angegeben. Bitte fügen Sie den Google-Drive-Link erneut ein.',
  webhook_not_configured: 'Der Dienst ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut.',
  upstream_error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es in wenigen Sekunden erneut.',
  upstream_empty: 'Die Verarbeitung hat kein Ergebnis geliefert. Bitte senden Sie die Anfrage erneut.',
  upstream_unparseable: 'Die Antwort der Verarbeitung war unvollständig. Bitte senden Sie die Anfrage erneut.',
  upstream_unreachable: 'Der Dienst ist momentan nicht erreichbar. Bitte versuchen Sie es in wenigen Sekunden erneut.',
  save_not_confirmed: 'Der Entwurf konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.',
  ingest_not_confirmed: 'Das Projekt konnte nicht eingelesen werden. Bitte prüfen Sie die Freigabe des Ordners.',
  feedback_not_saved: 'Das Feedback konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.',
  whisper_failed: 'Die Aufnahme konnte nicht transkribiert werden. Bitte sprechen Sie erneut oder tippen Sie den Text.',
  transcription_failed: 'Die Aufnahme konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
  missing_audio: 'Es wurde keine Aufnahme empfangen. Bitte nehmen Sie erneut auf.',
  openai_key_missing: 'Die Spracheingabe ist derzeit nicht verfügbar. Bitte tippen Sie Ihren Text.',
  proxy_exception: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
}
const GENERIC_MESSAGE = 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.'

// Server-side only. Records that something failed and how big the evidence was,
// never the evidence itself — this system carries client correspondence.
const logFailure = (
  correlationId: string,
  code: string,
  status: number,
  extra?: Record<string, unknown>,
) => {
  console.error(JSON.stringify({ correlation_id: correlationId, error: code, status, ...extra }))
}

type FailOptions = {
  /** Logged server-side as a byte count only. Never returned to the caller. */
  detail?: unknown
  /** A user-safe German message from upstream, used instead of the canned one. */
  message?: string
  extra?: Record<string, unknown>
}

// Every failure leaves this function in ONE shape, with a machine-readable code
// the frontend error card keys on, plus a correlation id so a user report can be
// traced without internal detail travelling to the client.
const fail = (code: string, status: number, opts: FailOptions = {}) => {
  const correlationId = crypto.randomUUID()
  const detailBytes =
    opts.detail === undefined ? undefined : String(opts.detail).length
  logFailure(correlationId, code, status, { detail_bytes: detailBytes, ...opts.extra })
  return json(
    {
      status: 'error',
      error: code,
      message: opts.message ?? ERROR_MESSAGES[code] ?? GENERIC_MESSAGE,
      correlation_id: correlationId,
    },
    status,
  )
}



Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { message, sessionId, timestamp } = body

    // --- ADMIN CHECK (LS API only) ---
    if (body.action === 'check_admin') {
      const email = body.email || '';

      if (!email) {
        return new Response(
          JSON.stringify({ isAdmin: false, error: 'missing_email' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const lsApiKey = Deno.env.get('LS_API_KEY') || '';
      if (!lsApiKey) {
        return new Response(
          JSON.stringify({ isAdmin: false, error: 'api_key_missing' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      try {
        const lsResponse = await fetch(
          `https://api.learningsuite.io/api/v1/team-members/by-email?email=${encodeURIComponent(email)}`,
          {
            headers: {
              'Authorization': `Bearer ${lsApiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );

        if (lsResponse.ok) {
          const data = await lsResponse.json();
          if (Array.isArray(data) && data.length > 0) {
            const role = data[0].roleId;
            const isAdmin = (role === 'admin' || role === 'owner');
            return new Response(
              JSON.stringify({ isAdmin, role }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }

        return new Response(
          JSON.stringify({ isAdmin: false }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ isAdmin: false, error: 'api_error' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // --- TRANSCRIBE AUDIO via OpenAI Whisper ---
    if (body.action === 'transcribe_audio') {
      // The mic path answers 200 by contract (the client reads `text`), but the
      // error shape is the same as everywhere else — and never carries the raw
      // upstream body.
      const micFail = (code: string, detail?: unknown) => {
        const correlationId = crypto.randomUUID()
        logFailure(correlationId, code, 200, {
          action: 'transcribe_audio',
          detail_bytes: detail === undefined ? undefined : String(detail).length,
        })
        return json({
          status: 'error',
          error: code,
          message: ERROR_MESSAGES[code] ?? GENERIC_MESSAGE,
          correlation_id: correlationId,
          text: '',
        })
      }

      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) {
        return micFail('openai_key_missing');
      }
      try {
        const audioB64: string = body.audio_base64 || '';
        const mime: string = body.mime_type || 'audio/webm';
        if (!audioB64) {
          return micFail('missing_audio');
        }
        const bin = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0));
        const blob = new Blob([bin], { type: mime });
        const fd = new FormData();
        fd.append('file', blob, 'audio.webm');
        fd.append('model', 'whisper-1');
        fd.append('language', 'de');

        const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openaiKey}` },
          body: fd,
        });
        const txt = await resp.text();
        if (!resp.ok) {
          return micFail('whisper_failed', txt);
        }
        let parsed: any;
        try { parsed = JSON.parse(txt); } catch { parsed = { text: txt }; }
        return new Response(
          JSON.stringify({ text: parsed.text || '' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        return micFail('transcription_failed', e);
      }
    }


    const MESSAGELESS_ACTIONS = [
      'analyze_pdf', 'draft_statement', 'ingest_project',
      'ingest_legal_pdf', 'ingest_stellungnahme', 'ingest_folder',
      'save_statement', 'suspend_document', 'submit_feedback', 'upload_source',
      'transcribe_audio', 'check_admin', 'get_chunk', 'get_result',
      'auto',
    ];
    const effectiveAction = body.action || 'question';
    const isMessageless = MESSAGELESS_ACTIONS.includes(effectiveAction);

    if (!isMessageless) {
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return fail('missing_message', 400)
      }
    }


    // Detect local file path and return helpful error immediately
    if (body.message?.match(/^\/Users\/|^C:\\|^\/home\//i)) {
      return new Response(
        JSON.stringify({
          status: 'error',
          action: 'question',
          antwort: 'Es scheint, dass Sie einen lokalen Dateipfad eingefügt haben. Bitte laden Sie das Behördenschreiben zuerst in Google Drive hoch und fügen Sie dann den Google Drive Link hier ein. Beispiel: https://drive.google.com/file/d/FILE_ID/view',
          rechtsgrundlage: [],
          fehlende_informationen: null,
          naechste_schritte: 'Laden Sie die PDF in Google Drive hoch und teilen Sie den Link.',
          wichtiger_hinweis: null,
          quellen: []
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Google Drive URL in the message: extract the file id, but do NOT decide
    // the action — routing is the router's job (n8n). file_id is read by name
    // downstream, so this extraction stays.
    const driveMatch = body.message?.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch && !body.file_id) {
      body.file_id = driveMatch[1].split('/')[0].split('?')[0];
    }

    if (body.action === 'analyze_pdf') {
      const driveMatch = body.message?.match(/\/d\/([a-zA-Z0-9_-]+)/);
      const cleanId = driveMatch?.[1]?.split('/')[0]?.split('?')[0] || '';

      // NOTE: no fileless short-circuit here any more. n8n answers a
      // document-less analyze_pdf as a legal question with a routing notice,
      // which is strictly better than telling the user to paste a Drive link.

      if (cleanId) body.file_id = cleanId;


      const stateMap: Record<string, string> = {
        'bayern': 'Bayern', 'münchen': 'Bayern', 'nürnberg': 'Bayern', 'bamberg': 'Bayern', 'augsburg': 'Bayern',
        'berlin': 'Berlin',
        'hamburg': 'Hamburg',
        'bremen': 'Bremen',
        'hessen': 'Hessen', 'frankfurt': 'Hessen',
        'nrw': 'Nordrhein-Westfalen', 'nordrhein': 'Nordrhein-Westfalen', 'düsseldorf': 'Nordrhein-Westfalen', 'köln': 'Nordrhein-Westfalen',
        'baden': 'Baden-Württemberg', 'stuttgart': 'Baden-Württemberg',
        'sachsen': 'Sachsen', 'dresden': 'Sachsen',
        'niedersachsen': 'Niedersachsen', 'hannover': 'Niedersachsen',
        'schleswig': 'Schleswig Holstein', 'kiel': 'Schleswig Holstein',
        'thüringen': 'Thüringen', 'erfurt': 'Thüringen',
        'brandenburg': 'Brandenburg', 'potsdam': 'Brandenburg',
        'mecklenburg': 'Mecklenburg-Vorpommern', 'schwerin': 'Mecklenburg-Vorpommern',
        'sachsen-anhalt': 'Sachsen-Anhalt', 'magdeburg': 'Sachsen-Anhalt',
        'saarland': 'Saarland', 'saarbrücken': 'Saarland',
        'rheinland': 'Rheinland-Pfalz', 'mainz': 'Rheinland-Pfalz',
      };
      const msgLower = (body.message || '').toLowerCase();
      let detectedState = body.state || null;
      if (!detectedState) {
        for (const [keyword, state] of Object.entries(stateMap)) {
          if (msgLower.includes(keyword)) {
            detectedState = state;
            break;
          }
        }
      }
      body.state = detectedState;
    }

    const webhookUrl = Deno.env.get('N8N_WEBHOOK_URL')
    if (!webhookUrl) {
      return fail('webhook_not_configured', 500)
    }

    // --- CONVERSATIONAL DRAFT EDIT (dedicated, no chat history) ---
    if (body.action === 'draft_statement' && body.mode === 'edit') {
      try {
        const sessionId = body.sessionId || body.session_id || null;
        const topic = typeof body.topic === 'string' ? body.topic : '';
        if (!sessionId) {
          return fail('missing_session_id', 400);
        }
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'draft_statement',
            mode: 'edit',
            sessionId,
            topic,
          }),
        });
        const txt = await resp.text();
        if (!resp.ok) {
          return fail('upstream_error', 502, { detail: txt, extra: { upstream_status: resp.status } });
        }
        const trimmed = (txt || '').trim();
        if (!trimmed) {
          return fail('upstream_empty', 502);
        }
        let parsed: unknown;
        // A non-empty body that is not JSON is not automatically a failure.
        try { parsed = JSON.parse(trimmed); } catch { parsed = { output: trimmed }; }
        return json(parsed);
      } catch (e) {
        return fail('upstream_unreachable', 502, { detail: e });
      }
    }


    // --- SAVE EDITED STATEMENT (manual pencil-edit) ---
    if (body.action === 'save_statement') {
      try {
        const sessionId = body.sessionId || body.session_id || null;
        const statementText = typeof body.statement_text === 'string' ? body.statement_text : '';
        if (!sessionId) {
          return fail('missing_session_id', 400);
        }
        if (!statementText.trim()) {
          return fail('empty_statement', 400);
        }
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save_statement',
            sessionId,
            statement_text: statementText,
          }),
        });
        const txt = await resp.text();
        if (!resp.ok) {
          return fail('upstream_error', 502, { detail: txt, extra: { upstream_status: resp.status } });
        }
        const trimmed = (txt || '').trim();
        if (!trimmed) {
          return fail('upstream_empty', 502);
        }
        let parsed: any;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return fail('upstream_unparseable', 502, { detail: trimmed });
        }
        const obj = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!obj || typeof obj !== 'object' || obj.status === 'error' || obj.saved === false || obj.error) {
          return fail('save_not_confirmed', 502, { detail: trimmed });
        }
        return json(obj);
      } catch (e) {
        return fail('upstream_unreachable', 502, { detail: e });
      }
    }


    if (body.action === 'submit_feedback') {
      try {
        const sessionId = body.session_id || body.sessionId || null;
        const fwd: Record<string, unknown> = {
          action: 'submit_feedback',
          response_id: body.response_id,
          status: body.status,
          session_id: sessionId,
          sessionId,
          response_content: body.response_content || null,
          question: body.question || null,
          user_email: body.user_email || null,
          used_chunk_ids: Array.isArray(body.used_chunk_ids) ? body.used_chunk_ids : [],
          used_paragraphs: Array.isArray(body.used_paragraphs) ? body.used_paragraphs : [],
        };
        // corrected_text is ONLY forwarded for status='correction' (per backend contract)
        if (body.status === 'correction' && typeof body.corrected_text === 'string' && body.corrected_text.trim().length > 0) {
          fwd.corrected_text = body.corrected_text;
        }
        // message is forwarded for status='note' (freeform admin note)
        if (body.status === 'note' && typeof body.message === 'string' && body.message.trim().length > 0) {
          fwd.message = body.message;
        }
        const fbResp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fwd),
        });
        const fbText = await fbResp.text();
        if (!fbResp.ok) {
          return fail('upstream_error', 502, { detail: fbText, extra: { upstream_status: fbResp.status } });
        }

        // n8n answering 2xx is NOT proof the feedback row was written. A workflow
        // branch that yields zero items ends the run silently and the webhook
        // replies 200 with an empty body. Treat that as a failure.
        const fbTrimmed = (fbText || '').trim();
        if (!fbTrimmed) {
          return fail('upstream_empty', 502);
        }

        let fbParsed: any = null;
        let fbJson = true;
        try {
          fbParsed = JSON.parse(fbTrimmed);
        } catch {
          fbJson = false;
        }

        // MEASURED 2026-08-27: n8n's happy path answers this action with the
        // plain-text body `Feedback gespeichert` — 200, non-empty, not JSON.
        // Rejecting that would turn a working button red, so a non-empty
        // unparseable body is passed through as success (same policy as the
        // generic forward path). Only an empty body is a failure here.
        if (!fbJson) {
          return json({ success: true, message: fbTrimmed.slice(0, 500), upstream_raw: fbTrimmed.slice(0, 500) });
        }

        const fbObj = Array.isArray(fbParsed) ? fbParsed[0] : fbParsed;
        const fbOk =
          fbObj && typeof fbObj === 'object' &&
          fbObj.success !== false &&
          fbObj.status !== 'error' &&
          !fbObj.error;

        if (!fbOk) {
          return fail('feedback_not_saved', 502, { detail: fbTrimmed });
        }

        return json({ success: true, message: fbObj.message ?? 'Feedback gespeichert', upstream: fbObj });
      } catch (e) {
        return fail('proxy_exception', 500, { detail: e });
      }
    }



    // --- INGEST PROJECT (bind a chat to a Drive folder) ---
    if (body.action === 'ingest_project') {
      try {
        const projectRef = body.project_ref || body.projectRef || '';
        if (!projectRef) {
          return fail('missing_project_ref', 400);
        }
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'ingest_project',
            project_ref: projectRef,
          }),
        });
        const txt = await resp.text();
        if (!resp.ok) {
          return fail('upstream_error', 502, { detail: txt, extra: { upstream_status: resp.status } });
        }
        const trimmed = (txt || '').trim();
        if (!trimmed) {
          return fail('upstream_empty', 502);
        }
        let parsed: any;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return fail('upstream_unparseable', 502, { detail: trimmed });
        }
        const obj = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!obj || typeof obj !== 'object' || obj.status === 'error' || obj.success === false || obj.error) {
          return fail('ingest_not_confirmed', 502, { detail: trimmed });
        }
        return json(obj);
      } catch (e) {
        return fail('upstream_unreachable', 502, { detail: e });
      }
    }



    const forwardPayload: Record<string, unknown> = {
      action: effectiveAction,
      message: typeof body.message === 'string' ? body.message : '',
      sessionId: body.sessionId || null,
      timestamp: body.timestamp || new Date().toISOString(),
    };
    // THIS LIST IS A SILENT GATE: chat-proxy rebuilds every outbound body from
    // scratch and copies ONLY these keys. Anything not named here is dropped with
    // no log and no error. `additional_question` was the live casualty for months.
    // Add a key here whenever the backend needs to see a new field.
    const passthroughKeys = [
      'file_id', 'file_base64', 'file_name', 'files',
      'state', 'question', 'topic', 'statement_type',
      'ziel', 'mode', 'source_type', 'upload_type', 'project_ref',
      'chunk_id', 'target_action',
      // Turn identity. Without these the backend cannot tell one upload from the
      // next in the same conversation.
      'turn_id', 'client_turn_id',
      // Routing corrections and attachment intent — the router reads these by
      // name. force_action always wins (R0); attach_intent picks analysis vs
      // plain upload; rerun_of ties a corrected turn to the one it replaces.
      'force_action', 'attach_intent', 'rerun_of',
    ];
    for (const k of passthroughKeys) {
      if (body[k] !== undefined) forwardPayload[k] = body[k];
    }
    if (effectiveAction === 'draft_statement' && forwardPayload.statement_type === undefined) {
      forwardPayload.statement_type = 'Stellungnahme';
    }

    console.log('Forwarding to n8n:', JSON.stringify({ ...forwardPayload, file_base64: forwardPayload.file_base64 ? '[omitted]' : undefined }));

    let response: Response
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forwardPayload),
      })
    } catch (e) {
      return fail('upstream_unreachable', 502, { detail: e })
    }

    const rawText = await response.text()
    console.log('Webhook raw response status:', response.status, 'body:', rawText)

    if (!response.ok) {
      // Upstream 4xx means the request was rejected cleanly by n8n.
      // Pass that status through and surface the German message directly.
      if (response.status >= 400 && response.status < 500) {
        try {
          const parsed = JSON.parse(rawText)
          if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') {
            return json(
              {
                status: 'error',
                error: parsed.error || 'upstream_error',
                message: parsed.message,
              },
              response.status,
            )
          }
        } catch {
          // Body doesn't parse: fall through to the existing 502 behavior.
        }
      }
      return fail('upstream_error', 502, { detail: rawText, extra: { upstream_status: response.status } })
    }

    // An empty 2xx is the known n8n trap: a branch that yields zero items ends
    // the run silently and the webhook answers 200 with nothing in it.
    if (!rawText || !rawText.trim()) {
      return fail('upstream_empty', 502)
    }

    let data: unknown
    try {
      data = JSON.parse(rawText)
    } catch {
      // Non-empty but not JSON is NOT a failure — keep wrapping it as before.
      data = { output: rawText }
    }

    return json(data)
  } catch (error) {
    return fail('proxy_exception', 500, { detail: error })
  }
})

