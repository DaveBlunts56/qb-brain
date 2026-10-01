import { COLORS, DIFFICULTY, GEO, MODES, QB_SPEED, RUN_SPEED, TX, choice, clamp, dist, lerp } from "./config.js";
import { DEF_TUNE, applyShownAlignment, buildDefense, pickRushPlan } from "./defense.js";
import { isDrive } from "./drive.js";
import { setupKeyRead } from "./keyread.js";
import { tutRepCfg } from "./learn.js";
import { mkPath, posAt } from "./paths.js";
import { currentPlays, state } from "./state.js";
import { currentPlan, disguiseChanceFor, pickActualCoverage, pickShownCoverage, shellOf } from "./train.js";

/* ============================================================
   BUILD A REP
============================================================ */
// QB 3-step drop: three drop steps (~0.75 yd each) after the snap, then he sets.
// A shotgun-depth QB moves up so he sets at the same depth he used to stand at.
const DROP_STEP=0.75, DROP_STEPS=3, DROP_TIME=0.75;
function dropRoute(p){
  if(p.id!=="Q" || p.target || p.route.pts.length>1) return null;
  const len=DROP_STEP*DROP_STEPS, y0 = p.y>-3 ? p.y : p.y+len, y1=y0-len;
  return {y0, pts:[[p.x,y0],[p.x,y1]], speed:len/DROP_TIME};
}
function makePlayer(p){
  const dr=dropRoute(p);
  if(dr){
    return {id:p.id, color:COLORS[p.id]||"#f2c14e", x0:clamp(TX(p.x),1,GEO.W-1), y0:dr.y0, name:"3-step drop",
      path:mkPath(dr.pts,dr.speed,"stop",0.1), target:false, dashed:false, stride:DROP_STEP, drop:true};
  }
  const passerLike = (p.id==="Q"||p.id==="T") && !p.target;
  const speed = p.speed || (passerLike||p.route.name==="rollout"||p.route.name==="bootleg"||p.route.name==="slide"||p.route.name==="slide left"||p.route.name==="drift right" ? QB_SPEED : RUN_SPEED);
  // the center has to snap first, so his release is a beat late
  const delay = p.delay!==undefined ? p.delay : (p.id==="C" ? 0.3 : 0);
  return {id:p.id, color:COLORS[p.id]||"#f2c14e", x0:clamp(TX(p.x),1,GEO.W-1), y0:p.y, name:p.route.name,
    path:mkPath(p.route.pts,speed,p.route.after,delay), target:p.target, dashed:!!p.dashed, stride:p.stride};
}
function buildRep(opts){
  opts=opts||{};
  if(state.tut && !opts.keep){ const c=tutRepCfg(); opts=Object.assign({},opts,{play:c.play, coverage:c.coverage, askCoverage:c.ask}); }
  else if(state.forceCoverage && !opts.coverage && !opts.keep) opts=Object.assign({},opts,{coverage:state.forceCoverage});
  const squad = opts.squad||state.squad;
  const diff = DIFFICULTY[opts.difficulty||state.difficulty];
  const plan = opts.keep ? {} : currentPlan();
  let plays = opts.plays || currentPlays();
  if(plan.plays && !opts.play){ const f=plays.filter(p=>plan.plays.includes(p.name)); if(f.length) plays=f; }
  const pick = plan.plays ? "random" : (opts.playName || state.playPick);
  const play = opts.play || (pick!=="random" && plays.find(p=>p.name===pick)) || choice(plays);
  const players = play.players.map(makePlayer);
  const targets = players.filter(p=>p.target);
  const sevenClock = squad===7 && state.rush7!=="rusher" && !state.tut;
  const nDef = squad===5?4:(sevenClock?7:6);

  const keep = opts.keep;   // audible: same defense, new play
  let disguised = keep ? keep.disguised : opts.coverage ? false : Math.random() < disguiseChanceFor(plan,diff,squad);
  const shownCoverage = keep ? keep.shownCoverage : opts.coverage || pickShownCoverage(Object.assign({forceRotation:disguised},plan),squad);
  let actualCoverage = keep ? keep.actualCoverage : shownCoverage, disguiseKind = keep ? keep.disguiseKind : null;
  if(disguised && !keep){
    const a=pickActualCoverage(shownCoverage,plan,squad); actualCoverage=a.cov; disguiseKind=a.kind;
    if(actualCoverage===shownCoverage) disguised=false;
  }
  let tune = DEF_TUNE[opts.difficulty||state.difficulty] || DEF_TUNE.varsity;
  if(plan.eyesMul) tune=Object.assign({},tune,{eyes:Math.min(0.95,tune.eyes*plan.eyesMul)});
  if(plan.rushPlans) tune=Object.assign({},tune,{plans:plan.rushPlans});
  const defenders = buildDefense(actualCoverage, targets, nDef, tune);
  if(actualCoverage!==shownCoverage) applyShownAlignment(defenders, shownCoverage, targets, nDef, tune);
  const rushPlan = keep ? keep.rushPlan : sevenClock ? "none" : opts.rushPlan || pickRushPlan(tune);
  const rx = keep ? keep.rusher.x : rushPlan==="edge" ? GEO.CX+(Math.random()<0.5?-1:1)*Math.min(7,GEO.W*0.25) : GEO.CX;

  const out = {
    play, players, targets, squad,
    passer: play.passer || [{id:"Q"}],
    shownCoverage, actualCoverage, disguised, disguiseKind, defenders, plan,
    rusher:{x:rx,y:7,vel:{x:0,y:0}}, rushStart:null, rushPlan, tune,
    askCoverage: keep ? keep.askCoverage : opts.askCoverage!==undefined ? opts.askCoverage : Math.random() < MODES[state.mode].askCoverageChance,
    tStudy: diff.study, rushDelay: diff.rushDelay, rushSpeed: diff.rushSpeed*(plan.rushMul||1), rushAccel: diff.rushAccel, delayPlan: diff.delayPlan, reactionDelay: diff.reactionDelay,
    ball:null
  };
  initLive(out);
  buildBallTimeline(out);
  if(rushPlan==="none"){ out.rusher.dropped=true; out.rusher.x=-50; out.rusher.y=40; out.clock=4.0; }
  setupKeyRead(out);
  out.shellShown=shellOf(defenders);
  out.goalRel = isDrive()&&state.drive ? state.drive.len-state.drive.ballOn : 1e9;
  return out;
}
function playerById(rep,id){ return rep.players.find(p=>p.id===id); }

/* ---- Live movement ----
   Each player chases a "rabbit" that runs the drawn route, limited by real top speed and
   acceleration, so cuts get rounded and stops take a step instead of being instant.
   Once the ball is thrown, the receiver who can get there first reads it and runs to it. */
const ACCEL=22, CHASE_SPEED=7.8;
// Scramble rule (tournament): the QB may move around, but can never cross the line of scrimmage.
const SCRAMBLE_SPEED=6.2, SCRAMBLE_MAX_Y=-0.6, JOY_DEAD=0.15;
function initLive(rep){
  rep.players.forEach(p=>{ p.s={x:p.x0,y:p.y0,vx:0,vy:0}; p.hist=[{t:0,x:p.x0,y:p.y0}]; });
}
function livePos(p){ return {x:p.s.x,y:p.s.y}; }
function histPos(p,tq){
  const h=p.hist;
  if(tq<=h[0].t) return {x:h[0].x,y:h[0].y};
  for(let i=h.length-1;i>0;i--){
    if(h[i-1].t<=tq){ const a=h[i-1], b=h[i], f=(b.t-a.t)>1e-6?(tq-a.t)/(b.t-a.t):1; return {x:lerp(a.x,b.x,clamp(f,0,1)),y:lerp(a.y,b.y,clamp(f,0,1))}; }
  }
  return {x:h[0].x,y:h[0].y};
}
function stepPlayers(rep,t,dt){
  const b=rep.ball;
  rep.players.forEach(p=>{
    if(p===rep.carrier) return;
    const s=p.s;
    let tx,ty,vmax=p.path.speed+0.3,gain=6;
    const scr=rep.scr;
    if(scr && !b){ const h=holderAt(rep,t); if(h) scr.id=h; }      // the stick always drives whoever has the ball
    const holding = scr && scr.id===p.id && !(b && b.chaser===p);
    if(b && b.chaser===p && t>=b.tRel+b.react){
      tx=b.to.x; ty=b.to.y; vmax=CHASE_SPEED; gain=9;          // go get the ball
    } else if(holding){
      // scramble with the joystick: push further = run faster; let go and he settles
      const m=Math.hypot(scr.jx,scr.jy);
      if(!b && scr.active && m>JOY_DEAD){
        const k=Math.min(1,(m-JOY_DEAD)/(1-JOY_DEAD));
        tx=s.x+scr.jx/m*3; ty=Math.min(s.y+scr.jy/m*3,SCRAMBLE_MAX_Y); vmax=SCRAMBLE_SPEED*k; gain=8;
      } else { tx=s.x; ty=s.y; vmax=SCRAMBLE_SPEED; gain=4; }
    } else {
      const q=posAt(p,t+0.12); tx=q.x; ty=q.y;                  // run the route
    }
    const dx=tx-s.x, dy=ty-s.y, d=Math.hypot(dx,dy);
    const want=Math.min(vmax,d*gain);
    let ax=(d>1e-4?dx/d*want:0)-s.vx, ay=(d>1e-4?dy/d*want:0)-s.vy;
    const a=Math.hypot(ax,ay), amax=ACCEL*dt;
    if(a>amax){ ax*=amax/a; ay*=amax/a; }
    s.vx+=ax; s.vy+=ay;
    s.x=clamp(s.x+s.vx*dt,0.8,GEO.W-0.8); s.y=clamp(s.y+s.vy*dt,GEO.yMin+0.5,GEO.yMax-0.8);
    if(holding && s.y>SCRAMBLE_MAX_Y){ s.y=SCRAMBLE_MAX_Y; if(s.vy>0) s.vy=0; }   // QB can never cross the line
    p.hist.push({t,x:s.x,y:s.y}); if(p.hist.length>400) p.hist.shift();
  });
}
// The receiver with the best chance to reach the landing spot reads the throw and adjusts to it.
function pickChaser(rep,to,flight){
  let best=null, bt=1e9;
  rep.targets.forEach(p=>{
    const tReach=dist(livePos(p),to)/CHASE_SPEED;
    const score=tReach-flight; // how late he'd be
    if(score<bt){ bt=score; best=p; }
  });
  return best;
}
/* ---- Ball timeline: the center snaps it to the first passer; later entries are pitches/laterals ----
   Each exchange travels through the air (snap ~13 yd/s, pitch ~11 yd/s); nobody can throw until they hold it. */
function buildBallTimeline(rep){
  const segs=[], C=playerById(rep,"C");
  const start = C ? {x:C.x0,y:C.y0} : {x:GEO.CX,y:0};
  const first=playerById(rep,rep.passer[0].id);
  const d0=dist(start,{x:first.x0,y:first.y0});
  let t = d0<2.2 ? 0.12 : d0/13;                                   // under center vs shotgun
  segs.push({air:true,from:start,to:first.id,t0:0,t1:t});
  rep.passer.forEach((sg,i)=>{
    const until = sg.until===undefined ? 1e9 : Math.max(sg.until,t+0.05);
    segs.push({air:false,id:sg.id,t0:t,t1:until});
    const nx=rep.passer[i+1];
    if(nx){
      const a=posAt(playerById(rep,sg.id),until), b=posAt(playerById(rep,nx.id),until+0.3);
      const dur=Math.max(0.15,dist(a,b)/11);
      segs.push({air:true,fromId:sg.id,to:nx.id,t0:until,t1:until+dur});
      t=until+dur;
    }
  });
  rep.ballSegs=segs; rep.snapDone=segs[0].t1;
}
function ballSegAt(rep,t){ for(const s of rep.ballSegs){ if(t>=s.t0 && t<s.t1) return s; } return rep.ballSegs[rep.ballSegs.length-1]; }
function holderAt(rep,t){ const s=ballSegAt(rep,t); return s.air?null:s.id; }
// who has (or is about to receive) the ball — the rusher and the aim both key off this player
function passerIdAt(rep,t){ const s=ballSegAt(rep,t); return s.air?s.to:s.id; }
function passerPos(rep,t){ return livePos(playerById(rep,passerIdAt(rep,t))); }
function ballAirPos(rep,t){
  const s=ballSegAt(rep,t); if(!s.air) return null;
  const a = s.from || s.fromPt || (s.fromPt = livePos(playerById(rep,s.fromId)));
  const b = livePos(playerById(rep,s.to));
  const f = clamp((t-s.t0)/(s.t1-s.t0),0,1);
  return {x:lerp(a.x,b.x,f), y:lerp(a.y,b.y,f)};
}

export function init(){}

export { DROP_STEP, DROP_STEPS, DROP_TIME, dropRoute, makePlayer, buildRep, playerById, ACCEL, CHASE_SPEED, SCRAMBLE_SPEED, SCRAMBLE_MAX_Y, JOY_DEAD, initLive, livePos, histPos, stepPlayers, pickChaser, buildBallTimeline, ballSegAt, holderAt, passerIdAt, passerPos, ballAirPos };
