const path=require('path'), fs=require('fs');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const SITE=process.env.QB_SITE||'http://localhost:8765/';
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
const { chromium, devices } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({...devices['iPhone 13'], deviceScaleFactor:2}); await ctx.addInitScript(()=>{ window.__QB_TEST__=true; });
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(300);
  await p.tap('text=SETTINGS'); await p.tap('#squadRow .choice >> nth=1'); await p.tap('#diffRow .choice >> nth=1'); await p.tap('#adaptiveSwitch'); await p.waitForTimeout(100);
  await p.screenshot({path:OUT+'v18_settings.png', fullPage:true});
  await p.tap('#settingsScreen .back'); await p.tap('text=DRILLS'); await p.tap('#modeRow .choice >> nth=3'); await p.tap('#startBtn'); await p.waitForTimeout(400);
  const r=await p.evaluate(()=>({sq:window.__qbState.rep.squad, n:window.__qbState.rep.defenders.length, clock:window.__qbState.rep.clock, shown:window.__qbState.rep.shownCoverage, actual:window.__qbState.rep.actualCoverage, plan:window.__qbState.rep.plan&&window.__qbState.rep.plan.adaptiveNote}));
  await p.screenshot({path:OUT+'v18_film7.png'});
  for(let i=0;i<6;i++){ if(!(await p.isVisible('#filmSheet'))) break; const q=await p.textContent('#filmQ'); const fb=await p.locator('#field').boundingBox();
    if(/KEY DEFENDER/.test(q)){ const k=await p.evaluate(()=>window.__qbFilm.keyPx()); await p.mouse.click(fb.x+k.x, fb.y+k.y); }
    else if(/FIRST READ/.test(q)){ const k=await p.evaluate(()=>window.__qbFilm.readPx()); await p.mouse.click(fb.x+k.x, fb.y+k.y); }
    else await p.tap('#filmOpts button >> nth=0');
    await p.waitForTimeout(60); await p.tap('#filmGo'); await p.waitForTimeout(60); }
  await p.screenshot({path:OUT+'v18_presnap7.png'});
  await p.tap('#primaryBtn'); await p.waitForTimeout(4600);   // let the 4-second clock run out
  await p.waitForFunction(()=>!document.querySelector('#resultSheet').classList.contains('hidden'),{timeout:12000}); await p.waitForTimeout(200);
  const res=await p.textContent('#resultText');
  await p.tap('#filmBox .film-opt >> nth=0'); await p.waitForTimeout(100);
  await p.screenshot({path:OUT+'v18_clock.png'});
  const coach=await p.textContent('#coachCard');
  await p.tap('#quitBtn'); await p.waitForTimeout(200); await p.tap('#restartBtn'); await p.tap('text=DASHBOARD'); await p.waitForTimeout(150); await p.tap('#dashScreen >> text=QB PROFILE'); await p.waitForTimeout(200);
  const ad=await p.textContent('#pfAdaptive');
  console.log(JSON.stringify({r,res,coach:coach.slice(0,260),ad,errs},null,1));
  if(errs.length || (r.sq!==7 || r.n!==7 || r.clock!==4)) { console.error('FAIL: sevens-adaptive'); process.exitCode=1; }
  await b.close();
})();
