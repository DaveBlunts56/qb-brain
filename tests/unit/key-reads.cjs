require('./_stub.cjs');
const S=window.__qbSim, K=window.__qbKey, st=window.__qbState;
st.mode="quick_read";
const out={}, stats={};
for(const sq of [5,7]) for(const bk of ["standard"]){ const plays=S.BOOKS[bk].plays[sq]; if(!plays) continue;
  for(const pl of plays) for(const cov of ["Man","Cover 1","Cover 2","Cover 3","Underneath Zone"]) for(let i=0;i<6;i++){
    st.squad=sq; st.difficulty="varsity";
    const rep=S.buildRep({squad:sq,play:pl,coverage:cov}); st.rep=rep;
    const key=bk+" "+sq+" "+pl.name;
    if(!rep.keyRead){ out[key]=out[key]||"none"; continue; }
    out[key]=K.keyPlanText(rep);
    let t=0,dt=1/60;
    while(t<2.6){ t+=dt; S.stepPlayers(rep,t,dt); S.updateDefenders(rep,t,dt); S.updateRusher(rep,t,dt); K.recordDefHist(rep,t); }
    const a=K.analyzeKeyRead(rep,1.8,rep.keyRead.A);
    const s=(stats[pl.name+" vs "+cov]=stats[pl.name+" vs "+cov]||{A:0,B:0,none:0,ex:""});
    if(!a){ s.none++; continue; }
    s[a.commit||"none"]++; if(!s.ex) s.ex=a.did+" → "+a.correctTxt;
  }}
console.log(out);
const pick=["Smash vs Cover 2","Smash vs Cover 3","Slant-Flat vs Cover 3","Flood vs Cover 3","Stick vs Cover 2","Four Verticals vs Cover 1","Drive vs Underneath Zone","Levels vs Cover 3","Spacing vs Cover 3","Smash vs Man"];
pick.forEach(k=>console.log(k, JSON.stringify(stats[k])));

// ---- pass/fail ----
const sm2=stats['Smash vs Cover 2'], sm3=stats['Smash vs Cover 3'];
if(!sm2 || !sm3 || sm2.B<sm2.A || sm3.A<sm3.B || out['standard 5 Smash'].indexOf('CB')<0) { console.error('FAIL: Smash key read'); process.exitCode=1; }
