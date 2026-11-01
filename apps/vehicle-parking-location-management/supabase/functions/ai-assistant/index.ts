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
      global: { headers: { Authorization: ['Bearer', accessToken].join(' ') } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData.user) return respond({ error: 'Your session is invalid or expired. Please sign in again.' }, 401);

    const { data: membership, error: membershipError } = await authClient
      .from('workspace_members')
      .select('user_id')
      .eq('user_id', authData.user.id)
      .maybeSingle();
    if (membershipError) {
      console.error('AI assistant membership check failed:', membershipError.message);
      return respond({ error: 'Unable to verify workspace access. Please try again later.' }, 500);
    }
    if (!membership) return respond({ error: 'Workspace membership is required to use the AI assistant.' }, 403);

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
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
    const fallbackModel = Deno.env.get('GEMINI_FALLBACK_MODEL') || 'gemini-3.1-flash-lite';
    const models = [...new Set([model, fallbackModel])];

    const systemInstruction = [
      'You are the VPLM (Vehicle Parking Location Management) assistant for signed-in workspace users.',
      'Help users understand general vehicle parking workflows, vehicle assignment concepts, parking transfers, reservations, parking availability, movement history, and road-test coordination.',
      'The client application handles exact vehicle-registration lookups from the current workspace and presents a guided transfer flow with explicit confirmations.',
      'You do not receive workspace vehicle records and have no tools to search records, check live capacity, update data, or perform actions.',
      'Never claim to have searched live records, located a real vehicle, checked current capacity, updated a record, or completed an action. For a specific vehicle lookup, direct the user to enter its registration in the assistant; the application handles the lookup locally.',
      'Do not request or encourage users to provide confidential, personal, customer, registration, VIN, or other operationally sensitive information in general AI questions.',
      'Be concise, practical, and clear when information is uncertain.',
    ].join(' ');

    let response: Response | null = null;
    let providerMessage = '';
    let failedStatus = 0;
    for (const [modelIndex, currentModel] of models.entries()) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent`, {
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
        } catch (error) {
          response = null;
          failedStatus = 0;
          providerMessage = error instanceof Error ? error.message.slice(0, 400) : 'Network request failed.';
          console.error('Gemini request could not reach provider:', { model: currentModel, attempt: attempt + 1, message: providerMessage });
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 750 + Math.floor(Math.random() * 250)));
            continue;
          }
          break;
        }

        if (response.ok) break;

        failedStatus = response.status;
        const providerBody: unknown = await response.json().catch(() => null);
        providerMessage = typeof providerBody === 'object' && providerBody !== null &&
          'error' in providerBody && typeof providerBody.error === 'object' && providerBody.error !== null &&
          'message' in providerBody.error && typeof providerBody.error.message === 'string'
          ? providerBody.error.message.slice(0, 400)
          : '';
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!retryable || response.status === 429 || response.status === 503 || attempt === 1) break;

        const delay = 1000 + Math.floor(Math.random() * 250);
        console.warn('Gemini returned a transient error; retrying:', { status: response.status, model: currentModel, attempt: attempt + 1, delay });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      if (response?.ok) break;
      if (modelIndex < models.length - 1) {
        console.warn('Gemini primary model unavailable; trying fallback:', {
          status: failedStatus || 'network error',
          model: currentModel,
          fallbackModel: models[modelIndex + 1],
        });
      }
    }

    if (!response?.ok) {
      const status = failedStatus;
      console.error('Gemini request failed:', { status: status || 'network error', models, message: providerMessage || 'No provider message.' });
      if (status === 429) return respond({ error: 'The AI provider rate limit was reached on both configured models. Please try again later.' }, 429);
      return respond({
        error: status && providerMessage
          ? `The AI provider returned HTTP ${status}: ${providerMessage}`
          : 'The AI provider could not be reached with either configured model. Please try again later.',
      }, 502);
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
