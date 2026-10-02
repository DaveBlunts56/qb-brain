// Results screen + Share Result on a phone: a real 5-rep QB Brain session with throws, the score card on the
// summary, and the 1080×1920 share image (saved to tests/out for a look). A 3-rep session gets no score.
const path=require('path'), fs=require('fs');
const { chromium, devices } = require('playwright');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
(async()=>{
  const b=await chromium.launch(); const errs=[], log=[], bad=[];
  const check=(ok,what)=>{ log.push((ok?'ok   ':'FAIL ')+what); if(!ok) bad.push(what); };
  const ctx=await b.newContext({...devices['iPhone 13'],deviceScaleFactor:2});
  await ctx.addInitScript(()=>{ window.__QB_TEST__=true; });
  const p=await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(400);
  const play=async(n)=>{
    let reps=0;
    for(let guard=0; guard<400 && reps<n; guard++){
      await p.waitForTimeout(120);
      if(await p.isVisible('#coverageSheet')){ await p.tap('#mcqOptions button >> nth=0'); continue; }
      if(await p.isVisible('#resultSheet')){ reps++; if(reps<n) await p.tap('#nextRepBtn'); continue; }
      const ph=await p.evaluate(()=>window.__qbState.phase);
      if(ph==='study' && await p.isVisible('#primaryBtn')){ await p.tap('#primaryBtn').catch(()=>{}); await p.waitForTimeout(1100); continue; }
      if(ph==='decision'){ const fb=await p.locator('#field').boundingBox();
        await p.mouse.move(fb.x+195,fb.y+300); await p.mouse.down(); await p.mouse.move(fb.x+185,fb.y+380,{steps:5}); await p.mouse.up(); await p.waitForTimeout(400); }
    }
    return reps;
  };
  // ---- too short for a score
  await p.tap('text=DRILLS'); await p.tap('#modeRow .choice >> nth=2'); await p.tap('#startBtn');
  check(await play(3)===3,'3-rep session played');
  await p.tap('#quitBtn'); await p.waitForTimeout(300);
  check(/5\+ reps/.test(await p.textContent('#resultCard')) && await p.isHidden('#shareBtn'),'short session: explains the 5-rep minimum, no share');

  // ---- a scored session
  await p.tap('#againBtn'); await p.waitForTimeout(200);
  check(await play(5)===5,'5-rep session played');
  await p.tap('#quitBtn'); await p.waitForTimeout(300);
  const score=await p.textContent('.rc-score b');
  check(/^\d+$/.test(score),'score shown on the summary: '+score);
  const stats=await p.textContent('.rc-stats'); check(/Decision Speed/.test(stats) && /Read Accuracy/.test(stats),'measured stats listed: '+stats.replace(/\s+/g,' '));
  check(!/Blitz/.test(await p.textContent('#summaryScreen')),'no unmeasured stats');
  await p.screenshot({path:OUT+'results.png'});
  const fits=await p.evaluate(()=>document.getElementById('summaryScreen').scrollWidth<=window.innerWidth); check(fits,'no sideways scrolling');

  // ---- share image
  await p.tap('#shareBtn');
  try{ await p.waitForFunction(()=>{ const i=document.getElementById('shareImg'); return i.src && i.complete && i.naturalWidth>0; },null,{timeout:10000}); }catch(e){ console.log(log.join('\n')); console.log('shareMsg:',await p.textContent('#shareMsg'),'visible:',await p.isVisible('#shareSheet'),errs); throw e; }
  const dims=await p.evaluate(()=>{ const i=document.getElementById('shareImg'); return [i.naturalWidth,i.naturalHeight]; });
  check(dims[0]===1080 && dims[1]===1920,'share image is 1080×1920 ('+dims.join('×')+')');
  check(/SHARE|SAVE IMAGE/.test(await p.textContent('#shareGo')),'share button: '+await p.textContent('#shareGo'));
  const b64=await p.evaluate(async()=>{ const r=await fetch(document.getElementById('shareImg').src); const bl=await r.blob(); return await new Promise(res=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result.split(',')[1]); fr.readAsDataURL(bl); }); });
  fs.writeFileSync(OUT+'share_card.png',Buffer.from(b64,'base64'));
  await p.screenshot({path:OUT+'share_sheet.png'});
  if((await p.textContent('#shareGo'))==='SAVE IMAGE'){
    const [dl]=await Promise.all([p.waitForEvent('download'),p.tap('#shareGo')]);
    check(dl.suggestedFilename()==='qb-brain-score.png','saves qb-brain-score.png');
  }
  await p.tap('#shareClose'); check(await p.isHidden('#shareSheet'),'share sheet closes');

  console.log(log.join('\n')); if(errs.length) console.log(errs);
  if(errs.length||bad.length){ console.error('FAIL: results-share'); process.exitCode=1; }
  await b.close();
})();
