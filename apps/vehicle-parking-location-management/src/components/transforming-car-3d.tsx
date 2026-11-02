import { useEffect, useRef } from 'react';

/**
 * Original procedural WebGL mascot. No third-party 3D assets, external services,
 * or dependencies. The same mechanical pieces move between car and robot poses.
 */
export function TransformingCar3D({ awake }: { awake: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const awakeRef = useRef(awake);
  useEffect(() => { awakeRef.current = awake; }, [awake]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) return;
    const vertex = `attribute vec3 aPosition; attribute vec3 aNormal; uniform mat4 uMVP; uniform mat4 uModel; varying vec3 vNormal; varying vec3 vWorld; void main(){vec4 world=uModel*vec4(aPosition,1.);vWorld=world.xyz;vNormal=mat3(uModel)*aNormal;gl_Position=uMVP*vec4(aPosition,1.);}`;
    const fragment = `precision mediump float; varying vec3 vNormal; varying vec3 vWorld; uniform vec3 uColor; uniform float uGlow; void main(){vec3 n=normalize(vNormal);vec3 light=normalize(vec3(-.6,1.2,1.8));float diffuse=max(dot(n,light),0.);float rim=pow(1.-abs(dot(n,normalize(vec3(0.,.4,1.)))),3.);vec3 color=uColor*(.27+.73*diffuse)+vec3(.38,.67,.9)*rim*.27+uColor*uGlow*.6;gl_FragColor=vec4(color,1.);}`;
    const shader = (kind: number, source: string) => { const sh=gl.createShader(kind)!;gl.shaderSource(sh,source);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'WebGL shader failed');return sh; };
    const program=gl.createProgram()!;
    try { gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS)) return; } catch { return; }
    gl.useProgram(program);
    const verts:number[]=[];
    const faces: Array<[number[],number[]]> = [
      [[-1,-1,1],[0,0,1]],[[1,-1,-1],[0,0,-1]],[[1,-1,1],[1,0,0]],[[-1,-1,-1],[-1,0,0]],
      [[-1,1,1],[0,1,0]],[[-1,-1,-1],[0,-1,0]]
    ];
    const quads=[
      [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],
      [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]],
      [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]],
      [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]],
      [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]],
      [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]
    ];
    quads.forEach((q,i)=>{const n=faces[i][1];[0,1,2,0,2,3].forEach(j=>verts.push(...q[j],...n));});
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(verts),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(program,'aPosition'),norm=gl.getAttribLocation(program,'aNormal');
    gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(norm);gl.vertexAttribPointer(norm,3,gl.FLOAT,false,24,12);
    const uMVP=gl.getUniformLocation(program,'uMVP'),uModel=gl.getUniformLocation(program,'uModel'),uColor=gl.getUniformLocation(program,'uColor'),uGlow=gl.getUniformLocation(program,'uGlow');
    const multiply=(a:number[],b:number[])=>{const o=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;};
    const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    const translate=(x:number,y:number,z:number)=>{const m=identity();m[12]=x;m[13]=y;m[14]=z;return m;};
    const scale=(x:number,y:number,z:number)=>[x,0,0,0,0,y,0,0,0,0,z,0,0,0,0,1];
    const rotateY=(a:number)=>[Math.cos(a),0,-Math.sin(a),0,0,1,0,0,Math.sin(a),0,Math.cos(a),0,0,0,0,1];
    const rotateZ=(a:number)=>[Math.cos(a),Math.sin(a),0,0,-Math.sin(a),Math.cos(a),0,0,0,0,1,0,0,0,0,1];
    const perspective=(f:number,aspect:number,near:number,far:number)=>{const q=1/Math.tan(f/2);return [q/aspect,0,0,0,0,q,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];};
    const orange=[1,.31,.025],dark=[.055,.075,.12],metal=[.33,.38,.43],glass=[.035,.16,.25],blue=[.1,.8,1],white=[.9,.95,1];
    type Piece={car:[number,number,number,number,number,number,number];robot:[number,number,number,number,number,number,number];color:number[];glow?:number};
    const pieces:Piece[]=[];
    const part=(car:Piece['car'],robot:Piece['robot'],color:number[],glow=0)=>pieces.push({car,robot,color,glow});
    // Coordinates: x horizontal, y vertical, z depth; seventh value is z-axis rotation.
    part([0,0,0,1.85,.32,.76,0],[0,.48,0,.62,.9,.43,0],orange);
    part([0,.34,-.2,.95,.35,.68,0],[0,.62,-.2,.44,.55,.32,0],glass);
    part([0,.16,.67,1.75,.13,.22,0],[0,.3,.35,.66,.27,.22,0],orange);
    part([0,-.12,.77,.75,.21,.12,0],[0,.35,.49,.35,.22,.12,0],dark);
    part([-.7,-.11,.77,.31,.09,.12,0],[-.24,.44,.5,.14,.11,.1,0],blue,1);
    part([.7,-.11,.77,.31,.09,.12,0],[.24,.44,.5,.14,.11,.1,0],blue,1);
    part([0,-.17,-.79,1.4,.15,.1,0],[0,.85,-.2,.42,.2,.16,0],metal);
    part([0,.17,-.2,.7,.09,.8,0],[0,1.2,0,.27,.3,.28,0],orange);
    part([0,.35,-.1,.44,.2,.38,0],[0,1.47,0,.23,.26,.24,0],dark);
    part([-.13,.37,.13,.1,.045,.06,0],[-.11,1.48,.15,.085,.05,.06,0],blue,1);
    part([.13,.37,.13,.1,.045,.06,0],[.11,1.48,.15,.085,.05,.06,0],blue,1);
    part([0,.04,.79,.18,.06,.06,0],[0,.72,.48,.14,.14,.08,0],blue,1);
    for(const side of [-1,1]){
      part([side*.8,-.31,.47,.24,.42,.12,0],[side*.67,.42,.1,.27,.55,.3,side*.24],dark);
      part([side*.81,-.3,-.49,.24,.42,.12,0],[side*.66,-.1,.12,.25,.53,.28,side*.13],dark);
      part([side*.83,-.06,.35,.31,.2,.54,0],[side*.72,.55,.06,.31,.42,.34,side*.27],orange);
      part([side*.84,-.05,-.5,.28,.17,.44,0],[side*.35,-.55,.06,.29,.53,.35,side*.08],orange);
      part([side*.78,.12,-.1,.14,.12,.5,0],[side*.94,.15,.04,.15,.37,.2,side*.25],metal);
      part([side*.55,-.13,.01,.15,.15,.18,0],[side*.97,-.19,.1,.18,.18,.2,0],dark);
      part([side*.79,-.33,.48,.1,.11,.14,0],[side*.35,-1.02,.12,.28,.16,.4,0],metal);
      part([side*.8,-.33,-.5,.1,.11,.14,0],[side*.35,-.89,.13,.27,.18,.37,0],metal);
    }
    let frame=0,progress=awakeRef.current?1:0,last=performance.now(),disposed=false;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const render=(now:number)=>{
      if(disposed)return;
      const dt=Math.min((now-last)/1000,.05);last=now;
      const target=awakeRef.current?1:0;
      progress=reduced?target:progress+(target-progress)*Math.min(1,dt*3.2);
      const t=progress*progress*(3-2*progress);
      const dpr=Math.min(window.devicePixelRatio||1,2);
      const width=Math.max(1,Math.round(canvas.clientWidth*dpr)),height=Math.max(1,Math.round(canvas.clientHeight*dpr));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);
      const projection=perspective(.8,width/height,.1,100);
      const floating=reduced?0:Math.sin(now*.0018)*.055;
      const view=multiply(translate(0,-.1+floating,-5.2),rotateY(-.3+Math.sin(now*.00035)*.11+t*.3));
      for(const piece of pieces){
        const v=piece.car.map((n,i)=>n+(piece.robot[i]-n)*t);
        const [x,y,z,sx,sy,sz,rz]=v;
        const model=multiply(multiply(view,translate(x,y,z)),multiply(rotateZ(rz),scale(sx,sy,sz)));
        gl.uniformMatrix4fv(uMVP,false,new Float32Array(multiply(projection,model)));
        gl.uniformMatrix4fv(uModel,false,new Float32Array(model));
        gl.uniform3fv(uColor,new Float32Array(piece.color));
        gl.uniform1f(uGlow,piece.glow||0);
        gl.drawArrays(gl.TRIANGLES,0,36);
      }
      frame=requestAnimationFrame(render);
    };
    frame=requestAnimationFrame(render);
    return ()=>{disposed=true;cancelAnimationFrame(frame);gl.deleteBuffer(buffer);gl.deleteProgram(program);};
  },[]);
  return <canvas ref={canvasRef} width={280} height={200} className="pointer-events-none block h-[104px] w-[146px]" aria-hidden="true" />;
}
