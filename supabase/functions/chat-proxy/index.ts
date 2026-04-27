const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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
        console.error('LS API error:', e);
        return new Response(
          JSON.stringify({ isAdmin: false, error: 'api_error' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (body.action !== 'submit_feedback' && (!message || typeof message !== 'string')) {
      return new Response(
        JSON.stringify({ error: 'message is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
    if (body.message) {
      const msg = body.message.toLowerCase();
      if (msg.startsWith('ich habe eine baurechtsfrage') || msg.includes('?')) {
        body.action = 'question';
        body.question = body.message;
      } else if (msg.startsWith('erstelle eine stellungnahme')) {
        body.action = 'draft_statement';
        body.topic = body.message.replace('erstelle eine stellungnahme zum thema:', '').trim();
      } else if (msg.startsWith('analysiere dieses behördenschreiben')) {
        body.action = 'analyze_pdf';
        body.file_name = 'Behördenschreiben.pdf';
        body.state = 'Bayern';
        delete body.question;
      } else {
        body.action = 'question';
        body.question = body.message;
      }
    }

    if (body.action === 'analyze_pdf') {
      const driveMatch = body.message?.match(/\/d\/([a-zA-Z0-9_-]+)/);
      const cleanId = driveMatch?.[1]?.split('/')[0]?.split('?')[0] || '';

      if (!cleanId && !body.file_id && !body.file_base64) {
        return new Response(
          JSON.stringify({
            status: 'success',
            action: 'question',
            frage: '',
            bundesland: 'nicht erkannt',
            antwort: 'Bitte fügen Sie einen gültigen Google Drive Link zu einem Behördenschreiben ein. Beispiel: https://drive.google.com/file/d/FILE_ID/view',
            rechtsgrundlage: [],
            fehlende_informationen: null,
            naechste_schritte: null,
            wichtiger_hinweis: null,
            quellen: [],
            model_used: 'none',
            tokens_used: {}
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

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
      const msgLower = body.message.toLowerCase();
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
      return new Response(
        JSON.stringify({ error: 'Webhook URL not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (body.action === 'submit_feedback') {
      // Verify HMAC signature before accepting feedback
      const fbEmail = body.user_email || '';
      const fbSig = body.sig || '';
      const fbHmacSecret = Deno.env.get('HMAC_SECRET') || '';

      if (fbHmacSecret && fbSig) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
          encoder.encode(fbHmacSecret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(fbEmail));
        const expectedSig = Array.from(new Uint8Array(signatureBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        if (fbSig !== expectedSig) {
          return new Response(
            JSON.stringify({ error: 'unauthorized', message: 'Invalid signature' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'submit_feedback',
            response_id: body.response_id,
            status: body.status,
            corrected_text: body.corrected_text || null,
            sessionId: body.sessionId,
            response_content: body.response_content || null,
            question: body.question || null,
            user_email: body.user_email || null
          }),
        });
      } catch (e) {
        console.error('Feedback forward error:', e);
      }
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Calling webhook:', webhookUrl, { message, sessionId, timestamp })

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: body.action,
        file_id: body.file_id || null,
        file_base64: body.file_base64 || null,
        file_name: body.file_name || 'Behördenschreiben.pdf',
        state: body.state || null,
        question: body.question || null,
        topic: body.topic || null,
        message: body.message,
        sessionId: body.sessionId,
        timestamp: body.timestamp,
        response_id: body.response_id || null,
        status: body.status || null,
        corrected_text: body.corrected_text || null,
      }),
    })

    const rawText = await response.text()
    console.log('Webhook raw response status:', response.status, 'body:', rawText)

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Webhook responded with ${response.status}`, details: rawText }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Try to parse as JSON, fall back to plain text
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
