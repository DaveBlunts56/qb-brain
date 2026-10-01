const path=require('path'), fs=require('fs');
const APP='file://'+path.resolve(__dirname,'../../dist/qb_brain.html');
const SITE=process.env.QB_SITE||'http://localhost:8765/';
const OUT=path.join(__dirname,'../out/'); fs.mkdirSync(OUT,{recursive:true});
const { chromium, devices } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({...devices['iPhone 13'], deviceScaleFactor:2}); await ctx.addInitScript(()=>{ window.__QB_TEST__=true; });
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
  await p.goto(APP); await p.waitForTimeout(300);
  await p.tap('text=PLAYBOOK'); await p.waitForTimeout(200);
  await p.tap('#pbTabs .choice >> nth=0'); await p.waitForTimeout(150);
  await p.screenshot({path:OUT+'ed0_myplays.png'});
  await p.tap('text=+ CREATE A PLAY'); await p.waitForTimeout(250);
  await p.fill('#edName','Dagger');
  const at=async(x,y)=>{ await p.locator('#edCanvas').scrollIntoViewIfNeeded(); const cb=await p.locator('#edCanvas').boundingBox(); const s=cb.width/30; return [cb.x+x*s, cb.y+(21-y)*s]; };
  // select X (3,0) and give him a dig at 12
  let [x,y]=await at(3,0); await p.mouse.click(x,y); await p.waitForTimeout(100);
  await p.tap('#edTools .chip:text-is("dig")');
  for(let i=0;i<2;i++) await p.tap('#edTools .chip:text-is("+")');
  // drag Y from (9,0) to (11,-1)
  [x,y]=await at(9,0); const [x2,y2]=await at(11,-1);
  await p.mouse.move(x,y); await p.mouse.down(); await p.mouse.move(x2,y2,{steps:6}); await p.mouse.up();
  await p.tap('#edTools .chip:text-is("seam")');
  // Z: draw a custom path
  [x,y]=await at(27,0); await p.mouse.click(x,y);
  await p.tap('#edTools .chip:text-is("✎ Draw")'); await p.tap('#edTools .chip:text-is("Clear path")');
  for(const q of [[27,4],[24,7],[27,12]]){ const a=await at(q[0],q[1]); await p.mouse.click(a[0],a[1]); await p.waitForTimeout(40); }
  await p.tap('#edTools .chip:text-is("Sit down")');
  // QB: pistol + rollout right
  [x,y]=await at(15,-2.8); await p.mouse.click(x,y); await p.tap('#edTools .chip:text-is("Pistol")'); await p.tap('#edTools .chip:text-is("Rollout ▶")');
  await p.screenshot({path:OUT+'ed1_editing.png'});
  // read order: X, Y, Z, C
  await p.tap('#edProgBtn');
  for(const q of [[3,0],[11,-1],[27,0],[15,0]]){ const a=await at(q[0],q[1]); await p.mouse.click(a[0],a[1]); await p.waitForTimeout(40); }
  // audibles: pick 2 standard plays
  await p.tap('#edAudBtn'); await p.waitForTimeout(100);
  await p.tap('#pickList button >> nth=0'); await p.tap('#pickList button >> nth=1'); await p.screenshot({path:OUT+'ed2_picker.png'}); await p.tap('#pickDone');
  await p.fill('#edNote','Dig behind the seam. Hit the dig vs Cover 2.');
  await p.locator('#edSave').scrollIntoViewIfNeeded(); await p.tap('#edSave'); await p.waitForTimeout(100);
  const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('qbbrain.myplays.v1')));
  await p.screenshot({path:OUT+'ed3_saved.png', fullPage:false});
  // Test it -> quick read drill
  await p.tap('#edTest'); await p.waitForTimeout(300);
  const playName=await p.evaluate(()=>window.__qbState.rep.play.name);
  // audible: hot route Y to go, then check to another play
  await p.tap('#audibleBtn'); await p.waitForTimeout(150);
  const yPx=await p.evaluate(()=>{ const r=window.__qbState.rep; return r.players.find(q=>q.id==='Y')._px; });
  const fb=await p.locator('#field').boundingBox(); await p.mouse.click(fb.x+yPx.x, fb.y+yPx.y); await p.waitForTimeout(100);
  await p.tap('#audHotRow .chip:text-is("go")'); await p.waitForTimeout(100);
  await p.screenshot({path:OUT+'ed4_audible.png'});
  const hot=await p.evaluate(()=>({name:window.__qbState.rep.players.find(q=>q.id==='Y').name, list:[...document.querySelectorAll('#audList b')].map(x=>x.textContent)}));
  await p.tap('#audList button >> nth=0'); await p.waitForTimeout(100);
  const after=await p.evaluate(()=>({play:window.__qbState.rep.play.name, from:window.__qbState.rep.audibledFrom, cov:window.__qbState.rep.shownCoverage}));
  await p.tap('#audClose'); await p.tap('#primaryBtn'); await p.waitForTimeout(1300);
  await p.mouse.move(fb.x+195,fb.y+330); await p.mouse.down(); await p.mouse.move(fb.x+190,fb.y+420,{steps:5}); await p.mouse.up();
  await p.waitForFunction(()=>!document.querySelector('#resultSheet').classList.contains('hidden'),{timeout:12000});
  // Full drive: play call screen
  await p.tap('#quitBtn'); await p.waitForTimeout(200); await p.tap('#restartBtn'); await p.waitForTimeout(150);
  await p.tap('text=PLAY DRIVE'); await p.tap('#driveStartBtn'); await p.waitForTimeout(400);
  const callVisible=await p.isVisible('#callSheet');
  await p.screenshot({path:OUT+'ed5_playcall.png'});
  const tabs=await p.evaluate(()=>[...document.querySelectorAll('#callTabs .chip')].map(x=>x.textContent));
  await p.tap('#callGrid .play-card >> nth=0'); await p.waitForTimeout(200);
  const drivePlay=await p.evaluate(()=>({phase:window.__qbState.phase, play:window.__qbState.rep.play.name}));
  console.log(JSON.stringify({saved:saved.map(q=>({name:q.name,form:q.form,prog:q.prog,players:q.players.map(z=>z.id+':'+(z.route.mode==='lib'?z.route.type+(z.route.depth?'@'+z.route.depth:''):z.route.mode==='qb'?z.route.action:'draw'+z.route.rel.length)+'('+z.x+','+z.y+')')})), playName, hot, after, callVisible, tabs, drivePlay, errs},null,1));
  if(errs.length || (!saved.length || hot.name!=='go (hot)' || !callVisible || drivePlay.play!=='Dagger' || after.play==='Dagger')) { console.error('FAIL: play-editor'); process.exitCode=1; }
  await b.close();
})();
