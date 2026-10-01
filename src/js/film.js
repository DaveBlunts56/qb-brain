import { VIEW, ctx, toPx } from "./canvas.js";
import { COV_COACH, defAt } from "./coach.js";
import { GEO, MODES, dist, shuffle } from "./config.js";
import { nearestDefender, updateDefenders, updateRusher } from "./defense.js";
import { drawField, drawRoutes } from "./draw.js";
import { ptField } from "./input.js";
import { MAN_FAMILY, keyPlanText, sideOf } from "./keyread.js";
import { audibleShow } from "./playbook.js";
import { profileFilm } from "./profile.js";
import { buildRep, histPos, livePos, playerById, stepPlayers } from "./rep.js";
import { SFX } from "./sound.js";
import { SKIN, drawSprite, drawStatic } from "./sprites.js";
import { els, state } from "./state.js";
import { actualShell, coveragePool } from "./train.js";

/* ============================================================
   FILM ROOM — read the look, name the key, pick the first read, run it, then see what it really was.
   Flow: pre-snap questions (man/zone · coverage · key defender · first read) → snap & play →
         post-snap ID → PRE-SNAP LOOK → POST-SNAP COVERAGE with the clue that gave it away.
============================================================ */

const FILM={rep:null, step:0, ans:{}, best:null, await:null};
const familyOf=c=>MAN_FAMILY(c)?"Man":"Zone";

// what the play "should" look like against the coverage the defense is SHOWING
function predictInitialRead(rep){
  try{
    const ghost=buildRep({play:rep.play, keep:{disguised:false, disguiseKind:null, shownCoverage:rep.shownCoverage, actualCoverage:rep.shownCoverage, rushPlan:rep.rushPlan, rusher:{x:rep.rusher.x}, askCoverage:false}});
    const score={}; let t=0, n=0; const dt=1/30;
    while(t<1.8){ t+=dt; stepPlayers(ghost,t,dt); updateDefenders(ghost,t,dt); updateRusher(ghost,t,dt);
      if(t>=1.0){ n++; ghost.targets.forEach(p=>{ const q=livePos(p); score[p.id]=(score[p.id]||0)+nearestDefender(ghost,q).dist; }); } }
    const prog=rep.play.prog||[];
    const arr=Object.keys(score).map(id=>({id, sep:score[id]/Math.max(1,n), pri:prog.indexOf(id)<0?9:prog.indexOf(id)})).sort((a,b)=>b.sep-a.sep || a.pri-b.pri);
    return {best:arr[0], all:arr};
  }catch(_){ return null; }
}
function filmStart(){
  const rep=state.rep; FILM.rep=rep; FILM.step=0; FILM.ans={}; FILM.await=null;
  FILM.best=predictInitialRead(rep);
  els.studyBanner.classList.add("hidden"); els.playTag.classList.add("hidden");
  els.controls.classList.add("hidden"); audibleShow(false);
  els.filmSheet.classList.remove("hidden");
  filmAsk();
}
const FILM_STEPS=["mz","cov","key","read"];
function filmAsk(){
  const rep=FILM.rep; let step=FILM_STEPS[FILM.step];
  if(step==="key" && !rep.keyRead){ FILM.step++; step=FILM_STEPS[FILM.step]; }
  if(step==="read" && !FILM.best){ FILM.step++; step=FILM_STEPS[FILM.step]; }
  els.filmFb.textContent=""; els.filmFb.className="film-fb"; els.filmGo.classList.add("hidden");
  els.filmOpts.innerHTML=""; FILM.await=null;
  const opt=(label,on)=>{ const b=document.createElement("button"); b.type="button"; b.className="film-opt"; b.textContent=label; b.addEventListener("click",()=>on(b)); els.filmOpts.appendChild(b); return b; };
  const n=FILM_STEPS.indexOf(step)+1;
  if(!step){ filmReady(); return; }
  if(step==="mz"){
    els.filmQ.textContent="1 · MAN OR ZONE?"; els.filmSub.textContent="Look at the alignment: cushion, eyes, and who's deep.";
    ["Man","Zone"].forEach(k=>opt(k,()=>filmAnswer("mz",k,k===familyOf(rep.shownCoverage))));
  } else if(step==="cov"){
    els.filmQ.textContent="2 · LIKELY COVERAGE?"; els.filmSub.textContent="Count the deep defenders. The look can still change after the snap.";
    const must=[rep.shownCoverage], others=shuffle(coveragePool(rep.squad).filter(c=>c!==rep.shownCoverage));
    shuffle(must.concat(others).slice(0,4)).forEach(c=>opt(c,()=>filmAnswer("cov",c,c===rep.shownCoverage)));
  } else if(step==="key"){
    els.filmQ.textContent="3 · WHO'S YOUR KEY DEFENDER?"; els.filmSub.textContent="Tap the defender this play puts in a bind ("+rep.keyRead.A+" vs "+rep.keyRead.B+").";
    FILM.await="key"; filmDrawPre();
  } else if(step==="read"){
    els.filmQ.textContent="4 · BEST FIRST READ?"; els.filmSub.textContent="Against this look, which receiver do you expect to be your answer? Tap him.";
    FILM.await="read"; filmDrawPre();
  }
}
function filmAnswer(k,val,ok,extra){
  const rep=FILM.rep; FILM.ans[k]={val,ok};
  els.filmOpts.querySelectorAll && els.filmOpts.querySelectorAll("button").forEach(b=>{ b.disabled=true; if(b.textContent===val) b.classList.add(ok?"ok":"bad"); });
  const C=COV_COACH[rep.shownCoverage]||{};
  let fb="";
  if(k==="mz") fb = ok ? "✓ It looks like "+familyOf(rep.shownCoverage).toLowerCase()+"." : "✗ The alignment says "+familyOf(rep.shownCoverage).toLowerCase()+".";
  if(k==="cov") fb = (ok?"✓ ":"✗ It shows "+rep.shownCoverage+". ")+(C.tell||"");
  if(k==="key") fb = extra;
  if(k==="read") fb = extra;
  els.filmFb.textContent=fb; els.filmFb.className="film-fb "+(ok?"ok":"bad");
  FILM.await=null;
  els.filmGo.textContent = FILM.step>=FILM_STEPS.length-1 ? "GOT IT ▶" : "NEXT ▶";
  els.filmGo.classList.remove("hidden");
  SFX.click();
}

function filmReady(){
  els.filmSheet.classList.add("hidden");
  els.controls.classList.remove("hidden"); els.primaryBtn.classList.remove("hidden"); els.primaryBtn.textContent="SNAP";
  audibleShow(true);
  // show the plan on the field tag: the key and the first read you picked
  const rep=FILM.rep; let html='<b>'+rep.play.name+'</b> · Film Room';
  if(rep.keyRead) html+='<br><span style="color:#ff6b5a">'+keyPlanText(rep)+'</span>';
  els.playTag.innerHTML=html; els.playTag.classList.remove("hidden");
  drawStatic(); filmMarkKey(true);
}
function filmDrawPre(){ drawStatic(); }
function filmMarkKey(onlyKey){
  const rep=FILM.rep; if(!rep || !rep.keyRead) return;
  const s=toPx(rep.keyRead.key.pos.x,rep.keyRead.key.pos.y);
  ctx.beginPath(); ctx.arc(s.x,s.y,VIEW.PR*1.9,0,Math.PI*2); ctx.strokeStyle="#ff6b5a"; ctx.lineWidth=3; ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);
}
// taps on the field answer the key / first-read questions

/* ---------- after the play: post-snap ID, then the reveal ---------- */
function filmClue(rep){
  const pre=rep.shownCoverage+" ("+(rep.shellShown||"")+")", post=rep.actualCoverage+" ("+actualShell(rep)+")";
  const C=COV_COACH[rep.actualCoverage]||{};
  if(!rep.disguised) return {pre, post, same:true, clue:"No disguise — what you saw is what you got. "+(C.tell||"")};
  const role=(d,p0)=>{ const sd=sideOf(p0.x); return (p0.y>=8.5?"the "+(sd==="middle"?"":sd+" ")+"safety":Math.abs(p0.x-GEO.CX)>GEO.W*0.28?"the "+sd+" corner":"the "+(sd==="middle"?"middle":sd)+" underneath defender").replace("  "," "); };
  const moved=d=>{ const p0=d.pos0||(d.h&&d.h[0])||d.pos; for(let t=0.1;t<=1.6;t+=0.05){ if(dist(defAt(d,t),p0)>1.6) return +t.toFixed(1); } return null; };
  const defs=rep.defenders.filter(d=>!d.isRusher && d.h && d.h.length);
  let clue="";
  if(rep.disguiseKind==="bluff man → zone"){
    const d=defs.find(d=>d.role==="zone" && rep.targets.some(r=>dist(d.pos0||d.h[0],{x:r.x0,y:r.y0})<6)) || defs.find(d=>d.role==="zone");
    if(d){ const t=moved(d)||0.3; clue=role(d,d.pos0||d.h[0])+" was lined up on a receiver like man, but at "+t+"s he dropped to a spot and turned to face you. Eyes on the QB = zone."; }
  } else if(rep.disguiseKind==="bluff zone → man"){
    const d=defs.find(d=>d.role==="man" && (d.pos0||d.h[0]).y>=4);
    if(d){ const t=moved(d)||0.4; clue=role(d,d.pos0||d.h[0])+" looked like a zone defender, but at "+t+"s he turned and ran with "+d.assign.id+"'s route. Running with a receiver = man."; }
  } else {
    const down=defs.find(d=>(d.pos0||d.h[0]).y>=8.5 && !(d.role==="zone" && d.type==="deep"));
    const up=defs.find(d=>(d.pos0||d.h[0]).y<8.5 && d.role==="zone" && d.type==="deep");
    if(down){ const t=moved(down)||0.3; clue=role(down,down.pos0||down.h[0])+" rotated down at "+t+"s — "+(rep.shellShown||"the shell")+" became "+actualShell(rep)+"."; }
    else if(up){ const t=moved(up)||0.3; clue=role(up,up.pos0||up.h[0])+" bailed deep at "+t+"s — "+(rep.shellShown||"the shell")+" became "+actualShell(rep)+"."; }
  }
  if(!clue) clue="The defense moved after the snap. "+(C.tell||"");
  return {pre, post, same:false, clue, kind:rep.disguiseKind};
}
function filmResult(rep){
  if(!MODES[state.mode].film || !els.filmBox) return;
  els.filmBox.classList.remove("hidden"); els.coachCard.classList.add("hidden");
  els.filmBox.innerHTML="";
  const h=document.createElement("div"); h.className="film-q"; h.textContent="5 · POST-SNAP: WHAT DID THEY ACTUALLY PLAY?"; els.filmBox.appendChild(h);
  const row=document.createElement("div"); row.className="film-opts"; els.filmBox.appendChild(row);
  const opts=shuffle(Array.from(new Set([rep.actualCoverage,rep.shownCoverage].concat(shuffle(coveragePool(rep.squad))))).slice(0,4));
  opts.forEach(c=>{ const b=document.createElement("button"); b.type="button"; b.className="film-opt"; b.textContent=c;
    b.addEventListener("click",()=>{ FILM.ans.post={val:c, ok:c===rep.actualCoverage}; profileFilm(FILM.ans); filmReveal(rep); }); row.appendChild(b); });
}
function filmReveal(rep){
  const box=els.filmBox; box.innerHTML="";
  const cl=filmClue(rep);
  const flow=document.createElement("div"); flow.className="film-flow";
  flow.innerHTML='<div><small>PRE-SNAP LOOK</small><b></b></div><span>→</span><div><small>POST-SNAP</small><b></b></div>';
  flow.children[0].children[1].textContent=cl.pre; flow.children[2].children[1].textContent=cl.post;
  if(cl.same) flow.classList.add("same");
  box.appendChild(flow);
  if(cl.kind){ const k=document.createElement("div"); k.className="film-kind"; k.textContent=cl.kind.toUpperCase(); box.appendChild(k); }
  const c=document.createElement("p"); c.className="film-clue"; c.innerHTML="<b>THE CLUE:</b> "; c.appendChild(document.createTextNode(cl.clue)); box.appendChild(c);
  const sc=document.createElement("div"); sc.className="chip-row";
  [["mz","Man/zone"],["cov","Look"],["key","Key"],["read","1st read"],["post","Post-snap"]].forEach(([k,l])=>{ const a=FILM.ans[k]; if(!a) return;
    const s=document.createElement("span"); s.className="film-score "+(a.ok?"ok":"bad"); s.textContent=(a.ok?"✓ ":"✗ ")+l; sc.appendChild(s); });
  box.appendChild(sc);
  const vr=document.createElement("div"); vr.className="chip-row";
  [["PRE-SNAP",0],["POST-SNAP",1.0]].forEach(([l,t])=>{ const b=document.createElement("button"); b.type="button"; b.className="chip"; b.textContent=l; b.addEventListener("click",()=>{ vr.querySelectorAll("button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); drawFilmFrame(rep,t); }); vr.appendChild(b); });
  box.appendChild(vr);
  els.coachCard.classList.remove("hidden");
}
// pre-snap alignment, or the coverage a beat after the snap with every defender's path
function drawFilmFrame(rep,t){
  drawField(); drawRoutes(true);
  const tp=(x,y)=>toPx(x,y);
  if(t>0){
    rep.defenders.forEach(d=>{
      if(!d.h||!d.h.length) return;
      if(d.role==="man" && d.assign){ const a=defAt(d,t), r=histPos(d.assign,t), s=tp(a.x,a.y), rs=tp(r.x,r.y); ctx.strokeStyle="rgba(232,65,44,0.9)"; ctx.lineWidth=2; ctx.setLineDash([5,4]); ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(rs.x,rs.y); ctx.stroke(); ctx.setLineDash([]); }
      else if(d.role==="zone"){ const y0=d.type==="deep"?Math.max(8,d.ly-4):d.type==="flat"?0.5:2.5, y1=d.type==="deep"?d.ly+6:d.type==="flat"?6:10, a=tp(d.x0,y1), c=tp(d.x1,y0);
        ctx.fillStyle=d.type==="deep"?"rgba(90,184,255,0.16)":"rgba(255,201,51,0.16)"; ctx.fillRect(a.x,a.y,c.x-a.x,c.y-a.y); }
      ctx.strokeStyle="rgba(255,255,255,0.7)"; ctx.lineWidth=2; ctx.setLineDash([2,4]); ctx.beginPath();
      for(let u=0;u<=t+1e-6;u+=0.1){ const q=defAt(d,u), s=tp(q.x,q.y); u?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y); } ctx.stroke(); ctx.setLineDash([]);
    });
  }
  rep.players.forEach(p=>{ const q=t>0?histPos(p,t):{x:p.x0,y:p.y0}, s=tp(q.x,q.y);
    drawSprite(s.x,s.y,{jersey:p.color,shorts:"#f4f0e2",skin:SKIN[(p.id.charCodeAt(0)*7)%SKIN.length],hair:"#1b1b1b",label:p.id,labelColor:"#0d1117",flags:{},flagColor:"#ffc933",step:0}); });
  rep.defenders.forEach((d,i)=>{ if(d.isRusher && t===0) return; const q=t>0?defAt(d,t):(d.pos0||d.pos), s=tp(q.x,q.y);
    drawSprite(s.x,s.y,{jersey:"#e8412c",shorts:"#0d1117",skin:SKIN[(i*3+1)%SKIN.length],hair:"#2b1a10",flags:{},flagColor:"#5ab8ff",step:0,label:""}); });
  const cap=(t>0?"POST-SNAP · "+t.toFixed(1)+"s · "+rep.actualCoverage:"PRE-SNAP LOOK · "+rep.shownCoverage+" ("+(rep.shellShown||"")+")");
  ctx.font="16px 'Jersey 10', sans-serif"; ctx.textAlign="left"; ctx.textBaseline="middle";
  const tw=ctx.measureText(cap).width+16; ctx.fillStyle="rgba(13,17,23,0.9)"; ctx.fillRect(8,10,tw,24); ctx.fillStyle="#ffc933"; ctx.fillText(cap,16,23);
}

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  MODES.film={label:"Film Room", askCoverageChance:0, throws:true, film:true};
  ["filmSheet","filmQ","filmSub","filmOpts","filmFb","filmGo","filmBox"].forEach(id=>{ els[id]=document.getElementById(id); });
  els.filmGo.addEventListener("click",()=>{ FILM.step++; if(FILM.step>=FILM_STEPS.length) filmReady(); else filmAsk(); });
  els.field.addEventListener("pointerdown",(e)=>{
    if(!FILM.await || state.phase!=="study" || !MODES[state.mode].film) return;
    const rep=FILM.rep, pt=ptField(e);
    if(FILM.await==="key"){
      let hit=null, hd=40; rep.defenders.forEach(d=>{ const s=toPx(d.pos.x,d.pos.y), dd=Math.hypot(s.x-pt.px,s.y-pt.py); if(dd<hd){ hd=dd; hit=d; } });
      if(!hit) return;
      const ok=hit===rep.keyRead.key, L=rep.keyRead.lab, A=playerById(rep,rep.keyRead.A), B=playerById(rep,rep.keyRead.B);
      filmAnswer("key",null,ok,(ok?"✓ ":"✗ The key is ")+L.long+(L.side!=="middle"?" on the "+L.side:"")+(ok?"":"")+" — he can't cover "+A.id+"'s "+A.name+" and "+B.id+"'s "+B.name+" at the same time.");
      drawStatic(); filmMarkKey();
      const s=toPx(hit.pos.x,hit.pos.y); if(!ok){ ctx.beginPath(); ctx.arc(s.x,s.y,VIEW.PR*1.6,0,Math.PI*2); ctx.strokeStyle="#ffc933"; ctx.lineWidth=2.5; ctx.stroke(); }
    } else if(FILM.await==="read"){
      let hit=null, hd=40; rep.targets.forEach(p=>{ if(!p._px) return; const dd=Math.hypot(p._px.x-pt.px,p._px.y-pt.py); if(dd<hd){ hd=dd; hit=p; } });
      if(!hit) return;
      const b=FILM.best.best, mine=FILM.best.all.find(x=>x.id===hit.id);
      const ok = hit.id===b.id || (mine && mine.sep>=b.sep-1.0);
      const bp=playerById(rep,b.id);
      filmAnswer("read",hit.id,ok,(ok?"✓ ":"✗ ")+"Against "+rep.shownCoverage+", "+b.id+"'s "+bp.name+" should be your answer (about "+b.sep.toFixed(1)+" yds of room). "+(rep.keyRead?"Then let the key confirm it.":""));
      drawStatic(); ctx.beginPath(); ctx.arc(bp._px.x,bp._px.y,VIEW.PR*1.9,0,Math.PI*2); ctx.strokeStyle="#5fe08a"; ctx.lineWidth=3; ctx.stroke();
    }
  });
}

export { FILM, familyOf, predictInitialRead, filmStart, FILM_STEPS, filmAsk, filmAnswer, filmReady, filmDrawPre, filmMarkKey, filmClue, filmResult, filmReveal, drawFilmFrame };
