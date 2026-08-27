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

// Every failure leaves this function in ONE shape, with a machine-readable code.
const fail = (code: string, status: number, detail?: unknown) =>
  json(
    {
      status: 'error',
      error: code,
      detail: detail === undefined ? undefined : String(detail).slice(0, 2000),
    },
    status,
  )


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
        console.error('LS API error:', e);
        return new Response(
          JSON.stringify({ isAdmin: false, error: 'api_error' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // --- TRANSCRIBE AUDIO via OpenAI Whisper ---
    if (body.action === 'transcribe_audio') {
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) {
        return new Response(
          JSON.stringify({ error: 'openai_key_missing', text: '' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      try {
        const audioB64: string = body.audio_base64 || '';
        const mime: string = body.mime_type || 'audio/webm';
        if (!audioB64) {
          return new Response(
            JSON.stringify({ error: 'missing_audio', text: '' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
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
          console.error('Whisper error', resp.status, txt);
          return new Response(
            JSON.stringify({ error: 'whisper_failed', detail: txt, text: '' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        let parsed: any;
        try { parsed = JSON.parse(txt); } catch { parsed = { text: txt }; }
        return new Response(
          JSON.stringify({ text: parsed.text || '' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        console.error('transcribe_audio error', e);
        return new Response(
          JSON.stringify({ error: String(e), text: '' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const MESSAGELESS_ACTIONS = [
      'analyze_pdf', 'draft_statement', 'ingest_project',
      'ingest_legal_pdf', 'ingest_stellungnahme', 'ingest_folder',
      'save_statement', 'suspend_document', 'submit_feedback', 'upload_source',
      'transcribe_audio', 'check_admin', 'get_chunk', 'get_result',
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

    // Auto-detect Google Drive URL anywhere in the message
    const driveMatch = body.message?.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch && (!body.action || body.action === 'question')) {
      body.action = 'analyze_pdf';
      body.file_id = driveMatch[1].split('/')[0].split('?')[0];
      body.file_name = 'Behördenschreiben.pdf';
    }

    // Detect action from message content if not explicitly set
    if (body.message && !body.action) {
      const msg = body.message.toLowerCase();
      if (msg.startsWith('ich habe eine baurechtsfrage') || msg.includes('?')) {
        body.action = 'question';
        body.question = body.message;
      } else if (msg.startsWith('erstelle eine stellungnahme')) {
        body.action = 'draft_statement';
        body.topic = body.message.replace('erstelle eine stellungnahme zum thema:', '').trim();
      } else if (msg.startsWith('analysiere dieses behördenschreiben')) {
        body.action = 'analyze_pdf';
        body.file_name = body.file_name || 'Behördenschreiben.pdf';
        body.state = body.state || 'Bayern';
        delete body.question;
      } else {
        body.action = 'question';
        body.question = body.message;
      }
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
          console.error('draft_statement edit upstream error', resp.status, txt);
          return fail('upstream_error', 502, txt);
        }
        const trimmed = (txt || '').trim();
        if (!trimmed) {
          console.error('draft_statement edit: upstream 2xx with empty body');
          return fail('upstream_empty', 502);
        }
        let parsed: unknown;
        // A non-empty body that is not JSON is not automatically a failure.
        try { parsed = JSON.parse(trimmed); } catch { parsed = { output: trimmed }; }
        return json(parsed);
      } catch (e) {
        console.error('draft_statement edit error:', e);
        return fail('upstream_unreachable', 502, e);
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
          console.error('save_statement upstream error', resp.status, txt);
          return fail('upstream_error', 502, txt);
        }
        const trimmed = (txt || '').trim();
        if (!trimmed) {
          console.error('save_statement: upstream 2xx with empty body');
          return fail('upstream_empty', 502);
        }
        let parsed: any;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          console.error('save_statement: unparseable upstream body:', trimmed.slice(0, 500));
          return fail('upstream_unparseable', 502, trimmed);
        }
        const obj = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!obj || typeof obj !== 'object' || obj.status === 'error' || obj.saved === false || obj.error) {
          return fail('save_not_confirmed', 502, trimmed);
        }
        return json(obj);
      } catch (e) {
        console.error('save_statement error:', e);
        return fail('upstream_unreachable', 502, e);
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
          console.error('submit_feedback upstream error', fbResp.status, fbText);
          return fail('upstream_error', 502, fbText);
        }

        // n8n answering 2xx is NOT proof the feedback row was written. A workflow
        // branch that yields zero items ends the run silently and the webhook
        // replies 200 with an empty body. Treat that as a failure.
        const fbTrimmed = (fbText || '').trim();
        if (!fbTrimmed) {
          console.error('submit_feedback: upstream 2xx with empty body');
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
          console.warn('submit_feedback: non-JSON upstream body:', fbTrimmed.slice(0, 500));
          return json({ success: true, message: fbTrimmed.slice(0, 500), upstream_raw: fbTrimmed.slice(0, 500) });
        }

        const fbObj = Array.isArray(fbParsed) ? fbParsed[0] : fbParsed;
        const fbOk =
          fbObj && typeof fbObj === 'object' &&
          fbObj.success !== false &&
          fbObj.status !== 'error' &&
          !fbObj.error;

        if (!fbOk) {
          console.error('submit_feedback: upstream reported failure:', fbTrimmed.slice(0, 500));
          return fail('feedback_not_saved', 502, fbTrimmed);
        }

        return json({ success: true, message: fbObj.message ?? 'Feedback gespeichert', upstream: fbObj });
      } catch (e) {
        console.error('Feedback forward error:', e);
        return fail('proxy_exception', 500, e);
      }
    }



    // --- INGEST PROJECT (bind a chat to a Drive folder) ---
    if (body.action === 'ingest_project') {
      try {
        const projectRef = body.project_ref || body.projectRef || '';
        if (!projectRef) {
          return new Response(
            JSON.stringify({ status: 'error', error: 'missing_project_ref' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
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
          return new Response(
            JSON.stringify({ status: 'error', error: `Webhook ${resp.status}`, detail: txt }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        let parsed: unknown;
        try { parsed = JSON.parse(txt); } catch { parsed = { status: 'success', raw: txt }; }
        return new Response(
          JSON.stringify(parsed),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        console.error('ingest_project error:', e);
        return new Response(
          JSON.stringify({ status: 'error', error: String(e) }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
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
    ];
    for (const k of passthroughKeys) {
      if (body[k] !== undefined) forwardPayload[k] = body[k];
    }
    if (effectiveAction === 'draft_statement' && forwardPayload.statement_type === undefined) {
      forwardPayload.statement_type = 'Stellungnahme';
    }

    console.log('Forwarding to n8n:', JSON.stringify({ ...forwardPayload, file_base64: forwardPayload.file_base64 ? '[omitted]' : undefined }));

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(forwardPayload),
    })

    const rawText = await response.text()
    console.log('Webhook raw response status:', response.status, 'body:', rawText)

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Webhook responded with ${response.status}`, details: rawText }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let data: unknown
    try {
      data = JSON.parse(rawText)
    } catch {
      data = { output: rawText || 'No response from webhook' }
    }

    return new Response(
      JSON.stringify(data),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Chat proxy error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to process message', details: String(error) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
