// QB Brain Pro.
// Beta build: testers have everything; "Preview as Free" locks the Pro features and each one opens the Upgrade screen.
// Release-style build (accounts on, channel stable) against the stand-in cloud: Free until the account has a Pro
// entitlement — which only the server (here: the mock "webhook") can grant — then unlocked; signing out locks it again.
const path=require('path'), fs=require('fs');
const { chromium, devices } = require('playwright');
const BETA='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const STABLE='file://'+path.resolve(__dirname,'../../dist/qb_brain.accounts.stable.html');
const CLOUD=process.env.QB_MOCK_CLOUD||'http://localhost:8790';
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
const mock=async p=>(await fetch(CLOUD+p)).json();
(async()=>{
  const b=await chromium.launch(); const errs=[], log=[], bad=[];
  const check=(ok,what)=>{ log.push((ok?'ok   ':'FAIL ')+what); if(!ok) bad.push(what); };
  const phone=async(app,cloud)=>{ const ctx=await b.newContext({...devices['iPhone 13'],deviceScaleFactor:2});
    await ctx.addInitScript(c=>{ window.__QB_TEST__=true; if(c) window.__QB_CLOUD__={url:c,anonKey:'test-anon',checkout:true}; },cloud||null);
    const p=await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message)); await p.goto(app); await p.waitForTimeout(400); return p; };
  const upHead=async p=>(await p.isVisible('#upgradeScreen')) ? await p.textContent('#upHead') : '(no upgrade screen)';

  // ================= beta build =================
  let p=await phone(BETA);
  check(/BETA/.test(await p.textContent('#proLinkText')),'beta: home says Pro is unlocked ('+await p.textContent('#proLinkText')+')');
  await p.tap('#homeScreen >> text=SETTINGS');
  check(await p.isVisible('#previewFreeRow'),'beta: Preview as Free switch shown');
  await p.tap('#diffRow .choice >> nth=2');
  check(/Elite/.test(await p.textContent('#settingsSummary')),'beta: Elite selectable');
  check(await p.locator('#diffRow .choice >> nth=2 >> .pro-tag').count()===1,'Elite carries a PRO tag');
  await p.tap('#diffRow .choice >> nth=0');
  await p.tap('#previewFreeSwitch'); await p.waitForTimeout(100);
  await p.tap('#diffRow .choice >> nth=2'); await p.waitForTimeout(150);
  check(/Elite difficulty is part of QB Brain Pro/.test(await upHead(p)),'preview Free: Elite opens Upgrade: '+await upHead(p));
  await p.screenshot({path:OUT+'upgrade.png'});
  await p.tap('#upBuy'); check(/beta build/.test(await p.textContent('#upMsg')),'beta: GET PRO explains nothing to buy');
  await p.tap('#upBack'); await p.waitForTimeout(100);
  check(await p.isVisible('#settingsScreen') && /Rookie/.test(await p.textContent('#settingsSummary')),'back to Settings, difficulty unchanged');
  await p.tap('#adaptiveSwitch'); await p.waitForTimeout(100);
  check(/Adaptive training is part/.test(await upHead(p)),'Adaptive opens Upgrade');
  await p.tap('#upBack'); await p.tap('#settingsScreen .back');
  await p.tap('text=DRILLS'); await p.tap('#modeRow .choice >> nth=3'); await p.waitForTimeout(100);
  check(/Film Room is part/.test(await upHead(p)),'Film Room opens Upgrade');
  await p.tap('#upBack'); await p.tap('#drillsScreen .back');
  await p.tap('text=DASHBOARD'); await p.tap('#dashScreen >> text=QB PROFILE'); await p.waitForTimeout(150);
  check(/Coach's diagnosis/.test(await p.textContent('#pfDiag')) && await p.isHidden('#pfCov'),'QB Profile breakdowns locked for Free');
  await p.screenshot({path:OUT+'profile_locked.png'});
  await p.tap('#profileScreen .back');
  await p.tap('#homeScreen >> text=SETTINGS'); await p.tap('#previewFreeSwitch'); await p.tap('#diffRow .choice >> nth=2');
  check(/Elite/.test(await p.textContent('#settingsSummary')),'preview off: Elite unlocked again');
  await p.context().close();

  // ================= release-style build + cloud =================
  p=await phone(STABLE,CLOUD);
  check(/GO PRO/.test(await p.textContent('#proLinkText')),'stable: guest is Free');
  await p.tap('#proLink'); await p.waitForTimeout(100);
  check(await p.locator('#upPlans .plan').count()===2,'two plans shown');
  await p.tap('#upBuy'); check(/sign in first/.test(await p.textContent('#upMsg')),'guest asked to have a grown-up sign in: '+await p.textContent('#upMsg'));
  // that tap opened the account screen (behind the grown-ups question)
  const gate=async()=>{ const q=await p.textContent('#gateQ'); const m=q.match(/(\d+) × (\d+)/); await p.click('#gateOpts button:text-is("'+(+m[1]*+m[2])+'")'); await p.waitForTimeout(150); };
  if(await p.isVisible('#gateSheet')) await gate();
  check(await p.isVisible('#accountScreen'),'account screen opened');
  await p.click('#authTabs button[data-k="create"]'); await p.fill('#authName','Pro Parent'); await p.fill('#authEmail','pro@example.com'); await p.fill('#authPw','touchdown123'); await p.check('#authAgree'); await p.click('#authGo');
  await p.waitForSelector('#playerForm:not(.hidden)',{timeout:8000}); await p.fill('#pfNick','Mo');
  await Promise.all([p.waitForNavigation(),p.click('#pfSave')]); await p.waitForTimeout(400);
  check(/GO PRO/.test(await p.textContent('#proLinkText')),'signed in, no entitlement: still Free');
  await p.tap('#proLink'); await p.tap('#upPlans .plan >> nth=1');
  await p.tap('#upBuy'); await p.waitForTimeout(200);
  if(await p.isVisible('#gateSheet')) await gate();
  // the payment provider's webhook would record the purchase; the mock does it here
  await p.waitForURL(/from=checkout/,{timeout:8000}); await mock('/__test/grant?email=pro@example.com');
  await p.waitForTimeout(600);
  const st=await mock('/__test/state'); check(st.checkouts.length===1 && st.checkouts[0].plan==='monthly','server asked for a monthly checkout');
  await p.waitForFunction(()=>/active/i.test(document.getElementById('upMsg').textContent+document.getElementById('upStatus').textContent),null,{timeout:20000}).catch(()=>{});
  check(await p.isVisible('#upgradeScreen') && /Pro is active/.test(await p.textContent('#upStatus')),'back from checkout: '+await p.textContent('#upStatus'));
  check(!/from=checkout|pro=success/.test(p.url().split('?')[0]+p.url().split('#')[1]),'address bar tidied');
  await p.tap('#upBack'); await p.tap('#homeScreen >> text=SETTINGS'); await p.tap('#diffRow .choice >> nth=2');
  check(/Elite/.test(await p.textContent('#settingsSummary')),'subscriber: Elite unlocked');
  await p.reload(); await p.waitForTimeout(500);
  check(/ACTIVE/.test(await p.textContent('#proLinkText')),'Pro kept after reload');
  // signing out locks Pro again
  await p.tap('#homeScreen >> text=SETTINGS'); await p.click('#acctOpenBtn'); if(await p.isVisible('#gateSheet')) await gate();
  await Promise.all([p.waitForNavigation(),p.click('#signOutBtn')]); await p.waitForTimeout(400);
  check(/GO PRO/.test(await p.textContent('#proLinkText')),'signed out: Free again');
  await p.tap('#homeScreen >> text=SETTINGS'); await p.tap('#diffRow .choice >> nth=2'); await p.waitForTimeout(100);
  check(/Elite difficulty is part/.test(await upHead(p)),'signed out: Elite locked');
  // clean up the account
  await p.tap('#upBack'); await p.click('#acctOpenBtn'); if(await p.isVisible('#gateSheet')) await gate();
  await p.fill('#authEmail','pro@example.com'); await p.fill('#authPw','touchdown123'); await p.click('#authGo'); await p.waitForSelector('#acctIn:not(.hidden)',{timeout:8000});
  await p.click('#deleteAcctBtn'); await p.click('#deleteAcctBtn'); await p.waitForTimeout(800);
  check((await mock('/__test/state')).users===0,'test account deleted');

  console.log(log.join('\n')); if(errs.length) console.log(errs);
  if(errs.length||bad.length){ console.error('FAIL: pro-gating'); process.exitCode=1; }
  await b.close();
})();
