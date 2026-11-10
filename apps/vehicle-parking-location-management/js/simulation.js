/** Reference-based workshop digital twin. Visual-only: never writes VPLM data.
 * Approximate geometry from user-supplied annotated site plan and photographs.
 * Coordinates: X left-to-right (NSD -> accommodation), Z top-to-bottom.
 */
let disposeCurrent=null;
export function initPhysicsSimulation(scrapedSlots=[]){
  if(disposeCurrent)disposeCurrent();
  const host=document.getElementById('canvas3d-container');
  const T=window.THREE, M=window.Matter;
  if(!host||!T||!M)throw new Error('3D libraries unavailable. Check network and reload.');
  const scene=new T.Scene();scene.background=new T.Color(0xa8c9d9);scene.fog=new T.Fog(0xa8c9d9,115,230);
  const camera=new T.PerspectiveCamera(48,1,0.1,350);
  camera.position.set(8,94,105);camera.lookAt(0,0,0);
  const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
  renderer.outputEncoding=T.sRGBEncoding;
  host.appendChild(renderer.domElement);
  scene.add(new T.HemisphereLight(0xffffff,0x6b7785,2));
  const sun=new T.DirectionalLight(0xffffff,1.2);sun.position.set(-30,80,40);scene.add(sun);
  const mat=c=>new T.MeshLambertMaterial({color:c});
  const road=mat(0x454d50),roof=mat(0xcbd1d2),wall=mat(0xe6e8e6),green=mat(0x347d74),yellow=mat(0xf3c842),white=mat(0xfafafa);
  const asphalt=mat(0x343b40),bayMat=mat(0x69777a),blue=mat(0x2978a5),red=mat(0xbd3c37);
  function block(x,y,z,w,h,d,material,parent=scene){
    const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);parent.add(mesh);return mesh;
  }
  function textLabel(label,x,z,size=2.2){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
    const ctx=canvas.getContext('2d');ctx.fillStyle='rgba(12,31,39,.87)';ctx.fillRect(0,0,512,96);
    ctx.fillStyle='#fff';ctx.font='bold 43px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,256,48,495);
    const tex=new T.CanvasTexture(canvas);const mesh=new T.Mesh(new T.PlaneGeometry(Math.max(7,label.length*1.25),2.7),new T.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));
    mesh.rotation.x=-Math.PI/2;mesh.position.set(x,0.16,z);scene.add(mesh);
  }
  // Site footprint, perimeter and lane network (approximate, not surveyed).
  block(0,-.25,0,140,.4,72,road);
  for(const z of [-35,35])block(0,.13,z,140,.18,.65,green);
  for(const x of [-69.5,69.5])block(x,.13,0,.65,.18,72,green);
  block(-7,.02,0,8,.08,69,asphalt);
  block(3,.03,28,132,.07,7,asphalt);
  block(3,.03,-28,132,.07,7,asphalt);
  // Workshop structures: NSD, BP3, BP1, BP2, wash, reception, main workshop.
  function building(name,x,z,w,d,height,color=roof){
    block(x,height/2,z,w,height,d,wall);
    block(x,height+.18,z,w+.6,.35,d+.6,color);
    textLabel(name,x,z);
  }
  building('NSD',-53,-5,24,43,7);
  building('BP3',-37,-18,6,22,7);
  building('BP1',-29,-18,6,22,7);
  building('BP2',-17,-18,15,23,7);
  building('WASHING AREA',-29,19,22,10,4,mat(0xbccdd1));
  building('RECEPTION',15,-1,8,18,4);
  // Main service hall: roof + visible bay row facing the central access lane.
  building('WORKSHOP FLOOR',43,-6,43,35,8);
  // Recreate colored vehicle lifts along the front of the workshop.
  for(let i=0;i<7;i++){
    const x=25+i*5.8,z=14;
    block(x-.95,2.5,z,0.45,5,.6,i%2?blue:red);
    block(x+.95,2.5,z,0.45,5,.6,i%2?blue:red);
    block(x,.12,z,4.6,.15,6,mat(0xaab4b5));
    block(x,.24,z+2.6,4.2,.08,.12,yellow);
  }
  // Roofed accommodation parking A and B, two long rows on far right.
  for(const [x,label] of [[65,'ACC A'],[73,'ACC B']]){
    for(let i=0;i<12;i++){
      const z=-25+i*4.25;
      block(x,.07,z,4.1,.1,3.7,i%3===0?mat(0x829c96):bayMat);
      block(x-2,.16,z,.1,.1,3.8,white);
      if(i%2===0)block(x,4.3,z,4.8,.3,4.2,roof);
      if(i%3===0)block(x-2.3,2.2,z,.22,4.4,.22,red);
    }
    textLabel(label,x,30);
  }
  // Central numbered parking rows, reference colors and approximate locations.
  function parkingRow(prefix,x,z,cols,spacing=4.6){
    for(let i=0;i<cols;i++){
      const px=x+i*spacing;
      block(px,.08,z,4.1,.1,6,bayMat);
      block(px-2.05,.17,z,.09,.12,6,white);
      block(px+2.05,.17,z,.09,.12,6,white);
    }
    textLabel(prefix,x+(cols-1)*spacing/2,z-4.5);
  }
  parkingRow('A PARKING',-2,-15,4);
  parkingRow('L PARKING',-2,2,4);
  parkingRow('RECEPTION PARKING',-47,10,6);
  parkingRow('FRONT PARKING',28,27,8);
  // Colored markings and drain channel inspired by workshop photographs.
  for(let i=0;i<11;i++)block(-7,.14,-26+i*5,.18,.04,2.2,yellow);
  block(-3,.11,0,.3,.05,53,green);
  // Trees at perimeter are simplified geometry.
  const trunk=mat(0x6b5141),leaf=mat(0x4d8060);
  for(let i=0;i<18;i++){
    const x=-64+i*7.3;
    block(x,1.2,-33.8,.4,2.4,.4,trunk);
    const canopy=new T.Mesh(new T.SphereGeometry(1.2,6,5),leaf);canopy.position.set(x,2.9,-33.8);scene.add(canopy);
  }
  // Demo vehicles are illustrative, NOT actual vehicle occupancy.
  function car(color){
    const group=new T.Group();
    block(0,.45,0,1.8,.65,3.4,mat(color),group);
    block(0,.95,-.2,1.55,.48,1.8,mat(0x9bc1d1),group);
    for(const x of [-.88,.88])for(const z of [-1.05,1.05])block(x,.23,z,.3,.46,.65,mat(0x171b20),group);
    scene.add(group);return group;
  }
  const examples=[[0xeeeeee,-47,10],[0x32383c,-38,10],[0x8b9298,0,-15],[0xe2e2e2,5,2],[0x28313a,65,-22]];
  for(const [c,x,z] of examples){const model=car(c);model.position.set(x,0,z);}
  const activeCar=car(0x08a9bd);activeCar.position.set(-7,0,22);
  // Matter is used for damped steering in the visual simulation only.
  const engine=M.Engine.create({gravity:{x:0,y:0}});
  const body=M.Bodies.rectangle(-7,22,1.8,3.4,{frictionAir:.12});
  M.Composite.add(engine.world,body);
  let target={x:-7,z:22},dragging=false,alive=true,raf=0,last=performance.now();
  const raycaster=new T.Raycaster(),plane=new T.Plane(new T.Vector3(0,1,0),0),point=new T.Vector3();
  function steer(e){
    if(!dragging)return;
    const rect=renderer.domElement.getBoundingClientRect();
    const ndc=new T.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(ndc,camera);
    if(raycaster.ray.intersectPlane(plane,point)){target={x:Math.max(-65,Math.min(65,point.x)),z:Math.max(-31,Math.min(31,point.z))};}
  }
  function down(e){dragging=true;renderer.domElement.setPointerCapture?.(e.pointerId);steer(e);}
  function up(){dragging=false;}
  function resize(){const w=Math.max(host.clientWidth,1),h=Math.max(host.clientHeight,1);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  function tick(now){
    if(!alive)return;
    const dt=Math.min(now-last,33);last=now;
    const dx=target.x-body.position.x,dz=target.z-body.position.y;
    M.Body.applyForce(body,body.position,{x:dx*.00045,y:dz*.00045});
    M.Engine.update(engine,dt);
    activeCar.position.set(body.position.x,0,body.position.y);
    if(Math.hypot(body.velocity.x,body.velocity.y)>.025)activeCar.rotation.y=Math.atan2(body.velocity.x,body.velocity.y);
    renderer.render(scene,camera);raf=requestAnimationFrame(tick);
  }
  resize();window.addEventListener('resize',resize);
  renderer.domElement.addEventListener('pointerdown',down);
  renderer.domElement.addEventListener('pointermove',steer);
  renderer.domElement.addEventListener('pointerup',up);
  renderer.domElement.addEventListener('pointercancel',up);
  raf=requestAnimationFrame(tick);
  disposeCurrent=()=>{
    alive=false;cancelAnimationFrame(raf);window.removeEventListener('resize',resize);
    renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointermove',steer);
    renderer.domElement.removeEventListener('pointerup',up);renderer.domElement.removeEventListener('pointercancel',up);
    scene.traverse(obj=>{if(obj.isMesh){obj.geometry?.dispose();const materials=Array.isArray(obj.material)?obj.material:[obj.material];materials.forEach(m=>{m.map?.dispose();m.dispose()});}});
    renderer.dispose();renderer.domElement.remove();M.Composite.clear(engine.world,false);M.Engine.clear(engine);disposeCurrent=null;
  };
  return disposeCurrent;
}
