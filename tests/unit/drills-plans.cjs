require('./_stub.cjs');
const S=window.__qbSim, P=window.__qbProfile, st=window.__qbState;
for(const k of Object.keys(P.DRILLS)){
  const D=P.DRILLS[k]; P.startDrill(D);
  const cov={}, dk={}, plays={}; let dg=0, keys=0;
  for(let i=0;i<120;i++){ const r=S.buildRep(); cov[r.shownCoverage+(r.disguised?"→"+r.actualCoverage:"")]=(cov[r.shownCoverage+(r.disguised?"→"+r.actualCoverage:"")]||0)+1; if(r.disguised){dg++; dk[r.disguiseKind]=(dk[r.disguiseKind]||0)+1;} plays[r.play.name]=1; if(r.keyRead) keys++; }
  console.log(D.name, "| mode", st.mode, "| disguised", dg+"/120", JSON.stringify(dk), "| keys", keys, "| plays", Object.keys(plays).length, "\n   ", Object.entries(cov).sort((a,b)=>b[1]-a[1]).slice(0,6).map(e=>e[0]+":"+e[1]).join("  "));
}

// ---- pass/fail ----
P.startDrill(P.DRILLS.rotation); let dg=0; for(let i=0;i<100;i++) if(S.buildRep().disguised) dg++;
if(dg<60) { console.error('FAIL: rotation drill not disguising'); process.exitCode=1; }
