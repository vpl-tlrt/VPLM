import {scrapeDashboardLayout} from './scraper.js';
import {initPhysicsSimulation} from './simulation.js';
const trigger=document.getElementById('hidden-trigger');
const overlay=document.getElementById('canvas3d-container');
const exit=document.getElementById('exit-btn');
let taps=0,lastTap=0,stop=null,previousOverflow='';
function close(){if(!overlay.classList.contains('is-active'))return;
  if(stop){stop();stop=null}overlay.classList.remove('is-active');
  overlay.setAttribute('aria-hidden','true');document.body.style.overflow=previousOverflow;
  trigger.focus({preventScroll:true});
}
function open(){if(overlay.classList.contains('is-active'))return;
  previousOverflow=document.body.style.overflow;
  overlay.classList.add('is-active');overlay.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  try{stop=initPhysicsSimulation(scrapeDashboardLayout());exit.focus({preventScroll:true})}
  catch(error){console.error('3D simulation unavailable',error);close()}
}
trigger?.addEventListener('click',()=>{const now=performance.now();taps=now-lastTap<650?taps+1:1;lastTap=now;if(taps>=3){taps=0;open()}});
exit?.addEventListener('click',close);
document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
