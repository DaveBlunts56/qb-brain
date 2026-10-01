const {els}=require('./_stub.cjs');
const E=id=>els[id], S=window.__qbSim, ST=window.__qbState;
function frames(ms,n){for(let i=0;i<n&&global.__raf;i++){global.__now+=ms;const f=global.__raf;global.__raf=null;f(global.__now);}}
const tally={}; let errors=0;
function driveOnce(cfg){
  E('bookRow').children[cfg.book==='dawz'?1:0]._h.click();
  if(cfg.book!=='dawz') E('squadRow').children[cfg.squad===7?1:0]._h.click();
  E('diffRow').children[['rookie','varsity','elite'].indexOf(cfg.diff)]._h.click();
  E('throwRow').children[1]._h.click();           // tap -> auto bullet
  E('lenRange').value=String(cfg.len); E('lenRange')._h.input();
  E('widRange').value=String(cfg.width); E('widRange')._h.input();
  E('fdRow').children[cfg.fd==='ten'?1:0]._h.click();
  E('driveStartBtn')._h.click();
  let plays=0;
  while(plays<40){
    if(ST.phase==='call') window.__qbPickCall(null);
    if(!E('coverageSheet')._cls.has('hidden')) E('mcqOptions').children[0]._h.click();
    E('primaryBtn').onclick();
    frames(16,Math.round(60*cfg.throwAt));
    const rep=ST.rep;
    // tap the most open target
    let best=null,bs=-1; rep.targets.forEach(p=>{const sep=S.nearestDefender(rep,S.livePos(p)).dist+(S.livePos(p).y>2?1:0); if(sep>bs){bs=sep;best=p;}});
    if(best&&best._px){ E('field')._h.pointerdown({clientX:best._px.x,clientY:best._px.y,pointerId:1,preventDefault(){}}); if(plays%2===0) E('field')._h.pointerup({clientX:best._px.x,clientY:best._px.y,pointerId:1}); }
    frames(16,900);
    if(E('resultSheet')._cls.has('hidden')) throw new Error('no result, phase '+ST.phase);
    plays++;
    const d=ST.drive;
    if(d.over){ E('nextRepBtn')._h.click(); break; }
    E('nextRepBtn')._h.click();
  }
  const d=ST.drive;
  tally[d.result]=(tally[d.result]||0)+1;
  if(E('summaryScreen')._cls.has('hidden')) throw new Error('no summary');
  return d;
}
const cfgs=[];
for(const book of ['std','dawz']) for(const len of [50,100]) for(const width of [20,30,53]) for(const fd of ['mid','ten']) for(const diff of ['rookie','elite'])
  cfgs.push({book,squad:5,len,width,fd,diff,throwAt:1.3});
cfgs.push({book:'std',squad:7,len:70,width:40,fd:'mid',diff:'varsity',throwAt:1.4});
let sample=null;
for(const c of cfgs){ for(let k=0;k<3;k++){ try{ const d=driveOnce(c); if(!sample&&d.result==='TOUCHDOWN'&&d.plays.length>3) sample=d; }catch(e){ errors++; console.log('ERR',JSON.stringify(c),e.stack.split('\n').slice(0,3).join(' | ')); } E('restartBtn')._h.click(); } }
console.log('errors',errors,'drives',cfgs.length*3,tally);
if(sample){ console.log('\nSample drive:',sample.len+'x'+sample.width,sample.result,'score',sample.score,'yards',sample.yards,'comp',sample.comp+'/'+sample.att);
  sample.plays.forEach((p,i)=>console.log(' ',i+1,p.situation.padEnd(22),p.play.padEnd(16),p.result.padEnd(11),p.headline,'('+p.points+')')); }

// ---- pass/fail ----
if(errors || Object.values(tally).reduce((a,b)=>a+b,0)!==cfgs.length*3) { console.error('FAIL'); process.exitCode=1; }
