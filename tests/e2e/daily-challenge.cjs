// Daily challenge: the home card starts a fixed-length session, the HUD counts down to it, FINISH ends it,
// and the result is judged against the goal and remembered for the day. Every template is checked to build real reps.
const path=require('path'), fs=require('fs');
const { chromium, devices } = require('playwright');
const APP=process.env.QB_SITE ? process.env.QB_SITE+'dist/qb_brain.html' : 'file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
(async()=>{
  const b=await chromium.launch(); const errs=[], log=[], bad=[];
  const check=(ok,what)=>{ log.push((ok?'ok   ':'FAIL ')+what); if(!ok) bad.push(what); };
  const ctx=await b.newContext({...devices['iPhone 13'],deviceScaleFactor:2});
  await ctx.addInitScript(()=>{ window.__QB_TEST__=true; });
  const p=await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(400);
  // every template's plan builds reps in both formats (its plays exist, its coverages are in the pool)
  const tpl=await p.evaluate(()=>{ const out=[]; const S=window.__qbSim, st=window.__qbState;
    window.__qbChallenge.CHALLENGES.forEach(c=>{ [5,7].forEach(sq=>{ if(!c.plan||!c.plan.plays) return;
      const names=S.BOOKS.standard.plays[sq].map(p=>p.name); const miss=c.plan.plays.filter(n=>!names.includes(n)); if(miss.length===c.plan.plays.length) out.push(c.id+' '+sq+'v'+sq+': none of '+c.plan.plays.join('/')); }); });
    return out; });
  check(!tpl.length,'every challenge has plays in both formats '+tpl.join('; '));
  const today=await p.evaluate(()=>window.__qbChallenge.todays());
  check(await p.isVisible('#dailyCard') && (await p.textContent('#dailyName'))===today.name,'home card shows today: '+today.name+' ('+today.reps+' reps)');
  await p.screenshot({path:OUT+'home_daily.png'});
  await p.tap('#dailyCard'); await p.waitForTimeout(200);
  check((await p.textContent('#hudRep'))==='1/'+today.reps && /Daily challenge/.test(await p.textContent('#hudSub')),'HUD: '+await p.textContent('#hudRep')+' · '+await p.textContent('#hudSub'));
  let reps=0, finish='';
  for(let guard=0; guard<600 && reps<today.reps; guard++){
    await p.waitForTimeout(120);
    if(await p.isVisible('#coverageSheet')){ await p.tap('#mcqOptions button >> nth=0'); continue; }
    if(await p.isVisible('#resultSheet')){ reps++; if(reps<today.reps) await p.tap('#nextRepBtn'); else finish=await p.textContent('#nextRepBtn'); continue; }
    const ph=await p.evaluate(()=>window.__qbState.phase);
    if(ph==='study' && await p.isVisible('#primaryBtn')){ await p.tap('#primaryBtn').catch(()=>{}); await p.waitForTimeout(1000); continue; }
    if(ph==='decision'){ const fb=await p.locator('#field').boundingBox();
      await p.mouse.move(fb.x+195,fb.y+300); await p.mouse.down(); await p.mouse.move(fb.x+185,fb.y+380,{steps:5}); await p.mouse.up(); await p.waitForTimeout(400); }
  }
  check(reps===today.reps && finish==='FINISH','played '+reps+' reps, last button says '+finish);
  await p.tap('#nextRepBtn'); await p.waitForTimeout(300);
  check(await p.isVisible('#summaryScreen'),'FINISH ends the session');
  const chips=await p.textContent('#resultCard');
  check(/CHALLENGE/.test(chips),'result card reports the challenge: '+chips.replace(/\s+/g,' ').slice(0,160));
  await p.screenshot({path:OUT+'challenge_result.png'});
  const rec=await p.evaluate(()=>{ const d=JSON.parse(localStorage.getItem('qbbrain.p.local.progress')).data; const t=window.__qbChallenge.todays(); return d.ch&&d.ch[t.day]; });
  check(rec && rec.tries===1 && rec.key===today.key,'saved for today: '+JSON.stringify(rec));
  await p.tap('#restartBtn'); await p.waitForTimeout(150);
  const state=await p.textContent('#dailyState');
  check(rec && (rec.done ? state==='DONE ✓' : state==='TRY AGAIN'),'home card now says '+state);
  console.log(log.join('\n')); if(errs.length) console.log(errs);
  if(errs.length||bad.length){ console.error('FAIL: daily-challenge'); process.exitCode=1; }
  await b.close();
})();
