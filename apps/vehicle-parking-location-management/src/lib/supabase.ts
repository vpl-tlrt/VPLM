import { createClient } from '@supabase/supabase-js';

function validateConfiguration(): { url: string; key: string } | { error: string } {
  const urlVariable = 'VITE_SUPABASE_URL';
  const keyVariable = 'VITE_SUPABASE_ANON_KEY';
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const supabasePublishableKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl) return { error: `The GitHub Actions variable ${urlVariable} is missing.` };
  if (!supabasePublishableKey) return { error: `The GitHub Actions variable ${keyVariable} is missing.` };

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    return { error: `${urlVariable} is not a valid URL. Use the Project URL from Supabase → Project Settings → API.` };
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return { error: `${urlVariable} must start with https:// and use the Project URL from Supabase.` };
  }
  if (supabasePublishableKey.startsWith('sb_secret_')) {
    return { error: `${keyVariable} contains a secret key. Use the Supabase publishable key instead.` };
  }
  if (!supabasePublishableKey.startsWith('sb_publishable_') && !supabasePublishableKey.startsWith('eyJ')) {
    return { error: `${keyVariable} is not a recognized publishable/anon key. Copy the publishable key from Supabase → Project Settings → API.` };
  }
  return { url: supabaseUrl, key: supabasePublishableKey };
}

const configuration = validateConfiguration();
export const supabaseConfigurationError = 'error' in configuration ? configuration.error : '';
export const isSupabaseConfigured = !supabaseConfigurationError;

export const supabase = 'error' in configuration
  ? null
  : createClient(configuration.url, configuration.key, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
