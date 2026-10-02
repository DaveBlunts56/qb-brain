// Merge rules for cloud sync: nothing a player did on either device should be lost.
const path=require('path'), esbuild=require('esbuild');
const code=esbuild.buildSync({entryPoints:[path.join(__dirname,'../../src/js/merge.js')],bundle:true,format:'cjs',write:false,logLevel:'error'}).outputFiles[0].text;
const m={exports:{}}; new Function('module','exports',code)(m,m.exports); const {mergeDocs,sameDoc}=m.exports;
let fails=0; const ok=(c,msg)=>{ if(!c){ fails++; console.error('FAIL',msg); } else console.log('ok  ',msg); };
// profile: union of reps from both devices
const A={upd:5,data:{v:1,recs:[{t:1,con:'Smash',res:'GOOD READ'},{t:3,con:'Mesh',res:'COVERED'}]}};
const B={upd:7,data:{v:1,recs:[{t:1,con:'Smash',res:'GOOD READ'},{t:2,con:'Stick',res:'RISKY'}]}};
const P=mergeDocs('profile',A,B); ok(P.data.recs.map(r=>r.t).join()==='1,2,3','profile keeps every rep once, in order'); ok(P.upd===7,'merged time is the newest');
// plays: newest edit wins, deletions stick
const pA={upd:10,data:{plays:[{uid:'a',name:'Old',upd:1},{uid:'b',name:'Keep',upd:2}],audibles:{},gone:{c:9}}};
const pB={upd:12,data:{plays:[{uid:'a',name:'New',upd:5},{uid:'c',name:'Deleted elsewhere',upd:4},{uid:'d',name:'Made on B',upd:6}],audibles:{'my:a':['x']},gone:{}}};
const M=mergeDocs('plays',pA,pB); const names=M.data.plays.map(p=>p.name).join();
ok(names==='New,Keep,Made on B','plays: newest edit wins, new plays added, deleted play stays deleted ('+names+')');
ok(M.data.audibles['my:a'] && M.data.audibles['my:a'][0]==='x','audibles from the newer device kept');
// a play re-edited after it was deleted on the other device comes back
const R=mergeDocs('plays',{upd:1,data:{plays:[],gone:{z:5}}},{upd:2,data:{plays:[{uid:'z',name:'Edited later',upd:8}]}});
ok(R.data.plays.length===1,'a play edited after the delete survives');
// tutorial: finished anywhere = finished
const T=mergeDocs('tutorial',{upd:1,data:{l1:true}},{upd:2,data:{l4:true}}); ok(T.data.l1 && T.data.l4,'tutorial lessons from both devices');
// settings: newest wins
const S=mergeDocs('settings',{upd:3,data:{difficulty:'elite'}},{upd:9,data:{difficulty:'rookie'}}); ok(S.data.difficulty==='rookie','settings: newest change wins');
ok(mergeDocs('settings',null,{upd:1,data:{a:1}}).data.a===1 && mergeDocs('settings',{upd:1,data:{a:2}},null).data.a===2,'one side missing');
ok(sameDoc({data:{a:1}},{data:{a:1}}) && !sameDoc({data:{a:1}},{data:{a:2}}),'sameDoc');
if(fails) process.exitCode=1;
// progress: every session from both devices, training days, and the best of each record
const gA={upd:4,data:{v:1,sessions:[{t:1,n:6,sc:70},{t:5,n:3,e:10,sc:null}],days:{'2026-10-01':1},best:{score:{v:70,t:1},spd:{v:1.9,t:1}}}};
const gB={upd:6,data:{v:1,sessions:[{t:5,n:8,e:12,sc:75},{t:9,n:7,sc:81}],days:{'2026-10-01':2,'2026-10-02':1},best:{score:{v:81,t:9},spd:{v:2.1,t:9},streak:{v:2,t:9}}}};
const G=mergeDocs('progress',gA,gB);
ok(G.data.sessions.map(s=>s.t+':'+s.n).join()==='1:6,5:8,9:7','progress: sessions from both, the fuller copy of a shared session wins');
ok(G.data.days['2026-10-01']===2 && G.data.days['2026-10-02']===1,'progress: training days from both');
ok(G.data.best.score.v===81 && G.data.best.spd.v===1.9 && G.data.best.streak.v===2,'progress: best score (higher), best release (lower), best streak');
