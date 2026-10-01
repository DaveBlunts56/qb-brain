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
  await p.tap('text=LEARN'); await p.waitForTimeout(150);
  const log=[];
  const bubble=()=>p.evaluate(()=>document.querySelector('#cbText').textContent.slice(0,60));
  const nexts=async()=>{ for(let i=0;i<8;i++){ const v=await p.isVisible('#cbBtn'); const t=v?await p.textContent('#cbBtn'):''; if(v && t==='NEXT'){ await p.tap('#cbBtn'); await p.waitForTimeout(80);} else break; } };
  // aim-throw at a receiver: pull back opposite to target from field center
  const throwTo=async(id,bullet)=>{
    const fb=await p.locator('#field').boundingBox();
    // lead the receiver: aim where he'll be when the lob lands (about 0.25s of gesture + flight time)
    const r=await p.evaluate((id)=>{ const S=window.__qbSim, rep=window.__qbState.rep;
      const q=rep.players.find(x=>x.id==='Q'), t=rep.players.find(x=>x.id===id);
      const a=rep.players.find(x=>x.id==='X'), b=rep.players.find(x=>x.id==='Z');
      const ppy=(b._px.x-a._px.x)/(S.livePos(b).x-S.livePos(a).x);
      const from=S.livePos(q); let L=S.livePos(t);
      for(let i=0;i<4;i++){ const fl=0.3+S.dist(from,L)/19+0.25; L={x:S.livePos(t).x+t.s.vx*fl, y:S.livePos(t).y+t.s.vy*fl}; }
      return {dx:(L.x-from.x)*ppy, dy:-(L.y-from.y)*ppy}; },id);
    const sx=fb.x+fb.width/2, sy=fb.y+fb.height*0.55;
    const dx=r.dx/2.3, dy=r.dy/2.3;   // slingshot: pull back opposite the throw; the game multiplies pull length by 2.3
    await touch('touchStart',[[sx,sy,1]]);
    for(let k=1;k<=6;k++){ await touch('touchMove',[[sx-dx*k/6, sy-dy*k/6,1]]); await p.waitForTimeout(15); }
    if(bullet){ await touch('touchStart',[[sx-dx,sy-dy,1],[fb.x+40,fb.y+60,2]]); await touch('touchEnd',[[sx-dx,sy-dy,1]]); }
    await p.waitForTimeout(40);
    await touch('touchEnd',[]);
  };
  // Lesson 1
  await p.tap('.lesson >> nth=0'); await p.waitForTimeout(250);
  log.push('L1 start: '+await bubble());
  await nexts(); log.push('after nexts: '+await bubble());
  await p.screenshot({path:OUT+'tut1.png'});
  // a real player sometimes misses; the lesson says TRY AGAIN and skips the intro — retry like a player would
  for(let attempt=0; attempt<5; attempt++){
    await p.tap('#primaryBtn'); await p.waitForTimeout(1200); log.push('after snap: '+await bubble());
    await throwTo(['Y','X','Z'][attempt%3]); await p.waitForTimeout(150); log.push('after aim/throw: '+await bubble());
    await p.waitForFunction(()=>window.__qbState.phase==='result',{timeout:10000}); await p.waitForTimeout(300);
    const btn=await p.textContent('#cbBtn');
    log.push('result: '+await p.textContent('#resultText')+' | '+await bubble()+' | btn '+btn);
    if(attempt===0) await p.screenshot({path:OUT+'tut1_result.png'});
    await p.tap('#cbBtn'); await p.waitForTimeout(300);
    if(/LESSON COMPLETE/.test(btn)) break;
  }
  log.push('after: screen learn? '+await p.isVisible('#learnScreen')+' phase '+await p.evaluate(()=>window.__qbState.phase));
  // Lesson 4 (coverage)
  if(await p.isVisible('#learnScreen')){ await p.tap('.lesson >> nth=3'); await p.waitForTimeout(250); await nexts(); await p.screenshot({path:OUT+'tut4.png'});
    log.push('L4 coverage sheet visible '+await p.isVisible('#coverageSheet'));
    const ok=await p.evaluate(()=>{ const btns=[...document.querySelectorAll('#mcqOptions button')]; const b=btns.find(x=>x.textContent.includes('Man')&&!x.textContent.includes('Cover')); if(b){ b.click(); return true;} return false; });
    await p.waitForTimeout(150); log.push('L4 after pick: '+await bubble());
    await p.tap('#primaryBtn'); await p.waitForFunction(()=>window.__qbState.phase==='result',{timeout:10000}); await p.waitForTimeout(200);
    log.push('L4 result '+await bubble()+' btn '+await p.textContent('#cbBtn'));
    await p.tap('#cbBtn'); await p.waitForTimeout(300); log.push('L4 rep2: '+await bubble());
  }
  await p.tap('#quitBtn'); await p.waitForTimeout(250);
  log.push('quit -> learn '+await p.isVisible('#learnScreen')+' diff '+await p.evaluate(()=>window.__qbState.difficulty));
  console.log(log.join('\n')); console.log(errs);
  if(errs.length || (!log.some(l=>/LESSON COMPLETE/.test(l)) || !log.some(l=>/quit -> learn true diff rookie/.test(l)))) { console.error('FAIL: tutorial'); process.exitCode=1; }
  await b.close();
})();
