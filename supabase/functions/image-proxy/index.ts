const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function encode(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url } = await req.json()

    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ ok: false, error: 'url is required' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Fetching image from:', url)
    const response = await fetch(url)

    if (!response.ok) {
      console.error('Image fetch failed:', response.status)
      return new Response(
        JSON.stringify({ ok: false, error: `Image fetch failed: ${response.status}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const buffer = await response.arrayBuffer()
    const base64 = encode(buffer)

    console.log('Image fetched successfully, size:', buffer.byteLength, 'type:', contentType)

    return new Response(
      JSON.stringify({ ok: true, base64, contentType }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Image proxy error:', error)
    return new Response(
      JSON.stringify({ ok: false, error: 'Failed to fetch image' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
