const path=require('path'), fs=require('fs');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const SITE=process.env.QB_SITE||'http://localhost:8765/';
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
const { chromium, devices } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({...devices['iPhone 13'], deviceScaleFactor:2}); await ctx.addInitScript(()=>{ window.__QB_TEST__=true; });
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error' && !/ERR_TUNNEL|fonts/.test(m.text())) errs.push(m.text()); });
  await p.goto(APP); await p.waitForTimeout(300);
  await p.screenshot({path:OUT+'lr0_home.png'});
  await p.tap('#newbieCard'); await p.waitForTimeout(200); await p.screenshot({path:OUT+'lr1_learn.png'});
  // manual: every chapter
  await p.tap('#manualOpenBtn'); await p.waitForTimeout(150); await p.screenshot({path:OUT+'lr2_manual.png'});
  const ids=await p.evaluate(()=>window.__qbLearn.MANUAL.map(c=>c.id));
  for(const id of ids){ await p.evaluate(i=>window.__qbLearn.openManual(i),id); await p.waitForTimeout(60); }
  for(const id of ['cov-2','routes','con-smash','basics','read-key','read-leverage','throw-types','read-clock','cov-more']){
    await p.evaluate(i=>window.__qbLearn.openManual(i),id); await p.waitForTimeout(120); await p.screenshot({path:OUT+'lr_ch_'+id+'.png', fullPage:false});
  }
  // practice button: Cover 2 chapter
  await p.evaluate(()=>window.__qbLearn.openManual('cov-2')); await p.waitForTimeout(100);
  await p.tap('text=PRACTICE VS COVER 2'); await p.waitForTimeout(300);
  const forced=await p.evaluate(()=>({mode:window.__qbState.mode, cov:window.__qbState.rep.actualCoverage}));
  // play a rep and check the coach card + coach view
  if(await p.isVisible('#coverageSheet')) await p.tap('#mcqOptions button');
  await p.tap('#primaryBtn'); await p.waitForTimeout(1300);
  const fb=await p.locator('#field').boundingBox();
  await p.mouse.move(fb.x+195,fb.y+330); await p.mouse.down(); await p.mouse.move(fb.x+170,fb.y+400,{steps:5}); await p.mouse.up();
  await p.waitForFunction(()=>!document.querySelector('#resultSheet').classList.contains('hidden'),{timeout:12000});
  await p.waitForTimeout(200);
  const coach=await p.evaluate(()=>({v:document.querySelector('#coachVerdict').textContent, lines:[...document.querySelectorAll('#coachLines p')].map(x=>x.textContent)}));
  await p.screenshot({path:OUT+'lr3_coach.png'});
  await p.tap('#coachViewBtn'); await p.waitForTimeout(150); await p.screenshot({path:OUT+'lr4_coachview.png'});
  await p.tap('#coachLearnBtn'); await p.waitForTimeout(150); const learnOpen=await p.isVisible('#manual'); await p.tap('#manClose');
  await p.tap('#quitBtn'); await p.waitForTimeout(250); await p.screenshot({path:OUT+'lr5_summary.png', fullPage:true});
  console.log(JSON.stringify({chapters:ids.length, forced, coach, learnOpen, errs},null,1));
  if(errs.length || (ids.length<30 || forced.cov!=='Cover 2' || !coach.v || !learnOpen)) { console.error('FAIL: manual-coach'); process.exitCode=1; }
  await b.close();
})();
