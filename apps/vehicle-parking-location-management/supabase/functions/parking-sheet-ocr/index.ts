import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
const headers={ 'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS' };
const reply=(data:Record<string,unknown>,status=200)=>new Response(JSON.stringify(data),
  {status,headers:{...headers,'Content-Type':'application/json'}});
const defaultKey=()=>{
  const legacy=Deno.env.get('SUPABASE_ANON_KEY');
  if(legacy)return legacy;
  const raw=Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  const obj=raw?JSON.parse(raw) as {default?:string}:null;
  if(!obj?.default)throw new Error('Publishable key is missing.');
  return obj.default;
};
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return reply({error:'Method not allowed.'},405);
  try {
    const token=req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if(!token)return reply({error:'Sign in required.'},401);
    const url=Deno.env.get('SUPABASE_URL');
    if(!url)return reply({error:'Supabase is not configured.'},503);
    const client=createClient(url,defaultKey(),{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},
      global:{headers:{Authorization:'Bearer '+token}}});
    const {data:auth,error:authError}=await client.auth.getUser(token);
    if(authError||!auth.user)return reply({error:'Session expired.'},401);
    const {data:member,error:memberError}=await client.from('workspace_members')
      .select('role').eq('user_id',auth.user.id).maybeSingle();
    if(memberError)return reply({error:'Could not verify permissions.'},503);
    if(!member||!['Administrator','Supervisor'].includes(String(member.role)))
      return reply({error:'Admin or Supervisor permission required.'},403);
    const input=await req.json() as {image?:unknown;mimeType?:unknown;zone?:unknown};
    const image=typeof input.image==='string'?input.image:'';
    const mimeType=typeof input.mimeType==='string'?input.mimeType:'';
    const zone=typeof input.zone==='string'?input.zone:'';
    if(!['image/jpeg','image/png','image/webp'].includes(mimeType) || image.length>5600000 ||
      !/^[A-Za-z0-9+/]+=*$/.test(image)||!image)return reply({error:'Valid image smaller than 4 MB required.'},400);
    if(zone.length>80)return reply({error:'Invalid parking zone.'},400);
    const apiKey=Deno.env.get('GEMINI_API_KEY');
    if(!apiKey)return reply({error:'GEMINI_API_KEY is not configured. Please use Excel/CSV import.'},503);
    // Fixed bounded model list: a single slow custom model must never make the
    // browser wait through multiple 30-second attempts.
    const models=['gemini-2.5-flash-lite','gemini-2.5-flash'] as const;
    // Compact line records avoid the large repeated JSON keys that caused truncated
    // model responses on full parking sheets. Reject incomplete output, never partially import.
    const instruction = [
      'Read this VPLM handwritten parking sheet. Output ONLY one line per clearly readable vehicle.',
      'Each line has exactly five pipe-separated fields: PLATE|ZONE|BAY|X|CONFIDENCE.',
      'Example: 123456|A|24|NO|high and 987654|A|24|YES|medium.',
      'PLATE is the handwritten registration, not the printed bay identifier. Keep leading zeros.',
      'ZONE is the parking zone; use the requested zone unless the sheet clearly states another.',
      'BAY is its printed bay number, or blank for a manually entered unassigned vehicle.',
      'X must be YES only for a registration written in the X Parking column; otherwise NO.',
      'CONFIDENCE must be high, medium, or low. Skip unreadable plates; never guess digits.',
      'MANUAL ENTRY registrations must use zone Unassigned Bay, blank bay and NO for X.',
      'Never output headings, dates, explanations, markdown, JSON or blank lines.',
      'Requested sheet zone: ' + zone
    ].join(' ');
    const requestBody=JSON.stringify({contents:[{role:'user',parts:[{text:instruction},
      {inlineData:{mimeType,data:image}}]}],
      generationConfig:{temperature:0,maxOutputTokens:12000,responseMimeType:'text/plain'}});
    let response:Response|null=null;
    let lastFailure='No response';
    const deadline=Date.now()+35000;
    for(const model of models){
      const remaining=deadline-Date.now();
      if(remaining<2500)break;
      try{
        response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
          method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
          body:requestBody,signal:AbortSignal.timeout(Math.min(18000,remaining)),
        });
        if(response.ok)break;
        lastFailure=model+' returned HTTP '+response.status;
        console.warn('Parking OCR model unavailable:',model,response.status);
      }catch(error){
        lastFailure=model+' timed out or could not connect';
        console.warn('Parking OCR model network failure:',model,error instanceof Error?error.message:'Unknown');
      }
    }
    if(!response?.ok) return reply({error:'OCR service unavailable: '+lastFailure+'. Try Read in sections or Excel import. No vehicle records changed.'},503);
    const result=await response.json() as {candidates?:Array<{
      finishReason?:string; content?:{parts?:Array<{text?:string}>}
    }>};
    const candidate=result.candidates?.[0];
    const raw=(candidate?.content?.parts??[]).map(p=>p.text||'').join('').trim();
    if(candidate?.finishReason === 'MAX_TOKENS') {
      return reply({error:'The sheet contains too many entries for one photo. Photograph each half separately and upload both. No parking data was changed.'},422);
    }
    const rows:Array<{plate:string;zone:string;bay:string;xParking:boolean;confidence:string}> = [];
    for(const line of raw.split(/\r?\n/)) {
      if(!line.trim())continue;
      const fields=line.replace(/^[-*]\s*/, '').trim().split('|').map(value=>value.trim());
      if(fields.length!==5 || !/^[A-Za-z0-9 -]{3,30}$/.test(fields[0]))continue;
      if(!/^(YES|NO)$/i.test(fields[3]))continue;
      if(!/^(high|medium|low)$/i.test(fields[4]))continue;
      rows.push({plate:fields[0].slice(0,30),zone:(fields[1]||zone).slice(0,80),
        bay:fields[2].slice(0,10),xParking:/^YES$/i.test(fields[3]),
        confidence:fields[4].toLowerCase()});
    }
    if(!rows.length) {
      return reply({error:'No valid vehicle registrations could be read. Try a clearer photo, or enter the sheet in Excel. No parking data was changed.'},422);
    }
    if(rows.length>300) {
      return reply({error:'Too many registrations in one upload. Split the photo into two parts. No parking data was changed.'},422);
    }
    return reply({rows});
  }catch(error){
    console.error('Parking sheet reader failed:',error instanceof Error?error.message:'Unknown');
    return reply({error:'Could not read the parking photograph.'},500);
  }
});
