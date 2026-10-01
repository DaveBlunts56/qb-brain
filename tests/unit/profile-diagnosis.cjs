require('./_stub.cjs');
const P=window.__qbProfile;
const recs=P.recs;
const mk=(o)=>Object.assign({t:Date.now(),m:"quick_read",sq:5,d:"varsity",cov:"Cover 3",sh:"Cover 3",dg:0,dk:null,shell:"one-high, 3 deep",ashell:"one-high, 3 deep",con:"Smash",res:"GOOD READ",rel:1.6,first:1,fOpen:1,fr:1,miss:0,tw:0,pr:0,stare:0,kr:1,kt:"ontime",cid:null,mz:null},o);
for(let i=0;i<10;i++) recs.push(mk({}));
for(let i=0;i<6;i++) recs.push(mk({dg:1,dk:"rotation",sh:"Cover 2",cov:"Cover 3",shell:"two-high",ashell:"one-high, 3 deep",res:i<5?"COVERED":"GOOD READ",cid:0,mz:1}));
for(let i=0;i<6;i++) recs.push(mk({first:1,stare:1,miss:1,res:"INTERCEPTED",tw:1,kr:0,kt:"late"}));
for(let i=0;i<5;i++) recs.push(mk({pr:1,res:"SACKED",rel:null}));
const M=P.profileMetrics(); 
console.log({release:M.release.toFixed(2), key:M.key, stare:M.stare, tw:M.tw, pressure:M.pressure, rot:M.rotTwoHigh, covRank:M.covRank});
P.profileDiagnose(M).forEach(d=>console.log("-",Math.round(d.sev),d.text,"=>",d.dr.name));

// ---- pass/fail ----
const D=P.profileDiagnose(M);
if(!D.length || D[0].dr.name!=='Post-Snap Rotation Drill') { console.error('FAIL: diagnosis'); process.exitCode=1; }
