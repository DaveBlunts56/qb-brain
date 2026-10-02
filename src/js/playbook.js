import { VIEW, ctx } from "./canvas.js";
import { COLORS, choice, clamp, on } from "./config.js";
import { downText, spotText } from "./drive.js";
import { ptField } from "./input.js";
import { setupKeyRead } from "./keyread.js";
import { tutAdjustRep, tutEvent, tutRender } from "./learn.js";
import { showPlayTag, startRep } from "./loop.js";
import { AUDIBLES, HOT_ROUTES, LIB, LIB_ORDER, MY_PLAYS, QB_ACTIONS, audiblesFor, booksForSquad, deleteMyPlay, libPts, playByKey, saveMyPlays, storedAfter, storedRouteName, storedRoutePts } from "./myplays.js";
import { BOOKS, pl } from "./plays.js";
import { buildRep, makePlayer, playerById } from "./rep.js";
import { SCREENS, buildChoiceRow, refreshSetupUI, showScreen, startSession } from "./setup.js";
import { SFX } from "./sound.js";
import { drawStatic } from "./sprites.js";
import { currentPlays, els, saveSettings, state } from "./state.js";

/* ============================================================
   CREATE A PLAY — editor, audibles at the line, play calling
============================================================ */

const SQUAD_IDS={5:["Q","C","X","Y","Z"], 7:["Q","C","X","H","Y","Z","F"]};
const FORMS={
  5:{"Spread":{X:[3,0],Y:[9,0],Z:[27,0]}, "Twins":{X:[3,0],Y:[7.5,0],Z:[27,0]},
     "Trips Rt":{Y:[19,0],Z:[23,0],X:[27,0]}, "Trips Lt":{X:[3,0],Z:[7,0],Y:[11,0]},
     "Bunch Rt":{X:[21,0],Y:[22.5,-1.3],Z:[24,0]}, "Bunch Lt":{Z:[6,0],Y:[7.5,-1.3],X:[9,0]},
     "Stack Rt":{X:[3,0],Y:[24,0],Z:[24,-1.5]}, "Stack Lt":{Y:[6,0],Z:[6,-1.5],X:[27,0]},
     "Offset":{X:[10.5,0],Z:[18.7,0],Y:[17,-2.3]}},
  7:{"Spread":{X:[2,0],H:[8,0],Y:[21,0],Z:[28,0],F:[11,-1.5]}, "Twins":{X:[2,0],H:[6,0],Y:[24,0],Z:[28,0],F:[12,-3]},
     "Trips Rt":{X:[2,0],H:[19,0],Y:[23.5,0],Z:[28,0],F:[11,-1.5]}, "Trips Lt":{Z:[2,0],Y:[6.5,0],H:[11,0],X:[28,0],F:[19,-1.5]},
     "Bunch Rt":{X:[2,0],H:[20.5,0],Y:[23,0],Z:[25.5,0],F:[11,-1.5]}, "Bunch Lt":{Z:[4.5,0],Y:[7,0],H:[9.5,0],X:[28,0],F:[19,-1.5]},
     "Empty":{X:[2,0],H:[7,0],F:[11,0],Y:[23,0],Z:[28,0]}}
};
const DEFAULT_ROUTES={X:"go",Y:"slant",Z:"go",H:"out",F:"flat",C:"sit"};
const QB_ALIGN=[["Under center",-1.2],["Pistol",-2.8],["Shotgun",-4.3]];

function newUid(){ return "p"+Date.now().toString(36)+Math.floor(Math.random()*46656).toString(36); }
function newStoredPlay(squad){
  const sp={uid:newUid(), name:"", squad, form:"Spread", note:"", players:[], prog:[], pitch:null};
  SQUAD_IDS[squad].forEach(id=>{
    if(id==="Q") sp.players.push({id,x:15,y:-2.8,route:{mode:"qb",action:"drop3"}});
    else if(id==="C") sp.players.push({id,x:15,y:0,route:{mode:"lib",type:"sit",depth:5}});
    else sp.players.push({id,x:15,y:0,route:{mode:"lib",type:DEFAULT_ROUTES[id]||"go"}});
  });
  applyFormation(sp,"Spread");
  return sp;
}
function applyFormation(sp,name){
  const f=FORMS[sp.squad][name]; if(!f) return;
  Object.keys(f).forEach(id=>{ const p=sp.players.find(q=>q.id===id); if(p){ p.x=f[id][0]; p.y=f[id][1]; } });
  sp.form=name;
}
// built-in or custom engine play -> editable stored copy
function playToStored(play){
  const sp={uid:newUid(), name:(play.name+" copy").slice(0,28), squad:play.squad||state.squad, form:play.form||"Custom", note:play.note||"", players:[], prog:(play.prog||[]).slice(), pitch:null};
  play.players.forEach(p=>{
    const r=p.route, o={id:p.id,x:p.x,y:p.y};
    if(r.pts.length>1) o.route={mode:"draw", rel:r.pts.slice(1).map(q=>[+(q[0]-p.x).toFixed(2),+(q[1]-p.y).toFixed(2)]), name:r.name};
    else if(p.id==="Q"){ o.route={mode:"qb",action:"drop3"}; o.y=-2.8; }   // built-in QBs take a 3-step drop from the pistol
    else o.route={mode:"lib",type:"stay"};
    if(r.pts.length>1) o.after=r.after;
    if(p.delay!==undefined && !(p.id==="Q" && o.route.mode==="qb")) o.delay=p.delay;
    if(p.dashed) o.motion=true;
    sp.players.push(o);
  });
  if(play.passer && play.passer.length>1) sp.pitch={to:play.passer[1].id, at:play.passer[0].until||0.9};
  return sp;
}

/* ---------------- editor state + drawing ---------------- */
const ED={sp:null, sel:null, mode:"edit", order:[], drag:null, w:300, dpr:1, dirty:false, aud:[], delArm:false, backArm:false};
const EDV={x0:0, y1:21};   // view: x 0..30, y -9..21 (template yards)
function edScale(){ return ED.w/30; }
function edP(x,y){ const s=edScale(); return [(x-EDV.x0)*s, (EDV.y1-y)*s]; }
function edF(px,py){ const s=edScale(); return [px/s+EDV.x0, EDV.y1-py/s]; }
function edPlayer(id){ return ED.sp.players.find(p=>p.id===id); }
function edTargets(){ const pt=ED.sp.pitch&&ED.sp.pitch.to; return ED.sp.players.filter(p=>p.id!=="Q" && p.id!==pt).map(p=>p.id); }
function edSize(){
  const cv=els.edCanvas; const w=cv.clientWidth||Math.min(520,(window.innerWidth||360)-32);
  ED.dpr=Math.min(window.devicePixelRatio||1,2.5); ED.w=w;
  cv.width=Math.round(w*ED.dpr); cv.height=Math.round(w*ED.dpr);
}
function edHint(text,warn){ els.edHint.textContent=text; els.edHint.classList.toggle("warn",!!warn); }
function edDefaultHint(){
  if(ED.mode==="order") return edHint("Tap your receivers in the order you read them ("+(ED.order.length+1)+" of "+edTargets().length+")",true);
  const p=ED.sel&&edPlayer(ED.sel);
  if(p && p.route && p.route.mode==="draw") return edHint("Tap the field to add a point · drag a point to move it");
  if(p) return edHint(p.id==="C" ? "The center stays on the ball to snap it · edit his route below" : "Drag "+p.id+" to move him · pick his route below");
  edHint("Tap a player to edit him · drag to move him");
}
function drawArrowHead(g,a,b,col,h){
  const ang=Math.atan2(b[1]-a[1],b[0]-a[0]);
  g.fillStyle=col; g.beginPath(); g.moveTo(b[0]+Math.cos(ang)*h,b[1]+Math.sin(ang)*h);
  g.lineTo(b[0]+Math.cos(ang+2.4)*h,b[1]+Math.sin(ang+2.4)*h); g.lineTo(b[0]+Math.cos(ang-2.4)*h,b[1]+Math.sin(ang-2.4)*h); g.fill();
}
function edDraw(){
  const cv=els.edCanvas, g=cv.getContext && cv.getContext("2d"); if(!g || !ED.sp || !g.setTransform) return;
  g.setTransform(ED.dpr,0,0,ED.dpr,0,0);
  const W=ED.w, s=edScale(), sp=ED.sp;
  g.fillStyle="#4f9c45"; g.fillRect(0,0,W,W);
  // backfield shade
  const los=edP(0,0)[1];
  g.fillStyle="rgba(0,0,0,0.10)"; g.fillRect(0,los,W,W-los);
  for(let y=-5;y<=20;y+=5){
    const py=edP(0,y)[1];
    g.fillStyle="rgba(244,240,226,0.32)"; g.fillRect(0,py-1,W,2);
    if(y>0){ g.fillStyle="rgba(244,240,226,0.55)"; g.font="12px 'Jersey 10', sans-serif"; g.textAlign="left"; g.textBaseline="middle"; g.fillText(String(y),4,py-8); }
  }
  for(let y=1;y<=20;y++){ if(y%5===0) continue; const py=edP(0,y)[1]; g.fillStyle="rgba(244,240,226,0.14)"; g.fillRect(W*0.33-3,py,6,1); g.fillRect(W*0.67-3,py,6,1); }
  g.fillStyle="#5ab8ff"; g.fillRect(0,los-1.5,W,3);
  const pitchTo=sp.pitch&&sp.pitch.to, R=Math.max(9,s*0.62);
  // routes
  sp.players.forEach(p=>{
    const pts=storedRoutePts(p).map(q=>edP(q[0],q[1])), col=COLORS[p.id]||"#ffc933";
    const dim = ED.sel && ED.sel!==p.id;
    if(pts.length<2) return;
    g.globalAlpha=dim?0.35:1;
    g.strokeStyle=col; g.lineWidth=ED.sel===p.id?4:3; g.lineJoin="round"; g.lineCap="round";
    g.setLineDash(p.motion?[7,6]:[]);
    g.beginPath(); pts.forEach((q,i)=>i?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1])); g.stroke(); g.setLineDash([]);
    const a=pts[pts.length-2], b=pts[pts.length-1], after=storedAfter(p);
    if(after==="run") drawArrowHead(g,a,b,col,R*0.8);
    else if(after==="sit"){ const ang=Math.atan2(b[1]-a[1],b[0]-a[0])+Math.PI/2; g.lineWidth=4; g.beginPath(); g.moveTo(b[0]+Math.cos(ang)*R*0.7,b[1]+Math.sin(ang)*R*0.7); g.lineTo(b[0]-Math.cos(ang)*R*0.7,b[1]-Math.sin(ang)*R*0.7); g.stroke(); }
    else { g.fillStyle=col; g.beginPath(); g.arc(b[0],b[1],3.5,0,Math.PI*2); g.fill(); }
    g.globalAlpha=1;
    // waypoint handles on the selected drawn route
    if(ED.sel===p.id && p.route.mode==="draw"){
      pts.slice(1).forEach((q,i)=>{ g.beginPath(); g.arc(q[0],q[1],8,0,Math.PI*2); g.fillStyle="rgba(13,17,23,0.75)"; g.fill(); g.lineWidth=2.5; g.strokeStyle="#ffffff"; g.stroke();
        g.fillStyle="#ffffff"; g.font="11px 'Jersey 10', sans-serif"; g.textAlign="center"; g.textBaseline="middle"; g.fillText(String(i+1),q[0],q[1]+0.5); });
    }
  });
  // pitch
  if(pitchTo){
    const q=edPlayer("Q"), t=edPlayer(pitchTo);
    if(q&&t){ const a=edP(q.x,q.y), b=edP(t.x,t.y); g.strokeStyle="#ffffff"; g.lineWidth=2; g.setLineDash([3,5]); g.beginPath(); g.moveTo(a[0],a[1]); g.lineTo(b[0],b[1]); g.stroke(); g.setLineDash([]);
      g.fillStyle="#ffffff"; g.font="13px 'Jersey 10', sans-serif"; g.textAlign="center"; g.fillText("PITCH",(a[0]+b[0])/2,(a[1]+b[1])/2-8); }
  }
  // players
  const order = ED.mode==="order" ? ED.order : (sp.prog||[]);
  sp.players.forEach(p=>{
    const a=edP(p.x,p.y), col=COLORS[p.id]||"#ffc933";
    if(ED.sel===p.id){ g.beginPath(); g.arc(a[0],a[1],R+5,0,Math.PI*2); g.strokeStyle="#ffc933"; g.lineWidth=3; g.stroke(); }
    g.beginPath(); g.arc(a[0],a[1],R,0,Math.PI*2); g.fillStyle=col; g.fill(); g.lineWidth=2.5; g.strokeStyle="#0d1117"; g.stroke();
    g.fillStyle="#0d1117"; g.font=Math.round(R*1.45)+"px 'Jersey 10', sans-serif"; g.textAlign="center"; g.textBaseline="middle"; g.fillText(p.id,a[0],a[1]+1);
    const k=order.indexOf(p.id);
    if(k>=0 && p.id!=="Q"){ const bx=a[0]+R*0.85, by=a[1]-R*0.85; g.beginPath(); g.arc(bx,by,7.5,0,Math.PI*2); g.fillStyle="#ffffff"; g.fill(); g.strokeStyle="#0d1117"; g.lineWidth=1.5; g.stroke();
      g.fillStyle="#0d1117"; g.font="12px 'Jersey 10', sans-serif"; g.fillText(String(k+1),bx,by+0.5); }
  });
}

/* ---------------- editor panels ---------------- */
function chip(label,on,onClick,cls){
  const b=document.createElement("button"); b.className="chip"+(on?" on":"")+(cls?" "+cls:""); b.type="button"; b.textContent=label;
  b.addEventListener("click",(e)=>{ e.preventDefault(); onClick(); }); return b;
}
function edChanged(){ ED.dirty=true; ED.backArm=false; edDraw(); }
function edRenderTools(){
  const box=els.edTools; box.innerHTML="";
  const p=ED.sel&&edPlayer(ED.sel);
  box.classList.toggle("empty",!p);
  if(!p){
    const d=document.createElement("div"); d.className="help";
    d.innerHTML="<b>Tap any player on the field</b> to change his route, or drag him to a new spot. Tap the <b>QB</b> to set his alignment and drop.";
    box.appendChild(d); edDefaultHint(); return;
  }
  const head=document.createElement("div"); head.className="ed-sel";
  const pid=document.createElement("span"); pid.className="pid"; pid.style.background=COLORS[p.id]||"#ffc933"; pid.textContent=p.id;
  const nm=document.createElement("b"); nm.textContent=storedRouteName(p)+(p.id===(ED.sp.pitch&&ED.sp.pitch.to)?" · gets the pitch":"");
  head.append(pid,nm,chip("✕",false,()=>{ ED.sel=null; edRenderTools(); edDraw(); },"ghost"));
  box.appendChild(head);
  const label=t=>{ const l=document.createElement("div"); l.className="mini-label"; l.textContent=t; box.appendChild(l); };
  const row=()=>{ const r=document.createElement("div"); r.className="chip-row"; box.appendChild(r); return r; };
  const r=p.route;
  if(p.id==="Q"){
    label("ALIGNMENT");
    const ra=row(); QB_ALIGN.forEach(([n,y])=>ra.appendChild(chip(n,Math.abs(p.y-y)<0.05,()=>{ p.y=y; edChanged(); edRenderTools(); })));
    label("AFTER THE SNAP");
    const rq=row();
    [["drop3","3-step drop"],["drop5","5-step drop"],["stay","Stay"],["rollR","Rollout ▶"],["rollL","◀ Rollout"],["bootR","Bootleg ▶"],["bootL","◀ Bootleg"]].forEach(([k,n])=>
      rq.appendChild(chip(n, r.mode==="qb"&&r.action===k, ()=>{ p.route={mode:"qb",action:k}; delete p.after; edChanged(); edRenderTools(); })));
    rq.appendChild(chip("✎ Draw path", r.mode==="draw", ()=>{ edToDraw(p); edRenderTools(); }));
  } else {
    label("ROUTE");
    const rr=row();
    LIB_ORDER.forEach(k=>rr.appendChild(chip(LIB[k].name, r.mode==="lib"&&r.type===k, ()=>{
      p.route={mode:"lib",type:k, flip: r.mode==="lib"?r.flip:false}; delete p.after; edChanged(); edRenderTools(); })));
    rr.appendChild(chip("✎ Draw", r.mode==="draw", ()=>{ edToDraw(p); edRenderTools(); }));
    if(r.mode==="lib"){
      const L=LIB[r.type];
      if(L.d!=null){
        label("DEPTH");
        const st=document.createElement("div"); st.className="stepper";
        const dv=document.createElement("b"); const cur=()=>r.depth==null?L.d:r.depth; dv.textContent=cur()+" yd";
        st.append(chip("−",false,()=>{ r.depth=Math.max(1,cur()-1); dv.textContent=cur()+" yd"; edChanged(); }), dv,
                  chip("+",false,()=>{ r.depth=Math.min(20,cur()+1); dv.textContent=cur()+" yd"; edChanged(); }));
        box.appendChild(st);
      }
      if(r.type!=="go" && r.type!=="sit" && r.type!=="stay"){
        label("DIRECTION");
        const rd=row();
        rd.appendChild(chip("Normal",!r.flip,()=>{ r.flip=false; edChanged(); edRenderTools(); }));
        rd.appendChild(chip("Flipped ↔",!!r.flip,()=>{ r.flip=true; edChanged(); edRenderTools(); }));
      }
    }
  }
  if(r.mode==="draw"){
    const h=document.createElement("div"); h.className="help"; h.textContent="Tap the field to add points to the path. Drag a numbered point to move it."; box.appendChild(h);
    const rw=row();
    rw.appendChild(chip("Undo point",false,()=>{ r.rel.pop(); edChanged(); }));
    rw.appendChild(chip("Clear path",false,()=>{ r.rel=[]; edChanged(); }));
  }
  if(p.id!=="Q"){
    label("AT THE END");
    const re=row(); const af=storedAfter(p);
    [["run","Keep running"],["sit","Sit down"],["stop","Stop"]].forEach(([k,n])=>re.appendChild(chip(n,af===k,()=>{ p.after=k; edChanged(); edRenderTools(); })));
    label("RELEASE");
    const rs=row(); const dflt=p.id==="C"?0.3:0, dl=p.delay==null?dflt:p.delay;
    [[0,"On the snap"],[0.3,"+0.3s"],[0.6,"+0.6s"],[1,"+1s"],[1.5,"+1.5s"]].forEach(([v,n])=>rs.appendChild(chip(n,Math.abs(dl-v)<0.01,()=>{ p.delay=v; edChanged(); edRenderTools(); })));
    const rm=row(); rm.appendChild(chip(p.motion?"Dashed line (fake/motion) ✓":"Dashed line (fake/motion)",!!p.motion,()=>{ p.motion=!p.motion; edChanged(); edRenderTools(); }));
  }
  edDefaultHint();
}
function edToDraw(p){
  if(p.route.mode!=="draw"){
    const pts=storedRoutePts(p), after=storedAfter(p);
    p.route={mode:"draw", rel:pts.slice(1).map(q=>[+(q[0]-p.x).toFixed(2),+(q[1]-p.y).toFixed(2)]), name: p.id==="Q"?"QB path":storedRouteName(p)};
    if(p.id!=="Q") p.after=after; else p.after="stop";
  }
  edChanged();
}
function edRenderMain(){
  const sp=ED.sp;
  els.edTitle.textContent = ED.isNew ? "CREATE A PLAY" : "EDIT PLAY";
  els.edName.value=sp.name; els.edNote.value=sp.note||"";
  // format
  els.edSquadRow.innerHTML="";
  [5,7].forEach(sq=>els.edSquadRow.appendChild(chip(sq+"v"+sq,sp.squad===sq,()=>{
    if(sp.squad===sq) return;
    const keep={uid:sp.uid,name:sp.name,note:sp.note};
    ED.sp=Object.assign(newStoredPlay(sq),keep); ED.sel=null; ED.mode="edit"; ED.aud=[]; edChanged(); edRenderMain();
    edHint("Switched to "+sq+"v"+sq+" — formation reset",true);
  })));
  // formations
  els.edFormRow.innerHTML="";
  Object.keys(FORMS[sp.squad]).forEach(f=>els.edFormRow.appendChild(chip(f,sp.form===f,()=>{ applyFormation(sp,f); edChanged(); edRenderMain(); })));
  if(!FORMS[sp.squad][sp.form]) els.edFormRow.appendChild(chip(sp.form||"Custom",true,()=>{}));
  edRenderProg(); edRenderPitch(); edRenderAud();
  els.edDelete.classList.toggle("hidden",ED.isNew);
  els.edDelete.textContent="DELETE PLAY"; ED.delArm=false;
  edRenderTools(); edDraw();
}
function edRenderProg(){
  const sp=ED.sp, row=els.edProgRow; row.innerHTML="";
  const t=edTargets(); const prog=(sp.prog||[]).filter(id=>t.includes(id)); t.forEach(id=>{ if(!prog.includes(id)) prog.push(id); }); sp.prog=prog;
  const list = ED.mode==="order" ? ED.order : prog;
  list.forEach((id,i)=>{ const c=chip((i+1)+" · "+id+" "+storedRouteName(edPlayer(id)),false,()=>{}); c.style.borderColor=COLORS[id]; row.appendChild(c); });
  els.edProgBtn.textContent = ED.mode==="order" ? "DONE" : "SET READ ORDER";
}
function edFinishOrder(){
  const t=edTargets(); const o=ED.order.slice(); t.forEach(id=>{ if(!o.includes(id)) o.push(id); });
  ED.sp.prog=o; ED.mode="edit"; ED.order=[]; edChanged(); edRenderProg(); edDefaultHint();
}

function edRenderPitch(){
  const sp=ED.sp; els.edPitchRow.innerHTML=""; els.edPitchTime.innerHTML="";
  els.edPitchRow.appendChild(chip("No pitch",!sp.pitch,()=>{ sp.pitch=null; edChanged(); edRenderMain(); }));
  sp.players.filter(p=>p.id!=="Q").forEach(p=>els.edPitchRow.appendChild(chip("Pitch to "+p.id,sp.pitch&&sp.pitch.to===p.id,()=>{ sp.pitch={to:p.id,at:sp.pitch?sp.pitch.at:0.9}; edChanged(); edRenderMain(); })));
  if(sp.pitch){
    [0.5,0.9,1.2,1.5].forEach(v=>els.edPitchTime.appendChild(chip("at "+v+"s",Math.abs(sp.pitch.at-v)<0.01,()=>{ sp.pitch.at=v; edChanged(); edRenderPitch(); })));
  }
}
function edRenderAud(){
  els.edAudRow.innerHTML="";
  const list=ED.aud.map(playByKey).filter(Boolean);
  if(!list.length){ const d=document.createElement("div"); d.className="help"; d.textContent="None yet."; els.edAudRow.appendChild(d); }
  list.forEach(p=>els.edAudRow.appendChild(chip(p.name,false,()=>{})));
}

/* ---------------- canvas input ---------------- */
function edLocal(e){ const r=els.edCanvas.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; }
function edHitPlayer(px,py){
  let best=null, bd=1e9, R=Math.max(16,edScale()*0.9);
  ED.sp.players.forEach(p=>{ const a=edP(p.x,p.y), d=Math.hypot(a[0]-px,a[1]-py); if(d<R && d<bd){ bd=d; best=p; } });
  return best;
}
const snapH=v=>Math.round(v*2)/2;

function edEndDrag(){
  const d=ED.drag; ED.drag=null; if(!d) return;
  if(d.kind==="player" && d.moved){
    const p=edPlayer(d.id);
    if(p && p.id!=="Q" && p.id!=="C" && FORMS[ED.sp.squad][ED.sp.form]){ ED.sp.form="Custom"; edRenderMain(); }
    else { edRenderTools(); edDraw(); }
  }
}

/* ---------------- open / save / test / delete ---------------- */
function openEditor(sp,isNew){
  ED.sp=JSON.parse(JSON.stringify(sp)); ED.isNew=!!isNew; ED.sel=null; ED.mode="edit"; ED.order=[]; ED.dirty=!!isNew&&false; ED.backArm=false;
  ED.aud=(AUDIBLES["my:"+sp.uid]||[]).slice();
  showScreen("editorScreen");
  edSize(); edRenderMain();
}
function edValidate(){
  const sp=ED.sp;
  if(!edTargets().length) return "You need at least one receiver who isn't getting the pitch.";
  for(const p of sp.players){ if(p.id!=="Q" && p.y>0.01) return p.id+" is lined up past the line of scrimmage."; }
  return null;
}
function edSave(){
  const sp=ED.sp;
  const err=edValidate(); if(err){ edHint(err,true); return false; }
  let name=(sp.name||"").trim();
  if(!name){ let n=MY_PLAYS.length+1; name="My Play "+n; while(MY_PLAYS.some(q=>q.name===name && q.uid!==sp.uid)) name="My Play "+(++n); }
  let base=name, k=2; while(MY_PLAYS.some(q=>q.name===name && q.squad===sp.squad && q.uid!==sp.uid)) name=base+" "+(k++);
  sp.name=name; els.edName.value=name;
  edRenderProg();
  const copy=JSON.parse(JSON.stringify(sp));
  copy.upd=Date.now();
  const i=MY_PLAYS.findIndex(q=>q.uid===sp.uid);
  if(i>=0) MY_PLAYS[i]=copy; else MY_PLAYS.push(copy);
  AUDIBLES["my:"+sp.uid]=ED.aud.slice();
  saveMyPlays();
  ED.isNew=false; ED.dirty=false; els.edTitle.textContent="EDIT PLAY"; els.edDelete.classList.remove("hidden");
  edHint("Saved to My Plays ✓",true);
  return true;
}

/* ---------------- audible picker (modal) ---------------- */
let PICK=null;
function openPicker(title,squad,selfKey,current,onDone){
  PICK={sel:current.slice(), onDone};
  els.pickTitle.textContent=title;
  els.pickList.innerHTML="";
  booksForSquad(squad).forEach(bk=>{
    const plays=bk.plays.filter(p=>p.key!==selfKey); if(!plays.length) return;
    const l=document.createElement("div"); l.className="mini-label"; l.textContent=bk.label.toUpperCase(); els.pickList.appendChild(l);
    plays.forEach(p=>{
      const b=document.createElement("button"); b.type="button";
      const sync=()=>{ const on=PICK.sel.includes(p.key); b.classList.toggle("on",on); b.firstChild.textContent=on?"✓":""; };
      b.innerHTML="<i></i><b></b><small></small>"; b.children[1].textContent=p.name; b.children[2].textContent=playKindLabel(p)+" · "+p.form;
      b.addEventListener("click",()=>{
        const k=PICK.sel.indexOf(p.key);
        if(k>=0) PICK.sel.splice(k,1); else if(PICK.sel.length<4) PICK.sel.push(p.key);
        else { els.pickSub.textContent="That's 4 already — untick one first."; return; }
        els.pickSub.textContent="Pick up to 4 plays to check to at the line."; sync();
      });
      els.pickList.appendChild(b); sync();
    });
  });
  els.pickSub.textContent="Pick up to 4 plays to check to at the line.";
  els.pickSheet.classList.remove("hidden");
}

/* ---------------- playbook screen: My Plays tab, create, edit, audibles ---------------- */
/* ---- PLAYBOOK browser: every play drawn as a mini diagram ---- */
function drawPlayDiagram(cv, play){
  const g=cv.getContext("2d"), W=cv.width, H=cv.height;
  const x0=0, x1=30, y0=-9, y1=19, sx=W/(x1-x0), sy=H/(y1-y0);
  const P=(x,y)=>[(x-x0)*sx, H-(y-y0)*sy];
  g.fillStyle="#4f9c45"; g.fillRect(0,0,W,H);
  for(let y=-5;y<=15;y+=5){ const a=P(0,y); g.fillStyle="rgba(0,0,0,0.06)"; if(y%10===0) g.fillRect(0,a[1]-5*sy,W,5*sy); g.fillStyle="rgba(244,240,226,0.35)"; g.fillRect(0,a[1]-1,W,2); }
  const los=P(0,0); g.fillStyle="#5ab8ff"; g.fillRect(0,los[1]-2,W,3);
  const R=Math.max(6,W/34);
  play.players.forEach(pl=>{
    const pts=pl.route.pts, col=COLORS[pl.id]||"#ffc933";
    if(pts.length>1){
      g.strokeStyle=col; g.lineWidth=Math.max(2,W/140); g.lineJoin="round"; g.setLineDash(pl.dashed?[W/60,W/60]:[]);
      g.beginPath(); pts.forEach((q,i)=>{ const a=P(q[0],q[1]); i?g.lineTo(a[0],a[1]):g.moveTo(a[0],a[1]); }); g.stroke(); g.setLineDash([]);
      const a=P(pts[pts.length-2][0],pts[pts.length-2][1]), b=P(pts[pts.length-1][0],pts[pts.length-1][1]), ang=Math.atan2(b[1]-a[1],b[0]-a[0]), h=R*0.9;
      g.fillStyle=col;
      if(pl.route.after==="run"){ g.beginPath(); g.moveTo(b[0]+Math.cos(ang)*h,b[1]+Math.sin(ang)*h); g.lineTo(b[0]+Math.cos(ang+2.4)*h,b[1]+Math.sin(ang+2.4)*h); g.lineTo(b[0]+Math.cos(ang-2.4)*h,b[1]+Math.sin(ang-2.4)*h); g.fill(); }
      else if(pl.route.after==="sit"){ g.fillRect(b[0]-h*0.8,b[1]-h*0.2,h*1.6,h*0.4); }
    }
  });
  play.players.forEach(pl=>{
    const a=P(pl.x,pl.y);
    g.beginPath(); g.arc(a[0],a[1],R,0,Math.PI*2); g.fillStyle=COLORS[pl.id]||"#ffc933"; g.fill();
    g.lineWidth=2; g.strokeStyle="#0d1117"; g.stroke();
    g.fillStyle="#0d1117"; g.font=Math.round(R*1.35)+"px 'Jersey 10', sans-serif"; g.textAlign="center"; g.textBaseline="middle";
    g.fillText(pl.id,a[0],a[1]+1);
  });
}
function playKindLabel(p){ return p.kind==="run"?"RUN":p.kind==="trick"?"TRICK":"PASS"; }
let pbOpen=null;
function openPlay(p){
  pbOpen=p;
  els.pbGrid.classList.add("hidden"); els.pbDetail.classList.remove("hidden");
  drawPlayDiagram(els.pbDetailCanvas,p);
  els.pbDetailName.textContent=p.name;
  els.pbDetailProg.textContent=playKindLabel(p)+" · "+p.form+"  ·  Read: "+p.prog.slice(0,3).map((id,i)=>{ const pl=p.players.find(q=>q.id===id); return (i+1)+" "+id+" "+pl.route.name; }).join(" → ");
  els.pbDetailNote.textContent=p.note||"";
  els.pbEditBtn.textContent = p.custom ? "EDIT PLAY" : "COPY & EDIT";
  pbAudSync(p);
  els.playbookScreen.scrollTo(0,0);
}

function renderPlaybook(){
  const books=[{key:"custom",title:"My Plays",sub:MY_PLAYS.length+" saved"},{key:"standard",title:"Standard",sub:"Concepts · "+state.squad+"v"+state.squad}];
  buildChoiceRow(els.pbTabs,books,state.book,k=>{ state.book=k; state.playPick="random"; });
  els.pbGrid.innerHTML="";
  const c=document.createElement("button"); c.className="play-card create"; c.type="button";
  c.innerHTML='<b>+ CREATE A PLAY</b><small>5v5 or 7v7 · your routes</small>';
  c.addEventListener("click",()=>openEditor(newStoredPlay(state.squad),true));
  const plays = state.book==="custom" ? [5,7].reduce((a,sq)=>a.concat(BOOKS.custom.plays[sq]),[]) : currentPlays();
  if(state.book==="custom") els.pbGrid.appendChild(c);
  plays.forEach(p=>{
    const b=document.createElement("button"); b.className="play-card"; b.type="button";
    const cv=document.createElement("canvas"); cv.width=300; cv.height=300; b.appendChild(cv);
    const t=document.createElement("b"); t.textContent=p.name; b.appendChild(t);
    const sm=document.createElement("small"); sm.textContent=playKindLabel(p)+" · "+p.form+(p.custom?" · "+p.squad+"v"+p.squad:""); b.appendChild(sm);
    b.addEventListener("click",()=>openPlay(p));
    els.pbGrid.appendChild(b); drawPlayDiagram(cv,p);
  });
  if(state.book!=="custom") els.pbGrid.appendChild(c);
  else {
    const imp=document.createElement("button"); imp.className="play-card import"; imp.type="button";
    imp.innerHTML='<b>⇩ IMPORT A PLAY</b><small>Paste a teammate\'s code</small>';
    imp.addEventListener("click",openImport);
    els.pbGrid.insertBefore(imp, els.pbGrid.children[1]||null);
  }
}
function pbAudSync(p){
  const list=audiblesFor(p);
  els.pbAudLine.innerHTML = list.length ? "<b>Audibles:</b> "+list.map(q=>q.name).join(" · ") : "<b>Audibles:</b> none set";
  els.pbAudBtn.textContent = list.length ? "CHANGE AUDIBLES" : "SET AUDIBLES";
}

/* ============================================================
   AUDIBLES AT THE LINE — check to another play, or hot-route a receiver
============================================================ */
const AUD={open:false, sel:null};
function audibleShow(on){ els.audibleBtn.classList.toggle("hidden", !on); }
function openAudible(){
  if(state.phase!=="study" || !state.rep) return;
  AUD.open=true; AUD.sel=null;
  els.controls.classList.add("hidden"); els.audibleSheet.classList.remove("hidden");
  renderAudible(); audDraw();
}
function closeAudible(){
  if(!AUD.open) return;
  AUD.open=false; AUD.sel=null;
  els.audibleSheet.classList.add("hidden");
  if(state.phase==="study"){ els.controls.classList.remove("hidden"); drawStatic(); if(state.tut) tutRender(); }
}

function renderAudible(){
  const rep=state.rep, base=rep.play;
  // hot route chips
  if(AUD.sel){
    const p=playerById(rep,AUD.sel), cur=rep.hot&&rep.hot[AUD.sel];
    els.audHot.classList.remove("hidden");
    els.audHotLabel.textContent="HOT ROUTE · "+AUD.sel+" (now: "+p.name.replace(" (hot)","")+")";
    els.audHotRow.innerHTML="";
    HOT_ROUTES.forEach(k=>els.audHotRow.appendChild(chip(LIB[k].name,cur===k,()=>{ hotRoute(AUD.sel,k); })));
    if(cur) els.audHotRow.appendChild(chip("↺ Original",false,()=>{ hotRoute(AUD.sel,null); },"ghost"));
    els.audSub.textContent="Pick "+AUD.sel+"'s new route, or tap another receiver.";
  } else {
    els.audHot.classList.add("hidden");
    els.audSub.textContent="Tap a receiver on the field to hot-route him, or check to a new play.";
  }
  // check-to list
  let list=audiblesFor(base), lab="CHECK TO";
  if(!list.length){ list=currentPlays().filter(p=>p.key!==base.key); lab="CHECK TO · no audibles set for "+base.name+", any play:"; }
  els.audListLabel.textContent=lab;
  els.audList.innerHTML="";
  list.forEach(p=>{
    const b=document.createElement("button"); b.type="button";
    b.innerHTML="<b></b><small></small>"; b.children[0].textContent=p.name; b.children[1].textContent=playKindLabel(p)+" · "+p.form;
    b.addEventListener("click",()=>doAudible(p));
    els.audList.appendChild(b);
  });
}
function audDraw(){
  drawStatic();
  const rep=state.rep;
  rep.targets.forEach(p=>{
    const s=p._px; if(!s) return;
    ctx.beginPath(); ctx.arc(s.x,s.y,VIEW.PR*1.7,0,Math.PI*2);
    ctx.strokeStyle = AUD.sel===p.id ? "#ffc933" : "rgba(255,255,255,0.45)"; ctx.lineWidth = AUD.sel===p.id ? 3.5 : 2; ctx.setLineDash(AUD.sel===p.id?[]:[4,4]); ctx.stroke(); ctx.setLineDash([]);
  });
}
// tap receivers on the field while the audible sheet is open

function hotRoute(id,type){
  const rep=state.rep, tp=rep.play.players.find(q=>q.id===id), live=playerById(rep,id);
  if(!tp||!live) return;
  const r = type ? {pts:libPts(type,tp.x,tp.y,null,false), after:LIB[type].after, name:LIB[type].name} : tp.route;
  const np=makePlayer(pl(id,tp.x,tp.y,r,{delay:tp.delay, target:tp.target}));
  live.path=np.path; live.name=np.name+(type?" (hot)":"");
  rep.hot=rep.hot||{}; if(type) rep.hot[id]=type; else delete rep.hot[id];
  setupKeyRead(rep);
  showPlayTag(); renderAudible(); audDraw(); SFX.click();
  if(type) tutEvent("hot");
}
function doAudible(play){
  const old=state.rep;
  const keep={disguised:old.disguised, disguiseKind:old.disguiseKind, shownCoverage:old.shownCoverage, actualCoverage:old.actualCoverage, rushPlan:old.rushPlan, rusher:{x:old.rusher.x}, askCoverage:old.askCoverage};
  const rep=buildRep({play, keep});
  rep.coverageGuess=old.coverageGuess; rep.audibledFrom=old.audibledFrom||old.play.name;
  state.rep=rep; AUD.sel=null;
  if(state.tut) tutAdjustRep(rep);
  showPlayTag(); renderAudible(); audDraw(); SFX.click();
  tutEvent("audible");
}

/* ============================================================
   PLAY CALLING (Full Drive): pick the play before every down
============================================================ */
const CALL={tab:null};
function showCallSheet(){
  state.phase="call";
  els.controls.classList.add("hidden");
  const d=state.drive;
  els.callHead.textContent=downText(d)+" · "+spotText(d,d.ballOn);
  const books=booksForSquad(state.squad);
  if(!CALL.tab || !books.find(b=>b.key===CALL.tab)) CALL.tab = (books.find(b=>b.key===state.book)||books[0]).key;
  els.callTabs.innerHTML="";
  books.forEach(b=>els.callTabs.appendChild(chip(b.label,b.key===CALL.tab,()=>{ CALL.tab=b.key; showCallSheet(); })));
  els.callGrid.innerHTML="";
  const plays=books.find(b=>b.key===CALL.tab).plays;
  plays.forEach(p=>{
    const b=document.createElement("button"); b.className="play-card"; b.type="button";
    const cv=document.createElement("canvas"); cv.width=200; cv.height=200; b.appendChild(cv);
    const t=document.createElement("b"); t.textContent=p.name; b.appendChild(t);
    const sm=document.createElement("small"); sm.textContent=playKindLabel(p)+" · "+p.form; b.appendChild(sm);
    const au=audiblesFor(p); if(au.length){ const tg=document.createElement("span"); tg.className="tag"; tg.textContent=au.length+" AUDIBLE"+(au.length>1?"S":""); b.appendChild(tg); }
    b.addEventListener("click",()=>pickCall(p));
    els.callGrid.appendChild(b); drawPlayDiagram(cv,p);
  });
  els.callSheet.classList.remove("hidden");
  els.callSheet.scrollTop=0;
}
function pickCall(play){
  if(!play){ const b=booksForSquad(state.squad).find(x=>x.key===CALL.tab)||booksForSquad(state.squad)[0]; play=choice(b.plays); }
  els.callSheet.classList.add("hidden");
  startRep({play});
}

/* ============================================================
   SHARE CODES — a play as text you can send to a teammate
============================================================ */

const CODE_PREFIX="QBB1-";
const cleanText=(s,n)=>String(s==null?"":s).replace(/[<>&"`]/g,"").slice(0,n);
const num=(v,lo,hi)=>{ v=+v; return isFinite(v)?Math.round(clamp(v,lo,hi)*100)/100:lo; };
function b64enc(str){ return btoa(unescape(encodeURIComponent(str))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function b64dec(str){ str=str.replace(/-/g,"+").replace(/_/g,"/"); while(str.length%4) str+="="; return decodeURIComponent(escape(atob(str))); }
function encodePlay(sp){
  const o={n:sp.name,s:sp.squad,f:sp.form,t:sp.note||"",g:sp.prog||[],h:sp.pitch||0,
    p:sp.players.map(p=>{ const r=p.route||{}; const q=[p.id,num(p.x,0,30),num(p.y,-9,1)];
      q.push(r.mode==="lib" ? ["l",r.type,r.depth==null?null:r.depth,r.flip?1:0] : r.mode==="qb" ? ["q",r.action] : ["d",(r.rel||[]).map(z=>[num(z[0],-30,30),num(z[1],-30,40)]),r.name||""]);
      q.push(p.after||0, p.delay==null?null:p.delay, p.motion?1:0); return q; })};
  return CODE_PREFIX+b64enc(JSON.stringify(o));
}
const OK_IDS=["Q","C","X","Y","Z","H","F","T","S"];
function decodePlay(code){
  code=String(code||"").replace(/\s+/g,"");
  const i=code.indexOf(CODE_PREFIX); if(i<0) throw new Error("That doesn't look like a QB Brain play code.");
  let o; try{ o=JSON.parse(b64dec(code.slice(i+CODE_PREFIX.length))); }catch(_){ throw new Error("The code is incomplete — copy the whole thing."); }
  const squad=o.s===7?7:5;
  if(!Array.isArray(o.p) || o.p.length<2 || o.p.length>8) throw new Error("This code has the wrong number of players.");
  const seen={};
  const players=o.p.map(q=>{
    const id=String(q[0]); if(!OK_IDS.includes(id) || seen[id]) throw new Error("This code has a player I don't recognize."); seen[id]=1;
    const p={id, x:num(q[1],0.5,29.5), y:num(q[2],-8,0)};
    const r=q[3]||[];
    if(r[0]==="l" && LIB[r[1]]) p.route={mode:"lib",type:r[1],depth:r[2]==null?null:num(r[2],1,20),flip:!!r[3]};
    else if(r[0]==="q" && QB_ACTIONS[r[1]]) p.route={mode:"qb",action:r[1]};
    else if(r[0]==="d" && Array.isArray(r[1])) p.route={mode:"draw",rel:r[1].slice(0,24).map(z=>[num(z[0],-30,30),num(z[1],-30,40)]),name:cleanText(r[2],24)||"custom route"};
    else p.route = id==="Q" ? {mode:"qb",action:"drop3"} : {mode:"lib",type:"stay"};
    if(["run","sit","stop"].includes(q[4])) p.after=q[4];
    if(q[5]!=null) p.delay=num(q[5],0,3);
    if(q[6]) p.motion=true;
    return p;
  });
  if(!seen.Q) throw new Error("This code is missing the QB.");
  const sp={uid:newUid(), name:cleanText(o.n,28)||"Imported play", squad, form:cleanText(o.f,20)||"Custom", note:cleanText(o.t,300), players,
    prog:(Array.isArray(o.g)?o.g:[]).map(String).filter(id=>seen[id]), pitch:null};
  if(o.h && seen[o.h.to] && o.h.to!=="Q") sp.pitch={to:String(o.h.to), at:num(o.h.at,0.3,2)};
  return sp;
}
let CODE_MODE="share";
function openShare(sp){
  CODE_MODE="share";
  els.codeTitle.textContent="SHARE · "+sp.name;
  els.codeSub.textContent="Send this code to a teammate. They paste it into Playbook → My Plays → Import a play.";
  els.codeText.value=encodePlay(sp); els.codeText.readOnly=true;
  els.codeMain.textContent="COPY CODE"; els.codeMsg.textContent="";
  els.codeShare.classList.toggle("hidden", !(navigator.share));
  els.codeSheet.classList.remove("hidden");
}
function openImport(){
  CODE_MODE="import";
  els.codeTitle.textContent="IMPORT A PLAY";
  els.codeSub.textContent="Paste a play code from a teammate (it starts with QBB1-).";
  els.codeText.value=""; els.codeText.readOnly=false;
  els.codeMain.textContent="IMPORT"; els.codeMsg.textContent=""; els.codeShare.classList.add("hidden");
  els.codeSheet.classList.remove("hidden");
}

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  on("plays:changed",()=>{ if(!els.playbookScreen.classList.contains("hidden") && els.pbDetail.classList.contains("hidden")) renderPlaybook(); });
  ["editorScreen","edBack","edTitle","edName","edSquadRow","edCanvas","edHint","edTools","edFormRow","edProgRow","edProgBtn",
   "edPitchRow","edPitchTime","edAudRow","edAudBtn","edNote","edSave","edTest","edDelete",
   "pickSheet","pickTitle","pickSub","pickList","pickDone",
   "audibleSheet","audClose","audSub","audHot","audHotLabel","audHotRow","audList","audListLabel","audibleBtn",
   "callSheet","callHead","callTabs","callGrid","callRandom","pbEditBtn","pbAudBtn","pbAudLine"
  ].forEach(id=>{ els[id]=document.getElementById(id); });
  SCREENS.push("editorScreen");
  els.edProgBtn.addEventListener("click",()=>{
    if(ED.mode==="order"){ edFinishOrder(); return; }
    ED.mode="order"; ED.order=[]; ED.sel=null; edRenderTools(); edRenderProg(); edDraw(); edDefaultHint();
  });
  els.edAudBtn.addEventListener("click",()=>{
    openPicker("AUDIBLES · "+(ED.sp.name||"this play"), ED.sp.squad, "my:"+ED.sp.uid, ED.aud, (keys)=>{ ED.aud=keys; ED.dirty=true; edRenderAud(); });
  });
  els.edName.addEventListener("input",()=>{ ED.sp.name=els.edName.value; ED.dirty=true; });
  els.edNote.addEventListener("input",()=>{ ED.sp.note=els.edNote.value; ED.dirty=true; });
  els.edCanvas.addEventListener("pointerdown",(e)=>{
    if(!ED.sp) return; e.preventDefault();
    const [px,py]=edLocal(e), [fx,fy]=edF(px,py);
    const hit=edHitPlayer(px,py);
    if(ED.mode==="order"){
      if(hit && edTargets().includes(hit.id) && !ED.order.includes(hit.id)){ ED.order.push(hit.id); if(ED.order.length>=edTargets().length) edFinishOrder(); else { edRenderProg(); edDraw(); edDefaultHint(); } }
      return;
    }
    const sel=ED.sel&&edPlayer(ED.sel);
    if(sel && sel.route.mode==="draw"){
      const pts=storedRoutePts(sel);
      for(let k=pts.length-1;k>=1;k--){ const a=edP(pts[k][0],pts[k][1]); if(Math.hypot(a[0]-px,a[1]-py)<16){ ED.drag={kind:"pt",k}; try{ els.edCanvas.setPointerCapture(e.pointerId); }catch(_){} return; } }
    }
    if(hit){
      if(ED.sel!==hit.id){ ED.sel=hit.id; edRenderTools(); }
      ED.drag={kind:"player",id:hit.id,sx:px,sy:py,ox:hit.x,oy:hit.y,moved:false};
      try{ els.edCanvas.setPointerCapture(e.pointerId); }catch(_){}
      edDraw(); return;
    }
    if(sel && sel.route.mode==="draw"){
      sel.route.rel.push([+(clamp(fx,0.3,29.7)-sel.x).toFixed(2), +(clamp(fy,-9,30)-sel.y).toFixed(2)]);
      ED.drag={kind:"pt",k:sel.route.rel.length};
      try{ els.edCanvas.setPointerCapture(e.pointerId); }catch(_){}
      edChanged(); return;
    }
    if(ED.sel){ ED.sel=null; edRenderTools(); edDraw(); }
  });
  els.edCanvas.addEventListener("pointermove",(e)=>{
    if(!ED.drag) return; e.preventDefault();
    const [px,py]=edLocal(e), [fx,fy]=edF(px,py), d=ED.drag;
    if(d.kind==="pt"){
      const p=edPlayer(ED.sel); if(!p||p.route.mode!=="draw") return;
      p.route.rel[d.k-1]=[+(clamp(fx,0.3,29.7)-p.x).toFixed(2), +(clamp(fy,-9,30)-p.y).toFixed(2)];
      edChanged(); return;
    }
    const p=edPlayer(d.id); if(!p) return;
    if(!d.moved && Math.hypot(px-d.sx,py-d.sy)<5) return;
    d.moved=true;
    const s=edScale(), nx=snapH(d.ox+(px-d.sx)/s), ny=snapH(d.oy-(py-d.sy)/s);
    if(p.id==="C"){ edHint("The center snaps the ball, so he stays on the ball",true); return; }
    if(p.id==="Q"){ p.y=clamp(ny,-7,-1); }
    else { p.x=clamp(nx,0.5,29.5); p.y=clamp(ny,-7,0); }
    edChanged();
  });
  els.edCanvas.addEventListener("pointerup",edEndDrag);
  els.edCanvas.addEventListener("pointercancel",edEndDrag);
  els.edSave.addEventListener("click",()=>{ edSave(); });
  els.edTest.addEventListener("click",()=>{
    if(!edSave()) return;
    state.book="custom"; state.squad=ED.sp.squad; state.playPick=ED.sp.name; state.drillMode="quick_read";
    refreshSetupUI(); startSession("quick_read");
  });
  els.edDelete.addEventListener("click",()=>{
    if(!ED.delArm){ ED.delArm=true; els.edDelete.textContent="TAP AGAIN TO DELETE"; return; }
    const uid=ED.sp.uid, key="my:"+uid;
    deleteMyPlay(uid);
    delete AUDIBLES[key]; Object.keys(AUDIBLES).forEach(k=>{ AUDIBLES[k]=AUDIBLES[k].filter(x=>x!==key); });
    saveMyPlays();
    if(state.book==="custom" && state.playPick===ED.sp.name) state.playPick="random";
    saveSettings();
    state.book="custom"; showScreen("playbookScreen");
  });
  els.edBack.addEventListener("click",()=>{
    if(ED.dirty && !ED.backArm){ ED.backArm=true; edHint("Unsaved changes — tap ◀ again to leave without saving",true); return; }
    showScreen("playbookScreen");
  });
  window.addEventListener("resize",()=>{ if(!els.editorScreen.classList.contains("hidden")){ edSize(); edDraw(); } });
  els.pickDone.addEventListener("click",()=>{ els.pickSheet.classList.add("hidden"); if(PICK){ PICK.onDone(PICK.sel.slice()); PICK=null; } });
  els.pbCloseBtn.addEventListener("click",()=>{ els.pbDetail.classList.add("hidden"); els.pbGrid.classList.remove("hidden"); });
  els.pbRunBtn.addEventListener("click",()=>{
    if(!pbOpen) return;
    if(pbOpen.custom){ state.book="custom"; state.squad=pbOpen.squad; }
    state.playPick=pbOpen.name; refreshSetupUI(); showScreen("drillsScreen");
  });
  els.pbEditBtn.addEventListener("click",()=>{
    if(!pbOpen) return;
    if(pbOpen.custom){ const sp=MY_PLAYS.find(q=>q.uid===pbOpen.uid); if(sp) openEditor(sp,false); }
    else openEditor(playToStored(pbOpen),true);
  });
  els.pbAudBtn.addEventListener("click",()=>{
    if(!pbOpen) return; const p=pbOpen;
    openPicker("AUDIBLES · "+p.name, p.squad, p.key, AUDIBLES[p.key]||[], keys=>{ AUDIBLES[p.key]=keys; saveMyPlays(); pbAudSync(playByKey(p.key)||p); });
  });
  els.audibleBtn.addEventListener("click",openAudible);
  els.audClose.addEventListener("click",closeAudible);
  els.field.addEventListener("pointerdown",(e)=>{
    if(!AUD.open || state.phase!=="study") return;
    const pt=ptField(e); let hit=null, hd=999;
    state.rep.targets.forEach(p=>{ if(!p._px) return; const d=Math.hypot(p._px.x-pt.px,p._px.y-pt.py); if(d<34 && d<hd){ hd=d; hit=p; } });
    if(hit){ AUD.sel=hit.id; renderAudible(); audDraw(); }
  });
  els.callRandom.addEventListener("click",()=>pickCall(null));
  els.codeSheet=document.getElementById("codeSheet");
  ["codeTitle","codeSub","codeText","codeMsg","codeMain","codeShare","codeClose","pbShareBtn"].forEach(id=>{ els[id]=document.getElementById(id); });
  els.codeMain.addEventListener("click",()=>{
    if(CODE_MODE==="share"){
      const done=()=>{ els.codeMsg.textContent="Copied ✓"; };
      try{ if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(els.codeText.value).then(done,()=>{ els.codeText.select(); document.execCommand("copy"); done(); });
           else { els.codeText.select(); document.execCommand("copy"); done(); } }catch(_){ els.codeMsg.textContent="Select the code and copy it."; }
      return;
    }
    try{
      const sp=decodePlay(els.codeText.value);
      let name=sp.name, base=name, k=2; while(MY_PLAYS.some(q=>q.name===name && q.squad===sp.squad)) name=base+" "+(k++);
      sp.name=name; sp.upd=Date.now(); MY_PLAYS.push(sp); saveMyPlays();
      els.codeSheet.classList.add("hidden");
      state.book="custom"; showScreen("playbookScreen");
      const p=BOOKS.custom.plays[sp.squad].find(q=>q.uid===sp.uid); if(p) openPlay(p);
    }catch(err){ els.codeMsg.textContent=err.message; }
  });
  els.codeShare.addEventListener("click",()=>{ try{ navigator.share({title:"QB Brain play", text:els.codeText.value}).catch(()=>{}); }catch(_){} });
  els.codeClose.addEventListener("click",()=>els.codeSheet.classList.add("hidden"));
  els.pbShareBtn.addEventListener("click",()=>{
    if(!pbOpen) return;
    const sp = pbOpen.custom ? MY_PLAYS.find(q=>q.uid===pbOpen.uid) : playToStored(pbOpen);
    if(!pbOpen.custom) sp.name=pbOpen.name;
    if(sp) openShare(sp);
  });
}

export { SQUAD_IDS, FORMS, DEFAULT_ROUTES, QB_ALIGN, newUid, newStoredPlay, applyFormation, playToStored, ED, EDV, edScale, edP, edF, edPlayer, edTargets, edSize, edHint, edDefaultHint, drawArrowHead, edDraw, chip, edChanged, edRenderTools, edToDraw, edRenderMain, edRenderProg, edFinishOrder, edRenderPitch, edRenderAud, edLocal, edHitPlayer, snapH, edEndDrag, openEditor, edValidate, edSave, PICK, openPicker, drawPlayDiagram, playKindLabel, pbOpen, openPlay, renderPlaybook, pbAudSync, AUD, audibleShow, openAudible, closeAudible, renderAudible, audDraw, hotRoute, doAudible, CALL, showCallSheet, pickCall, CODE_PREFIX, cleanText, num, b64enc, b64dec, encodePlay, OK_IDS, decodePlay, CODE_MODE, openShare, openImport };
