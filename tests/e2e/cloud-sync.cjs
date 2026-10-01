// Two "devices" share one parent account through the stand-in cloud (tests/mock-cloud.cjs):
// guest progress is kept when the account is created, a second device picks the player up,
// changes flow both ways, an expired login refreshes itself, and deleting the account wipes everything.
const path=require('path'), fs=require('fs');
const { chromium, devices } = require('playwright');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const CLOUD=process.env.QB_MOCK_CLOUD||'http://localhost:8790';
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
const mock=async p=>(await fetch(CLOUD+p)).json();
(async()=>{
  const b=await chromium.launch(); const errs=[], log=[];
  const device=async()=>{ const ctx=await b.newContext({...devices['iPhone 13'],deviceScaleFactor:2});
    await ctx.addInitScript(c=>{ window.__QB_TEST__=true; window.__QB_CLOUD__={url:c,anonKey:'test-anon'}; },CLOUD);
    const p=await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message)); await p.goto(APP); await p.waitForTimeout(400); return p; };
  const gate=async p=>{ const q=await p.textContent('#gateQ'); const m=q.match(/(\d+) × (\d+)/); await p.click('#gateOpts button:text-is("'+(+m[1]*+m[2])+'")'); await p.waitForTimeout(150); };
  const openAccount=async p=>{ await p.click('text=SETTINGS'); await p.click('#acctOpenBtn'); await gate(p); };
  const waitFor=async(fn,ms)=>{ const t0=Date.now(); while(Date.now()-t0<(ms||8000)){ if(await fn()) return true; await new Promise(r=>setTimeout(r,200)); } return false; };

  // ---- device A: a guest rep, then the parent creates an account and keeps that progress
  const A=await device();
  log.push('A bar: '+await A.textContent('#playerBar'));
  await A.click('text=DRILLS'); await A.click('#modeRow .choice >> nth=2'); await A.click('#startBtn'); await A.waitForTimeout(250);
  await A.click('#primaryBtn'); await A.waitForTimeout(1300);
  const fb=await A.locator('#field').boundingBox();
  await A.mouse.move(fb.x+195,fb.y+300); await A.mouse.down(); await A.mouse.move(fb.x+185,fb.y+380,{steps:5}); await A.mouse.up();
  await A.waitForFunction(()=>window.__qbState.phase==='result',{timeout:12000});
  await A.click('#quitBtn'); await A.waitForTimeout(200); await A.click('#restartBtn');
  await A.click('text=SETTINGS'); await A.click('#diffRow .choice >> nth=2'); await A.click('#settingsScreen .back');
  await openAccount(A);
  await A.screenshot({path:OUT+'cloud_signin.png'});
  await A.click('#authTabs button[data-k="create"]');
  await A.fill('#authEmail','parent@example.com'); await A.fill('#authPw','touchdown123');
  await A.click('#authGo'); log.push('A no consent: '+await A.textContent('#authMsg'));
  await A.check('#authAgree'); await A.click('#authGo');
  await A.waitForSelector('#playerForm:not(.hidden)',{timeout:8000});
  const bring=await A.isChecked('#pfBring'); log.push('A bring-local offered+checked: '+bring+' ('+await A.textContent('#pfBringText')+')');
  await A.fill('#pfNick','Jay'); await A.click('#pfBands button:text-is("12U")');
  await A.screenshot({path:OUT+'cloud_addplayer.png'});
  await Promise.all([A.waitForNavigation(),A.click('#pfSave')]); await A.waitForTimeout(400);
  log.push('A after add: '+await A.textContent('#playerName'));
  const synced=await waitFor(async()=>{ const s=await mock('/__test/state'); return s.data.some(d=>d.kind==='profile')&&s.data.some(d=>d.kind==='settings'); });
  log.push('A pushed profile+settings: '+synced);

  // ---- device B: wrong password, then sign in and pick Jay
  const B=await device();
  log.push('B bar: '+await B.textContent('#playerName'));
  await openAccount(B);
  await B.fill('#authEmail','parent@example.com'); await B.fill('#authPw','wrongpass1'); await B.click('#authGo'); await B.waitForTimeout(300);
  const wrong=await B.textContent('#authMsg'); log.push('B wrong pw: '+wrong);
  await B.fill('#authPw','touchdown123'); await B.click('#authGo');
  await B.waitForSelector('#acctIn:not(.hidden)',{timeout:8000});
  await B.screenshot({path:OUT+'cloud_players.png'});
  await Promise.all([B.waitForNavigation(),B.click('#acctPlayers button:text-is("PLAY AS")')]); await B.waitForTimeout(300);
  const gotIt=await waitFor(async()=>(await B.evaluate(()=>window.__qbProfile.recs.length))>=1 && /Elite/.test(await B.textContent('#settingsSummary')));
  log.push('B as '+await B.textContent('#playerName')+' sees A progress+settings: '+gotIt+' (sync: '+await B.textContent('#playerSync')+')');
  await B.screenshot({path:OUT+'cloud_home_b.png'});

  // ---- B changes something; A picks it up
  await B.click('text=SETTINGS'); await B.click('#diffRow .choice >> nth=1'); await B.click('#settingsScreen .back');
  await waitFor(async()=>(await B.textContent('#playerSync'))==='Synced' && !(await B.evaluate(()=>0)),6000); await B.waitForTimeout(3500);
  await A.reload(); await A.waitForTimeout(300);
  const back=await waitFor(async()=>/Varsity/.test(await A.textContent('#settingsSummary')));
  log.push('A sees B change: '+back);

  // ---- expired login refreshes itself
  await mock('/__test/expire');
  await openAccount(A); await A.click('#syncNowBtn'); await A.waitForTimeout(800);
  const line=await A.textContent('#syncLine'); log.push('A after token expiry: '+line);

  // ---- delete account
  await openAccount(B);
  await B.click('#deleteAcctBtn');
  await Promise.all([B.waitForNavigation(),B.click('#deleteAcctBtn')]); await B.waitForTimeout(300);
  const st=await mock('/__test/state');
  log.push('after delete: B bar '+await B.textContent('#playerName')+', cloud users '+st.users+', players '+st.players.length);

  console.log(log.join('\n')); console.log(errs);
  const fail = errs.length || !synced || !bring || !/don't match/.test(wrong) || !gotIt || !back || !/^Synced/.test(line) || st.users!==0 || st.players.length!==0
    || (await B.textContent('#playerName'))!=='GUEST';
  if(fail){ console.error('FAIL: cloud-sync'); process.exitCode=1; }
  await b.close();
})();
