import { VIEW, ch, ctx, cw, toPx } from "./canvas.js";
import { GEO, clamp } from "./config.js";
import { isDrive } from "./drive.js";
import { state } from "./state.js";

/* ============================================================
   DRAWING
============================================================ */
// speckled grass texture (Retro Bowl-ish), made once
let turfPattern=null;
function getTurfPattern(){
  if(turfPattern) return turfPattern;
  if(typeof document==="undefined" || !document.createElement) return null;
  const c=document.createElement("canvas"); c.width=48; c.height=48;
  const g=c.getContext && c.getContext("2d"); if(!g || !g.createPattern) return null;
  g.fillStyle="#4f9c45"; g.fillRect(0,0,48,48);
  let seed=7; const rnd=()=>{ seed=(seed*16807)%2147483647; return seed/2147483647; };
  for(let i=0;i<60;i++){ g.fillStyle= rnd()<0.5 ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.10)"; g.fillRect(Math.floor(rnd()*48),Math.floor(rnd()*48),2,2); }
  turfPattern=ctx.createPattern(c,"repeat");
  return turfPattern;
}
function drawField(){
  ctx.clearRect(0,0,cw,ch);
  ctx.fillStyle=getTurfPattern()||"#4f9c45"; ctx.fillRect(0,0,cw,ch);
  const W=GEO.W, lo=VIEW.yHi-ch/VIEW.ppy, hi=VIEW.yHi;
  const hline=(y,style,w,dash)=>{ const p=toPx(0,y); ctx.strokeStyle=style; ctx.lineWidth=w; ctx.setLineDash(dash||[]); ctx.beginPath(); ctx.moveTo(0,p.y); ctx.lineTo(cw,p.y); ctx.stroke(); ctx.setLineDash([]); };
  const band=(y0,y1,fill)=>{ const a=toPx(0,y1), b=toPx(0,y0); ctx.fillStyle=fill; ctx.fillRect(0,a.y,cw,b.y-a.y); };
  ctx.textBaseline="middle";
  const d=state.drive;
  if(d && isDrive()){
    // absolute field: own goal line at rel -ballOn, opponent goal line at rel len-ballOn
    const own=-d.ballOn, opp=d.len-d.ballOn;
    band(own-60,own-10,"#0d1117"); band(opp+10,opp+60,"#0d1117");         // outside the end lines
    band(own-10,own,"rgba(20,60,120,0.45)"); band(opp,opp+10,"rgba(20,60,120,0.45)");   // end zones
    for(let y=0;y<d.len;y+=10) if(((y/10)|0)%2===0) band(own+y,own+Math.min(y+5,d.len),"rgba(0,0,0,0.08)");
    ctx.font="700 "+Math.round(clamp(VIEW.ppy*1.1,10,16))+"px 'Jersey 10', sans-serif"; ctx.textAlign="center";
    ctx.fillStyle="rgba(244,240,226,0.5)";
    const ez=(y)=>{ const p=toPx(W/2,y); if(p.y>-20&&p.y<ch+20) ctx.fillText("END ZONE",p.x,p.y); };
    ez(own-5); ez(opp+5);
    for(let y=5;y<d.len;y+=5){
      const ry=own+y; if(ry<lo-1||ry>hi+1) continue;
      const mid=Math.abs(y-d.len/2)<0.01;
      hline(ry, mid?"rgba(245,243,236,0.5)":"rgba(245,243,236,0.25)", mid?2:1);
      if(y%10===0||mid){
        const lab = mid ? "MID" : String(Math.min(y,d.len-y));
        ctx.fillStyle="rgba(245,243,236,0.4)"; ctx.font="15px 'Jersey 10', sans-serif"; ctx.textAlign="left";
        ctx.fillText(lab,5,toPx(0,ry).y-7); ctx.textAlign="right"; ctx.fillText(lab,cw-5,toPx(0,ry).y-7);
      }
    }
    hline(own,"rgba(245,243,236,0.85)",3); hline(opp,"rgba(245,243,236,0.85)",3);
    hline(own-10,"rgba(245,243,236,0.5)",2); hline(opp+10,"rgba(245,243,236,0.5)",2);
    if(d.toGain<d.len) hline(d.toGain-d.ballOn,"#f2c14e",2.5);            // line to gain
  } else {
    for(let y=-10;y<hi;y+=10) band(y,y+5,"rgba(0,0,0,0.08)");
    ctx.fillStyle="rgba(245,243,236,0.35)"; ctx.font="500 10px 'Pixelify Sans', sans-serif"; ctx.textAlign="left";
    for(let y=5;y<=hi;y+=5){ hline(y,"rgba(245,243,236,0.28)",1); ctx.fillText(String(y),4,toPx(0,y).y-8); }
  }
  hline(7,"rgba(226,84,43,0.35)",1,[3,6]);                                   // rush line
  hline(0,"rgba(120,190,255,0.8)",2);                                        // line of scrimmage
  ctx.strokeStyle="rgba(245,243,236,0.45)"; ctx.lineWidth=2;
  [0.15,W-0.15].forEach(x=>{ const p=toPx(x,0); ctx.beginPath(); ctx.moveTo(p.x,0); ctx.lineTo(p.x,ch); ctx.stroke(); });
}
function hexA(hex,a){ const n=parseInt(hex.slice(1),16); return "rgba("+(n>>16)+","+((n>>8)&255)+","+(n&255)+","+a+")"; }
function drawRoutes(fade){
  const rep=state.rep;
  rep.players.forEach(p=>{
    const pts=p.path.pts; if(pts.length<2 || p.drop) return;
    ctx.strokeStyle=hexA(p.color, fade?0.2:0.9); ctx.lineWidth=2.2;
    ctx.setLineDash(p.dashed?[4,4]:[]);
    ctx.beginPath();
    pts.forEach((q,i)=>{ const s=toPx(q[0],q[1]); if(i===0) ctx.moveTo(s.x,s.y); else ctx.lineTo(s.x,s.y); });
    ctx.stroke(); ctx.setLineDash([]);
    const a=toPx(pts[pts.length-2][0],pts[pts.length-2][1]), b=toPx(pts[pts.length-1][0],pts[pts.length-1][1]);
    const ang=Math.atan2(b.y-a.y,b.x-a.x);
    ctx.fillStyle=ctx.strokeStyle;
    if(p.path.after==="run"){
      ctx.beginPath(); ctx.moveTo(b.x+Math.cos(ang)*6,b.y+Math.sin(ang)*6);
      ctx.lineTo(b.x+Math.cos(ang+2.5)*7,b.y+Math.sin(ang+2.5)*7);
      ctx.lineTo(b.x+Math.cos(ang-2.5)*7,b.y+Math.sin(ang-2.5)*7); ctx.fill();
    } else if(p.path.after==="sit"){
      ctx.beginPath(); ctx.moveTo(b.x+Math.cos(ang+Math.PI/2)*6,b.y+Math.sin(ang+Math.PI/2)*6);
      ctx.lineTo(b.x-Math.cos(ang+Math.PI/2)*6,b.y-Math.sin(ang+Math.PI/2)*6); ctx.stroke();
    } else { ctx.beginPath(); ctx.arc(b.x,b.y,3,0,Math.PI*2); ctx.fill(); }
  });
}
function drawFootball(x,y,s,rot){
  ctx.beginPath(); ctx.ellipse(x,y,7*s,4.5*s,rot||0,0,Math.PI*2);
  ctx.fillStyle="#8b5a2b"; ctx.fill(); ctx.strokeStyle="#f5f3ec"; ctx.lineWidth=1; ctx.stroke();
}

export function init(){}

export { turfPattern, getTurfPattern, drawField, hexA, drawRoutes, drawFootball };
