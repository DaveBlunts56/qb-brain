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
  const bubble=()=>p.evaluate(()=>document.querySelector('#cbText').textContent.slice(0,50));
  const nexts=async()=>{ for(let i=0;i<8;i++){ const v=await p.isVisible('#cbBtn'); const t=v?await p.textContent('#cbBtn'):''; if(v && t==='NEXT'){ await p.tap('#cbBtn'); await p.waitForTimeout(80);} else break; } };
  const lesson=async(n)=>{ await p.evaluate(n=>window.__qbLearn.startLesson(n),n); await p.waitForTimeout(250); await nexts(); };
  const log=[];
  // L2: bullet toggle
  await lesson(1); await p.tap('#primaryBtn'); await p.waitForTimeout(900);
  const fb=await p.locator('#field').boundingBox(); const sx=fb.x+200, sy=fb.y+300;
  await touch('touchStart',[[sx,sy,1]]); for(let k=1;k<=5;k++){ await touch('touchMove',[[sx,sy+12*k,1]]); await p.waitForTimeout(15); }
  log.push('L2 aiming: '+await bubble());
  await touch('touchStart',[[sx,sy+60,1],[fb.x+40,fb.y+80,2]]); await p.waitForTimeout(60);
  log.push('L2 after 2nd finger: '+await bubble());
  await touch('touchEnd',[]);
  await p.waitForFunction(()=>window.__qbState.phase==='result',{timeout:10000}); await p.waitForTimeout(200);
  log.push('L2 result: '+await p.textContent('#resultText')+' / '+await bubble());
  await p.tap('#quitBtn'); await p.waitForTimeout(200);
  // L3: scramble
  await lesson(2); await p.tap('#primaryBtn'); await p.waitForTimeout(300);
  const jb=await p.locator('#joyBase').boundingBox(); const J=[jb.x+jb.width/2,jb.y+jb.height/2,1];
  await touch('touchStart',[J]); await touch('touchMove',[[J[0]+40,J[1],1]]); await p.waitForTimeout(150);
  log.push('L3 after stick: '+await bubble());
  await touch('touchEnd',[]);
  await p.tap('#quitBtn'); await p.waitForTimeout(200);
  // L8: audible
  await lesson(7);
  log.push('L8 audible btn visible '+await p.isVisible('#audibleBtn')+' snap visible '+await p.isVisible('#primaryBtn'));
  await p.tap('#audibleBtn'); await p.waitForTimeout(150);
  await p.tap('#audList button >> nth=0'); await p.waitForTimeout(150);
  log.push('L8 after audible: '+await bubble()+' play '+await p.evaluate(()=>window.__qbState.rep.play.name));
  await p.tap('#audClose'); await p.waitForTimeout(100);
  log.push('L8 snap visible '+await p.isVisible('#primaryBtn'));
  await p.screenshot({path:OUT+'tut8.png'});
  await p.tap('#quitBtn'); await p.waitForTimeout(200);
  console.log(log.join('\n')); console.log(errs);
  if(errs.length || (!log.some(l=>/after 2nd finger: Bullet/.test(l)) || !log.some(l=>/after stick: Good/.test(l)) || !log.some(l=>/L8 snap visible true/.test(l)))) { console.error('FAIL: tutorial-inputs'); process.exitCode=1; }
  await b.close();
})();
