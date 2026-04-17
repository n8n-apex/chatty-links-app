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

    if (!message || typeof message !== 'string') {
      return new Response(
        JSON.stringify({ error: 'message is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Detect action from message content if not explicitly set
    if (!body.action && body.message) {
      const msg = body.message.toLowerCase();
      if (msg.startsWith('ich habe eine baurechtsfrage') || msg.includes('?')) {
        body.action = 'question';
        body.question = body.message;
      } else if (msg.startsWith('erstelle eine stellungnahme')) {
        body.action = 'draft_statement';
        body.topic = body.message.replace('erstelle eine stellungnahme zum thema:', '').trim();
      } else if (msg.startsWith('analysiere dieses behördenschreiben')) {
        body.action = 'analyze_pdf';
      } else {
        body.action = 'question';
        body.question = body.message;
      }
    }

    const webhookUrl = Deno.env.get('N8N_WEBHOOK_URL')
    if (!webhookUrl) {
      return new Response(
        JSON.stringify({ error: 'Webhook URL not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (body.action === 'submit_feedback') {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_feedback',
          response_id: body.response_id,
          status: body.status,
          corrected_text: body.corrected_text || null,
          sessionId: body.sessionId,
        }),
      });
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Calling webhook:', webhookUrl, { message, sessionId, timestamp })

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
