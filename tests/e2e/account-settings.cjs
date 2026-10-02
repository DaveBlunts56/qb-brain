// Account settings against the stand-in cloud: a display name at sign-up, renaming, changing the password,
// the full "forgot password" round trip (emailed link → set a new password → sign in with it),
// an expired email link, and deleting the account at the end (so the shared mock is empty for the next test).
const path=require('path'), fs=require('fs');
const { chromium, devices } = require('playwright');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.accounts.html');
const CLOUD=process.env.QB_MOCK_CLOUD||'http://localhost:8790';
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
const mock=async p=>(await fetch(CLOUD+p)).json();
(async()=>{
  const b=await chromium.launch(); const errs=[], log=[], bad=[];
  const ctx=await b.newContext({...devices['iPhone 13'],deviceScaleFactor:2});
  await ctx.addInitScript(c=>{ window.__QB_TEST__=true; window.__QB_CLOUD__={url:c,anonKey:'test-anon'}; },CLOUD);
  let p=await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message));
  const check=(ok,what)=>{ log.push((ok?'ok   ':'FAIL ')+what); if(!ok) bad.push(what); };
  const gate=async()=>{ const q=await p.textContent('#gateQ'); const m=q.match(/(\d+) × (\d+)/); await p.click('#gateOpts button:text-is("'+(+m[1]*+m[2])+'")'); await p.waitForTimeout(150); };
  const openAccount=async()=>{ await p.click('#homeScreen >> text=SETTINGS'); await p.click('#acctOpenBtn'); if(await p.isVisible('#gateSheet')) await gate(); await p.waitForSelector('#accountScreen:not(.hidden)'); };
  const home=async()=>{ await p.click('#accountScreen .back'); };

  await p.goto(APP); await p.waitForTimeout(300);
  // ---- create an account with a display name
  await openAccount();
  await p.click('#authTabs button[data-k="create"]');
  check(await p.isVisible('#authName'),'name field shows on Create account');
  await p.fill('#authName','Coach Dave'); await p.fill('#authEmail','coach@example.com'); await p.fill('#authPw','touchdown123'); await p.check('#authAgree');
  await p.click('#authGo');
  await p.waitForSelector('#playerForm:not(.hidden)',{timeout:8000});
  await p.fill('#pfNick','Jay');
  await Promise.all([p.waitForNavigation(),p.click('#pfSave')]); await p.waitForTimeout(300);
  await openAccount();
  check((await p.textContent('#acctHello'))==='Coach Dave','greets by display name ('+await p.textContent('#acctHello')+')');
  check((await p.textContent('#acctEmail'))==='coach@example.com','shows the email under the name');
  await p.screenshot({path:OUT+'account_settings.png'});

  // ---- rename + password change
  await p.fill('#acctName','Coach D'); await p.click('#acctNameSave'); await p.waitForTimeout(400);
  check((await p.textContent('#acctHello'))==='Coach D','rename saved: '+await p.textContent('#acctMsg'));
  await p.fill('#acctPw','short'); await p.click('#acctPwSave');
  check(/8 characters/.test(await p.textContent('#acctMsg')),'short password refused');
  await p.fill('#acctPw','secondpass22'); await p.click('#acctPwSave'); await p.waitForTimeout(400);
  check(/Password updated/.test(await p.textContent('#acctMsg')),'password changed');
  await p.reload(); await p.waitForTimeout(300); await openAccount();
  check((await p.textContent('#acctHello'))==='Coach D','name survives a reload (persistent session)');

  // ---- sign out, forgot password, follow the emailed link
  await Promise.all([p.waitForNavigation(),p.click('#signOutBtn')]); await p.waitForTimeout(300);
  await openAccount();
  await p.fill('#authEmail','coach@example.com'); await p.click('#authForgot'); await p.waitForTimeout(400);
  check(/reset link/.test(await p.textContent('#authMsg')),'reset requested');
  const mail=await mock('/__test/mail'); const link=mail.length && mail[mail.length-1].link;
  check(!!link && link.startsWith(APP),'reset email links back to the app');
  // the email opens in a fresh tab
  await p.close(); p=await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message));
  await p.goto(link); await p.waitForSelector('#pwSheet:not(.hidden)',{timeout:8000});
  check(!/access_token/.test(p.url()),'tokens removed from the address bar');
  check(/coach@example.com/.test(await p.textContent('#pwFor')),'new-password sheet names the account');
  await p.screenshot({path:OUT+'account_newpw.png'});
  await p.fill('#pwNew','brandnew333'); await p.click('#pwGo'); await p.waitForTimeout(1300);
  check(await p.isHidden('#pwSheet'),'new password saved, sheet closes');
  await openAccount();
  await p.click('#signOutBtn'); await p.waitForTimeout(600);   // playing as Guest here, so no reload
  if(await p.isHidden('#accountScreen')) await openAccount();
  await p.fill('#authEmail','coach@example.com'); await p.fill('#authPw','secondpass22'); await p.click('#authGo'); await p.waitForTimeout(400);
  check(/don't match/.test(await p.textContent('#authMsg')),'old password no longer works');
  await p.fill('#authPw','brandnew333'); await p.click('#authGo');
  await p.waitForSelector('#acctIn:not(.hidden)',{timeout:8000});
  check(true,'signed in with the new password');

  // ---- an expired / used link
  await p.close(); p=await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message));
  await p.goto(APP+'#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'); await p.waitForTimeout(500);
  check(await p.isVisible('#accountScreen') && /didn't work/.test(await p.textContent('#acctMsg')),'expired link explained: '+await p.textContent('#acctMsg'));

  // ---- delete the account (leaves the mock empty for the other tests)
  await p.goto(APP); await p.waitForTimeout(300); await openAccount();
  await p.click('#deleteAcctBtn'); await Promise.all([p.waitForNavigation(),p.click('#deleteAcctBtn')]); await p.waitForTimeout(300);
  const st=await mock('/__test/state'); check(st.users===0,'account deleted');

  console.log(log.join('\n')); if(errs.length) console.log(errs);
  if(errs.length||bad.length){ console.error('FAIL: account-settings'); process.exitCode=1; }
  await b.close();
})();
