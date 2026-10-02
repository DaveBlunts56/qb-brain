import { setupCanvas } from "./canvas.js";
import { DIFFICULTY, MODES, emit, on } from "./config.js";
import { downText, isDrive, newDrive, spotText } from "./drive.js";
import { startRep } from "./loop.js";
import { renderPlaybook } from "./playbook.js";
import { BOOKS } from "./plays.js";
import { SFX } from "./sound.js";
import { currentPlays, els, loadSettings, saveSettings, state } from "./state.js";
import { endSession } from "./summary.js";

/* ============================================================
   SETUP SCREEN
============================================================ */
function buildChoiceRow(container, items, currentKey, onPick){
  container.innerHTML="";
  items.forEach(item=>{
    const b=document.createElement("button");
    b.className="choice"+(item.key===currentKey?" active":"");
    b.disabled=!!item.disabled;
    b.innerHTML="<b>"+item.title+"</b><small>"+item.sub+"</small>";
    b.addEventListener("click",()=>{ onPick(item.key); refreshSetupUI(); });
    container.appendChild(b);
  });
}
function refreshSetupUI(){
  const myN=(BOOKS.custom.plays[state.squad]||[]).length;
  buildChoiceRow(els.bookRow,[
    {key:"standard",title:BOOKS.standard.label,sub:BOOKS.standard.sub},
    {key:"custom",title:"My Plays",sub: myN ? myN+" for "+state.squad+"v"+state.squad : "None for "+state.squad+"v"+state.squad+" yet", disabled:!myN && state.book!=="custom"}
  ], state.book, k=>{ state.book=k; state.playPick="random"; });

  buildChoiceRow(els.squadRow,[
    {key:5,title:"5v5",sub:"QB, center + 3 receivers"},
    {key:7,title:"7v7",sub:"6 eligible receivers"}
  ], state.squad, k=>{ state.squad=k; state.playPick="random"; if(!state.driveCfg.widthTouched) state.driveCfg.width = k===7?40:30; });

  const dc=state.driveCfg;
  els.lenRange.value=dc.len; els.lenVal.textContent=dc.len;
  els.widRange.value=dc.width; els.widVal.textContent=dc.width;
  buildChoiceRow(els.fdRow,[
    {key:"mid",title:"Midfield, then goal",sub:"Standard flag: cross midfield for a new set of downs"},
    {key:"ten",title:"Every 10 yards",sub:"Classic chains"}
  ], dc.fd, k=>dc.fd=k);

  buildChoiceRow(els.diffRow,[
    {key:"rookie",title:"Rookie",sub:"Slow rush, simple looks"},
    {key:"varsity",title:"Varsity",sub:"Faster rush, some disguise"},
    {key:"elite",title:"Elite",sub:"Fast rush, frequent disguise"}
  ], state.difficulty, k=>state.difficulty=k);

  buildChoiceRow(els.modeRow,[
    {key:"qb_brain",title:"QB Brain",sub:"Call the coverage, then make the read"},
    {key:"coverage_id",title:"Coverage ID",sub:"Identify the defense only, no throw"},
    {key:"quick_read",title:"Quick Read",sub:"Skip the ID question, find the throw fast"},
    {key:"film",title:"Film Room",sub:"Read the look, name the key, pick the read — then see the rotation"}
  ], state.drillMode, k=>state.drillMode=k);

  buildChoiceRow(els.throwRow,[
    {key:"pull",title:"Pullback",sub:"Pull back = lob · 2nd finger = bullet"},
    {key:"tap",title:"Tap receiver",sub:"Tap = bullet · hold = lob"}
  ], state.throwMode, k=>state.throwMode=k);

  buildChoiceRow(els.stickRow,[
    {key:"left",title:"Left thumb",sub:"Stick bottom-left · throw with your right"},
    {key:"right",title:"Right thumb",sub:"Stick bottom-right · throw with your left"}
  ], state.stickSide, k=>state.stickSide=k);

  const plays=currentPlays();
  els.playSelect.innerHTML="";
  const o0=document.createElement("option"); o0.value="random"; o0.textContent="All plays (random)"; els.playSelect.appendChild(o0);
  plays.forEach(p=>{ const o=document.createElement("option"); o.value=p.name; o.textContent=p.name+(p.kind==="run"?" (run)":p.kind==="trick"?" (trick)":""); els.playSelect.appendChild(o); });
  els.playSelect.value=state.playPick;

  els.progSwitch.classList.toggle("on", state.showProgression);
  els.soundSwitch.classList.toggle("on", state.sound);
  els.settingsSummary.textContent = state.squad+"v"+state.squad+" · "+DIFFICULTY[state.difficulty].label+" · "+(state.throwMode==="pull"?"Pullback meter":"Tap to throw");
  if(!els.playbookScreen.classList.contains("hidden")) renderPlaybook();
  emit("setup");
  saveSettings();
}

function flipProg(){
  state.showProgression=!state.showProgression;
  els.progSwitch.classList.toggle("on", state.showProgression);
  saveSettings();
}

function flipSound(){
  state.sound=!state.sound;
  els.soundSwitch.classList.toggle("on", state.sound);
  saveSettings(); if(state.sound) SFX.whistle();
}

function syncThrowType(){
  Array.from(els.throwType.querySelectorAll("button")).forEach(b=>b.classList.toggle("on",b.dataset.k===state.throwType));
}

// iPhone tip: only on the installable (GitHub) build, only in Safari, only when not already installed

/* ---- screens ---- */
const SCREENS=["homeScreen","drillsScreen","driveScreen","playbookScreen","settingsScreen","gameScreen","summaryScreen"];
function showScreen(id){
  SCREENS.forEach(k=>els[k].classList.toggle("hidden",k!==id));
  if(id==="drillsScreen") els.drillsBookSlot.appendChild(els.bookBlock);
  if(id==="driveScreen") els.driveBookSlot.appendChild(els.bookBlock);
  if(id==="playbookScreen"){ els.pbDetail.classList.add("hidden"); els.pbGrid.classList.remove("hidden"); renderPlaybook(); }
  if(els[id] && els[id].scrollTo) els[id].scrollTo(0,0);
  emit("screen",id);
}

function startSession(mode,extra){
  state.mode=mode;
  state.forceCoverage = extra && extra.coverage || null;
  state.plan = extra && extra.plan || null;
  saveSettings();
  state.session={reps:0, score:0, log:[], t0:Date.now(), challenge: extra && extra.challenge || null};
  state.drive = mode==="drive" ? newDrive() : null;
  showScreen("gameScreen");
  updateHud();
  setupCanvas();
  startRep();
}

function updateHud(){
  els.hudMode.textContent = MODES[state.mode].label.toUpperCase();
  const d=state.drive;
  if(isDrive() && d){
    els.hudSub.textContent = d.over ? d.result : downText(d)+" · "+spotText(d,d.ballOn);
    els.hudRepLbl.textContent="PLAY";
    els.hudRep.textContent = d.over ? d.plays.length : d.plays.length+1;
  } else {
    els.hudSub.textContent = state.plan && state.plan.name ? state.plan.name : state.squad+"v"+state.squad+" · "+DIFFICULTY[state.difficulty].label+(state.adaptive?" · Adaptive":state.book==="custom"?" · My Plays":"");
    els.hudRepLbl.textContent="REP";
    els.hudRep.textContent = state.session.reps+1;
  }
  els.hudScore.textContent = state.session.score;
}

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  els.playSelect.addEventListener("change",()=>{ state.playPick=els.playSelect.value; saveSettings(); });
  els.lenRange.addEventListener("input",()=>{ state.driveCfg.len=+els.lenRange.value; els.lenVal.textContent=els.lenRange.value; });
  els.widRange.addEventListener("input",()=>{ state.driveCfg.width=+els.widRange.value; state.driveCfg.widthTouched=true; els.widVal.textContent=els.widRange.value; });
  els.progSwitch.addEventListener("click",flipProg);
  els.soundSwitch.addEventListener("click",flipSound);
  els.soundSwitch.addEventListener("keydown",(e)=>{ if(e.key===" "||e.key==="Enter"){ e.preventDefault(); flipSound(); } });
  els.progSwitch.addEventListener("keydown",(e)=>{ if(e.key===" "||e.key==="Enter"){ e.preventDefault(); flipProg(); } });
  els.lenRange.addEventListener("change",saveSettings);
  els.widRange.addEventListener("change",saveSettings);
  Array.from(els.throwType.querySelectorAll("button")).forEach(b=>{
    b.addEventListener("click",()=>{ state.throwType=b.dataset.k; syncThrowType(); });
  });
  loadSettings();
  on("data:changed",k=>{ if(k==="settings"){ loadSettings(); refreshSetupUI(); } });
  refreshSetupUI();
  (function(){
    const tip=document.getElementById("installHint"); if(!tip || !window.QB_PWA) return;
    const ios=/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
    const standalone=window.navigator.standalone===true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    let dismissed=false; try{ dismissed=localStorage.getItem("qbbrain.tipDismissed")==="1"; }catch(_){}
    if(ios && !standalone && !dismissed) tip.classList.remove("hidden");
    const x=document.getElementById("installClose");
    if(x) x.addEventListener("click",()=>{ tip.classList.add("hidden"); try{ localStorage.setItem("qbbrain.tipDismissed","1"); }catch(_){} });
  })();
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showScreen(b.dataset.go)));
  els.drillsBookSlot.appendChild(els.bookBlock);
  els.startBtn.addEventListener("click",()=>startSession(state.drillMode));
  els.driveStartBtn.addEventListener("click",()=>startSession("drive"));
  els.restartBtn.addEventListener("click",()=>showScreen("homeScreen"));
  els.againBtn.addEventListener("click",()=>startSession(state.mode,{coverage:state.forceCoverage, plan:state.plan}));
  els.quitBtn.addEventListener("click", endSession);
}

export { buildChoiceRow, refreshSetupUI, flipProg, flipSound, syncThrowType, SCREENS, showScreen, startSession, updateHud };
