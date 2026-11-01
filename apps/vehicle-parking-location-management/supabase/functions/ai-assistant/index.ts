import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const getPublishableKey = (): string => {
  const legacy = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacy) return legacy;

  const raw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && 'default' in parsed &&
          typeof (parsed as { default?: unknown }).default === 'string') {
        return (parsed as { default: string }).default;
      }
    } catch {
      // Fall through to a clear configuration error below.
    }
  }
  throw new Error('A Supabase publishable/anon key is not configured.');
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  try {
    const authorization = request.headers.get('Authorization') ?? '';
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) return respond({ error: 'Sign in to use the VPLM AI assistant.' }, 401);

    const projectUrl = Deno.env.get('SUPABASE_URL');
    if (!projectUrl) throw new Error('SUPABASE_URL is not configured.');
    const authClient = createClient(projectUrl, getPublishableKey(), {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData.user) return respond({ error: 'Your session is invalid or expired. Please sign in again.' }, 401);

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return respond({ error: 'Request body must be valid JSON.' }, 400);
    }

    if (typeof input !== 'object' || input === null || !('message' in input) || typeof (input as { message?: unknown }).message !== 'string') {
      return respond({ error: 'Enter a message to continue.' }, 400);
    }
    const message = (input as { message: string }).message.trim();
    if (!message) return respond({ error: 'Enter a message to continue.' }, 400);
    if (message.length > 2000) return respond({ error: 'Messages must be 2,000 characters or fewer.' }, 413);

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return respond({ error: 'The AI provider key is not configured. Ask the administrator to set GEMINI_API_KEY.' }, 503);
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';

    const systemInstruction = [
      'You are the VPLM (Vehicle Parking Location Management) assistant in a prototype testing environment.',
      'Help users understand general vehicle parking workflows, vehicle assignment concepts, parking transfers, reservations, parking availability, movement history, and road-test coordination.',
      'This prototype has no access to live VPLM records, no tools, and no ability to change application data.',
      'Never claim to have searched live records, located a real vehicle, checked current capacity, updated a record, or completed an action.',
      'When asked for live data or to perform an action, explain that this prototype cannot do that yet and state what integration would be needed.',
      'Do not request or encourage users to provide confidential, personal, customer, registration, VIN, or other operationally sensitive information.',
      'Be concise, practical, and clear when information is uncertain.',
    ].join(' ');

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 700 },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) return respond({ error: 'The AI free-tier request limit has been reached. Please try again later.' }, 429);
      console.error('Gemini request failed with status:', status);
      return respond({ error: 'The AI provider could not complete the request. Please try again later.' }, 502);
    }

    const result: unknown = await response.json();
    const reply = typeof result === 'object' && result !== null &&
      'candidates' in result && Array.isArray((result as { candidates?: unknown }).candidates)
      ? ((result as { candidates: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates[0]?.content?.parts ?? [])
          .map((part) => typeof part.text === 'string' ? part.text : '')
          .join('\n')
          .trim()
      : '';

    if (!reply) return respond({ error: 'The AI returned no text. Please try rephrasing your question.' }, 502);
    return respond({ reply });
  } catch (error) {
    console.error('AI assistant request failed:', error instanceof Error ? error.message : 'Unknown error');
    return respond({ error: 'The AI assistant is temporarily unavailable. Please try again later.' }, 500);
  }
});
