// QB Brain Score, ranks and streaks: the maths behind the dashboard and the results card.
const path=require('path'), esbuild=require('esbuild');
const load=f=>{ const code=esbuild.buildSync({entryPoints:[path.join(__dirname,'../../src/js/'+f)],bundle:true,format:'cjs',write:false,logLevel:'error',define:{__QB_FEATURES__:'{}',__QB_CLOUD__:'null'}}).outputFiles[0].text;
  const m={exports:{}}; new Function('module','exports','require',code)(m,m.exports,require); return m.exports; };
const { sessionStats, rankFor, RANKS } = load('score.js');
let fails=0; const ok=(c,msg)=>{ if(!c){ fails++; console.error('FAIL',msg); } else console.log('ok  ',msg); };
const rep=(o)=>Object.assign({t:1,m:'qb_brain',sq:5,d:'elite',res:'GOOD READ',rel:1.4,tw:0,pr:0,cid:1},o);
// perfect Elite session = 100
let S=sessionStats(Array.from({length:6},()=>rep()));
ok(S.score===100,'perfect elite session scores 100 ('+S.score+')');
ok(sessionStats(Array.from({length:6},()=>rep({d:'rookie'}))).score===88,'same reps on Rookie are worth 88');
ok(sessionStats(Array.from({length:4},()=>rep())).score===null,'fewer than 5 reps: no score');
// coverage-only session: only the coverage part counts
S=sessionStats([1,1,1,0,0,1].map(c=>rep({res:null,rel:null,cid:c,d:'varsity'})));
ok(S.cov===67 && S.score===Math.round(67*0.95) && S.parts.speed===null,'Coverage ID mode: score is coverage % × difficulty ('+S.score+')');
// a mixed session, checked by hand
S=sessionStats([
  rep({res:'GOOD READ',rel:1.4,cid:1}), rep({res:'RISKY',rel:2.3,cid:0}), rep({res:'COVERED',rel:2.3,cid:1,tw:1,pr:1}),
  rep({res:'SACKED',rel:null,cid:null,pr:1}), rep({res:'GOOD READ',rel:3.2,cid:null,pr:1})]);
// decisions 3/5=60 · coverage 2/3=67 · speed (1+.5+.5+0+0)/5=40 · security 100-3*20=40 → (45*60+25*67+15*40+15*40)/100=55.75 → 56
ok(S.read===60 && S.cov===67 && S.parts.speed===40 && S.parts.security===40 && S.score===56,'mixed session matches the hand calculation ('+JSON.stringify(S.parts)+' → '+S.score+')');
ok(S.press===33 && S.pressN===3 && S.spd===2.3 && S.sacks===1,'under pressure 1 of 3, avg release 2.3s over throws only, 1 sack');
// ranks
const sess=(sc,d,n)=>Array.from({length:n},(_,i)=>({t:i,sc,d}));
ok(rankFor(sess(90,'elite',2)).rank===null,'unranked until 3 scored sessions');
ok(rankFor(sess(90,'elite',5)).rank.name==='FRANCHISE QB','90 avg on Elite = Franchise QB');
const rk=rankFor(sess(86,'rookie',10));
ok(rk.rank.name==='STARTER' && /Varsity or Elite/.test(rk.blocker),'86 avg all on Rookie stays Starter and says why ('+rk.rank.name+')');
ok(rankFor(sess(81,'varsity',6)).rank.name==='FIELD GENERAL','81 avg on Varsity = Field General');
ok(rankFor(sess(40,'varsity',4)).rank.name==='SCOUT TEAM' && rankFor(sess(40,'varsity',4)).next.name==='BACKUP','low scores start at Scout Team');
ok(RANKS.every((r,i)=>!i||r.min>RANKS[i-1].min),'rank thresholds go up');
if(fails) process.exitCode=1;
