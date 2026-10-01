import { VIEW, ch, ctx, cw, toPx } from "./canvas.js";
import { GEO, MODES, clamp, dist, lerp } from "./config.js";
import { drawFootball } from "./draw.js";
import { tutEvent } from "./learn.js";
import { aim, aimType, tSnap, toggleThrowType } from "./loop.js";
import { posAt } from "./paths.js";
import { holderAt, passerIdAt, passerPos, pickChaser } from "./rep.js";
import { SFX } from "./sound.js";
import { els, state } from "./state.js";

/* ============================================================
   THROWING — pullback meter with bullet / lob
============================================================ */
function ptField(e){
  const r=els.field.getBoundingClientRect();
  const px=e.clientX-r.left, py=e.clientY-r.top;
  return {x:px/VIEW.ppy, y:VIEW.yHi-py/VIEW.ppy, px, py};
}
const THROW_GAIN=2.3, MAX_THROW=35, MIN_PULL=0.8;
// Lob ≈ 19 yd/s with a little hang time; bullet ≈ 28 yd/s.
function flightTime(type,d){ return type==="lob" ? 0.3+d/19 : 0.1+d/28; }
// Slingshot: ball goes opposite the drag; longer drag = longer throw.
function aimLanding(from,type){
  const px=aim.start.x-aim.cur.x, py=aim.start.y-aim.cur.y;
  const len=Math.hypot(px,py);
  const valid=len>=MIN_PULL;
  const d=Math.min(MAX_THROW,len*THROW_GAIN), ux=len?px/len:0, uy=len?py/len:1;
  const x=clamp(from.x+ux*d,0.5,GEO.W-0.5), y=clamp(from.y+uy*d,GEO.yMin+0.5,GEO.yMax-0.5);
  const dd=Math.hypot(x-from.x,y-from.y);
  return {x,y,dist:dd,power:d/MAX_THROW,flight:flightTime(type,dd),valid};
}

/* ---- JOYSTICK: left thumb scrambles, right thumb throws. WASD / arrow keys on a computer. ---- */
const joy={pointerId:null, cx:0, cy:0, R:46, keys:{}};
function joyVisible(on){
  els.joy.classList.toggle("hidden",!on);
  els.joy.classList.toggle("right", state.stickSide==="right");
  if(!on) joyRelease();
}
function joySet(jx,jy){
  const rep=state.rep; if(!rep || state.phase!=="decision") return;
  if(!rep.scr) rep.scr={active:false,id:null,jx:0,jy:0};
  rep.scr.jx=jx; rep.scr.jy=jy; rep.scr.active = Math.hypot(jx,jy)>0;
  els.joyKnob.style.transform="translate("+(jx*joy.R)+"px,"+(-jy*joy.R)+"px)";
  if(rep.scr.active){ els.aimHint.classList.add("hidden"); tutEvent("scramble"); }
}
function joyRelease(){ joy.pointerId=null; els.joy.classList.remove("on"); const rep=state.rep; if(rep && rep.scr){ rep.scr.jx=0; rep.scr.jy=0; rep.scr.active=false; } els.joyKnob.style.transform=""; }
function joyMove(e){
  let dx=e.clientX-joy.cx, dy=e.clientY-joy.cy; const d=Math.hypot(dx,dy);
  if(d>joy.R){ dx*=joy.R/d; dy*=joy.R/d; }
  joySet(dx/joy.R,-dy/joy.R);
}

const JOY_KEYS={ArrowUp:[0,1],KeyW:[0,1],ArrowDown:[0,-1],KeyS:[0,-1],ArrowLeft:[-1,0],KeyA:[-1,0],ArrowRight:[1,0],KeyD:[1,0]};
function joyKeys(){
  let x=0,y=0; for(const k in joy.keys){ if(joy.keys[k]){ x+=JOY_KEYS[k][0]; y+=JOY_KEYS[k][1]; } }
  const m=Math.hypot(x,y)||1; joySet(x/m, y/m);
}

/* ---- TAP TO THROW: tap a receiver = bullet, hold him = lob ---- */
const TAP_HOLD_MS=280;
let tapHold=null;
function clearTapHold(){ tapHold=null; }
function tapThrow(type){
  const h=tapHold; tapHold=null;
  const rep=state.rep; if(!h || !rep || state.phase!=="decision" || rep.ball) return;
  const tt=(performance.now()-tSnap)/1000;
  if(!holderAt(rep,tt)) return;
  const from=passerPos(rep,tt); let L=posAt(h.target,tt);
  for(let i=0;i<5;i++) L=posAt(h.target,tt+flightTime(type,dist(from,L)));   // lead him to where he'll be
  L={x:clamp(L.x,0.5,GEO.W-0.5), y:clamp(L.y,GEO.yMin+0.5,GEO.yMax-0.5)};
  releaseBall(rep,tt,from,L,type);
}
// called every frame: a hold that lasts long enough becomes a lob
function checkTapHold(){ if(tapHold && performance.now()-tapHold.t0>=TAP_HOLD_MS) tapThrow("lob"); }
function endTap(e,cancel){
  if(!tapHold || e.pointerId!==tapHold.pointerId) return false;
  if(cancel) tapHold=null; else tapThrow("bullet");
  return true;
}
function drawTapHold(){
  if(!tapHold || !tapHold.target._px) return;
  const k=clamp((performance.now()-tapHold.t0)/TAP_HOLD_MS,0,1), s=tapHold.target._px, r=VIEW.PR*1.9;
  ctx.beginPath(); ctx.arc(s.x,s.y,r,0,Math.PI*2); ctx.strokeStyle="rgba(0,0,0,0.45)"; ctx.lineWidth=5; ctx.stroke();
  ctx.beginPath(); ctx.arc(s.x,s.y,r,-Math.PI/2,-Math.PI/2+k*Math.PI*2); ctx.strokeStyle="#ffffff"; ctx.lineWidth=4; ctx.stroke();
  ctx.font="16px 'Jersey 10', sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
  const lab=k<1?"HOLD = LOB":"LOB"; const tw=ctx.measureText(lab).width+12;
  ctx.fillStyle="rgba(13,17,23,0.85)"; ctx.fillRect(s.x-tw/2,s.y-r-24,tw,18);
  ctx.fillStyle="#ffffff"; ctx.fillText(lab,s.x,s.y-r-15);
}
function endAim(e,cancel){
  if(!aim.active || e.pointerId!==aim.pointerId) return;
  aim.cur=ptField(e); aim.active=false;
  const rep=state.rep; if(rep) rep.eyesRaw=null;
  if(state.phase!=="decision"||rep.ball) return;
  const t=(performance.now()-tSnap)/1000;
  if(!holderAt(rep,t)){ els.aimHint.firstElementChild.textContent="Wait until the ball is in your hands"; els.aimHint.classList.remove("hidden"); return; }
  const from=passerPos(rep,t);
  const type=aimType();
  const L=aimLanding(from,type);
  if(cancel||!L.valid){ els.aimHint.classList.remove("hidden"); return; }
  releaseBall(rep,t,from,{x:L.x,y:L.y},type);
}
function releaseBall(rep,t,from,to,type){
  const d=dist(from,to), fl=flightTime(type,d);
  rep.ball={tRel:t, from:{x:from.x,y:from.y}, to, flight:fl, tLand:t+fl, dist:d, type, thrower:passerIdAt(rep,t),
    react: type==="lob"?0.2:0.12};
  rep.ball.chaser=pickChaser(rep,to,fl);
  SFX.throwIt(type==="lob");
}

function arcCtrl(a,b,type){
  const d=Math.hypot(a.x-b.x,a.y-b.y);
  const hgt = type==="lob" ? Math.min(90,20+d*0.3) : Math.min(14,3+d*0.04);
  return {x:(a.x+b.x)/2, y:(a.y+b.y)/2-hgt};
}
function bez(p0,c,p1,f){ const u=1-f; return {x:u*u*p0.x+2*u*f*c.x+f*f*p1.x, y:u*u*p0.y+2*u*f*c.y+f*f*p1.y}; }
function drawRing(pt,alpha,color,r){
  const rx=r*VIEW.ppy, ry=r*VIEW.ppy;
  ctx.beginPath(); ctx.ellipse(pt.x,pt.y,rx,ry,0,0,Math.PI*2);
  ctx.strokeStyle=color; ctx.globalAlpha=alpha; ctx.lineWidth=2; ctx.stroke();
  ctx.globalAlpha=alpha*0.25; ctx.fillStyle=color; ctx.fill(); ctx.globalAlpha=1;
  return {rx,ry};
}
function drawThrowOverlay(t){
  const rep=state.rep;
  if(aim.active && !rep.ball){
    const sp=toPx(aim.start.x,aim.start.y), cp=toPx(aim.cur.x,aim.cur.y);
    const from=passerPos(rep,t), type=aimType(), L=aimLanding(from,type);
    const lob=type==="lob";
    // pull band + thumb
    ctx.strokeStyle="rgba(245,243,236,0.35)"; ctx.lineWidth=2; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(sp.x,sp.y); ctx.lineTo(cp.x,cp.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(cp.x,cp.y,10,0,Math.PI*2); ctx.fillStyle="rgba(245,243,236,0.55)"; ctx.fill();
    // ring at the passer
    const a=toPx(from.x,from.y);
    ctx.beginPath(); ctx.arc(a.x,a.y,VIEW.PR+6,0,Math.PI*2); ctx.strokeStyle="rgba(255,255,255,0.8)"; ctx.lineWidth=2; ctx.stroke();
    if(L.valid){
      const e=toPx(L.x,L.y), c=arcCtrl(a,e,type);
      const len=Math.hypot(e.x-a.x,e.y-a.y);
      const gap = lob ? 17 : 12, n=Math.max(3,Math.floor(len/gap));
      // shadow dots on the ground
      ctx.fillStyle="rgba(0,0,0,0.35)";
      for(let i=1;i<n;i++){ const f=i/n; ctx.beginPath(); ctx.arc(lerp(a.x,e.x,f),lerp(a.y,e.y,f),1.8,0,Math.PI*2); ctx.fill(); }
      // ball-in-the-air dots (hollow for a lob, solid for a bullet)
      for(let i=1;i<n;i++){
        const f=i/n, q=bez(a,c,e,f), r=lob ? 3.2+1.6*Math.sin(Math.PI*f) : 2.6;
        ctx.beginPath(); ctx.arc(q.x,q.y,r,0,Math.PI*2);
        if(lob){ ctx.fillStyle="rgba(20,20,20,0.35)"; ctx.fill(); ctx.strokeStyle="#ffffff"; ctx.lineWidth=1.8; ctx.stroke(); }
        else { ctx.fillStyle="#ffd166"; ctx.fill(); ctx.strokeStyle="rgba(0,0,0,0.45)"; ctx.lineWidth=1; ctx.stroke(); }
      }
      const r=drawRing(e,0.9,lob?"#ffffff":"#ffd166",lob?2.2:1.6);
      // type badge (pops briefly when switched)
      const pop = aim.flash ? clamp(1-(performance.now()-aim.flash)/250,0,1) : 0;
      const label=(lob?"LOB":"BULLET")+"  "+Math.round(L.dist)+" yd · "+L.flight.toFixed(1)+"s";
      ctx.font="700 "+Math.round(12+pop*4)+"px 'Jersey 10', sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
      const tw=ctx.measureText(label).width+14, ty=e.y-r.ry-14;
      ctx.fillStyle=lob?"rgba(21,33,25,0.85)":"rgba(90,60,0,0.9)"; ctx.fillRect(e.x-tw/2,ty-10,tw,20);
      ctx.fillStyle=lob?"#ffffff":"#ffd166"; ctx.fillText(label,e.x,ty+1);
      // power meter
      const col = L.power<0.5?"#5fb87a":(L.power<0.8?"#e8b84e":"#e2542b");
      const mx=10,my=ch*0.26,mw=12,mh=ch*0.46;
      ctx.fillStyle="rgba(0,0,0,0.4)"; ctx.fillRect(mx,my,mw,mh);
      ctx.fillStyle=col; ctx.fillRect(mx,my+mh*(1-L.power),mw,mh*L.power);
      ctx.strokeStyle="rgba(245,243,236,0.6)"; ctx.lineWidth=1; ctx.strokeRect(mx,my,mw,mh);
      ctx.fillStyle="#f5f3ec"; ctx.font="12px 'Jersey 10', sans-serif"; ctx.textAlign="left";
      ctx.fillText("POWER",mx-2,my-8);
    }
    // how-to strip at the bottom of the field
    const hint = lob ? "LOB  ·  tap with another finger for BULLET" : "BULLET  ·  tap again for LOB";
    if(!state.tut){
    ctx.font="600 12px 'Pixelify Sans', sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
    const hw=ctx.measureText(hint).width+24, hy= els.joy.classList.contains("hidden") ? ch-22 : 26;
    ctx.fillStyle="rgba(21,33,25,0.85)"; ctx.fillRect(cw/2-hw/2,hy-13,hw,26);
    ctx.fillStyle=lob?"#ffffff":"#ffd166"; ctx.fillText(hint,cw/2,hy+1);
    }
  }
  if(rep.ball && !rep.carrier && !rep.ballGone){
    const b=rep.ball, a=toPx(b.from.x,b.from.y), e=toPx(b.to.x,b.to.y), c=arcCtrl(a,e,b.type);
    drawRing(e,0.55,"#ffffff",b.type==="lob"?2.2:1.6);
    const f=clamp((t-b.tRel)/b.flight,0,1), pos=bez(a,c,e,f);
    ctx.beginPath(); ctx.ellipse(lerp(a.x,e.x,f),lerp(a.y,e.y,f),5,3,0,0,Math.PI*2); ctx.fillStyle="rgba(0,0,0,0.3)"; ctx.fill();
    const s = b.type==="lob" ? 1+0.6*Math.sin(Math.PI*f) : 1;
    drawFootball(pos.x,pos.y,s,Math.atan2(e.y-a.y,e.x-a.x));
  }
}

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  els.field.addEventListener("pointerdown",(e)=>{
    const rep=state.rep;
    if(state.phase!=="decision"||!MODES[state.mode].throws||rep.ball) return;
    e.preventDefault();
    // a second finger while aiming switches lob <-> bullet
    if(aim.active && e.pointerId!==aim.pointerId){ toggleThrowType(); return; }
    const pt=ptField(e);
    if(state.throwMode==="tap"){
      let hit=null, hd=999;
      rep.targets.forEach(p=>{ if(!p._px) return; const dd=Math.hypot(p._px.x-pt.px,p._px.y-pt.py); if(dd<32&&dd<hd){hd=dd;hit=p;} });
      const tt=(performance.now()-tSnap)/1000;
      if(hit && holderAt(rep,tt) && !tapHold){
        // quick tap = bullet (thrown when you lift), hold = lob (thrown as soon as the hold registers)
        tapHold={target:hit, pointerId:e.pointerId, t0:performance.now()};
        els.aimHint.classList.add("hidden");
        try{ els.field.setPointerCapture(e.pointerId); }catch(_){}
      }
    } else {
      aim.active=true; aim.start=pt; aim.cur=pt; aim.lob=true; aim.pointerId=e.pointerId; aim.flash=0;
      tutEvent("aim");
      els.aimHint.classList.add("hidden");
      try{ els.field.setPointerCapture(e.pointerId); }catch(_){}
    }
  });
  els.field.addEventListener("pointermove",(e)=>{
    const rep=state.rep;
    if(!aim.active || e.pointerId!==aim.pointerId) return;
    aim.cur=ptField(e);
    // QB eyes: where you're aiming drags nearby zone defenders toward it
    if(rep && !rep.ball){ const tq=(performance.now()-tSnap)/1000, L=aimLanding(passerPos(rep,tq),aimType()); rep.eyesRaw = L.valid ? {x:L.x,y:L.y} : null; }
  });
  els.joy.addEventListener("pointerdown",(e)=>{
    e.preventDefault(); e.stopPropagation();
    if(joy.pointerId!==null) return;
    const r=els.joyBase.getBoundingClientRect(); joy.cx=r.left+r.width/2; joy.cy=r.top+r.height/2; joy.R=r.width*0.42;
    joy.pointerId=e.pointerId; els.joy.classList.add("on");
    try{ els.joy.setPointerCapture(e.pointerId); }catch(_){}
    joyMove(e);
  });
  els.joy.addEventListener("pointermove",(e)=>{ if(e.pointerId===joy.pointerId){ e.preventDefault(); joyMove(e); } });
  ["pointerup","pointercancel","lostpointercapture"].forEach(ev=>els.joy.addEventListener(ev,(e)=>{ if(e.pointerId===joy.pointerId) joyRelease(); }));
  window.addEventListener("keydown",(e)=>{ if(JOY_KEYS[e.code] && state.phase==="decision" && !els.joy.classList.contains("hidden")){ e.preventDefault(); joy.keys[e.code]=true; joyKeys(); } });
  window.addEventListener("keyup",(e)=>{ if(JOY_KEYS[e.code]){ joy.keys[e.code]=false; if(state.phase==="decision") joyKeys(); } });
  els.field.addEventListener("contextmenu",(e)=>{ e.preventDefault(); toggleThrowType(); });
  window.addEventListener("keydown",(e)=>{ if(e.code==="Space" && aim.active){ e.preventDefault(); toggleThrowType(); } });
  els.field.addEventListener("pointerup",(e)=>{ if(!endTap(e,false)) endAim(e,false); });
  els.field.addEventListener("pointercancel",(e)=>{ if(!endTap(e,true)) endAim(e,true); });
}

export { ptField, THROW_GAIN, MAX_THROW, MIN_PULL, flightTime, aimLanding, joy, joyVisible, joySet, joyRelease, joyMove, JOY_KEYS, joyKeys, TAP_HOLD_MS, tapHold, clearTapHold, tapThrow, checkTapHold, endTap, drawTapHold, endAim, releaseBall, arcCtrl, bez, drawRing, drawThrowOverlay };
