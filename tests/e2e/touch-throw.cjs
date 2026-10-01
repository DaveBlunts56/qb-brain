const path=require('path'), fs=require('fs');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const SITE=process.env.QB_SITE||'http://localhost:8765/';
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
const { chromium, devices } = require('playwright');
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({...devices['iPhone 13'], deviceScaleFactor:2}); await ctx.addInitScript(()=>{ window.__QB_TEST__=true; });
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const cdp=await ctx.newCDPSession(p);
  const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((q,i)=>({x:q[0],y:q[1],id:q[2]}))});
  await p.goto(APP); await p.waitForTimeout(300);
  await p.tap('text=DRILLS'); await p.tap('#modeRow .choice >> nth=2');
  const results=[]; await p.evaluate(()=>{ window.__downs=[]; document.querySelector('#field').addEventListener('pointerdown',e=>window.__downs.push(e.pointerId),true); });
  for(const taps of [0,1,2]){
    await p.tap('#startBtn'); await p.waitForTimeout(250);
    await p.tap('#primaryBtn'); await p.waitForTimeout(800);
    const box=await p.locator('#field').boundingBox();
    const A=[box.x+195,box.y+300,1];
    await touch('touchStart',[A]);
    for(let k=1;k<=6;k++){ await touch('touchMove',[[A[0]-4*k,A[1]+18*k,1]]); await p.waitForTimeout(16); }
    const H=[A[0]-24,A[1]+108,1];
    const before=await p.evaluate(()=>window.__qbState && (document.querySelector('#field'),true));
    for(let n=0;n<taps;n++){
      // second finger taps somewhere else while the first keeps holding
      await touch('touchStart',[H,[box.x+320,box.y+120,2+n]]);
      await p.waitForTimeout(60);
      await touch('touchMove',[H]);   // lift only the second finger
      await p.waitForTimeout(60);
    }
    if(taps===1) await p.screenshot({path:OUT+'rb_bullet.png'});
    if(taps===0) await p.screenshot({path:OUT+'rb_lob.png'});
    await touch('touchEnd',[]);
    await p.waitForTimeout(100);
    results.push({downs: await p.evaluate(()=>window.__downs.splice(0)), secondFingerTaps:taps, thrown: await p.evaluate(()=>window.__qbState.rep.ball&&window.__qbState.rep.ball.type)});
    await p.waitForTimeout(2600);
    await p.tap('#quitBtn'); await p.tap('#restartBtn'); await p.tap('text=DRILLS');
  }
  console.log(results, errs); await b.close();
  if(errs.length || (results.map(r=>r.thrown).join()!=='lob,bullet,lob')) { console.error('FAIL: touch-throw'); process.exitCode=1; }
})();
