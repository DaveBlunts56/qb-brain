import { CENTER_X, GEO, ZX, clamp, dist, lerp } from "./config.js";
import { routeEnd } from "./keyread.js";
import { histPos, holderAt, livePos, passerIdAt, playerById } from "./rep.js";

/* ============================================================
   DEFENSE  (v1.3)
   Every defender is a body with momentum: a top speed and an acceleration limit,
   so sharp cuts beat them and they have to plant to change direction.
   They see the offense a reaction-time late, play real coverage rules, and read the QB's eyes.

   Roles
     man   – press or off technique, inside/outside leverage, trails on the hip
     zone  – type "deep" (thirds/halves/middle), "flat" (curl-flat), "hook" (middle under)
   The rusher lines up 7 yds off; his plan can be straight, off the edge, delayed, or a drop into coverage.
============================================================ */
const DEF_TUNE = {
  rookie:  {manAccel:9,  zoneAccel:11, eyes:0.15, lane:1.3, pressChance:0.15, plans:{straight:1}},
  varsity: {manAccel:11, zoneAccel:13, eyes:0.30, lane:1.4, pressChance:0.35, plans:{straight:0.6,edge:0.28,delay:0.12}},
  elite:   {manAccel:13, zoneAccel:15, eyes:0.45, lane:1.5, pressChance:0.55, plans:{straight:0.42,edge:0.28,delay:0.15,drop:0.15}}
};
const DEF_SPEED=7.2, BACKPEDAL=6.4, BREAK_SPEED=7.6;

function levOff(x,lev){ return lev==="inside"?(x<GEO.CX?1:-1):(x<GEO.CX?-1:1); }
function newDef(o){ o.vel={x:0,y:0}; return o; }
function manDef(r,tune){
  const lev=Math.random()<0.5?"inside":"outside";
  const press=Math.random()<tune.pressChance;
  const y0 = press ? 1.2 : 4.5+Math.random()*1.5;
  return newDef({role:"man",assign:r,leverage:lev,press,pos:{x:clamp(r.x0+levOff(r.x0,lev)*(press?0.8:1.4),1,GEO.W-1),y:Math.max(y0, r.y0+y0)}});
}
// zone defender: landmark (lx,ly) on the 30-yd template, coverage range x0..x1 (template), type
function TXinv(x){ return CENTER_X+(x-GEO.CX)/GEO.zs; }   // field x -> template x (zones)
function zoneDef(type,lx,ly,x0,x1,align){
  const L={x:ZX(lx),y:ly};
  return newDef({role:"zone",type,lx:L.x,ly:L.y,x0:ZX(x0),x1:ZX(x1),pos:{x:align?ZX(align[0]):L.x,y:align?align[1]:Math.min(L.y,type==="deep"?10:L.y)}});
}
/* Coverage shells. 5v5 = 4 cover defenders + rusher; 7v7 = 6 + rusher.
   Ranges overlap a little so routes get passed from one zone to the next. */
function buildDefense(coverage, targets, nDef, tune){
  tune = tune || DEF_TUNE.varsity;
  let defs=[];
  if(coverage==="Man"){
    targets.slice(0,nDef).forEach(r=>defs.push(manDef(r,tune)));
  } else if(coverage==="Cover 1"){
    defs.push(zoneDef("deep",15,15,0,30,[15,12.5]));
    let man=targets.slice();
    if(man.length>nDef-1){
      const free=man.slice().sort((a,b)=>Math.abs(a.x0-GEO.CX)-Math.abs(b.x0-GEO.CX))[0];
      man=man.filter(r=>r!==free);
    }
    man.slice(0,nDef-1).forEach(r=>defs.push(manDef(r,tune)));
  } else if(coverage==="Cover 2"){
    defs.push(zoneDef("deep",7.5,14,0,15.5,[7.5,12]), zoneDef("deep",22.5,14,14.5,30,[22.5,12]));
    if(nDef<=4) defs.push(zoneDef("flat",6,5,0,13,[5,4]), zoneDef("flat",24,5,17,30,[25,4]));
    else defs.push(zoneDef("flat",4,4,0,9,[4,4]), zoneDef("hook",11,7,7,15.5,[11,5.5]), zoneDef("hook",19,7,14.5,23,[19,5.5]), zoneDef("flat",26,4,21,30,[26,4]));
  } else if(coverage==="Cover 3"){
    defs.push(zoneDef("deep",5,13.5,0,10.5,[5,10]), zoneDef("deep",15,15.5,9.5,20.5,[15,12.5]), zoneDef("deep",25,13.5,19.5,30,[25,10]));
    if(nDef<=4) defs.push(zoneDef("hook",15,6,5,25,[15,5]));
    else defs.push(zoneDef("flat",5,5,0,11,[5,4]), zoneDef("hook",15,7,9,21,[15,5.5]), zoneDef("flat",25,5,19,30,[25,4]));
  } else if(coverage==="Robber"){
    // Cover 1 Robber: one deep safety, a robber sitting in the middle hole reading the QB, man on the outside
    defs.push(zoneDef("deep",15,15,0,30,[15,12.5]));
    const rb=zoneDef("hook",15,7,8,22,[15,7.5]); rb.robber=true; defs.push(rb);
    const man=targets.slice().sort((a,b)=>Math.abs(b.x0-GEO.CX)-Math.abs(a.x0-GEO.CX)).slice(0,nDef-2);
    man.forEach(r=>defs.push(manDef(r,tune)));
  } else if(coverage==="Bracket"){
    // double the biggest threat: one under him (man, inside leverage), one over the top; man on the rest
    const threat=targets.slice().sort((a,b)=>routeEnd(b).y-routeEnd(a).y)[0];
    const under=manDef(threat,tune); under.leverage="inside"; under.bracket=true; defs.push(under);
    const tx=clamp(threat.x0,4,26)/GEO.kx; const over=zoneDef("deep",clamp(TXinv(threat.x0),3,27),13,clamp(TXinv(threat.x0)-7,0,30),clamp(TXinv(threat.x0)+7,0,30),[clamp(TXinv(threat.x0),3,27),10]); over.bracket=true; defs.push(over);
    targets.filter(r=>r!==threat).sort((a,b)=>Math.abs(b.x0-GEO.CX)-Math.abs(a.x0-GEO.CX)).slice(0,nDef-2).forEach(r=>defs.push(manDef(r,tune)));
  } else if(coverage==="2-Man"){
    // Cover 2 man-under: two deep halves, man underneath
    defs.push(zoneDef("deep",7.5,14,0,15.5,[7.5,12]), zoneDef("deep",22.5,14,14.5,30,[22.5,12]));
    targets.slice().sort((a,b)=>Math.abs(b.x0-GEO.CX)-Math.abs(a.x0-GEO.CX)).slice(0,nDef-2).forEach(r=>defs.push(manDef(r,tune)));
  } else if(coverage==="Cover 4"){
    // quarters: four deep, the rest underneath
    defs.push(zoneDef("deep",4,15,0,8.5,[4,11]), zoneDef("deep",11.5,16,7,16,[11,12]), zoneDef("deep",18.5,16,14,23,[19,12]), zoneDef("deep",26,15,21.5,30,[26,11]));
    const left=nDef-4;
    if(left>=3) defs.push(zoneDef("flat",4,4,0,10,[4,4]), zoneDef("hook",15,6,9,21,[15,5.5]), zoneDef("flat",26,4,20,30,[26,4]));
    else if(left===2) defs.push(zoneDef("hook",10,6,3,15.5,[10,5]), zoneDef("hook",20,6,14.5,27,[20,5]));
    else if(left===1) defs.push(zoneDef("hook",15,6,6,24,[15,5]));
  } else { // Underneath Zone: no deep help — hook players carry verticals to ~12 then let them go
    if(nDef<=4) defs.push(zoneDef("flat",4,4,0,9.5), zoneDef("hook",11.5,7.5,8,16), zoneDef("hook",18.5,7.5,14,22), zoneDef("flat",26,4,20.5,30));
    else defs.push(zoneDef("flat",3,4,0,7), zoneDef("hook",9,7.5,6,12.5), zoneDef("hook",13.5,5,11,16), zoneDef("hook",16.5,5,14,19), zoneDef("hook",21,7.5,17.5,24), zoneDef("flat",27,4,23,30));
  }
  while(defs.length<nDef){ const rb=zoneDef("hook",15,7,8,22); rb.robber=true; defs.push(rb); }   // extra defender = middle robber
  const cap=GEO.yMax-1.5;   // near the goal line nobody can drop past the end line
  defs.forEach(d=>{ if(d.ly!==undefined) d.ly=Math.min(d.ly,cap-0.5); d.pos.y=Math.min(d.pos.y,cap-1); });
  return defs;
}
function applyShownAlignment(defs, shown, targets, nDef, tune){
  const shownDefs=buildDefense(shown, targets, nDef, tune);
  const key=d=>-Math.round(d.pos.y/3)*100 + d.pos.x;
  const a=defs.slice().sort((p,q)=>key(p)-key(q));
  const b=shownDefs.slice().sort((p,q)=>key(p)-key(q));
  for(let i=0;i<a.length&&i<b.length;i++) a[i].pos={x:b[i].pos.x,y:b[i].pos.y};
}
function pickRushPlan(tune){
  let r=Math.random(), acc=0;
  for(const [k,v] of Object.entries(tune.plans)){ acc+=v; if(r<acc) return k; }
  return "straight";
}

/* ---- motion: steer toward a target with a speed cap and an acceleration cap ---- */
function steer(o,pos,tx,ty,vmax,accel,dt,gain){
  const dx=tx-pos.x, dy=ty-pos.y, d=Math.hypot(dx,dy);
  const want=Math.min(vmax,d*(gain||5));
  let ax=(d>1e-4?dx/d*want:0)-o.vel.x, ay=(d>1e-4?dy/d*want:0)-o.vel.y;
  const a=Math.hypot(ax,ay), amax=accel*dt;
  if(a>amax){ ax*=amax/a; ay*=amax/a; }
  o.vel.x+=ax; o.vel.y+=ay;
  pos.x+=o.vel.x*dt; pos.y+=o.vel.y*dt;
}
function seenVel(p,tq){ const a=histPos(p,tq), b=histPos(p,tq-0.12); return {x:(a.x-b.x)/0.12, y:(a.y-b.y)/0.12}; }
// point on the QB->receiver throwing lane, `back` yards in front of the receiver
function lanePoint(qb,rp,back){
  const vx=rp.x-qb.x, vy=rp.y-qb.y, L=Math.hypot(vx,vy)||1;
  return {x:rp.x-vx/L*back, y:rp.y-vy/L*back};
}
/* QB eyes: the aim point (set by the UI while you pull back) is smoothed, so a quick glance
   barely moves anyone but staring at a receiver drags the zone toward him. */
function updateEyes(rep,dt){
  if(rep.eyesRaw){
    if(!rep.eyesSm) rep.eyesSm={x:rep.eyesRaw.x,y:rep.eyesRaw.y};
    const k=Math.min(1,dt*3.5);
    rep.eyesSm.x+=(rep.eyesRaw.x-rep.eyesSm.x)*k; rep.eyesSm.y+=(rep.eyesRaw.y-rep.eyesSm.y)*k;
    rep.eyesStr=Math.min(1,(rep.eyesStr||0)+dt*1.6);
  } else rep.eyesStr=Math.max(0,(rep.eyesStr||0)-dt*1.2);
}
// how shallow a zone defender will come before the ball is thrown (yds past the LOS)
const ZONE_FLOOR={flat:2.5, hook:4.0, deep:9};
function zoneTarget(rep,d,lookT,qb,tune){
  const seen=rep.targets.map(p=>({p,q:histPos(p,lookT)}));
  const inX=(q,pad)=>q.x>=d.x0-(pad||0) && q.x<=d.x1+(pad||0);
  let tx=d.lx, ty=d.ly;
  if(d.type==="deep"){
    // stay deeper than the deepest threat in my area; split two threats
    const th=seen.filter(s=>inX(s.q,1.5) && s.q.y>4).sort((a,b)=>b.q.y-a.q.y);
    if(th.length){
      const T=th[0].q;
      let x=lerp(d.lx,T.x,0.8);
      if(th.length>1 && th[1].q.y>T.y-5) x=lerp(T.x,th[1].q.x,0.4);
      tx=clamp(x,d.x0,d.x1); ty=Math.max(d.ly-2.5, T.y+2.6);
    }
  } else {
    const shallow = d.type==="flat";
    // flat defender: jump anything in the flat, otherwise sink under the curl
    // hook defender: wall off whoever is crossing my area, carry seams to ~12
    const cand=seen.filter(s=>inX(s.q,0.5) && s.q.y>0.5 && s.q.y<13);   // ignore anyone still in the backfield
    let T=null;
    if(shallow){
      const flat=cand.filter(s=>s.q.y<5.5).sort((a,b)=>dist(a.q,{x:d.lx,y:d.ly})-dist(b.q,{x:d.lx,y:d.ly}))[0];
      const curl=cand.filter(s=>s.q.y>=5.5).sort((a,b)=>a.q.y-b.q.y)[0];
      T=flat||curl;
    } else {
      T=cand.sort((a,b)=>dist(a.q,{x:d.lx,y:d.ly})-dist(b.q,{x:d.lx,y:d.ly}))[0];
    }
    if(T){
      const lp=lanePoint(qb,T.q,tune.lane);
      tx=clamp(lp.x,d.x0-1,d.x1+1);
      ty=T.q.y>11 ? Math.min(T.q.y-1,13) : clamp(lp.y,ZONE_FLOOR[d.type],12);   // carry a vertical a few steps
    }
  }
  // QB eyes pull zone players toward where you're looking
  if(rep.eyesStr>0 && rep.eyesSm && rep.eyesSm.x>d.x0-5 && rep.eyesSm.x<d.x1+5){
    const w=Math.min(0.9,tune.eyes*rep.eyesStr*(d.robber?1.8:1));
    tx=lerp(tx,rep.eyesSm.x,w);
    ty = d.type==="deep" ? Math.max(ty, lerp(ty,rep.eyesSm.y+1.5,w)) : lerp(ty,rep.eyesSm.y-1,w*0.6);
  }
  if(d.type!=="deep") ty=Math.max(ty,ZONE_FLOOR[d.type]);
  return {x:tx,y:ty};
}
function updateDefenders(rep, t, dt){
  const tune=rep.tune||DEF_TUNE.varsity, delay=rep.reactionDelay;
  const lookT=Math.max(0,t-delay);
  updateEyes(rep,dt);
  const qbId=passerIdAt(rep,t), qb=histPos(playerById(rep,qbId),lookT);
  const b=rep.ball;
  rep.defenders.forEach(d=>{
    let tx,ty, vmax=DEF_SPEED, accel = d.role==="man" ? tune.manAccel : tune.zoneAccel;
    // break on a thrown ball if I can get there
    if(b && t>=b.tRel+delay+0.1){
      const left=Math.max(0,b.tLand-t), reach=dist(d.pos,b.to);
      // deep defenders read the throw a beat later than underneath players who see it in front of them
      const late = d.type==="deep" ? 0.15 : 0;
      if(t>=b.tRel+delay+0.1+late && (reach <= BREAK_SPEED*(left+0.15)+0.8 || d.breaking)){
        d.breaking=true; tx=b.to.x; ty=b.to.y; vmax=BREAK_SPEED; accel+=4;
      }
    }
    if(tx===undefined){
      if(d.role==="man"){
        const r=d.assign, rp=histPos(r,lookT), rv=seenVel(r,lookT);
        const pred={x:rp.x+rv.x*0.22, y:rp.y+rv.y*0.22};
        const lev=levOff(r.x0,d.leverage)*0.8;
        // off coverage keeps a cushion that shrinks as the route develops; press trails on the hip
        const cushion = d.press ? -0.6 : Math.max(-0.6, 4.5-t*2.4);
        tx=pred.x+lev; ty=pred.y+cushion;
        if(cushion>0 && ty>d.pos.y) vmax=BACKPEDAL;
      } else {
        const z=zoneTarget(rep,d,lookT,qb,tune); tx=z.x; ty=z.y;
        if(ty>d.pos.y+0.5) vmax = d.type==="deep" ? DEF_SPEED : BACKPEDAL;
      }
      if(!b) ty=Math.max(1.0,ty);   // only the rusher attacks the backfield; coverage players stay in coverage
    }
    // traffic: a man defender who has to go around another offensive player loses a step (rubs/picks)
    if(d.role==="man" && !b){
      for(const o of rep.players){ if(o===d.assign) continue; const q=livePos(o); if(Math.hypot(q.x-d.pos.x,q.y-d.pos.y)<1.2){ vmax*=0.4; break; } }
    }
    steer(d,d.pos,tx,ty,vmax,accel,dt,5);
    d.pos.x=clamp(d.pos.x,0.5,GEO.W-0.5);
    // nobody but the rusher crosses into the backfield before the ball is thrown
    if(!b && d.pos.y<0.5){ d.pos.y=0.5; if(d.vel.y<0) d.vel.y=0; }
  });
}
/* Rusher: straight up the middle, off an edge, delayed, or (elite) dropping into a middle zone. */
function updateRusher(rep, t, dt){
  const r=rep.rusher;
  if(r.dropped || rep.ball) return;
  if(rep.rushPlan==="drop" && t>0.25){
    r.dropped=true;
    const d=zoneDef("hook",15,6,8,22); d.pos={x:r.x,y:r.y}; d.isRusher=true; d.vel={x:0,y:0};
    rep.defenders.push(d);
    return;
  }
  const start = rep.rushPlan==="delay" ? rep.delayPlan : rep.rushDelay;
  if(t<start){ if(rep.rushPlan==="delay") steer(r,r,r.x,8.5,3,8,dt); return; }
  const id=passerIdAt(rep,t), p=livePos(playerById(rep,id)), pv=playerById(rep,id).s;
  const tx=p.x+pv.vx*0.3, ty=p.y+pv.vy*0.3;
  if(!rep.rushStart) rep.rushStart=dist(r,p);
  steer(r,r,tx,ty,rep.rushSpeed,rep.rushAccel,dt,8);
}
function isSacked(rep,t){
  if(rep.rusher.dropped) return false;
  const h=holderAt(rep,t);
  return !rep.ball && !rep.qbRunning && h && dist(rep.rusher, livePos(playerById(rep,h)))<1.0;
}
function nearestDefender(rep, pt){
  let best=null, bd=999;
  rep.defenders.forEach(d=>{ const dd=dist(d.pos,pt); if(dd<bd){ bd=dd; best=d; } });
  return {d:best, dist:bd};
}
// Bullet passes travel low: a defender standing in the lane can tip or pick them.
function checkBulletLane(rep,t){
  const b=rep.ball; if(!b || b.type!=="bullet") return null;
  const f=(t-b.tRel)/b.flight; if(f<0.12||f>0.8) return null;
  const g={x:lerp(b.from.x,b.to.x,f), y:lerp(b.from.y,b.to.y,f)};
  for(const d of rep.defenders){
    const dd=dist(d.pos,g);
    if(dd<0.6) return {kind:"INTERCEPTED",def:d};
    if(dd<0.85) return {kind:"BROKEN UP",def:d};
  }
  return null;
}

export function init(){}

export { DEF_TUNE, DEF_SPEED, BACKPEDAL, BREAK_SPEED, levOff, newDef, manDef, TXinv, zoneDef, buildDefense, applyShownAlignment, pickRushPlan, steer, seenVel, lanePoint, updateEyes, ZONE_FLOOR, zoneTarget, updateDefenders, updateRusher, isSacked, nearestDefender, checkBulletLane };
