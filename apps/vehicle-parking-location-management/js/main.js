import '../css/style.css';
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
  try{document.getElementById('sim-error')?.remove();stop=initPhysicsSimulation(scrapeDashboardLayout());exit.focus({preventScroll:true})}
  catch(error){console.error('3D simulation unavailable',error);const instructions=document.getElementById('instructions');if(instructions){let message=document.getElementById('sim-error');if(!message){message=document.createElement('p');message.id='sim-error';message.setAttribute('role','alert');instructions.appendChild(message)}message.textContent='3D rendering could not start: '+(error?.message||'Unknown error')+'. Tap Exit Sim to return.'}}
}
trigger?.addEventListener('click',()=>{const now=performance.now();taps=now-lastTap<650?taps+1:1;lastTap=now;if(taps>=3){taps=0;open()}});
exit?.addEventListener('click',close);
document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
