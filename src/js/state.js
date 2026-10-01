import { MODES } from "./config.js";
import { BOOKS } from "./plays.js";
import { getDoc, load, save } from "./store.js";

/* ============================================================
   STATE
============================================================ */
const state = {
  squad:5, difficulty:"rookie", mode:"qb_brain", showProgression:false, sound:true, stickSide:"left", coachTalk:"auto", rush7:"clock", adaptive:false, throwMode:"pull",
  book:"standard", playPick:"random", throwType:"bullet", drillMode:"qb_brain",
  driveCfg:{len:50, width:30, widthTouched:false, fd:"mid"}, drive:null,
  session:{reps:0, score:0, log:[]},
  rep:null, phase:"idle"
};

const els = {};

/* ---- remember setup choices between visits (per device; safe if storage is unavailable) ---- */
let DEFAULT_SETTINGS=null;   // the untouched defaults; never saved, so they can't overrule real choices from another device
function settingsSnapshot(){
  const o={}; ["squad","difficulty","mode","drillMode","showProgression","sound","stickSide","coachTalk","rush7","adaptive","throwMode","book","playPick"].forEach(k=>o[k]=state[k]);
  o.driveCfg=JSON.parse(JSON.stringify(state.driveCfg)); return o;
}
function loadSettings(){
  if(DEFAULT_SETTINGS===null) DEFAULT_SETTINGS=JSON.stringify(settingsSnapshot());
  try{
    const o=load("settings",null); if(!o) return;
    ["squad","difficulty","mode","drillMode","showProgression","sound","stickSide","coachTalk","rush7","adaptive","throwMode","book","playPick"].forEach(k=>{ if(o[k]!==undefined) state[k]=o[k]; });
    if(!MODES[state.drillMode] || state.drillMode==="drive") state.drillMode="qb_brain";
    if(o.driveCfg) Object.assign(state.driveCfg,o.driveCfg);
    if(!MODES[state.mode]) state.mode="qb_brain";
    if(!BOOKS[state.book]) state.book="standard";
  }catch(_){}
}
function saveSettings(){
  try{
    const o=settingsSnapshot();
    if(!getDoc("settings") && JSON.stringify(o)===DEFAULT_SETTINGS) return;
    save("settings",o);
  }catch(_){}
}
function currentPlays(){
  const b=BOOKS[state.book]; const pl=b && b.plays[state.squad];
  return (pl && pl.length) ? pl : BOOKS.standard.plays[state.squad];
}

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  ["homeScreen","drillsScreen","driveScreen","playbookScreen","settingsScreen","drillsBookSlot","driveBookSlot","bookBlock","driveStartBtn","settingsSummary","bigBanner","bigBannerText","pbTabs","pbGrid","pbDetail","pbDetailCanvas","pbDetailName","pbDetailProg","pbDetailNote","pbRunBtn","pbCloseBtn","logTitle","driveGroup","lenRange","lenVal","widRange","widVal","fdRow","driveLine","hudRepLbl","summaryTitle","againBtn","bookRow","playSelect","throwType","playNote","throwRow","stickRow","joy","joyBase","joyKnob","aimHint","playTag","controls","gameScreen","summaryScreen","field","fieldWrap","hud","hudMode","hudSub","hudRep","hudScore",
   "timerBarWrap","timerBar","studyBanner","studyCount","rushCue","rushCount","coverageSheet","mcqOptions",
   "resultSheet","resultTag","resultText","resultSub","resultExplain","scoreRow","nextRepBtn","primaryBtn",
   "quitBtn","startBtn","restartBtn","squadRow","diffRow","modeRow","progSwitch","soundSwitch",
   "summarySub","statGrid","strengthRow","repLog"
  ].forEach(id=>{ els[id]=document.getElementById(id); });
}

export { state, els, loadSettings, saveSettings, currentPlays, settingsSnapshot, DEFAULT_SETTINGS };
