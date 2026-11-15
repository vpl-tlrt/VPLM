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
    const models=[...new Set([
      Deno.env.get('GEMINI_MODEL')||'gemini-2.5-flash',
      Deno.env.get('GEMINI_FALLBACK_MODEL')||'gemini-3.1-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ])];
    const instruction = [
      'Read this handwritten VPLM parking sheet carefully. Return JSON only: {"rows":[{"plate":"...","zone":"...","bay":"...","xParking":false,"confidence":"high|medium|low"}]} .',
      'Each handwritten vehicle number is a registration plate. Never invent or complete unreadable characters; omit unreadable entries.',
      'Printed bay numbers identify destinations, not vehicle registrations. The handwritten plate beside a numbered bay belongs to that bay.',
      'If the sheet has an X Parking column, a plate in that column uses the same numbered bay with xParking=true.',
      'Any handwritten registration in a MANUAL ENTRY area must have zone="Unassigned Bay", bay="", xParking=false.',
      'For ordinary rows use the supplied zone unless the sheet explicitly names a different zone. Zone supplied: ' + zone,
      'Ignore headings, dates, row indices, blank cells and printed example text. Never treat section headings as parking zones.',
      'Return one row per clearly visible vehicle registration. Set confidence=low for uncertain readings and require human verification.'
    ].join(' ');
    const requestBody=JSON.stringify({contents:[{role:'user',parts:[{text:instruction},
      {inlineData:{mimeType,data:image}}]}],
      generationConfig:{temperature:0,maxOutputTokens:5000,responseMimeType:'application/json'}});
    let response:Response|null=null;
    for(const model of models){
      try{
        response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
          method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
          body:requestBody,signal:AbortSignal.timeout(30000),
        });
        if(response.ok)break;
        console.warn('Parking OCR model unavailable:',model,response.status);
      }catch(error){ console.warn('Parking OCR model network failure:',model,error instanceof Error?error.message:'Unknown'); }
    }
    if(!response?.ok) return reply({error:'Google image recognition is temporarily unavailable (upstream model errors). Retry the photo later or import XLSX/CSV now. No parking records were changed.'},503);
    const result=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>};
    const raw=(result.candidates?.[0]?.content?.parts??[]).map(p=>p.text||'').join('');
    const parsed=JSON.parse(raw) as {rows?:unknown};
    if(!Array.isArray(parsed.rows))return reply({error:'AI returned an invalid row list.'},502);
    const rows=parsed.rows.slice(0,300).map((value:unknown)=>{
      const item=(value&&typeof value==='object'?value:{}) as Record<string,unknown>;
      return {plate:String(item.plate??'').slice(0,30),zone:String(item.zone??zone).slice(0,80),
        bay:String(item.bay??'').slice(0,10),xParking:item.xParking===true,
        confidence:['high','medium','low'].includes(String(item.confidence))?item.confidence:'low'};
    });
    return reply({rows});
  }catch(error){
    console.error('Parking sheet reader failed:',error instanceof Error?error.message:'Unknown');
    return reply({error:'Could not read the parking photograph.'},500);
  }
});
