/* CPU fallback for browsers where WebGL2 is disabled.
   STILL ANIMATED: projects actual 3D coordinates at runtime to Canvas 2D.
   Topic fields use the same angular falloff / filament maths as the GLSL path and
   only displace real 3D points; no 2D light patches are drawn.
   Lower performance and less accurate than the primary GPU GLSL renderer. */
(function(){
'use strict';
const payload=window.__TREND_RADAR_PAYLOAD__||{};
const topicList=Array.isArray(payload.topics)?payload.topics:[];
const MAX_TOPICS=16;
const fields=Array.isArray(payload.topicFields)?payload.topicFields.filter(f=>f&&Array.isArray(f.anchor)&&f.anchor.length===3).slice(0,MAX_TOPICS):[];
const topicCount=fields.length;
const AX=[],AY=[],AZ=[],RIDGE=[],BUNDLE=[],TC=[];
fields.forEach((f,i)=>{
 const a=f.anchor.map(Number);const l=Math.hypot(a[0],a[1],a[2])||1;
 AX[i]=a[0]/l;AY[i]=a[1]/l;AZ[i]=a[2]/l;
 RIDGE[i]=Math.min(.05,Math.max(.02,Number(f.ridge)||.02));
 BUNDLE[i]=Math.min(1,Math.max(0,Number(f.bundle)||0));
 TC[i]=/^#[0-9a-f]{6}$/i.test(String(f.color||''))?f.color:'#f36bbe';
});
window.createTrendRadarFallback=function(canvas){
 const ctx=canvas.getContext('2d',{alpha:true});
 if(!ctx){return {available:false,engine:'unavailable',setColor(){},setQuality(){},setPlaying(){},pulse(){},setSelection(){},project(){return null},getTopicFields(){return []}};}
 let playing=true,quality=window.matchMedia('(pointer: coarse) and (max-width: 760px)').matches?'medium':'high',color='#f36bbe',pulse=0,clock=0,prev=0,dpr=1,w=0,h=0,frame=0;
 let selectedIndex=-1,focusYaw=0;
 const TAU=Math.PI*2,rand=(function(){let x=20261103;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;}})();
 let shell=[],ribbons=[],dust=[];
 function init(){
  const f=quality==='high'?1:quality==='medium'?.7:.4;
  shell=[];ribbons=[];dust=[];
  const ns=Math.floor(6500*f);
  for(let i=0;i<ns;i++){
   const y=1-2*(i+.5)/ns,rr=Math.sqrt(1-y*y),az=i*2.39996323;
   const r=.96+.09*Math.sin(az*3+y*9)+.025*(rand()-.5);
   shell.push([r*rr*Math.cos(az),r*y,r*rr*Math.sin(az),rand(),rand()]);
  }
  const strands=Math.floor(49*f);
  for(let k=0;k<strands;k++){
   let ribbon=[];
   const tilt=rand()*TAU,axis=rand()*TAU,flow=.85+rand()*1.9,offset=rand()*TAU;
   const ca=Math.cos(tilt),sa=Math.sin(tilt),cb=Math.cos(axis),sb=Math.sin(axis);
   for(let i=0;i<240;i++){
    const t=i/239,angle=t*TAU*flow+offset;
    const lat=Math.sin(angle*.61+k*.32)*.57 + Math.sin(angle*1.7+k*.9)*.25;
    const r=1.015+.055*Math.sin(angle*3+k*.7);
    const u=Math.sqrt(Math.max(0,1-lat*lat));let x=u*Math.cos(angle),y=lat,z=u*Math.sin(angle);
    let ny=y*ca-z*sa,nz=y*sa+z*ca;y=ny;z=nz;
    let nx=x*cb-z*sb;nz=x*sb+z*cb;x=nx;z=nz;
    ribbon.push([x*r,y*r,z*r]);
   }
   ribbons.push(ribbon);
  }
  for(let i=0;i<Math.floor(1100*f);i++){
    const y=2*rand()-1,phi=rand()*TAU,r=1.04+Math.pow(rand(),3)*.42;
    dust.push([Math.sqrt(1-y*y)*Math.cos(phi)*r,y*r,Math.sqrt(1-y*y)*Math.sin(phi)*r,rand()]);
  }
 }
 init();
 // Angular falloff + filament bundle; identical semantics to the vertex shader.
 function fieldAt(nx,ny,nz,t){
  let disp=0,bestG=0,best=-1,bestFil=0;
  for(let i=0;i<topicCount;i++){
   const ax=AX[i],ay=AY[i],az=AZ[i];
   const pole=Math.abs(ay)>0.94;
   const hx=pole?1:0,hy=pole?0:1,hz=0;
   let tx=ay*hz-az*hy,ty=az*hx-ax*hz,tz=ax*hy-ay*hx;
   const tl=Math.hypot(tx,ty,tz)||1;tx/=tl;ty/=tl;tz/=tl;
   const bx=ay*tz-az*ty,by=az*tx-ax*tz,bz=ax*ty-ay*tx;
   const dx=nx-ax,dy=ny-ay,dz=nz-az;
   const along=dx*tx+dy*ty+dz*tz;
   const across=dx*bx+dy*by+dz*bz;
   const elong=1.55+1.20*BUNDLE[i];
   const g=Math.exp(-((along*along)/(elong*elong)+across*across)/0.09);
   if(g<0.004)continue;
   const phase=ax*13.7+ay*21.3+az*37.1;
   const fil=Math.pow(0.5+0.5*Math.cos(across*(7+8*BUNDLE[i])+phase+t*0.35),3);
   disp+=g*(0.45+0.75*fil)*RIDGE[i];
   if(g>bestG){bestG=g;best=i;bestFil=fil;}
  }
  return [Math.min(.05,disp),bestG,bestFil,best];
 }
 function place(x,y,z,t,fieldScale){
  const nl=Math.hypot(x,y,z)||1;
  const nX=x/nl,nY=y/nl,nZ=z/nl;
  const twist=.19*y+.1*Math.sin(y*4.5+t*.36)+.08*Math.sin(z*3.9-t*.29);
  let cc=Math.cos(twist),ss=Math.sin(twist),nx=x*cc-z*ss,nz=x*ss+z*cc;x=nx;z=nz;
  const wave=.036*Math.sin(x*6.2+y*5.5+t*.78)+.03*Math.sin(z*8.1-y*4.3-t*.5);
  const r=Math.max(.01,Math.sqrt(x*x+y*y+z*z));x+=x/r*wave+.025*Math.sin(y*7+t*.5);y+=y/r*wave+.027*Math.sin(z*6.7-t*.5);z+=z/r*wave;
  const fd=fieldAt(nX,nY,nZ,t);
  const d=fd[0]*(fieldScale===undefined?1:fieldScale);
  if(d>0){const r2=Math.max(.01,Math.sqrt(x*x+y*y+z*z));x+=x/r2*d;y+=y/r2*d;z+=z/r2*d;}
  const a=-.25+t*.095;cc=Math.cos(a);ss=Math.sin(a);nx=x*cc-z*ss;nz=x*ss+z*cc;x=nx;z=nz;
  const b=.12+Math.sin(t*.22)*.075;cc=Math.cos(b);ss=Math.sin(b);nx=x*cc-y*ss;const ny=x*ss+y*cc;x=nx;y=ny;
  return [x,y,z,fd[1],fd[2],fd[3]];
 }
 function transform(p,t,fieldScale){
  const q=place(p[0],p[1],p[2],t,fieldScale);
  let x=q[0];const y=q[1];let z=q[2];
  const cc=Math.cos(focusYaw),ss=Math.sin(focusYaw),fx=x*cc-z*ss,fz=x*ss+z*cc;x=fx;z=fz;
  const persp=4.1/(4.1-z),sc=Math.min(w,h)*.405;
  const rl=Math.max(1,Math.sqrt(x*x+y*y+z*z));
  return [w*.5+x*sc*persp,h*.50+y*sc*persp,z,persp,Math.pow(Math.max(0,1-Math.abs(z)/rl),1.45),q[3],q[4],q[5]];
 }
 function resize(){let rect=canvas.getBoundingClientRect();const nw=Math.max(1,Math.round(rect.width)),nh=Math.max(1,Math.round(rect.height)),np=Math.min(window.devicePixelRatio||1,1.35);if(nw===w&&nh===h&&np===dpr)return;w=nw;h=nh;dpr=np;canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}
 function stepFocus(dt){
  if(selectedIndex>=0&&selectedIndex<topicCount){
   const q=place(AX[selectedIndex],AY[selectedIndex],AZ[selectedIndex],clock,1);
   const target=Math.atan2(q[0],q[2])-0.30;
   let d=(target-focusYaw)%TAU;if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;
   const maxStep=2.2*dt;
   focusYaw+=Math.max(-maxStep,Math.min(maxStep,d*Math.min(1,dt/0.30)));
  }else{
   let d=(-focusYaw)%TAU;if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;
   focusYaw+=d*Math.min(1,dt/0.45);
  }
 }
 function draw(ms){
  if(!document.hidden){resize();const dt=Math.min(.05,Math.max(0,(ms-prev)/1000));if(playing&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)clock+=dt;prev=ms;pulse=Math.max(0,pulse-dt*.6);stepFocus(dt);
   ctx.clearRect(0,0,w,h);
   ctx.save();ctx.globalCompositeOperation='lighter';
   // Soft glow lit by the same points; does not use an image asset.
   const rad=Math.min(w,h)*.44;
   const glow=ctx.createRadialGradient(w/2,h/2,rad*.29,w/2,h/2,rad*1.18);
   glow.addColorStop(0,'rgba(201,78,186,0.00)');glow.addColorStop(.58,'rgba(215,75,195,0.025)');glow.addColorStop(.87,'rgba(229,97,217,0.035)');glow.addColorStop(1,'rgba(205,55,210,0)');
   ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
   const palettes=['#a879f2','#e88bd9','#f887c0','#ffe3f6','#c3abff'];
   for(const [idx,ribbon] of ribbons.entries()){
     const pick=palettes[idx%palettes.length];
     ctx.strokeStyle=pick;ctx.globalAlpha=idx%6===0?.41:.17;ctx.lineWidth=idx%7===0?1.25:.65;
     ctx.beginPath();
     for(let j=0;j<ribbon.length;j++){
       const pt=transform(ribbon[j],clock,1),x=pt[0],y=pt[1];
       if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
     }
     ctx.stroke();
   }
   const groups=[[],[],[],[],[]];
   const tinted=topicCount?Array.from({length:topicCount},()=>[]):[];
   let peak=[];
   for(const p of shell){
     const t=transform(p,clock,1);
     if(t[7]>=0&&t[5]>.26){
       tinted[t[7]].push(t);
       if(t[5]>.55&&t[6]>.72)peak.push(t);
       continue;
     }
     const rim=t[4];const bucket=Math.max(0,Math.min(4,Math.floor((.45*p[3]+rim*.8)*4.9)));
     groups[bucket].push(t);
   }
   for(let i=0;i<5;i++){
    ctx.fillStyle=palettes[i];ctx.globalAlpha=[.35,.49,.58,.70,.92][i];
    for(const pt of groups[i]){
      const sz=(i>=3?1.36:1.0)*pt[3];ctx.fillRect(pt[0],pt[1],sz,sz);
    }
   }
   for(let i=0;i<tinted.length;i++){
    ctx.fillStyle=TC[i];ctx.globalAlpha=.78;
    for(const pt of tinted[i]){const sz=(1.02+.85*pt[6])*pt[3];ctx.fillRect(pt[0],pt[1],sz,sz);}
   }
   if(peak.length){
    ctx.fillStyle='#ffe3f6';ctx.globalAlpha=.92;
    for(const pt of peak){const sz=(1.15+.9*pt[6])*pt[3];ctx.fillRect(pt[0],pt[1],sz,sz);}
   }
   ctx.fillStyle='#ffdaf3';ctx.globalAlpha=.70;
   for(let i=0;i<dust.length;i++){
     const pt=transform(dust[i],clock,.3);ctx.fillRect(pt[0],pt[1],i%7===0?1.5:.7,i%7===0?1.5:.7);
   }
   if(pulse>.02){
     ctx.strokeStyle=color;ctx.globalAlpha=.22*pulse;ctx.lineWidth=2.2;ctx.shadowColor=color;ctx.shadowBlur=18;
     ctx.beginPath();ctx.arc(w*.5,h*.5,Math.min(w,h)*(.405+.015*(1-pulse)),0,TAU);ctx.stroke();ctx.shadowBlur=0;
   }
   ctx.restore();frame++;
  } else prev=ms;
  requestAnimationFrame(draw);
 }
 requestAnimationFrame(draw);
 function topicIndexOf(id){
  if(typeof id==='number'&&Number.isFinite(id))return Math.floor(id);
  if(typeof id!=='string'||!id)return -1;
  const hit=fields.findIndex(f=>String(f.id||'')===id);
  if(hit>=0)return hit;
  return topicList.findIndex(t=>t&&(String(t.id||'')===id||t.name===id));
 }
 function setSelection(id){const i=topicIndexOf(id);selectedIndex=(i>=0&&i<topicCount)?i:-1;}
 function project(id){
  const i=typeof id==='number'?Math.floor(id):topicIndexOf(id);
  if(!(i>=0&&i<topicCount)||!w||!h)return null;
  const pt=transform([AX[i],AY[i],AZ[i]],clock,1);
  return {x:pt[0],y:pt[1],z:pt[2],front:pt[2]>0,index:i};
 }
 return {available:true,engine:'canvas-3d-fallback',setColor(hex){color=hex;pulse=1;},setQuality(q){if(['high','medium','low'].includes(q)&&q!==quality){quality=q;init();}},setPlaying(v){playing=!!v;},pulse(){pulse=1;},setSelection,project,getTopicFields(){return fields.slice();},get stats(){return {particles:shell.length+dust.length+ribbons.length*240,frames:frame,quality,playing,engine:'canvas-3d-fallback',topics:topicCount};}};
};
})();
