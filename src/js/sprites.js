import { VIEW, ctx, toPx } from "./canvas.js";
import { drawField, drawFootball, drawRoutes } from "./draw.js";
import { drawFx } from "./fx.js";
import { drawTapHold, drawThrowOverlay } from "./input.js";
import { ballAirPos, holderAt, livePos, passerIdAt, playerById } from "./rep.js";
import { state } from "./state.js";

/* ============================================================
   PIXEL PLAYERS — Retro Bowl-ish sprites with flag belts
============================================================ */
const SKIN=["#f1c27d","#c68642","#8d5524","#e0ac69","#a8754a"];
function darken(hex,f){ const n=parseInt(hex.slice(1),16); const r=(n>>16)&255,g=(n>>8)&255,b=n&255; const c=v=>Math.max(0,Math.min(255,Math.round(v*f))); return "rgb("+c(r)+","+c(g)+","+c(b)+")"; }
function drawSprite(x,y,o){
  const u=Math.max(2,Math.round(VIEW.PR/3.6));
  x=Math.round(x); y=Math.round(y);
  const W=6*u, top=y-6*u;               // head top; feet end at y+5u
  const R=(px,py,w,h,c)=>{ ctx.fillStyle=c; ctx.fillRect(px,py,w,h); };
  const OL=(px,py,w,h)=>R(px-1,py-1,w+2,h+2,"#000");
  // shadow
  ctx.beginPath(); ctx.ellipse(x,y+5*u,4*u,1.3*u,0,0,Math.PI*2); ctx.fillStyle="rgba(0,0,0,0.32)"; ctx.fill();
  if(o.ring){ ctx.beginPath(); ctx.ellipse(x,y+5*u,5.2*u,1.9*u,0,0,Math.PI*2); ctx.strokeStyle=o.ring; ctx.lineWidth=2; ctx.stroke(); }
  // legs (two-frame run cycle)
  const st=o.step||0, l1=st?1:0, l2=st?0:1;
  OL(x-2*u,y+2*u,u,(2+l1)*u); OL(x+u,y+2*u,u,(2+l2)*u);
  R(x-2*u,y+2*u,u,(2+l1)*u,o.skin); R(x+u,y+2*u,u,(2+l2)*u,o.skin);
  // body outline, then jersey / shorts / head
  OL(x-W/2,y-3*u,W,5*u); OL(x-1.5*u,top,3*u,3*u);
  R(x-W/2,y-3*u,W,4*u,o.jersey);
  R(x-W/2,y-3*u,W,u,darken(o.jersey,1.18));   // shoulder highlight
  R(x-W/2,y+u,W,u,o.shorts);                  // shorts / belt line
  R(x-1.5*u,top,3*u,3*u,o.skin);
  R(x-1.5*u,top,3*u,u,o.hair);                // hair / headband
  // arms
  OL(x-W/2-u,y-2*u,u,3*u); OL(x+W/2,y-2*u,u,3*u);
  R(x-W/2-u,y-2*u,u,3*u,o.skin); R(x+W/2,y-2*u,u,3*u,o.skin);
  // flag belt: a flag on each hip
  if(o.flags){
    const fc=o.flagColor;
    if(o.flags.left!==false){ OL(x-W/2-u,y+u,u,3*u); R(x-W/2-u,y+u,u,3*u,fc); }
    if(o.flags.right!==false){ OL(x+W/2,y+u,u,3*u); R(x+W/2,y+u,u,3*u,fc); }
  }
  if(o.label){
    ctx.fillStyle=o.labelColor||"#ffffff"; ctx.font=Math.max(10,Math.round(4.2*u))+"px 'Jersey 10', sans-serif";
    ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(o.label,x,y-1*u+1);
  }
  return {headY:top, u};
}
function runStep(p){
  // alternate legs every ~0.9 yd of travel
  const h=p.hist; if(!h||h.length<2) return 0;
  let d=0; for(let i=1;i<h.length;i++) d+=Math.hypot(h[i].x-h[i-1].x,h[i].y-h[i-1].y);
  return Math.floor(d/(p.stride||0.9))%2;
}
function trackStep(o){
  // defenders: accumulate distance on the object itself
  const last=o._lp; o._lp={x:o.x,y:o.y};
  if(last) o._odo=(o._odo||0)+Math.hypot(o.x-last.x,o.y-last.y);
  return Math.floor((o._odo||0)/0.9)%2;
}

function drawPlayers(t){
  const rep=state.rep, tt=t===null?0:t;
  const holder = rep.carrier ? rep.carrier.id : rep.ball ? null : (t===null ? (playerById(rep,"C")?"C":passerIdAt(rep,0)) : holderAt(rep,tt));
  rep.players.forEach(p=>{
    const q=t===null?{x:p.x0,y:p.y0}:livePos(p), s=toPx(q.x,q.y);
    const sk=SKIN[(p.id.charCodeAt(0)*7)%SKIN.length];
    drawSprite(s.x,s.y,{jersey:p.color,shorts:"#f4f0e2",skin:sk,hair:"#1b1b1b",label:p.id,labelColor:"#0d1117",
      flags:{left:!(p.flagGone==="left"),right:!(p.flagGone==="right")},flagColor:"#ffc933",step:t===null?0:runStep(p),
      ring:p.target?null:"rgba(255,255,255,0.75)"});
    p._px=s;
    if(p.id===holder) drawFootball(s.x+VIEW.PR*0.95,s.y-VIEW.PR*0.2,0.7,-0.5);
  });
  if(t!==null && !rep.ball){ const ap=ballAirPos(rep,tt); if(ap){ const s=toPx(ap.x,ap.y); drawFootball(s.x,s.y,0.8,-Math.PI/2); } }
  if(state.showProgression && t===null){
    rep.play.prog.slice(0,3).forEach((id,order)=>{
      const p=playerById(rep,id), s=toPx(p.x0,p.y0);
      ctx.beginPath(); ctx.arc(s.x, s.y-20, 8, 0, Math.PI*2);
      ctx.fillStyle="#f5f3ec"; ctx.fill();
      ctx.fillStyle="#152119"; ctx.font="14px 'Jersey 10', sans-serif";
      ctx.fillText(String(order+1), s.x, s.y-19);
    });
  }
  // defenders: triangles pointing at the offense
  rep.defenders.forEach(d=>{
    const s=toPx(d.pos.x,d.pos.y);
    drawSprite(s.x,s.y,{jersey:"#e8412c",shorts:"#0d1117",skin:SKIN[(rep.defenders.indexOf(d)*3+1)%SKIN.length],hair:"#2b1a10",
      flags:{left:true,right:true},flagColor:"#5ab8ff",step:t===null?0:trackStep(d.pos),label:"",
      holding:d.hasFlag});
  });
  const rs=toPx(rep.rusher.x,rep.rusher.y);
  if(!rep.rusher.dropped){
  drawSprite(rs.x,rs.y,{jersey:"#9e1b12",shorts:"#0d1117",skin:SKIN[2],hair:"#ffc933",label:"R",labelColor:"#ffc933",
    flags:{left:true,right:true},flagColor:"#5ab8ff",step:t===null?0:trackStep(rep.rusher),ring:"rgba(255,201,51,0.85)"});
  }
}
function drawStatic(){ drawField(); drawRoutes(false); drawPlayers(null); }
function drawFrame(t){ drawField(); drawRoutes(true); drawPlayers(t); drawThrowOverlay(t); drawTapHold(); drawFx(); }

export function init(){}

export { SKIN, darken, drawSprite, runStep, trackStep, drawPlayers, drawStatic, drawFrame };
