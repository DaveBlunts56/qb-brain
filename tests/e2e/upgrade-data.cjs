// Someone updating from v1.9 or earlier keeps everything: old saved data moves into the new per-player store.
const path=require('path');
const { chromium, devices } = require('playwright');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
(async()=>{
  const b=await chromium.launch(); const errs=[];
  const ctx=await b.newContext({...devices['iPhone 13'],deviceScaleFactor:2});
  await ctx.addInitScript(()=>{
    window.__QB_TEST__=true;
    if(localStorage.getItem('seeded')) return; localStorage.setItem('seeded','1');
    localStorage.setItem('qbbrain.settings.v1',JSON.stringify({squad:5,difficulty:'elite',throwMode:'tap'}));
    localStorage.setItem('qbbrain.profile.v1',JSON.stringify({v:1,recs:[{t:1,con:'Smash',res:'GOOD READ',cov:'Cover 2'},{t:2,con:'Mesh',res:'COVERED',cov:'Man'}]}));
    localStorage.setItem('qbbrain.tutorial.v1',JSON.stringify({l1:true,l2:true}));
    localStorage.setItem('qbbrain.myplays.v1',JSON.stringify([{uid:'old1',name:'Old Play',squad:5,form:'Spread',players:[{id:'Q',x:15,y:-2.8,route:{mode:'qb',action:'drop3'}},{id:'C',x:15,y:0,route:{mode:'lib',type:'sit'}},{id:'X',x:3,y:0,route:{mode:'lib',type:'go'}},{id:'Y',x:9,y:0,route:{mode:'lib',type:'slant'}},{id:'Z',x:27,y:0,route:{mode:'lib',type:'go'}}],prog:['X','Y','Z','C']}]));
  });
  const p=await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(400);
  const r=await p.evaluate(()=>({diff:window.__qbState.difficulty, throwMode:window.__qbState.throwMode, recs:window.__qbProfile.recs.length,
    tut:document.querySelector('#learnSummary').textContent, plays:JSON.parse(localStorage.getItem('qbbrain.p.local.plays')).data.plays.map(x=>x.name)}));
  await p.reload(); await p.waitForTimeout(300);
  const again=await p.evaluate(()=>({diff:window.__qbState.difficulty, recs:window.__qbProfile.recs.length}));
  console.log(r, again, errs);
  if(errs.length || r.diff!=='elite' || r.throwMode!=='tap' || r.recs!==2 || !/2\/8/.test(r.tut) || r.plays[0]!=='Old Play' || again.recs!==2 || again.diff!=='elite'){ console.error('FAIL: upgrade-data'); process.exitCode=1; }
  await b.close();
})();
