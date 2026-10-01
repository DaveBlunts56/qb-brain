/* ============================================================
   CONFIG
============================================================ */
// Rush: rusher lines up 7 yds off the ball (standard flag rule) and chases whoever holds the ball.
const DIFFICULTY = {
  // rusher leaves on the snap from 7 yds off; time to get home on a straight rush vs a QB at the end of his 3-step drop:
  // rookie ≈ 2.9s, varsity ≈ 2.3s, elite ≈ 1.2–1.5s (a real speed rusher)
  rookie:  {label:"Rookie",  study:5.0, rushDelay:0.05, rushSpeed:3.8, rushAccel:18, delayPlan:0.75, reactionDelay:0.40, disguiseChance:0.00},
  varsity: {label:"Varsity", study:3.5, rushDelay:0.05, rushSpeed:4.8, rushAccel:18, delayPlan:0.75, reactionDelay:0.25, disguiseChance:0.25},
  elite:   {label:"Elite",   study:2.5, rushDelay:0.02, rushSpeed:10.0, rushAccel:26, delayPlan:0.15, reactionDelay:0.18, disguiseChance:0.50}
};
const MODES = {
  qb_brain:    {label:"QB Brain",    askCoverageChance:0.55, throws:true},
  coverage_id: {label:"Coverage ID", askCoverageChance:1.00, throws:false},
  quick_read:  {label:"Quick Read",  askCoverageChance:0.00, throws:true},
  drive:       {label:"Full Drive",  askCoverageChance:0.30, throws:true}
};
const RUN_SPEED=7.0, QB_SPEED=5.0, CENTER_X=15; // CENTER_X = middle of the 30-yd template plays are drawn on

/* ---- Field geometry ----
   Plays are authored on a 30-yd-wide template and mapped onto the real field width.
   y is always measured from the line of scrimmage (LOS = 0, positive = downfield). */
const GEO = {W:30, CX:15, kx:1, zs:1, yMin:-12, yMax:40};
function setGeometry(W, yMin, yMax){
  GEO.W=W; GEO.CX=W/2; GEO.kx=clamp(W/30,0.75,1.35); GEO.zs=W/30; GEO.yMin=yMin; GEO.yMax=yMax;
}
function TX(x){ return GEO.CX+(x-CENTER_X)*GEO.kx; }   // template x -> field x (players/routes)
function ZX(x){ return GEO.CX+(x-CENTER_X)*GEO.zs; }   // template x -> field x (zone landmarks)
const COLORS={Q:"#f5f3ec",C:"#b8bec6",X:"#ff8c2a",Y:"#b35ce8",Z:"#22b3a6",T:"#7fd1c9",H:"#f2c14e",F:"#5aa0ff",S:"#b8bec6"};

function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function lerp(a,b,f){ return a+(b-a)*f; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function choice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
/* ---- tiny event hooks: features subscribe instead of overriding each other's functions ---- */
const HOOKS={};
function on(name,fn){ (HOOKS[name]=HOOKS[name]||[]).push(fn); }
function emit(name,...args){ (HOOKS[name]||[]).forEach(fn=>fn(...args)); }
function shuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

export function init(){}

export { DIFFICULTY, MODES, RUN_SPEED, QB_SPEED, CENTER_X, GEO, setGeometry, TX, ZX, COLORS, dist, lerp, clamp, choice, HOOKS, on, emit, shuffle };
