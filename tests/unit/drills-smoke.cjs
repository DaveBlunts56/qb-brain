const {els,lob,bullet}=require('./_stub.cjs');
const E=id=>els[id];
function frames(ms,n){for(let i=0;i<n&&global.__raf;i++){global.__now+=ms;const f=global.__raf;global.__raf=null;f(global.__now);}}
let errors=0; const results={};
function run(book,squad,diff,mode,tm,tt){
  E('bookRow').children[book==='std'?0:1]._h.click();
  if(book==='std') E('squadRow').children[squad===5?0:1]._h.click();
  E('diffRow').children[['rookie','varsity','elite'].indexOf(diff)]._h.click();
  E('modeRow').children[['qb','cov','quick'].indexOf(mode)]._h.click();
  E('throwRow').children[tm==='pull'?0:1]._h.click();
  (tt==='lob'?lob:bullet)._h.click();
  E('startBtn')._h.click();
  for(let r=0;r<20;r++){
    if(!E('coverageSheet')._cls.has('hidden')) E('mcqOptions').children[0]._h.click();
    E('primaryBtn').onclick();
    frames(16,40+ (r%5)*15);
    if(mode!=='cov'){
      if(tm==='pull'){
        E('field')._h.pointerdown({clientX:195,clientY:200,pointerId:1,preventDefault(){}});
        E('field')._h.pointermove({pointerId:1,clientX:195+(r%3-1)*40,clientY:260+(r%4)*25});
        frames(16,2);
        E('field')._h.pointerup({pointerId:1,clientX:195+(r%3-1)*40,clientY:260+(r%4)*25});
      } else E('field')._h.pointerdown({clientX:100+r*10,clientY:300,pointerId:1,preventDefault(){}});
    }
    frames(16,800);
    if(E('resultSheet')._cls.has('hidden')) throw new Error('no result rep '+r);
    const k=E('resultText').textContent; results[k]=(results[k]||0)+1;
    E('nextRepBtn')._h.click();
  }
  E('quitBtn')._h.click(); E('restartBtn')._h.click();
}
for(const book of ['std']) for(const squad of [5,7]) for(const diff of ['rookie','elite']) for(const mode of ['qb','cov','quick']) for(const tm of ['pull','tap']) for(const tt of ['bullet','lob']){
  try{ run(book,squad,diff,mode,tm,tt);}catch(e){errors++; console.log('ERR',book,squad,diff,mode,tm,tt,e.stack.split('\n').slice(0,3).join(' | '));}
}
console.log('errors',errors,results);

// ---- pass/fail ----
if(errors) { console.error('FAIL: '+errors+' drill errors'); process.exitCode=1; }
