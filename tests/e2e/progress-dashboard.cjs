// Progress + dashboard on a phone: reps from before the update become sessions, a real Coverage ID session
// is recorded when you tap END, and the dashboard shows rank, rating, streak, bests and recent sessions — and keeps them.
const path=require('path'), fs=require('fs');
const { chromium, devices } = require('playwright');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
(async()=>{
  const b=await chromium.launch(); const errs=[], log=[], bad=[];
  const check=(ok,what)=>{ log.push((ok?'ok   ':'FAIL ')+what); if(!ok) bad.push(what); };
  const ctx=await b.newContext({...devices['iPhone 13'],deviceScaleFactor:2});
  // a player who trained 3 and 2 days ago, before progress tracking existed
  await ctx.addInitScript(()=>{
    window.__QB_TEST__=true;
    if(localStorage.getItem('seeded')) return; localStorage.setItem('seeded','1');
    const day=864e5, now=Date.now(), recs=[];
    const mk=(t,o)=>Object.assign({t,m:'qb_brain',sq:5,d:'varsity',cov:'Cover 2',con:'Smash',res:'GOOD READ',rel:1.8,tw:0,pr:0,cid:1,mz:1,fr:1},o);
    for(let i=0;i<7;i++) recs.push(mk(now-3*day+i*60e3,{res:i<5?'GOOD READ':'COVERED',cid:i%3?1:0,cov:i%2?'Cover 3':'Cover 2'}));
    for(let i=0;i<7;i++) recs.push(mk(now-2*day+i*60e3,{res:i<6?'GOOD READ':'RISKY',rel:1.6,pr:i%2,con:i%2?'Mesh':'Smash'}));
    localStorage.setItem('qbbrain.p.local.profile',JSON.stringify({upd:now,data:{v:1,recs}}));
    localStorage.setItem('qbbrain.migrated.v2','1');
  });
  const p=await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(400);
  check(/Unranked/.test(await p.textContent('#dashTileSub')),'home tile before: '+await p.textContent('#dashTileSub'));

  // ---- a real 5-rep Coverage ID session
  await p.tap('text=DRILLS'); await p.tap('#modeRow .choice >> nth=1'); await p.tap('#startBtn');
  let reps=0;
  for(let guard=0; guard<200 && reps<5; guard++){
    await p.waitForTimeout(150);
    if(await p.isVisible('#coverageSheet')){ const n=await p.locator('#mcqOptions button').count(); await p.tap('#mcqOptions button >> nth='+(reps%n)); continue; }
    if(await p.isVisible('#resultSheet')){ reps++; if(reps<5) await p.tap('#nextRepBtn'); continue; }
    if(await p.isVisible('#primaryBtn')) await p.tap('#primaryBtn').catch(()=>{});
  }
  check(reps===5,'played 5 coverage reps');
  await p.tap('#quitBtn'); await p.waitForTimeout(300);
  const sess=await p.evaluate(()=>JSON.parse(localStorage.getItem('qbbrain.p.local.progress')).data);
  const lastS=sess.sessions[sess.sessions.length-1];
  check(sess.sessions.length===3 && sess.sessions.filter(s=>s.bf).length===2,'2 sessions rebuilt from old reps + 1 new ('+sess.sessions.length+')');
  check(lastS.m==='coverage_id' && lastS.n===5 && lastS.sc!=null && lastS.cov!=null && lastS.plays===0,'new session: '+JSON.stringify({m:lastS.m,n:lastS.n,sc:lastS.sc,cov:lastS.cov}));
  check(Object.keys(sess.days).length===3,'3 training days');

  // ---- dashboard
  await p.tap('#restartBtn'); await p.waitForTimeout(150);
  const tileSub=await p.textContent('#dashTileSub'); check(!/Unranked/.test(tileSub),'home tile now shows the rank: '+tileSub);
  await p.tap('text=DASHBOARD'); await p.waitForTimeout(300); await p.screenshot({path:OUT+'dashboard_top.png'});
  const rank=await p.textContent('#dashRank'), rating=await p.textContent('#dashRating');
  check(rank!=='UNRANKED' && /^\d+$/.test(rating),'rank '+rank+', rating '+rating);
  check(/1-DAY STREAK/.test(await p.textContent('#dashStreak')) && /TRAINED TODAY/.test(await p.textContent('#dashStreak')),'streak: '+await p.textContent('#dashStreak'));
  check(await p.locator('#dashChart svg .pt').count()===3,'chart has 3 sessions');
  check(/Today · Coverage ID/.test(await p.textContent('#dashRecent')),'recent sessions lists today');
  check((await p.locator('#dashBests .best:not(.none)').count())>=3,'personal bests filled');
  check(/Sessions completed/.test(await p.textContent('#dashTiles')) && /3/.test(await p.textContent('#dashTiles .pf-tile:nth-child(5) .n')),'3 sessions completed');
  await p.tap('#dashChart .hit >> nth=2'); await p.waitForTimeout(100);
  check(/Coverage ID/.test(await p.textContent('#dashTip')),'tapping a point shows that session');
  await p.screenshot({path:OUT+'dashboard.png'});
  check(!/NaN|undefined/.test(await p.textContent('#dashScreen')),'no NaN/undefined anywhere');
  await p.addStyleTag({content:'#app{position:static!important;display:block!important}.screen{overflow:visible!important}body{overflow:visible!important;height:auto!important}html{height:auto!important}'});
  await p.screenshot({path:OUT+'dashboard_full.png',fullPage:true});
  await p.reload(); await p.waitForTimeout(300); await p.tap('text=DASHBOARD'); await p.waitForTimeout(200);
  const sw=await p.evaluate(()=>document.getElementById('dashScreen').scrollWidth<=window.innerWidth);
  check(sw,'no sideways scrolling at phone width');

  // ---- it all survives a reload, and the old QB Profile is one tap away
  check((await p.textContent('#dashRank'))===rank,'rank kept after reload');
  await p.tap('#dashScreen >> text=QB PROFILE'); await p.waitForTimeout(200);
  check(await p.isVisible('#profileScreen'),'QB Profile opens from the dashboard');

  console.log(log.join('\n')); if(errs.length) console.log(errs);
  if(errs.length||bad.length){ console.error('FAIL: progress-dashboard'); process.exitCode=1; }
  await b.close();
})();
