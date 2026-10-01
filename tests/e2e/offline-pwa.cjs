const path=require('path'), fs=require('fs');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const SITE=process.env.QB_SITE||'http://localhost:8765/';
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
const { chromium, devices } = require('playwright');
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({...devices['iPhone 13'], deviceScaleFactor:2}); await ctx.addInitScript(()=>{ window.__QB_TEST__=true; });
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(SITE); await p.waitForTimeout(1500);
  const sw=await p.evaluate(async()=>{ const r=await navigator.serviceWorker.getRegistration(); return !!(r&&(r.active||r.installing||r.waiting)); });
  await p.tap('text=SETTINGS'); await p.tap('#diffRow .choice >> nth=2'); await p.tap('#settingsScreen .back');
  const summary=await p.textContent('#settingsSummary');
  await p.reload(); await p.waitForTimeout(800);
  const kept=await p.textContent('#settingsSummary');
  await ctx.setOffline(true); await p.reload(); await p.waitForTimeout(800);
  await p.tap('text=PLAY DRIVE'); await p.tap('#driveStartBtn'); await p.waitForTimeout(400);
  const gameVisible=await p.isVisible('#field');
  console.log({serviceWorker:sw, settingsAfterChange:summary, afterReload:kept, offlineDriveStarts:gameVisible, errs});
  if(errs.length || (!sw || summary!==kept || !gameVisible)) { console.error('FAIL: offline-pwa'); process.exitCode=1; }
  await b.close();
})();
