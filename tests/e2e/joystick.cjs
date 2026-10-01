const path=require('path'), fs=require('fs');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const SITE=process.env.QB_SITE||'http://localhost:8765/';
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
const { chromium, devices } = require('playwright');
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({...devices['iPhone 13'], deviceScaleFactor:2}); await ctx.addInitScript(()=>{ window.__QB_TEST__=true; });
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const cdp=await ctx.newCDPSession(p);
  const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(q=>({x:q[0],y:q[1],id:q[2]}))});
  const Qs=()=>p.evaluate(()=>{ const s=window.__qbState.rep.players.find(x=>x.id==='Q').s; return {x:+s.x.toFixed(2), y:+s.y.toFixed(2)}; });
  await p.goto(APP); await p.waitForTimeout(300);
  await p.tap('text=DRILLS'); await p.tap('#modeRow .choice >> nth=2'); await p.selectOption('#playSelect','Mesh');
  await p.tap('#startBtn'); await p.waitForTimeout(250);
  const preVisible=await p.isVisible('#joy');
  await p.tap('#primaryBtn'); await p.waitForTimeout(500);
  const visible=await p.isVisible('#joy');
  const jb=await p.locator('#joyBase').boundingBox(); const J=[jb.x+jb.width/2, jb.y+jb.height/2, 1];
  const q0=await Qs();
  await touch('touchStart',[J]);
  for(let k=1;k<=10;k++){ await touch('touchMove',[[J[0]+4*k, J[1]-6*k, 1]]); await p.waitForTimeout(25); }
  await p.waitForTimeout(900);
  const q1=await Qs();
  await p.screenshot({path:OUT+'joy1.png'});
  // right thumb pulls back while left thumb holds the stick
  const box=await p.locator('#field').boundingBox(); const Jh=[J[0]+40,J[1]-60,1];
  const A=[box.x+260, box.y+300, 2];
  await touch('touchStart',[Jh,A]);
  for(let k=1;k<=6;k++){ await touch('touchMove',[Jh,[A[0]-2*k,A[1]+16*k,2]]); await p.waitForTimeout(20); }
  await p.screenshot({path:OUT+'joy2.png'});
  await touch('touchEnd',[]); await p.waitForTimeout(120);
  const thrown=await p.evaluate(()=>{ const b=window.__qbState.rep.ball; return b?{type:b.type, fromX:+b.from.x.toFixed(2), fromY:+b.from.y.toFixed(2)}:null; });
  const toggledToBullet = thrown && thrown.type;
  // keyboard on a new rep
  await p.waitForFunction(()=>!document.querySelector('#resultSheet').classList.contains('hidden'),{timeout:12000});
  await p.tap('#nextRepBtn'); await p.waitForTimeout(250); await p.tap('#primaryBtn'); await p.waitForTimeout(600);
  const k0=await Qs(); await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(700); await p.keyboard.up('ArrowLeft'); const k1=await Qs();
  console.log({preVisible, visible, q0, q1, thrown, key:{k0,k1}, errs});
  if(errs.length || (!visible || preVisible || !(q1.y<=-0.55) || !(q1.x>q0.x+2) || !thrown || !(k1.x<k0.x))) { console.error('FAIL: joystick'); process.exitCode=1; }
  await b.close();
})();
