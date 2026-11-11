import { supabase } from '@/lib/supabase';

type Diagnostic = { category: 'Sync' | 'Bug'; severity: 'Medium' | 'High' | 'Critical'; title: string; details: string; screen?: string };
const reported = new Map<string,number>();
const COOLDOWN_MS = 5 * 60_000;
export async function reportAutomaticDiagnostic(userId: string | undefined, diagnostic: Diagnostic): Promise<boolean> {
  if (!userId || !supabase || !navigator.onLine) return false;
  const key = [diagnostic.category,diagnostic.title,diagnostic.details.slice(0,160)].join('|');
  const now = Date.now();
  if (now - (reported.get(key) ?? 0) < COOLDOWN_MS) return false;
  reported.set(key,now);
  const { error } = await supabase.from('vplm_issue_reports').insert({
    reporter_id:userId, category:diagnostic.category, severity:diagnostic.severity,
    title:diagnostic.title.slice(0,160), details:diagnostic.details.slice(0,4000),
    screen:diagnostic.screen ?? 'Automatic diagnostics'
  });
  if (error) { reported.delete(key); return false; }
  return true;
}
