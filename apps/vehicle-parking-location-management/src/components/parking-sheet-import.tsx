import { useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { isLiveGarageContainer, parkingZoneLabel, type ParkingLocation } from '@/lib/parking-data';
import { type ParkingImportRow } from '@/lib/parking-batch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Draft = { plate: string; zone: string; bay: string; xParking: boolean; confidence?: string };
const normalize = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
const asZone = (v: string) => {
  const normalized = v.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return ({acczonea:'A', zonea:'A', a:'A', acczoneb:'B', zoneb:'B', b:'B',
    acczonec:'C', zonec:'C', c:'C', workshop:'Workshop', workshopbay:'Workshop',
    reception:'Reception', receptionparking:'Reception',
    treception:'Toyota Reception', toyotareception:'Toyota Reception',
    lreception:'Lexus Reception', lexusreception:'Lexus Reception',
    washingarea:'Washing Area', bp1:'BP1', bp2:'BP2', bp3:'BP3',
    workshopcentrebay:'Workshop Centre Bay', managerparking:'Manager Parking',
    unassigned:'Unassigned Bay', unassignedbay:'Unassigned Bay' } as Record<string,string>)[normalized] ?? v;
};
const isPlate = (v: string) => /^[A-Z0-9]{3,20}$/.test(normalize(v));

type ScannedRegion = { label: string; image: string };
async function imageToRegions(file: File, mode: 'sections'|'single'): Promise<ScannedRegion[]> {
  const bitmap = await createImageBitmap(file);
  try {
    // High-resolution sections keep individual handwritten registrations legible
    // and prevent long model responses from being truncated.
    const landscape = bitmap.width > bitmap.height;
    const count = mode === 'single' ? 1 : landscape ? 3 : 2;
    const regions: ScannedRegion[] = [];
    for (let i = 0; i < count; i++) {
      const axis = landscape ? bitmap.width : bitmap.height;
      const margin = Math.round(axis * 0.035);
      const start = Math.max(0, Math.floor(i * axis / count) - margin);
      const end = Math.min(axis, Math.ceil((i + 1) * axis / count) + margin);
      const sourceWidth = landscape ? end - start : bitmap.width;
      const sourceHeight = landscape ? bitmap.height : end - start;
      const scale = Math.min(1, (mode === 'single' ? 1900 : 2200) / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Your browser could not prepare the photograph.');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, landscape ? start : 0, landscape ? 0 : start,
        sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('Photo conversion failed.')), 'image/jpeg', 0.86));
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Could not prepare the photo section.'));
        reader.readAsDataURL(blob);
      });
      regions.push({ label: mode === 'single' ? 'Full photo' : (landscape ? ['Left', 'Centre', 'Right'] : ['Top', 'Bottom'])[i], image: data });
    }
    return regions;
  } finally { bitmap.close(); }
}

const csvRows = (text: string): Draft[] => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.slice(1).map(line => {
    const fields = line.split(',').map(v => v.trim().replace(/^"|"$/g,''));
    return { plate:fields[0] || '',zone:asZone(fields[1] || 'Unassigned Bay'),bay:fields[2] || '',
      xParking:/^(x|yes|true|1)$/i.test(fields[3] || '') };
  }).filter(r => r.plate);
};

// Read XLSX ZIP members with built-in browser streaming decompression; no extra dependency or cloud upload.
async function xlsxMembers(buffer: ArrayBuffer): Promise<Map<string,string>> {
  const view = new DataView(buffer), bytes = new Uint8Array(buffer), decoder = new TextDecoder();
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0,bytes.length - 65557); i--) {
    if (view.getUint32(i,true) === 0x06054b50) { eocd=i;break; }
  }
  if (eocd < 0) throw new Error('Not a valid XLSX workbook.');
  const members = new Map<string,string>(), entries=view.getUint16(eocd+10,true);
  let off=view.getUint32(eocd+16,true);
  for (let i=0;i<entries;i++) {
    if (view.getUint32(off,true)!==0x02014b50) throw new Error('Corrupted XLSX ZIP directory.');
    const method=view.getUint16(off+10,true),size=view.getUint32(off+20,true);
    const nameLen=view.getUint16(off+28,true), extra=view.getUint16(off+30,true),comment=view.getUint16(off+32,true);
    const name=decoder.decode(bytes.slice(off+46,off+46+nameLen));
    const pos=view.getUint32(off+42,true),start=pos+30+view.getUint16(pos+26,true)+view.getUint16(pos+28,true);
    if (name.startsWith('xl/worksheets/sheet') && name.endsWith('.xml') || name==='xl/sharedStrings.xml') {
      const data=bytes.slice(start,start+size);
      let uncompressed: Uint8Array;
      if (method===0) uncompressed=data;
      else if (method===8) {
        const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        uncompressed=new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error('Unsupported workbook compression.');
      members.set(name,decoder.decode(uncompressed));
    }
    off+=46+nameLen+extra+comment;
  }
  return members;
}
async function parseTemplateXlsx(file: File): Promise<Draft[]> {
  const members=await xlsxMembers(await file.arrayBuffer());
  const sharedXml=members.get('xl/sharedStrings.xml');
  const xmlParser=new DOMParser();
  const shared=sharedXml?Array.from(xmlParser.parseFromString(sharedXml,'application/xml').getElementsByTagName('si'))
    .map(si=>si.textContent||''):[];
  const output: Draft[]=[];
  const zoneBySheet=['A','B','C','Workshop','Reception','Other Zones','Unassigned Bay'];
  for(let sheet=1;sheet<=7;sheet++){
    const raw=members.get('xl/worksheets/sheet'+sheet+'.xml');
    if(!raw)continue;
    const xml=xmlParser.parseFromString(raw,'application/xml');
    const rows=Array.from(xml.getElementsByTagName('row'));
    let manualStart=Infinity;
    for(const row of rows){
      const number=Number(row.getAttribute('r'));
      const cells=new Map<string,string>();
      for(const cell of Array.from(row.getElementsByTagName('c'))){
        const ref=cell.getAttribute('r')||'';
        const rawValue=cell.getElementsByTagName('v')[0]?.textContent||'';
        // Excel and openpyxl can write labels or entered registrations as inline strings.
        const inlineValue=cell.getElementsByTagName('is')[0]?.textContent||'';
        cells.set(ref.replace(/[0-9]/g,''),cell.getAttribute('t')==='s'?shared[Number(rawValue)]||'':
          cell.getAttribute('t')==='inlineStr'?inlineValue:rawValue);
      }
      if((cells.get('A')||'').includes('MANUAL ENTRY'))manualStart=number+2;
      const push=(plate:string,zone:string,bay:string,xParking=false)=>{
        if(isPlate(plate))output.push({plate:normalize(plate),zone,bay,xParking});
      };
      if(sheet===7 && number>=8 && number<=38){
        for(const col of ['B','D','F','H'])push(cells.get(col)||'','Unassigned Bay','');
      }else if(sheet===6 && number>=7 && number<manualStart){
        const group=(number>=7 && number<=16)?['Toyota Reception','Lexus Reception','Washing Area','BP1']:
          (number>=19 && number<=30)?['BP2','BP3','Workshop Centre Bay','Manager Parking']:null;
        if(group) ['B','D','F','H'].forEach((col,i)=>push(cells.get(col)||'',group[i],''));
      }else if(number>=manualStart && sheet!==7){
        for(const col of (sheet===5||sheet===6?['B','D','F','H']:['B','D','F']))push(cells.get(col)||'','Unassigned Bay','');
      }else if(sheet<=5 && number>=6 && number<manualStart-2){
        const zone=zoneBySheet[sheet-1];
        const groups=sheet===4? [['A','B'],['C','D'],['E','F']] :
          sheet===5? [['A','B'],['C','D'],['E','F'],['G','H']] :
          [['A','B','C'],['D','E','F']];
        for(const [bayCol,plateCol,xCol] of groups){
          const bay=cells.get(bayCol)||'';
          if(!/^\d+$/.test(bay))continue;
          push(cells.get(plateCol)||'',zone,bay);
          if(xCol)push(cells.get(xCol)||'',zone,bay,true);
        }
      }
    }
  }
  if(!output.length)throw new Error('No filled vehicle registration cells found in the VPLM workbook.');
  return output;
}

export function ParkingSheetImport({ locations,onApply,disabled=false }:{
  locations: ParkingLocation[]; onApply:(rows:ParkingImportRow[],relocateOccupants:boolean)=>boolean; disabled?:boolean;
}){
  const [draft,setDraft]=useState<Draft[]>([]);
  const [zone,setZone]=useState('A');
  const [reading,setReading]=useState(false);
  const [scanProgress,setScanProgress]=useState('');
  const [scanIncomplete,setScanIncomplete]=useState(false);
  const [scanMessage,setScanMessage]=useState('Select a photograph to start. No parking data changes until you confirm.');
  const [scanMode,setScanMode]=useState<'sections'|'single'>('sections');
  const [uploadError,setUploadError]=useState('');
  const [moveOccupants,setMoveOccupants]=useState(true);
  const [confirmed,setConfirmed]=useState(false);
  const zoneNames=[...new Set(locations.map(loc=>loc.zone))].filter(name=>name!=='Unassigned Bay');
  const update=(i:number,patch:Partial<Draft>)=>{setDraft(old=>old.map((row,j)=>i===j?{...row,...patch}:row));setConfirmed(false);};
  const startManualReview=()=>{
    if(reading||disabled)return;
    // Explicit manual fallback: do not mix unfinished photo scan entries with new records.
    setScanIncomplete(false);
    setUploadError('');
    setConfirmed(false);
    setDraft(old=>old.length ? [...old,{plate:'',zone,bay:'',xParking:false,confidence:'Manual'}] :
      [{plate:'',zone,bay:'',xParking:false,confidence:'Manual'}]);
    setScanMessage('Manual review mode: enter the registration and exact bay for every vehicle, then verify and apply.');
  };
  const ingest=async(e:ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    setReading(true);setConfirmed(false);setUploadError('');setDraft([]);setScanProgress('');setScanIncomplete(false);setScanMessage('Preparing '+file.name+' for recognition…');
    try{
      if(/\.csv$/i.test(file.name)){
        const imported=csvRows(await file.text());
        if(!imported.length)throw new Error('No vehicle registration rows found in the CSV.');
        setDraft(imported);setScanMessage(imported.length+' CSV entries ready. Check the table below and confirm before applying.');
      }else if(/\.xlsx$/i.test(file.name)){
        const imported=await parseTemplateXlsx(file);
        setDraft(imported);setScanMessage(imported.length+' Excel entries ready. Check the table below and confirm before applying.');
      }else if(file.type.startsWith('image/')){
        if(!supabase)throw new Error('AI scanning requires a live cloud connection.');
        if(file.size>18*1024*1024)throw new Error('Photo too large. Use an image smaller than 18 MB.');
        // Always resize/compress before invoking Edge Function, including Full photo.
        // Previously Full photo sent the raw camera file and could exceed request limits.
        const regions = await imageToRegions(file, scanMode);
        const collected:Draft[]=[];
        const unique=new Map<string,Draft>();
        for(let i=0;i<regions.length;i++){
          const region=regions[i];
          setScanProgress('Scanning '+region.label+' section ('+(i+1)+'/'+regions.length+')');
          const {data,error}=await supabase.functions.invoke('parking-sheet-ocr',{
            body:{image:region.image,mimeType:'image/jpeg',zone},
            signal:AbortSignal.timeout(50000)
          });
          if(error){
            const context=error as {context?:Response;message?:string};
            let detail='';
            if(context.context && typeof context.context.json==='function'){
              try { const body=await context.context.json() as {error?:string};detail=body.error||''; }
              catch { /* Use the original error below. */ }
            }
            throw new Error(region.label+': '+(detail||(/Failed to send a request/i.test(context.message||'') ?
              'Network request failed before a response. The photo was compressed; check connectivity and try Read in sections.' :
              context.message||'Photo recognition failed.')));
          }
          if(data?.error)throw new Error(region.label+': '+String(data.error));
          if(!Array.isArray(data?.rows))throw new Error(region.label+': Image scanner returned an invalid result.');
          collected.push(...(data.rows as Array<{plate:string;zone?:string;bay?:string;xParking?:boolean;confidence?:string}>)
            .map(item=>({plate:String(item.plate||''),zone:asZone(item.zone||zone),bay:String(item.bay||''),
              xParking:Boolean(item.xParking),confidence:item.confidence})));
          // Surface each completed section immediately instead of making the user
          // wait for every section; never save anything until the review is approved.
          for(const row of collected){
            const key=normalize(row.plate)+'|'+row.zone+'|'+row.bay+'|'+String(row.xParking);
            const previous=unique.get(key);
            if(!previous || (previous.confidence==='low' && row.confidence!=='low'))unique.set(key,row);
          }
          setDraft([...unique.values()]);
          setScanMessage(unique.size+' registrations recognized from '+(i+1)+' of '+regions.length+' sections. Review the table below.');
          setScanProgress(region.label+' complete: '+unique.size+' vehicles found. '+(regions.length-i-1)+' sections remaining.');

        }
        if(!unique.size)throw new Error('No clear registration readings. Try a better photo or import the Excel register. No vehicles changed.');
        setDraft([...unique.values()]);
        setScanMessage('Recognition finished: '+unique.size+' registrations ready. Scroll down, correct mistakes and confirm before applying.');
      }else throw new Error('Use JPG, PNG, CSV, or the VPLM XLSX template.');
    }catch(err){
      const message=err instanceof Error?err.message:'Could not read the parking sheet.';
      setScanIncomplete(true);
      setScanMessage('Recognition did not finish. No parking changes were made. You can retry the photo or import an Excel/CSV sheet.');
      setUploadError(message);toast.error(message);
    }
    finally{setReading(false);setScanProgress('');}
  };
  const resolveBay=(row:Draft)=>{
    if(row.zone==='Unassigned Bay')return undefined;
    return locations.find(loc=>loc.zone===row.zone &&
      (row.bay.trim() ? loc.bayNumber===row.bay.trim().padStart(2,'0') :
        isLiveGarageContainer(loc)))?.id;
  };
  const duplicatePlates=new Set(draft.filter((row,i)=>draft.some((other,j)=>j!==i &&
    normalize(other.plate)===normalize(row.plate))).map(row=>normalize(row.plate)));
  const invalid=draft.filter(row=>!isPlate(row.plate) || duplicatePlates.has(normalize(row.plate)) ||
    (row.zone!=='Unassigned Bay' && (!zoneNames.includes(row.zone) || !resolveBay(row))));
  const apply=()=>{
    if(disabled||!confirmed||invalid.length||scanIncomplete||reading||!draft.length)return;
    const rows=draft.map(row=>({plate:normalize(row.plate),bayId:resolveBay(row),xParking:row.xParking}));
    if(onApply(rows,moveOccupants)){setDraft([]);setConfirmed(false);setScanMessage('Parking updates were staged. Verify their cloud status on the live parking map.');}
  };
  return <Card><CardHeader><CardTitle>Photo / Excel Parking Import</CardTitle>
    <CardDescription>Admin and Supervisor only. Scan a photographed sheet, upload the VPLM XLSX register, or import CSV (vehicle,zone,bay,x). Review every row before changing MAIN.</CardDescription>
    </CardHeader><CardContent className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm">Photo zone <select className="rounded border p-2" value={zone} onChange={e=>setZone(e.target.value)}>
        {zoneNames.map(name=><option value={name} key={name}>{parkingZoneLabel(name)}</option>)}
        <option value="Unassigned Bay">Unassigned Bay</option>
      </select></label>
      <label className="text-sm">Photo scanning
        <select className="ml-2 rounded border p-2" value={scanMode} onChange={e=>setScanMode(e.target.value as 'sections'|'single')}>
          <option value="sections">Read in sections (recommended)</option>
          <option value="single">Read entire photo</option>
        </select>
      </label>
      <input type="file" accept=".xlsx,.csv,image/png,image/jpeg,image/webp" onChange={e=>void ingest(e)} disabled={disabled||reading} aria-label="Upload parking sheet" />
      <Button type="button" variant="outline" onClick={startManualReview} disabled={disabled||reading}>Add vehicle manually to review</Button>
    </div>
    <p role="status" className="rounded-md border p-3 text-sm font-medium">{reading ? (scanProgress||scanMessage) : scanMessage}</p>
    {uploadError&&<p role="alert" className="rounded border border-red-400 bg-red-950/20 p-3 text-sm text-red-600 dark:text-red-300">{uploadError} {draft.length>0?'These partial readings are shown for review only; import is disabled until a complete rescan.':'Existing parking records remain unchanged.'}</p>}
    {draft.length===0 && !reading && <p className="text-sm text-muted-foreground">No registrations are ready for review yet. Upload a completed sheet, use Excel/CSV, or select Add vehicle manually to review. Nothing is saved until approved.</p>}
    {draft.length>0&&<>
      <p className="text-sm font-medium" id="parking-import-review">Step 2 — Review {draft.length} registrations. {invalid.length} require correction. Duplicate readings must be corrected or removed. Entries with no known parking bay must use Unassigned Bay.</p>
      <div className="max-h-96 overflow-auto rounded border">
        <table className="w-full min-w-[580px] text-left text-sm"><thead><tr className="bg-muted">
          <th className="p-2">Vehicle</th><th className="p-2">Zone</th><th className="p-2">Bay</th><th className="p-2">X</th><th className="p-2">Reading</th><th className="p-2"></th>
        </tr></thead><tbody>{draft.map((row,i)=><tr key={i} className="border-t">
          <td className="p-1"><input className="w-28 rounded border p-2" value={row.plate} onChange={e=>update(i,{plate:e.target.value})}/></td>
          <td className="p-1"><select className="max-w-40 rounded border p-2" value={row.zone} onChange={e=>update(i,{zone:e.target.value,bay:''})}>
            {[...zoneNames,'Unassigned Bay'].map(z=><option key={z} value={z}>{parkingZoneLabel(z)}</option>)}
          </select></td>
          <td className="p-1"><input className="w-16 rounded border p-2" value={row.bay} placeholder="None" onChange={e=>update(i,{bay:e.target.value})}/></td>
          <td className="p-1"><input type="checkbox" checked={row.xParking} onChange={e=>update(i,{xParking:e.target.checked})}/></td>
          <td className="p-1">{row.confidence||'Review'}</td>
          <td className="p-1"><button type="button" onClick={()=>{setDraft(old=>old.filter((_,j)=>i!==j));setConfirmed(false);}}>Remove</button></td>
        </tr>)}</tbody></table></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={moveOccupants} onChange={e=>setMoveOccupants(e.target.checked)}/> Relocate occupied-bay vehicles to Unassigned Bay</label>
      {!moveOccupants&&<p className="text-xs">Occupied bays will be rejected during validation.</p>}
      <p className="text-sm font-semibold">Step 3 — Confirm and apply only after checking every row.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
        I have verified vehicle registrations, bays, X positions and authorization for {draft.length} updates.</label>
      <Button type="button" disabled={disabled||!confirmed||invalid.length>0||scanIncomplete||reading||!draft.length} onClick={apply}>Apply reviewed parking updates</Button>
    </>}
  </CardContent></Card>;
}
