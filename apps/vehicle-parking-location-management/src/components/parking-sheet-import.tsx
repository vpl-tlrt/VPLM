import { useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { isLiveGarageContainer, parkingZoneLabel, parkingRecordKey, supportsXParkingLocation, type ParkingLocation, type Vehicle } from '@/lib/parking-data';
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
async function parseTemplateXlsx(file: File, selectedZone: string): Promise<Draft[]> {
  const members=await xlsxMembers(await file.arrayBuffer());
  const sharedXml=members.get('xl/sharedStrings.xml');
  const xmlParser=new DOMParser();
  const shared=sharedXml?Array.from(xmlParser.parseFromString(sharedXml,'application/xml').getElementsByTagName('si'))
    .map(si=>si.textContent||''):[];
  const output: Draft[]=[];
  // Copilot and ordinary Excel exports often contain two columns instead of the
  // seven-sheet VPLM printable template. Detect that layout by its header.
  const rawFirst=members.get('xl/worksheets/sheet1.xml');
  if (rawFirst) {
    const firstXml=xmlParser.parseFromString(rawFirst,'application/xml');
    const firstRows=Array.from(firstXml.getElementsByTagName('row'));
    const getCells=(row:Element)=>{
      const cells=new Map<string,string>();
      for(const cell of Array.from(row.getElementsByTagName('c'))){
        const col=(cell.getAttribute('r')||'').replace(/[0-9]/g,'');
        const value=cell.getElementsByTagName('v')[0]?.textContent||'';
        const inline=cell.getElementsByTagName('is')[0]?.textContent||'';
        cells.set(col,cell.getAttribute('t')==='s'?(shared[Number(value)]||''):
          cell.getAttribute('t')==='inlineStr'?inline:value);
      }
      return cells;
    };
    const header=firstRows[0]&&getCells(firstRows[0]);
    if(header && /vehicle\s*(number|no\.?|registration)/i.test(header.get('A')||'') &&
      /(parking\s*)?(slot|bay)/i.test(header.get('B')||'')) {
      for(const line of firstRows.slice(1)){
        const cells=getCells(line);
        const plate=normalize((cells.get('A')||'').trim());
        const slot=(cells.get('B')||'').trim();
        if(!plate && !slot)continue;
        if(!isPlate(plate)||!/^\d{1,3}$/.test(slot)){
          throw new Error('Invalid vehicle or parking slot on Excel row '+line.getAttribute('r')+'. Please correct the workbook.');
        }
        const num=Number(slot);
        // The combined accommodation register covers A 1-46, B 47-90 and C 91-107.
        // Other ranges use the administrator's chosen source zone.
        const mappedZone=num>=1&&num<=46?'A':num<=90&&num>=47?'B':num<=107&&num>=91?'C':selectedZone;
        output.push({plate,zone:mappedZone,bay:slot,xParking:false,confidence:'Excel row '+line.getAttribute('r')});
      }
      if(!output.length)throw new Error('The two-column Excel sheet contains no vehicle entries.');
      return output;
    }
  }
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

export function ParkingSheetImport({ locations,vehicles,onApply,disabled=false }:{
  locations: ParkingLocation[]; vehicles: Vehicle[]; onApply:(rows:ParkingImportRow[],relocateOccupants:boolean)=>boolean|Promise<boolean>; disabled?:boolean;
}){
  const [draft,setDraft]=useState<Draft[]>([]);
  const [pastedText,setPastedText]=useState('');
  const [completeZone,setCompleteZone]=useState(false);
  const [reviewedSuggestions,setReviewedSuggestions]=useState<Set<number>>(new Set());
  const [zone,setZone]=useState('A');
  const [reading,setReading]=useState(false);
  const [applying,setApplying]=useState(false);
  const [progress,setProgress]=useState(0);
  const [phase,setPhase]=useState<'idle'|'preparing'|'recognizing'|'review'|'applying'|'staged'|'error'>('idle');
  const [completedSections,setCompletedSections]=useState(0);
  const [totalSections,setTotalSections]=useState(0);
  const [lastFile,setLastFile]=useState('');
  const [lastFileSize,setLastFileSize]=useState<number | null>(null);
  const [activity,setActivity]=useState<string[]>(['Importer ready — choose a photo, Excel/CSV file, or paste OCR text.']);
  const recordActivity=(message:string)=>setActivity(old=>[...old.slice(-7),new Date().toLocaleTimeString()+' — '+message]);
  const [lastEventAt,setLastEventAt]=useState('');
  const setStatus=(next:typeof phase,pct:number,detail:string)=>{
    setPhase(next);setProgress(pct);setScanMessage(detail);setLastEventAt(new Date().toLocaleTimeString());
    recordActivity(detail);
  };
  const [scanProgress,setScanProgress]=useState('');
  const [scanIncomplete,setScanIncomplete]=useState(false);
  const [scanMessage,setScanMessage]=useState('Select a photograph to start. No parking data changes until you confirm.');
  const [scanMode,setScanMode]=useState<'sections'|'single'>('sections');
  const [uploadError,setUploadError]=useState('');
  const [moveOccupants,setMoveOccupants]=useState(true);
  const [confirmed,setConfirmed]=useState(false);
  const zoneNames=[...new Set(locations.map(loc=>loc.zone))].filter(name=>name!=='Unassigned Bay');
  const update=(i:number,patch:Partial<Draft>)=>{setDraft(old=>old.map((row,j)=>i===j?{...row,...patch}:row));setConfirmed(false);setReviewedSuggestions(old=>{const n=new Set(old);n.delete(i);return n;});};
  const parseCopiedList=()=>{
    const lines=pastedText.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    const result:Draft[]=[];
    for(const line of lines){
      if (/vehicle\s*(number|no)|parking\s*slot/i.test(line)) continue;
      const columns=line.split(/\t+|\s{2,}|\s*[,;|]\s*/).map(s=>s.trim()).filter(Boolean);
      let plate=columns[0], bay=columns[1];
      if (columns.length===1) {
        const matched=line.match(/^([A-Z0-9-]+)\s+(\d{1,3})$/i);
        if(matched){plate=matched[1];bay=matched[2];}
      }
      if(!plate || !bay || !/^\d+$/.test(bay)) {
        toast.error('Unrecognized line: '+line.slice(0,60)+'. Use Vehicle Number and Parking Slot columns.');return;
      }
      result.push({plate:normalize(plate),zone,bay,xParking:false,confidence:'Copied OCR'});
    }
    if(!result.length)return toast.error('Paste vehicle numbers and parking slots first.');
    setDraft(result);setScanIncomplete(false);setUploadError('');setConfirmed(false);setCompleteZone(false);
    setReviewedSuggestions(new Set());setMoveOccupants(true);
    setStatus('review',100,result.length+' copied OCR rows ready. Review matches and displaced vehicles before applying.');
  };
  const startManualReview=()=>{
    if(reading||disabled)return;
    // Explicit manual fallback: do not mix unfinished photo scan entries with new records.
    setScanIncomplete(false);
    setUploadError('');
    setConfirmed(false);
    setDraft(old=>old.length ? [...old,{plate:'',zone,bay:'',xParking:false,confidence:'Manual'}] :
      [{plate:'',zone,bay:'',xParking:false,confidence:'Manual'}]);
    setStatus('review',100,'Manual review mode: enter the registration and exact bay for every vehicle, then verify and apply.');
  };
  const ingest=async(e:ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];e.target.value='';
    if(!file){setStatus('idle',0,'File selection cancelled. Choose a photo or spreadsheet to begin.');return;}
    setLastFileSize(file.size);
    recordActivity('File selected: '+file.name+' ('+Math.ceil(file.size/1024)+' KB).');
    setReading(true);setConfirmed(false);setUploadError('');setDraft([]);setScanProgress('');
    setScanIncomplete(false);setLastFile(file.name);setCompletedSections(0);setTotalSections(0);
    setStatus('preparing',5,'Preparing '+file.name+' for import…');
    try{
      if(/\.csv$/i.test(file.name)){
        const imported=csvRows(await file.text());
        if(!imported.length)throw new Error('No vehicle registration rows found in the CSV.');
        setDraft(imported);setStatus('review',100,imported.length+' CSV entries ready. Check the table below and confirm before applying.');
      }else if(/\.xlsx$/i.test(file.name)){
        setStatus('preparing',30,'Reading Excel workbook locally…');
        const imported=await parseTemplateXlsx(file,zone);
        setDraft(imported);setStatus('review',100,imported.length+' Excel entries ready. Check the table below and confirm before applying.');
      }else if(file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)){
        if(!supabase)throw new Error('AI scanning requires a live cloud connection.');
        if(file.size>18*1024*1024)throw new Error('Photo too large. Use an image smaller than 18 MB.');
        // Always resize/compress before invoking Edge Function, including Full photo.
        // Previously Full photo sent the raw camera file and could exceed request limits.
        setStatus('preparing',12,'Compressing photo into readable OCR sections…');
        const regions = await imageToRegions(file, scanMode);
        setTotalSections(regions.length);
        setStatus('recognizing',20,'Photo prepared. Starting OCR: 0 of '+regions.length+' sections complete.');
        const collected:Draft[]=[];
        const unique=new Map<string,Draft>();
        for(let i=0;i<regions.length;i++){
          const region=regions[i];
          setScanProgress('OCR service processing '+region.label+' ('+(i+1)+'/'+regions.length+'). Waiting for response…');
          setStatus('recognizing',20+Math.round(i/regions.length*70),'OCR processing '+region.label+' ('+(i+1)+'/'+regions.length+').');
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
          setCompletedSections(i+1);
          setStatus('recognizing',20+Math.round((i+1)/regions.length*70),unique.size+' registrations recognized. '+(i+1)+' of '+regions.length+' OCR sections complete.');
          setScanProgress(region.label+' complete: '+unique.size+' vehicles found. '+(regions.length-i-1)+' sections remaining.');

        }
        if(!unique.size)throw new Error('No clear registration readings. Try a better photo or import the Excel register. No vehicles changed.');
        setDraft([...unique.values()]);
        setStatus('review',100,'OCR complete: '+unique.size+' registrations ready. Correct mistakes and confirm. No records changed yet.');
      }else throw new Error('Use JPG, PNG, CSV, or the VPLM XLSX template.');
    }catch(err){
      const message=err instanceof Error?err.message:'Could not read the parking sheet.';
      setScanIncomplete(true);
      setStatus('error',0,'Import stopped: '+message+'. No parking changes were made. Retry or paste OCR results manually.');
      setUploadError(message);toast.error(message);
    }
    finally{setReading(false);setScanProgress('');recordActivity('File read process ended. Current result is shown above.');}
  };
  const resolveBay=(row:Draft)=>{
    if(row.zone==='Unassigned Bay')return undefined;
    return locations.find(loc=>loc.zone===row.zone &&
      (row.bay.trim() ? loc.bayNumber===row.bay.trim().padStart(2,'0') :
        isLiveGarageContainer(loc)))?.id;
  };
  const activeInZone=vehicles.filter(v=>v.status!=='Delivered' && v.status!=='Released' &&
    locations.some(loc=>loc.zone===zone && parkingRecordKey(loc.id)===parkingRecordKey(v.currentLocationId)));
  const normalizedPlates=new Set(draft.map(r=>normalize(r.plate)));
  const missingFromZone=activeInZone.filter(v=>!normalizedPlates.has(normalize(v.plateNumber)));
  const similarity=(a:string,b:string)=>{
    if(a===b)return 0;
    const d=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){
      let prev=d[0];d[0]=i;
      for(let j=1;j<=b.length;j++){const saved=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=saved;}
    }
    return d[b.length];
  };
  const suggestions=draft.map(row=>{
    const p=normalize(row.plate);
    const exact=vehicles.filter(v=>normalize(v.plateNumber)===p && v.status!=='Delivered');
    if(exact.length)return {exact,similar:[] as Vehicle[]};
    const similar=vehicles.filter(v=>v.status!=='Delivered' && similarity(p,normalize(v.plateNumber))<=2)
      .sort((a,b)=>similarity(p,normalize(a.plateNumber))-similarity(p,normalize(b.plateNumber))).slice(0,5);
    return {exact,similar};
  });
  const unresolvedMatches=suggestions.some((s,i)=>s.similar.length>0 && !reviewedSuggestions.has(i));
  const destinationOccupants=draft.flatMap(row=>{
    const id=resolveBay(row);
    if(!id)return [];
    return vehicles.filter(v=>v.status!=='Delivered' && v.status!=='Released' &&
      parkingRecordKey(v.currentLocationId)===parkingRecordKey(id) && normalize(v.plateNumber)!==normalize(row.plate) &&
      (v.xParking==='Yes')===row.xParking && !normalizedPlates.has(normalize(v.plateNumber)));
  });
  const duplicatePlates=new Set(draft.filter((row,i)=>draft.some((other,j)=>j!==i &&
    normalize(other.plate)===normalize(row.plate))).map(row=>normalize(row.plate)));
  const targetPositions=draft.map(row=>row.zone==='Unassigned Bay'?'':(resolveBay(row)||'invalid')+':'+(row.xParking?'X':'regular'));
  const duplicateSlots=new Set(targetPositions.filter((key,i)=>key && targetPositions.some((other,j)=>j!==i&&other===key)));
  const invalid=draft.filter((row,i)=>!isPlate(row.plate) || duplicatePlates.has(normalize(row.plate)) ||
    duplicateSlots.has(targetPositions[i]) ||
    (row.zone!=='Unassigned Bay' && (!zoneNames.includes(row.zone) || !resolveBay(row))) ||
    (row.xParking && !supportsXParkingLocation(locations.find(loc=>loc.id===resolveBay(row)))));
  const apply=async()=>{
    if(disabled||applying||!confirmed||invalid.length||scanIncomplete||reading||!draft.length)return;
    if(unresolvedMatches)return toast.error('Review every possible OCR match first.');
    const additions=completeZone ? missingFromZone.map(v=>({plate:normalize(v.plateNumber)})) : [];
    if(completeZone && draft.some(row=>row.zone!==zone))return toast.error('A complete-zone reconciliation can only include the selected zone.');
    const rows=[...draft.map(row=>({plate:normalize(row.plate),bayId:resolveBay(row),xParking:row.xParking})),...additions];
    if(completeZone && !window.confirm('COMPLETE ZONE CONFIRMATION: Move '+missingFromZone.length+
      ' vehicles missing from the OCR list in '+parkingZoneLabel(zone)+' to Unassigned Bay, in addition to the '+draft.length+
      ' reviewed entries? This requires a verified complete zone list.'))return;
    setApplying(true);setUploadError('');
    setStatus('applying',15,'Validating parking changes and active requests against MAIN…');
    try {
      const applied=await onApply(rows,moveOccupants);
      if(applied) {
        setDraft([]);setConfirmed(false);
        setStatus('staged',100,'Changes submitted to MAIN sync. Cloud save NOT yet verified; check live sync status.');
      } else {
        setStatus('review',100,'Update cancelled or blocked. No successful upload confirmed. Review any error message and retry.');
      }
    } catch(error) {
      const message=error instanceof Error?error.message:'Parking update failed.';
      setUploadError(message);setStatus('error',15,'Update failed: '+message+'. No successful cloud save confirmed.');
    } finally {setApplying(false);}
  };
  return <Card><CardHeader><CardTitle>Photo / Excel / Copilot OCR Parking Import · Status v3</CardTitle>
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
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="vplm-parking-file" className="text-sm font-semibold">Select parking file (Android / Excel / Photo)</label>
        <input id="vplm-parking-file" type="file" className="block w-full max-w-full rounded-md border border-primary bg-background p-2 text-sm"
          accept=".xlsx,.csv,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onClick={()=>{if(!reading&&!applying)setStatus('idle',0,'File picker opened. Select the XLSX workbook or a photo.');}}
          onChange={e=>void ingest(e)} disabled={reading||applying} aria-label="Upload parking sheet" />
      </div>
      <Button type="button" variant="outline" onClick={startManualReview} disabled={disabled||reading||applying}>Add vehicle manually to review</Button>
    </div>
    <section role="status" aria-live="polite" className="space-y-2 rounded-md border-2 border-primary/50 p-3" data-import-version="ocr-status-v3">
      <p className="text-xs font-semibold">OCR importer diagnostics v3 · read/review can run while cloud saving is temporarily unavailable.</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Import status: {{
          idle:'Ready',preparing:'Preparing file',recognizing:'OCR in progress',review:'Ready for review',
          applying:'Validating / submitting',staged:'Submitted to sync (unverified)',error:'Error'
        }[phase]}</span>
        <span className="text-sm font-semibold tabular-nums">{progress}%</span>
      </div>
      <div role="progressbar" aria-label="Parking sheet processing progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}
        className="h-3 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all duration-300 ${phase==='error'?'bg-destructive':'bg-primary'}`} style={{width:progress+'%'}} />
      </div>
      <p className="text-sm">{scanMessage}</p>
      {reading&&scanProgress&&<p className="text-xs text-muted-foreground">{scanProgress}</p>}
      {totalSections>0&&<p className="text-xs">OCR sections finished: {completedSections}/{totalSections} · {draft.length} recognized rows</p>}
      {lastFile&&<p className="text-xs text-muted-foreground">File: {lastFile}{lastFileSize!==null?' · '+Math.ceil(lastFileSize/1024)+' KB':''}</p>}
      {lastEventAt&&<p className="text-xs text-muted-foreground">Last update: {lastEventAt}</p>}
      {phase==='recognizing'&&<p className="text-xs">The bar advances when OCR sections return, not by network bytes uploaded.</p>}
      {phase==='staged'&&<p className="text-xs font-medium">This is not proof of a completed cloud save.</p>}
      {disabled&&<p role="alert" className="text-xs font-medium text-amber-700 dark:text-amber-300">MAIN cloud is busy or unavailable. You can read files and review OCR, but Apply remains disabled until the workspace is online and idle.</p>}
      <details className="rounded border p-2 text-xs" open={phase==='error'}>
        <summary className="cursor-pointer font-semibold">Recent upload activity ({activity.length})</summary>
        <ol className="mt-2 space-y-1">{activity.map((message,i)=><li key={i}>{message}</li>)}</ol>
      </details>
    </section>
    {uploadError&&<p role="alert" className="rounded border border-red-400 bg-red-950/20 p-3 text-sm text-red-600 dark:text-red-300">{uploadError} {draft.length>0?'These partial readings are shown for review only; import is disabled until a complete rescan.':'Existing parking records remain unchanged.'}</p>}
    {draft.length===0 && !reading && <p className="text-sm text-muted-foreground">No registrations are ready for review yet. Upload a completed sheet, use Excel/CSV, or select Add vehicle manually to review. Nothing is saved until approved.</p>}
    {draft.length>0&&<>
      <p className="text-sm font-medium" id="parking-import-review">Step 2 — Review {draft.length} registrations. {invalid.length} require correction. Duplicate readings must be corrected or removed. Entries with no known parking bay must use Unassigned Bay.</p>
      {duplicateSlots.size>0&&<p role="alert" className="rounded border border-amber-500 p-3 text-sm font-medium">
        {duplicateSlots.size} duplicated parking position(s) need review. Check OCR readings and choose a valid X Parking position if appropriate, correct the bay, or move the extra vehicle to Unassigned Bay. Unsafe assignments are blocked.
      </p>}
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
      <div className="space-y-3 rounded-md border p-3 text-sm">
        <p className="font-semibold">Live parking reconciliation preview</p>
        <p>{suggestions.filter(item=>item.exact.length>0).length} exact registrations · {suggestions.filter(item=>item.similar.length>0).length} possible OCR mismatches · {new Set(destinationOccupants.map(item=>item.id)).size} destination occupants not on the list</p>
        {suggestions.map((entry,i)=>entry.similar.length>0&&<div key={i} className="flex flex-wrap items-center gap-2 rounded border p-2">
          <span className="font-mono font-semibold">OCR: {draft[i].plate}</span>
          <label className="sr-only" htmlFor={'ocr-match-'+i}>Review OCR registration {draft[i].plate}</label>
          <select id={'ocr-match-'+i} className="max-w-full rounded border bg-background p-2"
            value={reviewedSuggestions.has(i)?'reviewed':''}
            onChange={e=>{
              const value=e.target.value;
              if(value==='reviewed'){setReviewedSuggestions(old=>new Set(old).add(i));setConfirmed(false);}
              else if(value){update(i,{plate:value});setReviewedSuggestions(old=>new Set(old).add(i));}
            }}>
            <option value="">Choose possible existing match…</option>
            {entry.similar.map(item=><option key={item.id} value={item.plateNumber}>Use {item.plateNumber} ({item.currentLocationId||'Unassigned Bay'})</option>)}
            <option value="reviewed">Keep OCR number; no match</option>
          </select>
        </div>)}
        {destinationOccupants.length>0&&<p>Occupied destination vehicles for proposed relocation: {Array.from(new Set(destinationOccupants.map(item=>item.plateNumber))).join(', ')}</p>}
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={completeZone} onChange={e=>{setCompleteZone(e.target.checked);setConfirmed(false);}} />
          <span><strong>Complete-zone reconciliation</strong> — I confirm this OCR list contains every parked vehicle in the selected source zone. Propose moving unlisted vehicles to Unassigned Bay.</span>
        </label>
        <p>{missingFromZone.length} currently parked vehicle(s) in {parkingZoneLabel(zone)} do not appear in this OCR list. {completeZone?'These will be added to the transfer proposal.':'These will NOT be moved.'}</p>
        {completeZone&&missingFromZone.length>0&&<p className="break-words font-mono text-xs">Missing: {missingFromZone.map(item=>item.plateNumber).join(', ')}</p>}
        {completeZone&&draft.some(item=>item.zone!==zone)&&<p role="alert" className="font-medium text-destructive">Complete-zone mode requires every OCR row to use the selected source zone.</p>}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={moveOccupants} onChange={e=>{setMoveOccupants(e.target.checked);setConfirmed(false);}}/> Relocate occupied-bay vehicles to Unassigned Bay</label>
      {!moveOccupants&&<p className="text-xs">Occupied bays will be rejected during validation.</p>}
      <p className="text-sm font-semibold">Step 3 — Confirm and apply only after checking every row.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
        I have verified vehicle registrations, bays, X positions and authorization for {draft.length} updates.</label>
      <Button type="button" disabled={disabled||applying||!confirmed||invalid.length>0||unresolvedMatches||scanIncomplete||reading||!draft.length} onClick={()=>void apply()}>{applying?'Validating / submitting…':'Apply reviewed parking updates'}</Button>
    </>}
  </CardContent></Card>;
}
