const path=require('path'), fs=require('fs');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const SITE=process.env.QB_SITE||'http://localhost:8765/';
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
const { chromium, devices } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({...devices['iPhone 13'], deviceScaleFactor:2}); await ctx.addInitScript(()=>{ window.__QB_TEST__=true; });
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const cdp=await ctx.newCDPSession(p);
  const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(q=>({x:q[0],y:q[1],id:q[2]}))});
  await p.goto(APP); await p.waitForTimeout(300);
  await p.tap('text=SETTINGS'); await p.tap('#throwRow .choice >> nth=1'); await p.tap('#settingsScreen .back');
  await p.tap('text=DRILLS'); await p.tap('#modeRow .choice >> nth=2'); await p.selectOption('#playSelect','Mesh');
  const out=[];
  for(const holdMs of [60, 450]){
    await p.tap('#startBtn'); await p.waitForTimeout(250); await p.tap('#primaryBtn'); await p.waitForTimeout(900);
    const box=await p.locator('#field').boundingBox();
    const r=await p.evaluate(()=>{ const rep=window.__qbState.rep; const t=rep.targets.find(x=>x._px); return {id:t.id,...t._px}; });
    const P=[box.x+r.x, box.y+r.y, 1];
    await touch('touchStart',[P]); await p.waitForTimeout(holdMs/2);
    if(holdMs>300) await p.screenshot({path:OUT+'tap_hold.png'});
    await p.waitForTimeout(holdMs/2);
    await touch('touchEnd',[]); await p.waitForTimeout(80);
    const ball=await p.evaluate(()=>{ const b=window.__qbState.rep.ball; return b?b.type:null; });
    await p.waitForFunction(()=>!document.querySelector('#resultSheet').classList.contains('hidden'),{timeout:12000});
    out.push({holdMs, target:r.id, ball, result: await p.evaluate(()=>document.querySelector('#resultText').textContent)});
    await p.tap('#quitBtn'); await p.waitForTimeout(200); await p.tap('#restartBtn'); await p.waitForTimeout(200); await p.tap('text=DRILLS');
  }
  console.log(out, errs); await b.close();
  if(errs.length || (out[0].ball!=='bullet' || out[1].ball!=='lob')) { console.error('FAIL: tap-throw'); process.exitCode=1; }
})();
