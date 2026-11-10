/** Isolated, read-only 3D demo. No changes to parking assignments or storage. */
let teardown=null;
export function initPhysicsSimulation(scrapedSlots=[]){
  if(teardown)teardown();
  const host=document.getElementById('canvas3d-container');
  const THREE=window.THREE, Matter=window.Matter;
  if(!host||!THREE||!Matter)throw new Error('Three.js or Matter.js failed to load');
  const {Engine,Bodies,Body,Composite}=Matter;
  const engine=Engine.create({gravity:{x:0,y:0}});
  const body=Bodies.rectangle(0,0,1.5,2.7,{frictionAir:0.09});
  Composite.add(engine.world,body);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x101b26);
  const camera=new THREE.PerspectiveCamera(55,1,0.1,100);
  camera.position.set(0,17,18);camera.lookAt(0,0,0);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  host.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x344a60,2));
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshStandardMaterial({color:0x253c48}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-0.2;scene.add(ground);
  const vehicle=new THREE.Mesh(new THREE.BoxGeometry(1.5,0.8,2.7),new THREE.MeshStandardMaterial({color:0x16b4bd}));
  vehicle.position.y=0.5;scene.add(vehicle);
  const slots=scrapedSlots.slice(0,80);
  const columns=Math.max(1,Math.ceil(Math.sqrt(slots.length)));
  slots.forEach((slot,i)=>{
    const material=new THREE.MeshStandardMaterial({color:slot.status==='occupied'?0xb74d4d:0x407e75});
    const bay=new THREE.Mesh(new THREE.BoxGeometry(2.1,0.05,3.2),material);
    bay.position.set((i%columns-(columns-1)/2)*2.6,-0.12,(Math.floor(i/columns)-Math.floor(slots.length/columns)/2)*3.8);
    scene.add(bay);
  });
  let pointer={x:0,y:0},active=true,last=performance.now(),frame=0;
  function resize(){const w=host.clientWidth||innerWidth,h=host.clientHeight||innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
  function move(e){const r=renderer.domElement.getBoundingClientRect();pointer={x:((e.clientX-r.left)/r.width-0.5)*24,y:((e.clientY-r.top)/r.height-0.5)*-18}}
  function animate(now){if(!active)return;const dt=Math.min(now-last,32);last=now;
    const delta={x:pointer.x-body.position.x,y:pointer.y-body.position.y};
    Body.applyForce(body,body.position,{x:delta.x*0.0007,y:delta.y*0.0007});
    Engine.update(engine,dt);
    vehicle.position.set(body.position.x,0.5,body.position.y);
    if(Math.hypot(body.velocity.x,body.velocity.y)>0.02)vehicle.rotation.y=Math.atan2(body.velocity.x,body.velocity.y);
    renderer.render(scene,camera);frame=requestAnimationFrame(animate);
  }
  resize();window.addEventListener('resize',resize);
  renderer.domElement.addEventListener('pointerdown',move);renderer.domElement.addEventListener('pointermove',move);
  frame=requestAnimationFrame(animate);
  teardown=()=>{active=false;cancelAnimationFrame(frame);window.removeEventListener('resize',resize);
    renderer.domElement.removeEventListener('pointerdown',move);renderer.domElement.removeEventListener('pointermove',move);
    scene.traverse(obj=>{if(obj.isMesh){obj.geometry.dispose();obj.material.dispose()}});
    renderer.dispose();renderer.domElement.remove();Composite.clear(engine.world,false);Engine.clear(engine);teardown=null;
  };
  return teardown;
}
