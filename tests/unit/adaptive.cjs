require('./_stub.cjs');
const S=window.__qbSim, P=window.__qbProfile, st=window.__qbState;
const recs=P.recs;
const mk=(o)=>Object.assign({t:Date.now(),m:"quick_read",sq:5,d:"varsity",cov:"Cover 3",sh:"Cover 3",dg:0,dk:null,shell:"one-high, 3 deep",ashell:"one-high, 3 deep",con:"Smash",res:"GOOD READ",rel:1.6,first:1,fOpen:1,fr:1,miss:0,tw:0,pr:0,stare:0,kr:1,kt:"ontime",cid:null,mz:null},o);
for(let i=0;i<8;i++) recs.push(mk({cov:"Cover 2",sh:"Cover 2"}));             // great vs Cover 2
for(let i=0;i<6;i++) recs.push(mk({cov:"Man",sh:"Man",res:"COVERED"}));        // weak vs man
for(let i=0;i<6;i++) recs.push(mk({stare:1,miss:1,res:"INTERCEPTED",tw:1}));    // stares
for(let i=0;i<5;i++) recs.push(mk({pr:1,res:"SACKED",rel:null}));              // pressure
st.squad=5; st.adaptive=true; st.mode="quick_read";
console.log(JSON.stringify(window.__qbTrain.adaptivePlan(),null,0));
const cov={}; let dg=0, eyes=0, rush=0;
for(let i=0;i<300;i++){ const r=S.buildRep(); const k=r.shownCoverage+(r.disguised?"→"+r.actualCoverage:""); cov[k]=(cov[k]||0)+1; if(r.disguised) dg++; eyes+=r.tune.eyes; rush+=r.rushSpeed; }
console.log("disguised",dg,"/300  avg eyes",(eyes/300).toFixed(2)," avg rushSpeed",(rush/300).toFixed(2));
console.log(Object.entries(cov).sort((a,b)=>b[1]-a[1]).map(e=>e[0]+":"+e[1]).join("  "));
st.adaptive=false; let e2=0; for(let i=0;i<100;i++){ e2+=S.buildRep().tune.eyes; } console.log("adaptive off avg eyes",(e2/100).toFixed(2));

// ---- pass/fail ----
const pl=window.__qbTrain.adaptivePlan(); st.adaptive=true; let e3=0; for(let i=0;i<50;i++) e3+=S.buildRep().tune.eyes;
if(!/more Man/.test(pl.note) || !(e3/50 > e2/100)) { console.error('FAIL: adaptive plan'); process.exitCode=1; }
