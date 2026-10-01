const path=require('path'), fs=require('fs');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const SITE=process.env.QB_SITE||'http://localhost:8765/';
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
const { chromium, devices } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({...devices['iPhone 13'], deviceScaleFactor:2}); await ctx.addInitScript(()=>{ window.__QB_TEST__=true; });
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(300);
  await p.evaluate(()=>{ window.__qbState.difficulty='varsity'; });
  await p.tap('text=DRILLS'); await p.tap('#modeRow .choice >> nth=3'); await p.waitForTimeout(100);
  const log=[];
  for(let rep=0; rep<4; rep++){
    if(rep===0) await p.tap('#startBtn'); 
    await p.waitForTimeout(250);
    const info=await p.evaluate(()=>({shown:window.__qbState.rep.shownCoverage, actual:window.__qbState.rep.actualCoverage, dk:window.__qbState.rep.disguiseKind, play:window.__qbState.rep.play.name, key:!!window.__qbState.rep.keyRead, q:document.querySelector('#filmQ').textContent}));
    log.push(JSON.stringify(info));
    if(rep===0) await p.screenshot({path:OUT+'film0_q1.png'});
    for(let i=0;i<6;i++){
      const q=await p.textContent('#filmQ'); if(!(await p.isVisible('#filmSheet'))) break;
      const fb=await p.locator('#field').boundingBox();
      if(/KEY DEFENDER/.test(q)){ const k=await p.evaluate(()=>window.__qbFilm.keyPx()); await p.mouse.click(fb.x+k.x, fb.y+k.y); }
      else if(/FIRST READ/.test(q)){ const k=await p.evaluate(()=>window.__qbFilm.readPx()); await p.mouse.click(fb.x+k.x, fb.y+k.y); }
      else await p.tap('#filmOpts button >> nth=0');
      await p.waitForTimeout(80);
      if(rep===0 && /KEY/.test(q)) await p.screenshot({path:OUT+'film1_key.png'});
      log.push('  '+q+' → '+await p.textContent('#filmFb'));
      await p.tap('#filmGo'); await p.waitForTimeout(80);
    }
    await p.tap('#primaryBtn'); await p.waitForTimeout(1400);
    const fb=await p.locator('#field').boundingBox();
    await p.mouse.move(fb.x+195,fb.y+300); await p.mouse.down(); await p.mouse.move(fb.x+180,fb.y+380,{steps:5}); await p.mouse.up();
    await p.waitForFunction(()=>!document.querySelector('#resultSheet').classList.contains('hidden'),{timeout:12000}); await p.waitForTimeout(200);
    await p.tap('#filmBox .film-opt >> nth=0'); await p.waitForTimeout(120);
    log.push('  reveal: '+(await p.textContent('#filmBox')).slice(0,220));
    log.push('  key: '+(await p.textContent('#coachKey')).slice(0,200));
    if(rep===0){ await p.screenshot({path:OUT+'film2_reveal.png'}); await p.tap('#filmBox .chip >> nth=0'); await p.waitForTimeout(100); await p.screenshot({path:OUT+'film3_pre.png'}); await p.tap('#filmBox .chip >> nth=1'); await p.waitForTimeout(100); await p.screenshot({path:OUT+'film4_post.png'}); }
    await p.tap('#nextRepBtn');
  }
  await p.tap('#quitBtn'); await p.waitForTimeout(200); await p.tap('#restartBtn'); await p.waitForTimeout(200);
  await p.tap('text=QB PROFILE'); await p.waitForTimeout(200); await p.screenshot({path:OUT+'profile.png', fullPage:true});
  log.push('profile recs '+await p.evaluate(()=>window.__qbProfile.recs.length));
  console.log(log.join('\n')); console.log(errs);
  if(errs.length || (!log.some(l=>/profile recs 4/.test(l)) || !log.some(l=>/PRE-SNAP LOOK/.test(l)))) { console.error('FAIL: film-room'); process.exitCode=1; }
  await b.close();
})();
