import { VIEW, ctx, toPx } from "./canvas.js";
import { clamp, lerp } from "./config.js";
import { drawFootball } from "./draw.js";
import { lastFrameT } from "./loop.js";
import { drawFrame } from "./sprites.js";
import { els } from "./state.js";

/* ============================================================
   FX — little moments on the field (flag pulls, catches, bounces)
   Positions are in field yards, so they follow the camera.
============================================================ */
let fxList=[];
function addFx(o){ o.t0=performance.now(); fxList.push(o); return o; }
function fxRemaining(){ const now=performance.now(); return fxList.reduce((m,f)=>Math.max(m,f.dur-(now-f.t0)),0); }
function drawFlagShape(x,y,ang,sz,col){
  ctx.save(); ctx.translate(x,y); ctx.rotate(ang);
  ctx.fillStyle="#000"; ctx.fillRect(-sz*0.35-1,-sz-1,sz*0.7+2,sz*2+2);
  ctx.fillStyle=col; ctx.fillRect(-sz*0.35,-sz,sz*0.7,sz*2);
  ctx.restore();
}
function popText(x,y,text,k,col){
  const sc=k<0.15? 0.6+k/0.15*0.5 : 1.1-Math.min(0.1,(k-0.15));
  ctx.save(); ctx.globalAlpha=k>0.75?Math.max(0,(1-k)/0.25):1;
  ctx.font=Math.round(20*sc)+"px 'Jersey 10', sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.lineWidth=4; ctx.strokeStyle="#000"; ctx.strokeText(text,x,y-k*14); ctx.fillStyle=col||"#ffc933"; ctx.fillText(text,x,y-k*14);
  ctx.restore();
}
function drawFx(){
  const now=performance.now();
  fxList=fxList.filter(f=>now-f.t0<f.dur);
  fxList.forEach(f=>{
    const k=clamp((now-f.t0)/f.dur,0,1);
    if(f.kind==="flag"){
      // the flag rips off the carrier's belt and flies into the defender's hand
      const a=toPx(f.from.x,f.from.y), b=toPx(f.to.x,f.to.y), m=Math.min(1,k/0.45);
      const x=lerp(a.x,b.x,m), y=lerp(a.y,b.y,m)-Math.sin(Math.PI*m)*16;
      if(k<0.45) drawFlagShape(x,y,k*18,VIEW.PR*0.45,"#ffc933");
      else { drawFlagShape(b.x+VIEW.PR*0.7,b.y-VIEW.PR*0.9-Math.sin((k-0.45)*24)*2,0.4+Math.sin((k-0.45)*20)*0.5,VIEW.PR*0.45,"#ffc933"); }
      if(k>0.3) popText(b.x,b.y-VIEW.PR*2.2,f.text||"FLAG!",(k-0.3)/0.7,"#ffc933");
    } else if(f.kind==="burst"){
      const p=toPx(f.at.x,f.at.y), r=VIEW.PR*(0.8+k*1.8);
      ctx.save(); ctx.globalAlpha=1-k; ctx.strokeStyle=f.col||"#ffffff"; ctx.lineWidth=3;
      for(let i=0;i<8;i++){ const an=i*Math.PI/4+0.3; ctx.beginPath(); ctx.moveTo(p.x+Math.cos(an)*r*0.55,p.y+Math.sin(an)*r*0.55); ctx.lineTo(p.x+Math.cos(an)*r,p.y+Math.sin(an)*r); ctx.stroke(); }
      ctx.restore();
      if(f.text) popText(p.x,p.y-VIEW.PR*2,f.text,k,f.col);
    } else if(f.kind==="bounce"){
      // ball hits the turf and skips along the line it was thrown
      const p=toPx(f.at.x,f.at.y), dx=f.dir.x, dy=f.dir.y;
      const dd=(1-Math.pow(1-k,2))*f.roll*VIEW.ppy;
      const hops=Math.abs(Math.sin(k*Math.PI*3.2))*(1-k)*VIEW.PR*1.6;
      const x=p.x+dx*dd, y=p.y-dy*dd;
      ctx.beginPath(); ctx.ellipse(x,y+2,5,2.5,0,0,Math.PI*2); ctx.fillStyle="rgba(0,0,0,0.3)"; ctx.fill();
      drawFootball(x,y-hops,0.85,k*14);
      if(f.text && k<0.9) popText(p.x,p.y-VIEW.PR*2,f.text,k,f.col||"#ffffff");
    } else if(f.kind==="text"){
      const p=toPx(f.at.x,f.at.y); popText(p.x,p.y,f.text,k,f.col);
    } else if(f.kind==="dust"){
      const p=toPx(f.at.x,f.at.y);
      ctx.save(); ctx.globalAlpha=0.6*(1-k); ctx.fillStyle="#d9cfa8";
      for(let i=0;i<6;i++){ const an=i*1.05+0.4, r=VIEW.PR*(0.5+k*1.6); ctx.fillRect(Math.round(p.x+Math.cos(an)*r)-2,Math.round(p.y+Math.sin(an)*r*0.5)-2,4,4); }
      ctx.restore();
    }
  });
}
// After the whistle: let the animation finish, then the banner. Tap skips.
let afterTimer=null, afterSkip=null;
function clearFx(){ fxList=[]; }
function cancelAfterPlay(){ clearTimeout(afterTimer); if(afterSkip){ els.fieldWrap.removeEventListener("pointerdown",afterSkip); afterSkip=null; } }
function afterPlay(then){
  const ms=Math.min(900,fxRemaining());
  if(ms<=30){ then(); return; }
  let over=false;
  const finish=()=>{ if(over) return; over=true; clearTimeout(afterTimer); if(afterSkip){ els.fieldWrap.removeEventListener("pointerdown",afterSkip); afterSkip=null; } then(); };
  const draw=()=>{ if(over) return; drawFrame(lastFrameT); requestAnimationFrame(draw); };
  afterSkip=()=>finish(); els.fieldWrap.addEventListener("pointerdown",afterSkip);
  requestAnimationFrame(draw);
  afterTimer=setTimeout(finish,ms);
}

export function init(){}

export { fxList, addFx, fxRemaining, drawFlagShape, popText, drawFx, afterTimer, afterSkip, clearFx, cancelAfterPlay, afterPlay };
