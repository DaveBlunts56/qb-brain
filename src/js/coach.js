import { VIEW, ctx, cw, toPx } from "./canvas.js";
import { DIFFICULTY, MODES, clamp, dist, lerp } from "./config.js";
import { drawField, drawRoutes } from "./draw.js";
import { roleName } from "./evaluate.js";
import { MAN_FAMILY, analyzeKeyRead } from "./keyread.js";
import { openManual, openManualFromGame } from "./learn.js";
import { lastFrameT } from "./loop.js";
import { posAt } from "./paths.js";
import { drawArrowHead } from "./playbook.js";
import { profileRecord } from "./profile.js";
import { histPos, passerIdAt, playerById } from "./rep.js";
import { SKIN, drawFrame, drawSprite } from "./sprites.js";
import { els, state } from "./state.js";

/* ============================================================
   THE COACH — post-play breakdown, Coach View replay, session notes.
   Content follows NFL FLAG, USA Football and PlaybookTech teaching (see the manual's Sources).
============================================================ */
const COV_COACH = {
  "Man": {
    simple:"Man coverage: every defender was guarding one receiver.",
    tell:"Defenders lined up tight on receivers with their eyes on their man, and they followed them after the snap.",
    beat:"Beat man with quick throws, crossers and rubs (Mesh, slants). Throw the moment your guy wins.",
    chapter:"cov-man"},
  "Cover 1": {
    simple:"Cover 1: man underneath with one safety deep in the middle.",
    tell:"One deep safety in the middle (the middle of the field is closed), everyone else tight on a receiver.",
    beat:"Attack the sides and underneath. The safety reads your shoulders, so look him off before throwing deep.",
    chapter:"cov-1"},
  "Cover 2": {
    simple:"Cover 2: two safeties split the deep field in half.",
    tell:"Two deep defenders and the middle of the field open. Corners sit short.",
    beat:"Hit the hole between the corner and safety (Smash corner), the deep middle, or short throws toward the center.",
    chapter:"cov-2"},
  "Cover 3": {
    simple:"Cover 3: three defenders deep, one underneath.",
    tell:"Three deep players keep everything in front of them. Only one or two defenders cover the short area.",
    beat:"Take what's underneath: flats, hitches, outs and ins in front of the deep defenders.",
    chapter:"cov-3"},
  "Cover 4": {
    simple:"Cover 4 (quarters): four defenders deep, only a few short.",
    tell:"Four deep defenders across the field; the short area is thin.",
    beat:"Take the underneath throws, and flood one side with layered routes.",
    chapter:"cov-7v7"},
  "Robber": {
    simple:"Cover 1 Robber: man outside, one deep safety, and a robber sitting in the middle.",
    tell:"One deep safety plus a defender parked at 6–8 yds in the middle with his eyes on you.",
    beat:"Don't throw into the middle where the robber sits — attack outside, or freeze him with your eyes and throw behind him.",
    chapter:"cov-7v7"},
  "Bracket": {
    simple:"Bracket: two defenders on your best receiver (one under, one over), man everywhere else.",
    tell:"A defender over the top of one receiver with another underneath him.",
    beat:"Your #1 is doubled — that means someone else is one-on-one or free. Go there.",
    chapter:"cov-7v7"},
  "2-Man": {
    simple:"2-Man: two deep safeties with man coverage underneath.",
    tell:"Two deep safeties (looks like Cover 2), but the underneath defenders turn and run with receivers.",
    beat:"Crossers and rubs underneath, or a receiver beating his man on an out — the safeties are too deep to help short.",
    chapter:"cov-7v7"},
  "Underneath Zone": {
    simple:"Underneath zone: everyone sat in short zones with no deep help.",
    tell:"Defenders at short depth looking at the QB, nobody really deep.",
    beat:"Get it over their heads: seams, posts and corners behind the short defenders. Throw to grass, not to a defender.",
    chapter:"cov-under"}
};
// Concept reads — key defender and if/then rule (sources: USA Football, PlaybookTech, Coach Kou, WRWR)
const CONCEPT_COACH = [
  {k:/slant.?flat|dragon/i, name:"Slant-Flat", beats:"Cover 3 and Cover 1", key:"the flat defender",
   read:"If he widens to the flat, throw the slant behind him. If he squeezes the slant, throw the flat.", chapter:"con-slantflat"},
  {k:/curl.?flat|hank/i, name:"Curl-Flat", beats:"Cover 3", key:"the flat defender",
   read:"Read flat to curl: if he jumps the flat, the curl sits open behind him.", chapter:"con-slantflat"},
  {k:/smash/i, name:"Smash", beats:"Cover 2", key:"the corner",
   read:"If the corner steps up on the hitch, throw the corner route over him. If he sinks, hit the hitch.", chapter:"con-smash"},
  {k:/stick/i, name:"Stick", beats:"zone and man", key:"the flat defender",
   read:"If he widens with the flat, throw the stick. If he sits on the stick, throw the flat.", chapter:"con-stick"},
  {k:/snag|triangle/i, name:"Snag", beats:"man and Cover 3", key:"the flat/curl defender",
   read:"Flat → snag → corner. Stay on that side; whichever one the defender doesn't take is open.", chapter:"con-snag"},
  {k:/flood|sail/i, name:"Flood", beats:"Cover 3", key:"the flat defender",
   read:"Three levels on one side. If the flat defender widens, throw the out (middle level); if he sinks, throw the flat.", chapter:"con-flood"},
  {k:/level/i, name:"Levels", beats:"zone (and man in flag)", key:"the hook defender",
   read:"Two in-breaking routes stacked: if the hook defender drops under the deep one, hit the short one, and the reverse.", chapter:"con-levels"},
  {k:/mesh/i, name:"Mesh", beats:"man", key:"the man defenders on the crossers",
   read:"The crossers rub each other's defenders. Throw to the one who comes out clean; vs zone, sit in the hole.", chapter:"con-mesh"},
  {k:/drive/i, name:"Drive", beats:"man and Cover 4", key:"the middle defender",
   read:"Shallow and dig go the same way: if the middle defender sits shallow, throw the dig; if he drops, throw the shallow.", chapter:"con-drive"},
  {k:/vert|seam/i, name:"Four Verticals", beats:"one-high and two-high looks", key:"the safety",
   read:"Read the deep safety: throw the seam away from him. Check it down if everyone is covered.", chapter:"con-verts"},
  {k:/spacing/i, name:"Spacing", beats:"zone", key:"the defender closest to the middle",
   read:"Receivers settle across the field at the same depth. Find the window between zone defenders.", chapter:"con-spacing"}
];
function conceptFor(play){ const n=(play.name||"")+" "+(play.note||""); return CONCEPT_COACH.find(c=>c.k.test(play.name||"")) || null; }

/* ---------- history helpers ---------- */
function recordDefHist(rep,t){
  rep.defenders.forEach(d=>{ (d.h=d.h||[]).push({t,x:d.pos.x,y:d.pos.y}); if(d.h.length>600) d.h.shift(); });
  const r=rep.rusher; (r.h=r.h||[]).push({t,x:r.x,y:r.y}); if(r.h.length>600) r.h.shift();
}
function hAt(h,t,fb){
  if(!h||!h.length) return {x:fb.x,y:fb.y};
  if(t<=h[0].t) return {x:h[0].x,y:h[0].y};
  for(let i=h.length-1;i>0;i--){ if(h[i-1].t<=t){ const a=h[i-1], b=h[i], f=(b.t-a.t)>1e-6?(t-a.t)/(b.t-a.t):1; return {x:lerp(a.x,b.x,clamp(f,0,1)),y:lerp(a.y,b.y,clamp(f,0,1))}; } }
  return {x:h[0].x,y:h[0].y};
}
function defAt(d,t){ return hAt(d.h,t,d.pos); }
// how open each target was at time t (distance to the nearest defender)
function opennessAt(rep,t){
  const defs=rep.defenders.filter(d=>!(d.h && d.h.length && d.h[0].t>t+0.01));   // a rusher who dropped later wasn't there yet
  return rep.targets.map(p=>{
    const q=histPos(p,t); let best=null, bd=1e9;
    defs.forEach(d=>{ const dp=defAt(d,t), dd=dist(dp,q); if(dd<bd){ bd=dd; best=d; } });
    return {p, pos:q, sep:bd, def:best};
  });
}
// for sacks: the earliest moment the ball should have come out
function bestMoment(rep,tEnd){
  const t0=Math.max(rep.snapDone||0.2,0.4); let best={t:t0,sep:-1,id:null};
  for(let t=t0;t<=tEnd-0.15;t+=0.1){
    const o=opennessAt(rep,t).sort((a,b)=>b.sep-a.sep)[0]; if(!o) break;
    if(o.sep>=4.5) return {t, sep:o.sep, id:o.p.id};
    if(o.sep>best.sep) best={t,sep:o.sep,id:o.p.id};
  }
  return best;
}
function rushArrival(rep){
  if(rep.clock) return rep.clock;
  // straight-line estimate of when the rusher gets home on this difficulty
  if(rep.rushPlan==="drop") return null;
  const d=rep.rushStart || 11, v=rep.rushSpeed||5;
  return (rep.rushPlan==="delay"?rep.delayPlan||0.75:rep.rushDelay||0) + d/v + 0.25;
}
function coachTalk(){ const m=state.coachTalk||"auto"; return m==="auto" ? (state.difficulty==="rookie"?"simple":"full") : m; }
const ord=n=>["1st","2nd","3rd","4th","5th","6th"][n]||((n+1)+"th");

/* ---------- the analysis ---------- */
function coachAnalyze(rep,resultType){
  const C=COV_COACH[rep.actualCoverage]||COV_COACH.Man, con=conceptFor(rep.play);
  const b=rep.ball, prog=rep.play.prog||[];
  const out={chapter:C.chapter, chapterLabel:rep.actualCoverage, lines:[], simple:[]};
  const name=id=>{ const p=playerById(rep,id); return p ? id+"'s "+p.name.replace(" (hot)","") : id; };
  // the look
  let look=C.simple;
  if(rep.disguised) look+=" They showed "+rep.shownCoverage+" and rotated after the snap — check the safeties again once the ball is snapped.";
  out.look=look;
  // coverage-only drill
  if(!MODES[state.mode].throws){
    out.tDec=Math.min(2.2, rep.hist ? 2.2 : 2.2);
    out.verdict = rep.coverageGuess===rep.actualCoverage ? "You read it right." : "Not quite — look again.";
    out.lines=[look, "The tell: "+C.tell, "How to beat it: "+C.beat];
    out.simple=[look, "Look for: "+C.tell];
    return out;
  }
  const arrive=rushArrival(rep);
  let tDec, mineId=null, mine=null, snap, best;
  if(b){
    tDec=b.tRel;
    snap=opennessAt(rep,tDec);
    // who was the throw for? the receiver closest to where the ball landed
    const L=b.to; let md=1e9; snap.forEach(o=>{ const q=posAt(o.p,b.tLand), d=dist(q,L); if(d<md){ md=d; mineId=o.p.id; } });
    if(b.chaser) mineId=b.chaser.id;
    mine=snap.find(o=>o.p.id===mineId);
  } else {
    const tEnd=rep.sackT||rep.endT||3;
    const bm=bestMoment(rep,tEnd); tDec=bm.t; snap=opennessAt(rep,tDec);
  }
  best=snap.slice().sort((a,c)=>c.sep-a.sep)[0];
  out.tDec=tDec; out.bestId=best?best.p.id:null; out.mineId=mineId;
  out.keyDef = mine ? mine.def : best ? best.def : null;
  const firstId=prog.find(id=>rep.targets.some(p=>p.id===id));
  const first=snap.find(o=>o.p.id===firstId);
  const readNo=mineId ? prog.indexOf(mineId) : -1;
  const roleOf=d=>roleName(rep,d);
  // verdict
  let v="", tip="";
  const sepTxt=s=>s.toFixed(1)+" yds";
  switch(resultType){
    case "GOOD READ": v="Great read. "+name(mineId)+(mine?" had "+sepTxt(mine.sep)+" of room when you let it go.":" was open."); break;
    case "RISKY":
      if(best && mine && best.p.id!==mineId && best.sep-mine.sep>1.5) v="Completed, but it was the harder throw. "+name(best.p.id)+" had "+sepTxt(best.sep)+" vs "+sepTxt(mine.sep)+".";
      else v="Completed into a tight window ("+sepTxt(mine?mine.sep:0)+"). It worked — but a defender was close.";
      break;
    case "COVERED": v=name(mineId)+" was covered."+(best && best.p.id!==mineId && best.sep>3.5 ? " "+name(best.p.id)+" was open by "+sepTxt(best.sep)+"." : ""); break;
    case "BROKEN UP": v="Broken up by "+roleOf(out.keyDef)+"."+(best && best.p.id!==mineId && best.sep>3.5 ? " "+name(best.p.id)+" was the safer throw ("+sepTxt(best.sep)+")." : ""); break;
    case "INTERCEPTED": v="Picked. "+(mine ? roleOf(mine.def)+" was "+sepTxt(mine.sep)+" from "+mineId+" when you threw." : "")+(best && best.p.id!==mineId && best.sep>3.5 ? " "+name(best.p.id)+" was open." : ""); break;
    case "OFF TARGET": v="Right idea, but the ball missed "+(mineId||"him")+". "+(mine&&mine.sep>3?"He was open — lead him to where he's going.":"Aim for the spot he's running to, not where he is."); break;
    case "SACKED": v = best && best.sep>=3.5 ? (rep.clockOut?"Time ran out.":"Sacked.")+" At "+tDec.toFixed(1)+"s "+name(best.p.id)+" was open by "+sepTxt(best.sep)+" — that was your throw." : (rep.clockOut?"Time ran out.":"Sacked.")+" Nobody was clean — throw it away or check it down sooner."; break;
    default: v=resultType;
  }
  out.verdict=v;
  // the read
  let readLine="";
  if(con) readLine=con.name+" beats "+con.beats+". Key: "+con.key+". "+con.read;
  else if(firstId) readLine="Your progression: "+prog.slice(0,3).map((id,i)=>(i+1)+" "+name(id)).join(" → ")+".";
  if(first && b){
    if(readNo===0) readLine+=" You threw your 1st read.";
    else if(readNo>0) readLine+=" You went to your "+ord(readNo)+" read"+(first.sep>=4?" — but your 1st read ("+firstId+") was already open ("+sepTxt(first.sep)+").":" after "+firstId+" was covered. Good progression.");
  }
  out.read=readLine;
  // timing
  let timing="";
  if(b){
    timing="Ball out at "+tDec.toFixed(1)+"s"+(rep.clock?" — the 7v7 clock runs out at "+rep.clock.toFixed(1)+"s.":arrive?" — the rusher gets home in about "+arrive.toFixed(1)+"s on "+DIFFICULTY[state.difficulty].label+".":".");
    if(b.type==="lob" && b.flight>1.4 && (resultType==="INTERCEPTED"||resultType==="BROKEN UP")) timing+=" The lob hung "+b.flight.toFixed(1)+"s, giving defenders time to close.";
  } else if(resultType==="SACKED"){
    timing="You held it "+(rep.sackT||0).toFixed(1)+"s"+(arrive?"; on "+DIFFICULTY[state.difficulty].label+" the rusher arrives around "+arrive.toFixed(1)+"s.":".");
  }
  out.timing=timing;
  // one coaching tip (most important first)
  const zone = !MAN_FAMILY(rep.actualCoverage);
  const cOpen = rep.squad===5 && snap.find(o=>o.p.id==="C" && o.sep>=3);
  if(resultType==="SACKED" && rep.clockOut) tip="7v7 gives you 4 seconds and no rush. Decide on your 1st read pre-snap, work 1 → 2 → checkdown, and get it out before the clock.";
  else if(resultType==="SACKED" && cOpen) tip="In 5v5 your center is your hot read — he was open. When the rush gets home fast, dump it to him.";
  else if(resultType==="SACKED") tip = arrive && arrive<1.8 ? "On Elite you have about one read. Know where the ball is going before the snap and throw on time, or scramble away from the rusher with the stick." : "Decide by your 2nd read. If nothing's there, scramble away from the rusher and throw to your checkdown.";
  else if(resultType==="INTERCEPTED" && b && b.type==="bullet") tip="Bullets travel low — an underneath defender in the lane can pick them. Lob it over him, or throw away from his side.";
  else if(resultType==="INTERCEPTED" && b && b.type==="lob") tip="Lobs hang in the air. Against tight coverage drive it in with a bullet, or save the lob for when the defender is trailing.";
  else if((resultType==="COVERED"||resultType==="BROKEN UP") && zone) tip="Against zone, throw to grass — the open space between defenders — not to a receiver standing next to one.";
  else if((resultType==="COVERED"||resultType==="BROKEN UP")) tip="Against man, throw when your receiver wins (as he breaks away), not after the defender recovers.";
  else if(resultType==="OFF TARGET") tip="Aim where he'll be when the ball gets there. Lead crossing routes; put deep balls out in front.";
  else if(resultType==="RISKY") tip = con ? "Trust the key: watch "+con.key+" and throw away from him." : "Throw away from the nearest defender's leverage — if he's inside, throw outside.";
  else if(resultType==="GOOD READ") tip = b && b.tRel>2.3 ? "Pro tip: same read, a beat earlier. Throw as he breaks, before he looks open." : "That's the habit: read it, trust it, ball out on time.";
  // key defender: what he did, what was right, what you did
  const ka=analyzeKeyRead(rep, b?b.tRel:null, mineId);
  out.keyA=ka;
  if(ka && ka.right===false && ka.correctId && resultType!=="SACKED") tip="Watch "+ka.label.long+", not the receivers. When he goes one way, throw the other.";
  else if(ka && ka.timing==="late" && (resultType==="GOOD READ"||resultType==="RISKY")) tip="Right read, late ball. Throw on the key's first step — that's the window.";
  else if(ka && ka.timing==="early" && ka.right) tip="It worked, but you threw before "+ka.label.short+" moved. Wait one beat for the key to declare.";
  // decision metrics for the QB Profile
  const rq=hAt(rep.rusher.h,tDec,rep.rusher), qbp=histPos(playerById(rep,passerIdAt(rep,tDec))||rep.players[0],tDec);
  const pressured = rep.clock ? tDec>=rep.clock-0.8 : (!rep.rusher.dropped && (dist(rq,qbp)<3.2 || (arrive && tDec>=arrive-0.35)));
  const firstOpen = !!(first && first.sep>=4);
  out.metrics={
    release: b ? +tDec.toFixed(2) : null,
    first: readNo===0, firstOpen,
    firstRight: b ? ((firstOpen && readNo===0) || (!firstOpen && readNo!==0 && mine && mine.sep>=3)) : (firstOpen?false:null),
    missed: !!(best && best.sep>=4.5 && (!mine || (best.p.id!==mineId && mine.sep<2.5))),
    tw: resultType==="INTERCEPTED" || (!!mine && mine.sep<1.3 && (resultType==="BROKEN UP"||resultType==="COVERED")),
    pressure: !!pressured,
    stare: !!(b && readNo===0 && first && first.sep<2.5 && best && best.p.id!==mineId && best.sep>=4),
    keyRight: ka ? ka.right : null, keyTiming: ka ? ka.timing : null
  };
  out.tip=tip;
  out.lines=[v, out.look, readLine, timing, "Coach's tip: "+tip].filter(Boolean);
  out.simple=[v, "Coach's tip: "+tip];
  return out;
}

/* ---------- rendering in the result sheet ---------- */
function renderKeyBlock(ka){
  const box=els.coachKey; if(!box) return; box.innerHTML="";
  if(!ka){ box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  const row=(cls,txt)=>{ const d=document.createElement("div"); d.className=cls; d.textContent=txt; box.appendChild(d); };
  row("kd-head","KEY DEFENDER: "+ka.label.short+(ka.label.side!=="middle"?" ("+ka.label.side+")":""));
  row("kd-line", ka.did+(ka.correctId||ka.correctTxt?" → "+ka.correctTxt+".":"."));
  if(ka.choice) row("kd-line kd-you "+(ka.right===true?"ok":ka.right===false?"bad":""), ka.choice+(ka.right===true?"  ✓ right read":ka.right===false?"  ✗ wrong side of the key":""));
  if(ka.timingTxt) row("kd-line kd-time "+ka.timing, ka.timingTxt);
}

let COACH_VIEW=false;
function renderCoach(rep,resultType){
  const info=coachAnalyze(rep,resultType); rep.coach=info;
  try{ profileRecord(rep,resultType,info); }catch(_){}
  const full=coachTalk()==="full";
  els.coachVerdict.textContent=info.verdict;
  els.coachLines.innerHTML="";
  (full?info.lines.slice(1):info.simple.slice(1)).forEach(t=>{ const p=document.createElement("p"); p.textContent=t; els.coachLines.appendChild(p); });
  renderKeyBlock(info.keyA);
  els.coachLearnBtn.textContent="LEARN: "+info.chapterLabel.toUpperCase();
  els.coachViewBtn.textContent="COACH VIEW";
  els.coachViewBtn.classList.remove("on");
  els.coachCard.classList.remove("hidden");
  els.resultExplain.classList.toggle("hidden", !full);
  COACH_VIEW=false;
  // log for the session notes
  const last=state.session.log[state.session.log.length-1];
  if(last){ last.tDec=info.tDec; last.best=info.bestId; last.mine=info.mineId; }
}

/* ---------- Coach View: freeze the moment of decision and draw the coverage ---------- */
function drawCoachView(rep){
  const info=rep.coach, t=info.tDec;
  drawField(); drawRoutes(true);
  const tp=(x,y)=>toPx(x,y);
  // coverage structure
  rep.defenders.forEach(d=>{
    if(d.h && d.h.length && d.h[0].t>t+0.01) return;
    const dp=defAt(d,t), s=tp(dp.x,dp.y);
    if(d.role==="man" && d.assign){
      const r=histPos(d.assign,t), rs=tp(r.x,r.y);
      ctx.strokeStyle="rgba(232,65,44,0.9)"; ctx.lineWidth=2; ctx.setLineDash([5,4]); ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(rs.x,rs.y); ctx.stroke(); ctx.setLineDash([]);
    } else if(d.role==="zone"){
      const y0 = d.type==="deep" ? Math.max(8,d.ly-4) : d.type==="flat" ? 0.5 : 2.5;
      const y1 = d.type==="deep" ? d.ly+6 : d.type==="flat" ? 6 : 10;
      const a=tp(d.x0,y1), c=tp(d.x1,y0);
      ctx.fillStyle = d.type==="deep" ? "rgba(90,184,255,0.16)" : "rgba(255,201,51,0.16)";
      ctx.strokeStyle = d.type==="deep" ? "rgba(90,184,255,0.7)" : "rgba(255,201,51,0.7)";
      ctx.lineWidth=1.5; ctx.fillRect(a.x,a.y,c.x-a.x,c.y-a.y); ctx.strokeRect(a.x,a.y,c.x-a.x,c.y-a.y);
    }
  });
  // players and defenders at that moment
  rep.players.forEach(p=>{
    const q=histPos(p,t), s=tp(q.x,q.y);
    drawSprite(s.x,s.y,{jersey:p.color,shorts:"#f4f0e2",skin:SKIN[(p.id.charCodeAt(0)*7)%SKIN.length],hair:"#1b1b1b",label:p.id,labelColor:"#0d1117",flags:{},flagColor:"#ffc933",step:0});
  });
  rep.defenders.forEach((d,i)=>{
    if(d.h && d.h.length && d.h[0].t>t+0.01) return;
    const q=defAt(d,t), s=tp(q.x,q.y);
    drawSprite(s.x,s.y,{jersey:"#e8412c",shorts:"#0d1117",skin:SKIN[(i*3+1)%SKIN.length],hair:"#2b1a10",flags:{},flagColor:"#5ab8ff",step:0,label:""});
  });
  if(!(rep.rusher.dropped && rep.rusher.h && rep.rusher.h.length && rep.rusher.h[rep.rusher.h.length-1].t<t)){
    const rq=hAt(rep.rusher.h,t,rep.rusher), rs=tp(rq.x,rq.y);
    drawSprite(rs.x,rs.y,{jersey:"#9e1b12",shorts:"#0d1117",skin:SKIN[2],hair:"#ffc933",label:"R",labelColor:"#ffc933",flags:{},flagColor:"#5ab8ff",step:0});
  }
  const ring=(id,col,label)=>{
    const p=playerById(rep,id); if(!p) return; const q=histPos(p,t), s=tp(q.x,q.y);
    ctx.beginPath(); ctx.arc(s.x,s.y,VIEW.PR*2,0,Math.PI*2); ctx.strokeStyle=col; ctx.lineWidth=3.5; ctx.stroke();
    ctx.font="14px 'Jersey 10', sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
    const tw=ctx.measureText(label).width+10; ctx.fillStyle="rgba(13,17,23,0.88)"; ctx.fillRect(s.x-tw/2,s.y-VIEW.PR*2-20,tw,16);
    ctx.fillStyle=col; ctx.fillText(label,s.x,s.y-VIEW.PR*2-12);
  };
  const snap=opennessAt(rep,t);
  // defender who decided it (when there's no concept key)
  if(!info.keyA && info.keyDef && info.keyDef.h){ const q=defAt(info.keyDef,t), s=tp(q.x,q.y); ctx.beginPath(); ctx.arc(s.x,s.y,VIEW.PR*1.8,0,Math.PI*2); ctx.strokeStyle="#ff6b5a"; ctx.lineWidth=3; ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.font="13px 'Jersey 10', sans-serif"; ctx.fillStyle="#ff6b5a"; ctx.textAlign="center"; ctx.fillText("KEY", s.x, s.y+VIEW.PR*2.6); }
  const ka=info.keyA;
  if(ka && ka.key && ka.key.h){
    const tE=ka.tCommit!=null?Math.max(ka.tCommit,t):t; ctx.strokeStyle="#ff6b5a"; ctx.lineWidth=2.5; ctx.setLineDash([2,4]); ctx.beginPath();
    for(let u=0;u<=tE+1e-6;u+=0.1){ const q=defAt(ka.key,u), s=tp(q.x,q.y); u?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y); } ctx.stroke(); ctx.setLineDash([]);
    const q0=defAt(ka.key,t), s0=tp(q0.x,q0.y); ctx.beginPath(); ctx.arc(s0.x,s0.y,VIEW.PR*1.8,0,Math.PI*2); ctx.strokeStyle="#ff6b5a"; ctx.lineWidth=3; ctx.stroke();
    const lab="KEY "+ka.label.short+(ka.tCommit!=null?" · "+ka.tCommit.toFixed(1)+"s":"");
    ctx.font="13px 'Jersey 10', sans-serif"; ctx.textAlign="center"; const lw=ctx.measureText(lab).width+10; ctx.fillStyle="rgba(13,17,23,0.88)"; ctx.fillRect(s0.x-lw/2,s0.y+VIEW.PR*2.1,lw,16); ctx.fillStyle="#ff6b5a"; ctx.fillText(lab,s0.x,s0.y+VIEW.PR*2.1+8);
    if(ka.correctId) ring(ka.correctId,"#5fe08a","CORRECT READ");
  } else if(info.bestId){ const o=snap.find(z=>z.p.id===info.bestId); ring(info.bestId,"#5fe08a","OPEN "+(o?o.sep.toFixed(1):"")+" YD"); }
  const b=rep.ball;
  if(b){
    const a=tp(b.from.x,b.from.y), e=tp(b.to.x,b.to.y);
    ctx.strokeStyle="#ffc933"; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(e.x,e.y); ctx.stroke();
    drawArrowHead(ctx,[a.x,a.y],[e.x,e.y],"#ffc933",10);
    ctx.strokeStyle="#ffc933"; ctx.lineWidth=2.5; ctx.beginPath(); ctx.moveTo(e.x-6,e.y-6); ctx.lineTo(e.x+6,e.y+6); ctx.moveTo(e.x+6,e.y-6); ctx.lineTo(e.x-6,e.y+6); ctx.stroke();
    if(info.mineId && info.mineId!==info.bestId){ const o=snap.find(z=>z.p.id===info.mineId); ring(info.mineId,"#ffc933","YOUR THROW "+(o?o.sep.toFixed(1):"")+" YD"); }
  }
  // caption
  const cap="COACH VIEW · "+t.toFixed(1)+"s · "+rep.actualCoverage;
  ctx.font="16px 'Jersey 10', sans-serif"; ctx.textAlign="left"; ctx.textBaseline="middle";
  const tw=ctx.measureText(cap).width+16; ctx.fillStyle="rgba(13,17,23,0.9)"; ctx.fillRect(8,10,tw,24);
  ctx.fillStyle="#ffc933"; ctx.fillText(cap,16,23);
  ctx.font="12px 'Pixelify Sans', sans-serif";
  const leg="green = most open · yellow = your throw · red KEY = defender who decided it · boxes = zones · dashed = man";
  const lw=Math.min(cw-16, ctx.measureText(leg).width+16); ctx.fillStyle="rgba(13,17,23,0.82)"; ctx.fillRect(8,38,lw,20);
  ctx.fillStyle="#f4f0e2"; ctx.fillText(leg,16,48,lw-14);
}

/* ---------- session notes on the summary screen ---------- */
function renderCoachNotes(){
  const box=els.coachNotes; if(!box) return; box.innerHTML="";
  const log=state.session.log.filter(l=>l.coverage);
  if(!log.length){ box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  const h=document.createElement("div"); h.className="section-label"; h.textContent="COACH'S NOTES"; box.appendChild(h);
  const notes=[];
  const by={}; log.forEach(l=>{ const g=(by[l.coverage]=by[l.coverage]||{n:0,good:0,bad:0}); g.n++; if(l.result==="GOOD READ"||(l.result===null&&l.coverageCorrect)) g.good++; if(["INTERCEPTED","SACKED","COVERED","BROKEN UP"].includes(l.result)) g.bad++; });
  const worst=Object.keys(by).filter(k=>by[k].n>=2).sort((a,b)=>by[a].good/by[a].n-by[b].good/by[b].n)[0];
  if(worst && by[worst].good/by[worst].n<0.6){ const C=COV_COACH[worst]; notes.push({t:"Work on "+worst+": "+by[worst].good+" of "+by[worst].n+" good. "+C.beat, ch:C.chapter, lab:worst}); }
  const best=Object.keys(by).filter(k=>by[k].n>=2).sort((a,b)=>by[b].good/by[b].n-by[a].good/by[a].n)[0];
  if(best && best!==worst && by[best].good/by[best].n>=0.6) notes.push({t:"You're reading "+best+" well ("+by[best].good+" of "+by[best].n+"). Keep trusting it."});
  const sacks=log.filter(l=>l.result==="SACKED").length, ints=log.filter(l=>l.result==="INTERCEPTED").length;
  if(sacks>=2) notes.push({t:sacks+" sacks. Decide by your 2nd read, then scramble away from the rusher or check it down.", ch:"read-clock", lab:"Beating the rush"});
  if(ints>=2) notes.push({t:ints+" interceptions. Throw away from the nearest defender's leverage, and don't lob into tight coverage.", ch:"throw-types", lab:"Lob vs bullet"});
  const thrown=log.filter(l=>l.result && l.result!=="SACKED" && l.time);
  if(thrown.length>=3){ const avg=thrown.reduce((s,l)=>s+l.time,0)/thrown.length; if(avg>2.6) notes.push({t:"Average time to throw "+avg.toFixed(1)+"s — that's slow against a rush. Pick your 1st read before the snap.", ch:"read-progression", lab:"Progressions"}); }
  if(!notes.length){
    const n=log.length, good=log.filter(l=>l.result==="GOOD READ"||(l.result===null&&l.coverageCorrect)).length;
    if(n<3) notes.push({t:"Get a few more reps in — after 3 or more I can spot patterns and tell you what to work on."});
    else if(good/n>=0.6) notes.push({t:"Solid session ("+good+" of "+n+" good). Try the next difficulty — Varsity and Elite add disguises and a faster rush."});
    else notes.push({t:"Keep at it ("+good+" of "+n+" good). Before every snap: count the safeties and decide your 1st read.", ch:"read-presnap", lab:"Count the safeties"});
  }
  notes.forEach(n=>{
    const d=document.createElement("div"); d.className="coach-note";
    const p=document.createElement("p"); p.textContent=n.t; d.appendChild(p);
    if(n.ch){ const b=document.createElement("button"); b.className="chip"; b.type="button"; b.textContent="READ: "+n.lab.toUpperCase(); b.addEventListener("click",()=>openManual(n.ch)); d.appendChild(b); }
    box.appendChild(d);
  });
}

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  ["coachCard","coachVerdict","coachLines","coachViewBtn","coachLearnBtn","coachNotes","coachKey"].forEach(id=>{ els[id]=document.getElementById(id); });
  els.coachViewBtn.addEventListener("click",()=>{
    const rep=state.rep; if(!rep || !rep.coach) return;
    COACH_VIEW=!COACH_VIEW;
    els.coachViewBtn.classList.toggle("on",COACH_VIEW);
    els.coachViewBtn.textContent=COACH_VIEW?"HIDE COACH VIEW":"COACH VIEW";
    if(COACH_VIEW) drawCoachView(rep); else drawFrame(lastFrameT===null?0:lastFrameT);
  });
  els.coachLearnBtn.addEventListener("click",()=>{ const rep=state.rep; if(rep&&rep.coach) openManualFromGame(rep.coach.chapter); });
}

export { COV_COACH, CONCEPT_COACH, conceptFor, recordDefHist, hAt, defAt, opennessAt, bestMoment, rushArrival, coachTalk, ord, coachAnalyze, renderKeyBlock, COACH_VIEW, renderCoach, drawCoachView, renderCoachNotes };
