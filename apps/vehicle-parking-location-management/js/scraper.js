/** Read-only snapshot of visible dashboard cards. Never mutate VPLM data. */
export function scrapeDashboardLayout(){
  const selectors=['[data-bay-id]','[data-slot-id]','[data-parking-bay]','[data-testid*="bay"]'];
  const nodes=[...document.querySelectorAll(selectors.join(','))].filter(el=>el.getClientRects().length);
  const seen=new Set();
  return nodes.slice(0,250).map((el,index)=>{
    const id=el.getAttribute('data-bay-id')||el.getAttribute('data-slot-id')||el.getAttribute('data-parking-bay')||el.id||`slot-${index}`;
    if(seen.has(id))return null;seen.add(id);
    const style=getComputedStyle(el);
    const color=style.backgroundColor;
    const text=(el.textContent||'').trim().slice(0,100);
    const occupied=/occupied|assigned|vehicle|in use/i.test([el.className,text,el.getAttribute('data-status')].join(' '));
    return {id,label:text||id,color,status:occupied?'occupied':'available'};
  }).filter(Boolean);
}
