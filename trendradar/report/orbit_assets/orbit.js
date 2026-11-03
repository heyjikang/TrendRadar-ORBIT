/* TrendRadar Orbit — ORIGINAL procedural 3D/WebGL2 renderer.
   Uses no bitmap, GIF, video, CDN or third-party runtime.
   It renders GPU points with vertex-shader shape deformation in 3D space.
   Topic influence fields displace the existing shell along its normal (ridges),
   never sprites or 2D light patches. */
(function(){
  'use strict';
  const canvas = document.getElementById('particle-canvas');
  const errorEl = document.getElementById('webgl-error');
  const payload = window.__TREND_RADAR_PAYLOAD__ || {};
  const topicList = Array.isArray(payload.topics) ? payload.topics : [];
  const MAX_TOPICS = 16;
  const fields = Array.isArray(payload.topicFields)
    ? payload.topicFields.filter(f => f && Array.isArray(f.anchor) && f.anchor.length === 3).slice(0, MAX_TOPICS)
    : [];
  const topicCount = fields.length;
  let gl;
  try{ gl = canvas.getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:true,powerPreference:'high-performance',preserveDrawingBuffer:false}); } catch(e){}
  if(!gl){
    const fallback=window.createTrendRadarFallback?.(canvas);
    if(fallback?.available){window.TrendRadarOrbit=fallback;const status=document.querySelector('.orbit-footer span:first-child');if(status)status.lastChild.textContent=' 3D SOFTWARE FALLBACK';const label=document.querySelector('.orbit-copy-right strong');if(label)label.textContent='SOFTWARE / 3D';}
    else {errorEl.hidden=false;window.TrendRadarOrbit=fallback||{available:false,setColor(){},setQuality(){},setPlaying(){},pulse(){},setSelection(){},project(){return null},getTopicFields(){return []}};}
    return;
  }

  const VERT = `#version 300 es
  precision highp float;
  in vec3 aPosition;
  in vec4 aMeta; // group (0 shell,1 silk,2 dust), seed, size, tint
  uniform float uTime;
  uniform float uAspect;
  uniform float uPixelRatio;
  uniform float uGlow;
  uniform float uPulse;
  uniform vec3 uAccent;
  uniform float uFocus;
  uniform int uTopicCount;
  uniform vec3 uTopicAnchor[16];
  uniform vec3 uTopicColor[16];
  uniform float uTopicRidge[16];
  uniform float uTopicBundle[16];
  uniform float uTopicActive[16];
  out vec3 vColor;
  out float vOpacity;
  mat2 rot(float a){float c=cos(a);float s=sin(a);return mat2(c,-s,s,c);}
  void main(){
    float type=aMeta.x;
    float seed=aMeta.y;
    vec3 p=aPosition;
    float t=uTime;
    vec3 n0=normalize(aPosition);
    // Rotating, non-rigid, independent superposed wave-fields.
    float twist=0.19*p.y+0.11*sin(p.y*4.5+t*0.36)+0.085*sin(p.z*3.9-t*.29);
    p.xz=rot(twist)*p.xz;
    float wave=sin(p.x*6.2+p.y*5.5+t*.78+seed*3.0)*.038;
    wave+=sin(p.z*8.1-p.y*4.3-t*.5+seed*6.28)*.027;
    wave+=sin(p.x*3.1+p.z*4.0+t*.41)*.027;
    p+=normalize(p)*wave*(type==1.0?1.6:1.0);
    p.x+=.033*sin(p.y*7.0+t*.5+seed*5.0);
    p.y+=.037*sin(p.z*6.7-t*.55+seed*3.0);
    // Topic fields: elongated filament bundles raised out of the shell surface.
    float disp=0.0,activeW=0.0,maxW=0.0,bestG=0.0,bestFil=0.0;
    float wsum=0.0;
    vec3 csum=vec3(0.0);
    for(int i=0;i<16;i++){
      if(i>=uTopicCount) break;
      vec3 an=uTopicAnchor[i];
      vec3 helper=abs(an.y)>0.94?vec3(1.0,0.0,0.0):vec3(0.0,1.0,0.0);
      vec3 tang=normalize(cross(an,helper));
      vec3 bitn=cross(an,tang);
      vec3 d=n0-an;
      float along=dot(d,tang);
      float across=dot(d,bitn);
      float elong=mix(1.05,1.80,uTopicBundle[i]);
      float gN=exp(-(along*along/(elong*elong)+across*across/0.055));
      float gW=exp(-(along*along/(elong*elong)+across*across/0.30));
      float phase=dot(an,vec3(13.7,21.3,37.1));
      float fil=pow(0.5+0.5*cos(across*mix(9.0,17.0,uTopicBundle[i])+phase+t*0.35),3.0);
      float m=gN*(0.35+0.85*fil);
      disp+=m*uTopicRidge[i];
      activeW=max(activeW,gN*uTopicActive[i]);
      float wb=gW*gW;
      wsum+=wb;
      csum+=uTopicColor[i]*wb;
      if(gW>maxW){maxW=gW;bestG=gN;bestFil=fil;}
    }
    vec3 tint=wsum>1e-6?csum/wsum:vec3(0.0);
    float tintMix=clamp(maxW*1.15,0.0,1.0);
    float filMask=clamp(bestG*(0.55+0.60*bestFil),0.0,1.0);
    float gMask=bestG;
    if(type==3.0){
      int last=max(uTopicCount-1,0);
      int ti=clamp(int(clamp(aMeta.w,0.0,1.0)*float(last)+0.5),0,last);
      tint=uTopicColor[ti];
      tintMix=1.0;filMask=1.0;gMask=1.0;
    }
    disp=clamp(disp,0.0,0.05);
    p+=normalize(p)*disp*(type==2.0?0.30:1.0);
    p.xz=rot(-.25 + t*.095)*p.xz;
    p.xy=rot(.12+sin(t*.22)*.075)*p.xy;
    p.yz=rot(.16+sin(t*.17)*.04)*p.yz;
    p.xz=rot(uFocus)*p.xz;
    float dist=4.10-p.z;
    gl_Position=vec4(p.x*3.05/uAspect, p.y*3.05, dist-.36, dist);
    float perspective=4.1/dist;
    float glowSize=mix(1.0,1.35,uGlow);
    gl_PointSize=clamp(aMeta.z*uPixelRatio*1.15*perspective*glowSize*(type==3.0?1.25:1.0),.6,8.0);
    float rim=pow(1.0-abs(p.z)/max(length(p),.01),1.65);
    float front=.45+.55*clamp((p.z+1.0)*.5,0.0,1.0);
    float shimmer=.85+.15*sin(t*1.5+seed*37.0);
    float stream=type==1.0?1.05:(type==2.0?.15:(type==3.0?.85:.15));
    float bright=(1.05+.75*rim)*stream*shimmer*front;
    vec3 lilac=vec3(.71,.43,1.0);
    vec3 pink=vec3(1.0,.34,.72);
    vec3 ivory=vec3(1.0,.84,.94);
    vec3 base=mix(lilac,pink,smoothstep(.1,.9,aMeta.w));
    base=mix(base,ivory,smoothstep(.5,1.0,rim)*(.05+.06*seed));
    // The user's preferred pink-violet palette remains dominant.
    base=mix(base,uAccent,.12+min(uPulse,.6)*.15);
    base=mix(base,min(tint*1.05,vec3(1.0)),clamp(tintMix,0.0,1.0));
    base+=tint*max(0.0,1.0-tintMix)*filMask*0.55;
    base+=vec3(1.0,0.86,0.96)*activeW*0.18;
    bright*=(1.0+0.55*filMask+0.30*activeW);
    bright*=(1.0-0.30*gMask*(1.0-filMask)*(type==3.0?0.0:1.0));
    bright*=mix(1.0,.80,tintMix);
    vColor=base*bright*(1.0+.28*uPulse);
    vOpacity=mix((type==1.0?.88:(type==2.0?.45:.70))*(.62+.38*seed)*(1.0+0.28*filMask),.78,tintMix);
  }`;
  const FRAG = `#version 300 es
  precision highp float;
  in vec3 vColor;
  in float vOpacity;
  uniform float uGlow;
  out vec4 fragColor;
  void main(){
    vec2 uv=gl_PointCoord*2.0-1.0;
    float rr=dot(uv,uv);
    if(rr>1.0) discard;
    float core=exp(-rr*12.0);
    float halo=exp(-rr*3.0);
    float alpha=mix(core*.95+halo*.08,halo*.055,uGlow)*vOpacity;
    fragColor=vec4(vColor,alpha);
  }`;

  function createShader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){throw Error(gl.getShaderInfoLog(s)||'shader compile error')}return s}
  function createProgram(){const p=gl.createProgram();const vs=createShader(gl.VERTEX_SHADER,VERT),fs=createShader(gl.FRAGMENT_SHADER,FRAG);gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p)||'program link error');return p}
  let program,vao,buffer,size=0,quality='high';
  const uniforms={};
  try {
    program=createProgram();gl.useProgram(program);
    for(const name of ['uTime','uAspect','uPixelRatio','uGlow','uPulse','uAccent','uFocus','uTopicCount']) uniforms[name]=gl.getUniformLocation(program,name);
    for(const name of ['uTopicAnchor','uTopicColor','uTopicRidge','uTopicBundle','uTopicActive']) uniforms[name]=gl.getUniformLocation(program,name+'[0]')||gl.getUniformLocation(program,name);
    vao=gl.createVertexArray();gl.bindVertexArray(vao);
    buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    const stride=7*4;
    const posLoc=gl.getAttribLocation(program,'aPosition'),metaLoc=gl.getAttribLocation(program,'aMeta');
    gl.enableVertexAttribArray(posLoc);gl.vertexAttribPointer(posLoc,3,gl.FLOAT,false,stride,0);
    gl.enableVertexAttribArray(metaLoc);gl.vertexAttribPointer(metaLoc,4,gl.FLOAT,false,stride,3*4);
  } catch(e){
    window.__ORBIT_WEBGL_ERROR__=String(e&&e.message||e);
    const backup=canvas.cloneNode(false);canvas.replaceWith(backup);
    const fallback=window.createTrendRadarFallback?.(backup);
    if(fallback?.available){window.TrendRadarOrbit=fallback;errorEl.hidden=true;const status=document.querySelector('.orbit-footer span:first-child');if(status)status.lastChild.textContent=' 3D SOFTWARE FALLBACK';}
    else {errorEl.hidden=false;errorEl.textContent='WebGL2 Shader 初始化失败：'+e.message;window.TrendRadarOrbit=fallback||{available:false,setColor(){},setQuality(){},setPlaying(){},pulse(){},setSelection(){},project(){return null},getTopicFields(){return []}};}return;
  }

  // Seeded PRNG for deterministic output across captures.
  function rng(seed){let x=seed>>>0;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return ((x>>>0)%1000000)/1000000;};}
  function buildParticles(qualityLevel){
    const rand=rng(20261103);
    const particles=[];
    const TAU=Math.PI*2;
    function push(x,y,z,type,seed,sz,tint){particles.push(x,y,z,type,seed,sz,tint);}
    const density=qualityLevel==='high'?1:qualityLevel==='medium'?.64:.34;
    // Layer 1: partly-transparent shell with a Fibonacci distribution.
    const nShell=Math.floor(9000*density);
    for(let i=0;i<nShell;i++){
      const yy=1-2*(i+.5)/nShell;
      const rr=Math.sqrt(Math.max(0,1-yy*yy));
      const phi=i*2.39996323+(rand()-.5)*.21;
      const x=rr*Math.cos(phi),z=rr*Math.sin(phi);
      const r=.95+.085*Math.sin(phi*3+yy*8)+.03*(rand()-.5);
      push(r*x,r*yy,r*z,0,rand(),.50+rand()*.88,rand());
    }
    // Layer 2: spiral silk ribbons crossing multiple axes in genuine XYZ.
    const strands=Math.max(20,Math.floor(44*density));
    const along=Math.floor(700*Math.max(.72,density));
    for(let s=0;s<strands;s++){
      const tilt=rand()*TAU,axis=rand()*TAU,flow=.85+rand()*.55,offset=rand()*TAU;
      const band=.003+rand()*.012;
      const ca=Math.cos(tilt),sa=Math.sin(tilt),cb=Math.cos(axis),sb=Math.sin(axis);
      for(let i=0;i<along;i++){
        const t=i/(along-1),angle=t*TAU*flow+offset;
        const latitude=Math.sin(angle*1.3+s*.7)*band + Math.sin(angle*.7+s*1.9)*band*.55;
        const r=(1.01+.032*Math.sin(angle*3+s*.7)+.008*(rand()-.5));
        const u=Math.sqrt(Math.max(0,1-latitude*latitude));
        let x=u*Math.cos(angle),y=latitude,z=u*Math.sin(angle);
        let ny=y*ca-z*sa,nz=y*sa+z*ca;y=ny;z=nz;
        let nx=x*cb-z*sb;nz=x*sb+z*cb;x=nx;z=nz;
        push(x*r,y*r,z*r,1,rand(),.62+rand()*.90, .3+.7*Math.sin(s*2.8+i*.025)*.5+.3);
      }
    }
    // Layer 2b: one filament bundle per topic, generated in the same local tangent
    // frame the vertex shader uses, so the shader's topic field colors these strands.
    const bundleTopics=Math.min(topicCount,8);
    const bundleStrands=Math.max(6,Math.floor(11*density));
    const bundleAlong=Math.floor(600*Math.max(.6,density));
    for(let ti=0;ti<bundleTopics;ti++){
      const ax=anchorBuf[ti*3],ay=anchorBuf[ti*3+1],az=anchorBuf[ti*3+2];
      const helper=Math.abs(ay)>0.94?[1,0,0]:[0,1,0];
      let tang=[ay*helper[2]-az*helper[1],az*helper[0]-ax*helper[2],ax*helper[1]-ay*helper[0]];
      const tl=Math.hypot(tang[0],tang[1],tang[2])||1;
      tang=[tang[0]/tl,tang[1]/tl,tang[2]/tl];
      const bitn=[ay*tang[2]-az*tang[1],az*tang[0]-ax*tang[2],ax*tang[1]-ay*tang[0]];
      const arc=(.62+.45*bundleBuf[ti])*(.75+rand()*.55);
      for(let s=0;s<bundleStrands;s++){
        const off=(rand()*2-1)*.11,freq=2.4+rand()*3.0,ph=rand()*TAU,amp=.004+rand()*.020;
        for(let k=0;k<bundleAlong;k++){
          const u=(k/(bundleAlong-1))*2-1;
          const ang=u*arc,ca2=Math.cos(ang),sa2=Math.sin(ang);
          const ac=off+Math.sin(u*freq*Math.PI+ph)*amp;
          let x=ax*ca2+tang[0]*sa2+bitn[0]*ac;
          let y=ay*ca2+tang[1]*sa2+bitn[1]*ac;
          let z=az*ca2+tang[2]*sa2+bitn[2]*ac;
          const l=Math.hypot(x,y,z)||1;
          const rr=(1.012+.005*(rand()-.5))/l;
          push(x*rr,y*rr,z*rr,3,rand(),.62+rand()*.80,ti/Math.max(1,bundleTopics-1));
        }
      }
    }
    // Layer 3: escaping dust / particle spray.
    const nDust=Math.floor(3100*density);
    for(let i=0;i<nDust;i++){
      const yy=rand()*2-1,rr=Math.sqrt(1-yy*yy),phi=rand()*TAU;
      const r=1.05+Math.pow(rand(),3)*.40;
      push(rr*Math.cos(phi)*r,yy*r,rr*Math.sin(phi)*r,2,rand(),.45+rand()*1.2,rand());
    }
    const array=new Float32Array(particles);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,array,gl.STATIC_DRAW);
    size=array.length/7;
    canvas.dataset.particles=String(size);
  }

  // ---- Topic field tables (single source: payload.topicFields) ----
  const anchorBuf=new Float32Array(MAX_TOPICS*3);
  const colorBuf=new Float32Array(MAX_TOPICS*3);
  const ridgeBuf=new Float32Array(MAX_TOPICS);
  const bundleBuf=new Float32Array(MAX_TOPICS);
  const activeBuf=new Float32Array(MAX_TOPICS);
  function hexToRgb(hex){
    if(!/^#[0-9a-f]{6}$/i.test(String(hex||'')))return null;
    const s=String(hex);
    return [1,3,5].map(i=>parseInt(s.slice(i,i+2),16)/255);
  }
  fields.forEach((f,i)=>{
    const a=f.anchor.map(Number);
    const len=Math.hypot(a[0],a[1],a[2])||1;
    anchorBuf[i*3]=a[0]/len;anchorBuf[i*3+1]=a[1]/len;anchorBuf[i*3+2]=a[2]/len;
    const rgb=hexToRgb(f.color)||[.96,.43,.75];
    colorBuf[i*3]=rgb[0];colorBuf[i*3+1]=rgb[1];colorBuf[i*3+2]=rgb[2];
    ridgeBuf[i]=Math.min(.05,Math.max(.02,Number(f.ridge)||.02));
    bundleBuf[i]=Math.min(1,Math.max(0,Number(f.bundle)||0));
    activeBuf[i]=0;
  });

  quality=window.matchMedia('(pointer: coarse) and (max-width: 760px)').matches?'medium':'high';
  buildParticles(quality);
  let accent=[.96,.43,.75],active=true,clock=0,previous=0,energy=0,frame=0,pixelRatio=1,width=0,height=0;
  let selectedIndex=-1,focusYaw=0;
  function resize(){const w=Math.max(1,Math.round(canvas.clientWidth)),h=Math.max(1,Math.round(canvas.clientHeight));const pr=Math.min(Math.max(window.devicePixelRatio||1,1),1.65);if(w===width&&h===height&&pr===pixelRatio)return;pixelRatio=pr;width=w;height=h;canvas.width=Math.round(w*pr);canvas.height=Math.round(h*pr);gl.viewport(0,0,canvas.width,canvas.height);}

  // CPU replica of the vertex transform (same order, same constants) for label projection.
  function rot2(a,x,y){const c=Math.cos(a),s=Math.sin(a);return [c*x-s*y,s*x+c*y];}
  function localPoint(i,t){
    const ax=anchorBuf[i*3],ay=anchorBuf[i*3+1],az=anchorBuf[i*3+2];
    const q=[ax,ay,az];
    let r=rot2(0.19*q[1]+0.11*Math.sin(q[1]*4.5+t*0.36)+0.085*Math.sin(q[2]*3.9-t*.29),q[0],q[2]);
    q[0]=r[0];q[2]=r[1];
    let wave=Math.sin(q[0]*6.2+q[1]*5.5+t*.78)*.038;
    wave+=Math.sin(q[2]*8.1-q[1]*4.3-t*.5)*.027;
    wave+=Math.sin(q[0]*3.1+q[2]*4.0+t*.41)*.027;
    const len=Math.hypot(q[0],q[1],q[2])||1;
    q[0]+=q[0]/len*wave;q[1]+=q[1]/len*wave;q[2]+=q[2]/len*wave;
    q[0]+=.033*Math.sin(q[1]*7.0+t*.5);
    q[1]+=.037*Math.sin(q[2]*6.7-t*.55);
    r=rot2(-.25+t*.095,q[0],q[2]);q[0]=r[0];q[2]=r[1];
    r=rot2(.12+Math.sin(t*.22)*.075,q[0],q[1]);q[0]=r[0];q[1]=r[1];
    r=rot2(.16+Math.sin(t*.17)*.04,q[1],q[2]);q[1]=r[0];q[2]=r[1];
    const phase=ax*13.7+ay*21.3+az*37.1;
    const fil=Math.pow(0.5+0.5*Math.cos(phase+t*0.35),3.0);
    const d=Math.min(.05,ridgeBuf[i]*(0.45+0.75*fil));
    const l2=Math.hypot(q[0],q[1],q[2])||1;
    q[0]+=q[0]/l2*d;q[1]+=q[1]/l2*d;q[2]+=q[2]/l2*d;
    return q;
  }
  function shortestAngle(from,to){let d=(to-from)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;}

  function render(ms){if(!document.hidden){resize();const dt=Math.min(.05,Math.max(0,(ms-previous)/1000));previous=ms;if(active && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)clock+=dt;energy=Math.max(0,energy-dt*.75);
    // Camera focus: ease toward the selected topic (0.9–1.5s), never jump.
    if(selectedIndex>=0&&selectedIndex<topicCount){
      const t0=localPoint(selectedIndex,clock);
      const target=Math.atan2(t0[0],t0[2])-0.30;
      const d=shortestAngle(focusYaw,target);
      const maxStep=2.2*dt;
      focusYaw+=Math.max(-maxStep,Math.min(maxStep,d*Math.min(1,dt/0.30)));
    } else {
      focusYaw+=shortestAngle(focusYaw,0)*Math.min(1,dt/0.45);
    }
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);gl.bindVertexArray(vao);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.disable(gl.DEPTH_TEST);gl.uniform1f(uniforms.uTime,clock);gl.uniform1f(uniforms.uAspect,width/height);gl.uniform1f(uniforms.uPixelRatio,pixelRatio*Math.min(1.6,Math.min(width,height)/640));gl.uniform1f(uniforms.uPulse,energy);gl.uniform3f(uniforms.uAccent,...accent);gl.uniform1f(uniforms.uFocus,focusYaw);gl.uniform1f(uniforms.uGlow,1);gl.drawArrays(gl.POINTS,0,size);gl.uniform1f(uniforms.uGlow,0);gl.drawArrays(gl.POINTS,0,size);frame++;}else{previous=ms;}requestAnimationFrame(render)}
  requestAnimationFrame(render);
  gl.useProgram(program);
  gl.uniform1i(uniforms.uTopicCount,topicCount);
  if(uniforms.uTopicAnchor)gl.uniform3fv(uniforms.uTopicAnchor,anchorBuf);
  if(uniforms.uTopicColor)gl.uniform3fv(uniforms.uTopicColor,colorBuf);
  if(uniforms.uTopicRidge)gl.uniform1fv(uniforms.uTopicRidge,ridgeBuf);
  if(uniforms.uTopicBundle)gl.uniform1fv(uniforms.uTopicBundle,bundleBuf);
  if(uniforms.uTopicActive)gl.uniform1fv(uniforms.uTopicActive,activeBuf);
  window.__ORBIT_DEBUG__={uniforms:Object.fromEntries(Object.entries(uniforms).map(([k,v])=>[k,v===null?null:typeof v])),topicCount,anchors:Array.from(anchorBuf).slice(0,15),ridges:Array.from(ridgeBuf)};
  const colors={};
  function setColor(hex){if(!/^#[0-9a-f]{6}$/i.test(hex))return;accent=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);energy=1;}
  function setQuality(q){if(!['high','medium','low'].includes(q)||quality===q)return;quality=q;buildParticles(q);}
  function setPlaying(on){active=!!on;}
  function pulse(){energy=1;}
  function topicIndexOf(id){
    if(typeof id==='number'&&Number.isFinite(id))return Math.floor(id);
    if(typeof id!=='string'||!id)return -1;
    const fromFields=fields.findIndex(f=>String(f.id||'')===id);
    if(fromFields>=0)return fromFields;
    return topicList.findIndex(t=>t&&(String(t.id||'')===id||t.name===id));
  }
  function setSelection(id){
    let idx=topicIndexOf(id);
    if(!(idx>=0&&idx<topicCount))idx=-1;
    selectedIndex=idx;
    for(let i=0;i<MAX_TOPICS;i++)activeBuf[i]=i===idx?1:0;
    gl.useProgram(program);
    if(uniforms.uTopicActive)gl.uniform1fv(uniforms.uTopicActive,activeBuf);
  }
  function project(id){
    const i=typeof id==='number'?Math.floor(id):topicIndexOf(id);
    if(!(i>=0&&i<topicCount)||!width||!height)return null;
    const q=localPoint(i,clock);
    const r=rot2(focusYaw,q[0],q[2]);
    const x=r[0],y=q[1],z=r[1];
    const dist=4.10-z;
    const ndcX=(x*3.05/(width/height))/dist;
    const ndcY=(y*3.05)/dist;
    return {x:(ndcX*0.5+0.5)*width,y:(0.5-ndcY*0.5)*height,z:z,front:z>0,index:i};
  }
  window.TrendRadarOrbit={available:true,engine:'webgl2',setColor,setQuality,setPlaying,pulse,setSelection,project,getTopicFields(){return fields.slice();},get stats(){return {particles:size,frames:frame,quality,playing:active,engine:'webgl2',topics:topicCount}}};
})();
