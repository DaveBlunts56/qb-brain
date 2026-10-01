require('./_stub.cjs');
const S=window.__qbSim, M=window.__qbMy, st=window.__qbState;
let n=0, bad=[];
function run(sp){
  const play=M.myToPlay(sp); play.squad=sp.squad;
  st.squad=sp.squad;
  for(const diff of ["rookie","elite"]){
    const rep=S.buildRep({squad:sp.squad,difficulty:diff,play}); st.rep=rep;
    let t=0,dt=1/60, thrown=false;
    while(t<4){ t+=dt; S.stepPlayers(rep,t,dt); S.updateDefenders(rep,t,dt); S.updateRusher(rep,t,dt);
      if(!thrown && t>1.6 && S.holderAt(rep,t)){ const tg=rep.targets[0]; const from=S.passerPos(rep,t); S.releaseBall(rep,t,from,S.posAt(tg,t+0.8),"lob"); thrown=true; }
      for(const p of rep.players){ if(!isFinite(p.s.x)||!isFinite(p.s.y)) { bad.push(sp.name+" "+p.id); return; } }
      for(const d of rep.defenders){ if(!isFinite(d.pos.x)) { bad.push(sp.name+" def"); return; } }
    }
    n++;
  }
}
for(const sq of [5,7]){
  // every library route on every receiver, with flips and depths
  M.LIB_ORDER.forEach((type,i)=>{
    const sp=M.newStoredPlay(sq); sp.name=sq+" lib "+type;
    sp.players.forEach(p=>{ if(p.id!=="Q") p.route={mode:"lib",type,flip:i%2===1,depth: (i%3)+3}; });
    run(sp);
  });
  Object.keys(M.QB_ACTIONS).forEach(a=>{ const sp=M.newStoredPlay(sq); sp.name=sq+" qb "+a; sp.players[0].route={mode:"qb",action:a}; run(sp); });
  // pitch to every player, empty drawn routes, delays
  M.SQUAD_IDS[sq].filter(id=>id!=="Q").forEach(id=>{ const sp=M.newStoredPlay(sq); sp.name=sq+" pitch "+id; sp.pitch={to:id,at:0.9};
    const p=sp.players.find(q=>q.id===id); p.route={mode:"draw",rel:[[-3,-3],[-6,-3.5]]}; p.after="stop"; run(sp); });
  const sp=M.newStoredPlay(sq); sp.name=sq+" empty draw"; sp.players.forEach(p=>{ if(p.id!=="Q"){ p.route={mode:"draw",rel:[]}; p.delay=1.5; } }); run(sp);
  // copies of every built-in play
  ["standard","bigdawz"].forEach(bk=>{ (S.BOOKS[bk].plays[sq]||[]).forEach(pl=>{ const c=M.playToStored(pl); c.squad=sq; run(c); }); });
}
console.log("reps",n,"bad",bad);

// ---- pass/fail ----
if(bad.length || n<150) { console.error('FAIL'); process.exitCode=1; }
