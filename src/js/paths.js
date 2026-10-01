import { GEO, TX, clamp, dist } from "./config.js";

/* ============================================================
   PATHS
============================================================ */
function mkPath(pts,speed,after,delay){
  pts=pts.map(p=>[clamp(TX(p[0]),1,GEO.W-1),p[1]]);
  let t=delay||0;
  const w=[{x:pts[0][0],y:pts[0][1],t:0}];
  if(delay) w.push({x:pts[0][0],y:pts[0][1],t:delay});
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1], b=pts[i];
    const d=Math.hypot(b[0]-a[0],b[1]-a[1]);
    let pen=0;
    if(i>=2){
      const p0=pts[i-2], v1=[a[0]-p0[0],a[1]-p0[1]], v2=[b[0]-a[0],b[1]-a[1]];
      const cos=(v1[0]*v2[0]+v1[1]*v2[1])/((Math.hypot(v1[0],v1[1])*Math.hypot(v2[0],v2[1]))||1);
      if(cos<0.6) pen=0.12+(0.6-cos)*0.12; // plant-and-cut costs a beat
    }
    t+=d/speed+pen;
    w.push({x:b[0],y:b[1],t});
  }
  return {wps:w,pts,after,speed};
}
// Position at time t. Routes marked "run" keep going after the drawn line ends
// (a go route keeps running; a flat hits the sideline and turns upfield).
function posAt(p,t){
  const w=p.path.wps;
  if(t<=w[0].t) return {x:w[0].x,y:w[0].y};
  for(let i=0;i<w.length-1;i++){
    const a=w[i], b=w[i+1];
    if(t>=a.t && t<=b.t){
      const f=(b.t-a.t)<=1e-4?1:(t-a.t)/(b.t-a.t);
      return {x:a.x+(b.x-a.x)*f, y:a.y+(b.y-a.y)*f};
    }
  }
  const last=w[w.length-1];
  if(p.path.after!=="run"||w.length<2) return {x:last.x,y:last.y};
  let k=w.length-2; while(k>0 && dist(w[k],last)<0.01) k--;
  const prev=w[k];
  let ux=last.x-prev.x, uy=last.y-prev.y; const L=Math.hypot(ux,uy)||1; ux/=L; uy/=L;
  let s=(t-last.t)*p.path.speed, x=last.x, y=last.y;
  if(Math.abs(ux)>1e-3){
    const bx=ux>0?GEO.W-1:1, sHit=(bx-x)/ux;
    if(sHit>=0 && s>sHit){ x=bx; y+=uy*sHit; s-=sHit; ux=0; uy=1; }
  }
  x+=ux*s; y+=uy*s;
  return {x:clamp(x,1,GEO.W-1), y:clamp(y,GEO.yMin+0.5,GEO.yMax-1)};
}

export function init(){}

export { mkPath, posAt };
