import { VIEW, ctx, cw, toPx } from "./canvas.js";
import { COV_COACH } from "./coach.js";
import { COLORS, GEO, MODES, clamp, on, setGeometry } from "./config.js";
import { DEF_TUNE, buildDefense } from "./defense.js";
import { clearOverlays } from "./drive.js";
import { rafId, startRep, studyTimer } from "./loop.js";
import { LIB, libPts } from "./myplays.js";
import { AUD, audibleShow, drawArrowHead } from "./playbook.js";
import { STANDARD5 } from "./plays.js";
import { playerById } from "./rep.js";
import { SCREENS, buildChoiceRow, refreshSetupUI, showScreen, startSession } from "./setup.js";
import { drawStatic } from "./sprites.js";
import { els, state } from "./state.js";

/* ============================================================
   LEARN — Coach's Manual (chapters + diagrams) and the interactive Tutorial
============================================================ */

/* ---------------- figure drawing (template yards: x 0..30, LOS y=0) ---------------- */
function figCtx(cv,y0,y1){
  const W=cv.clientWidth||340, d=Math.min(window.devicePixelRatio||1,2.5), H=Math.round(W*(y1-y0)/30);
  cv.width=Math.round(W*d); cv.height=Math.round(H*d); cv.style.aspectRatio=W+"/"+H;
  const g=cv.getContext && cv.getContext("2d"); if(!g || !g.setTransform) return null;
  g.setTransform(d,0,0,d,0,0);
  const s=W/30, P=(x,y)=>[x*s,(y1-y)*s];
  g.fillStyle="#4f9c45"; g.fillRect(0,0,W,H);
  for(let y=Math.ceil(y0/5)*5;y<=y1;y+=5){ const py=P(0,y)[1]; g.fillStyle="rgba(244,240,226,0.28)"; g.fillRect(0,py-1,W,2);
    if(y>0){ g.fillStyle="rgba(244,240,226,0.5)"; g.font="11px 'Jersey 10', sans-serif"; g.textAlign="left"; g.textBaseline="middle"; g.fillText(String(y),3,py-7); } }
  const los=P(0,0)[1]; if(los>=0 && los<=H){ g.fillStyle="rgba(0,0,0,0.10)"; g.fillRect(0,los,W,H-los); g.fillStyle="#5ab8ff"; g.fillRect(0,los-1.5,W,3); }
  return {g,P,s,W,H};
}
function figDot(F,x,y,id,col){ const [a,b]=F.P(x,y), R=Math.max(8,F.s*0.55); const g=F.g;
  g.beginPath(); g.arc(a,b,R,0,Math.PI*2); g.fillStyle=col||COLORS[id]||"#ffc933"; g.fill(); g.lineWidth=2; g.strokeStyle="#0d1117"; g.stroke();
  if(id){ g.fillStyle="#0d1117"; g.font=Math.round(R*1.4)+"px 'Jersey 10', sans-serif"; g.textAlign="center"; g.textBaseline="middle"; g.fillText(id,a,b+1); } }
function figDef(F,x,y,label,col){ const [a,b]=F.P(x,y), R=Math.max(8,F.s*0.55), g=F.g;
  g.beginPath(); g.moveTo(a,b+R); g.lineTo(a-0.95*R,b-0.75*R); g.lineTo(a+0.95*R,b-0.75*R); g.closePath(); g.fillStyle=col||"#e8412c"; g.fill(); g.lineWidth=2; g.strokeStyle="#0d1117"; g.stroke();
  if(label){ g.font="11px 'Jersey 10', sans-serif"; g.textAlign="center"; g.textBaseline="top"; g.fillStyle="#fff"; g.strokeStyle="rgba(0,0,0,.75)"; g.lineWidth=3; g.strokeText(label,a,b+R+1); g.fillText(label,a,b+R+1); } }
function figLine(F,pts,col,w,dash,arrow){ const g=F.g; g.strokeStyle=col; g.lineWidth=w||2.5; g.lineJoin="round"; g.setLineDash(dash||[]);
  g.beginPath(); pts.forEach((q,i)=>{ const [a,b]=F.P(q[0],q[1]); i?g.lineTo(a,b):g.moveTo(a,b); }); g.stroke(); g.setLineDash([]);
  if(arrow && pts.length>1){ const A=F.P(...pts[pts.length-2]), B=F.P(...pts[pts.length-1]); drawArrowHead(g,A,B,col,8); } }
function figText(F,x,y,t,col,size,align){ const [a,b]=F.P(x,y), g=F.g; g.font=(size||13)+"px 'Jersey 10', sans-serif"; g.textAlign=align||"center"; g.textBaseline="middle";
  g.strokeStyle="rgba(0,0,0,.8)"; g.lineWidth=3; g.strokeText(t,a,b); g.fillStyle=col||"#fff"; g.fillText(t,a,b); }
function figZone(F,x0,x1,y0,y1,deep){ const g=F.g, A=F.P(x0,y1), B=F.P(x1,y0);
  g.fillStyle=deep?"rgba(90,184,255,0.18)":"rgba(255,201,51,0.18)"; g.strokeStyle=deep?"rgba(90,184,255,0.8)":"rgba(255,201,51,0.8)"; g.lineWidth=1.5;
  g.fillRect(A[0],A[1],B[0]-A[0],B[1]-A[1]); g.strokeRect(A[0],A[1],B[0]-A[0],B[1]-A[1]); }
const FIG_OFF5=[["Q",15,-2.8],["C",15,0],["X",3,0],["Y",9,0],["Z",27,0]];
const FIG_OFF7=[["Q",15,-2.8],["C",15,0],["X",2,0],["H",8,0],["Y",21,0],["Z",28,0],["F",11,-1.5]];
// coverage diagram using the game's own defense builder
function figCoverage(cv,cov){
  const F=figCtx(cv,-6,19); if(!F) return;
  const save={W:GEO.W,yMin:GEO.yMin,yMax:GEO.yMax}; setGeometry(30,-14,45);
  let defs=[], rusher=true, OFF=FIG_OFF5, nd=4;
  if(/^7:/.test(cov)){ cov=cov.slice(2); OFF=FIG_OFF7; nd=7; rusher=false; }
  const targets=OFF.filter(o=>o[0]!=="Q").map(o=>({id:o[0],x0:o[1],y0:o[2],path:{wps:[{x:o[1],y:o[2],t:0},{x:o[1],y:o[2]+(o[0]==="Y"||o[0]==="X"?16:6),t:2}]}}));
  if(cov==="Cover 4"){ [[0,7.5],[7.5,15],[15,22.5],[22.5,30]].forEach(([a,b])=>defs.push({role:"zone",type:"deep",x0:a,x1:b,lx:(a+b)/2,ly:12,pos:{x:(a+b)/2,y:10}})); }
  else if(cov==="2-2 Box"){ defs=[{role:"zone",type:"flat",x0:0,x1:14,lx:8,ly:5,pos:{x:8,y:5}},{role:"zone",type:"flat",x0:16,x1:30,lx:22,ly:5,pos:{x:22,y:5}},
     {role:"zone",type:"deep",x0:0,x1:15,lx:8,ly:13,pos:{x:8,y:11}},{role:"zone",type:"deep",x0:15,x1:30,lx:22,ly:13,pos:{x:22,y:11}}]; }
  else if(cov==="3-1"){ defs=[{role:"zone",type:"flat",x0:0,x1:10,lx:4,ly:4,pos:{x:4,y:4}},{role:"zone",type:"hook",x0:10,x1:20,lx:15,ly:6,pos:{x:15,y:6}},
     {role:"zone",type:"flat",x0:20,x1:30,lx:26,ly:4,pos:{x:26,y:4}},{role:"zone",type:"deep",x0:0,x1:30,lx:15,ly:14,pos:{x:15,y:12}}]; }
  else if(cov==="Cover 3 (no rush)"){ defs=[{role:"zone",type:"deep",x0:0,x1:10,lx:5,ly:12,pos:{x:5,y:10}},{role:"zone",type:"deep",x0:10,x1:20,lx:15,ly:13,pos:{x:15,y:11}},{role:"zone",type:"deep",x0:20,x1:30,lx:25,ly:12,pos:{x:25,y:10}},
     {role:"zone",type:"flat",x0:0,x1:15,lx:8,ly:5,pos:{x:8,y:5}},{role:"zone",type:"flat",x0:15,x1:30,lx:22,ly:5,pos:{x:22,y:5}}]; rusher=false; }
  else { try{ defs=buildDefense(cov,targets,nd,DEF_TUNE.varsity); defs.forEach(d=>{ if(d.role==="man"){ d.press=false; d.pos={x:clamp(d.assign.x0+(d.assign.x0<15?1:-1),1,29),y:5}; } }); }catch(_){ defs=[]; } }
  setGeometry(save.W,save.yMin,save.yMax);
  defs.forEach(d=>{ if(d.role==="zone"){ const deep=d.type==="deep";
      const y0=deep?Math.max(8,d.ly-4):d.type==="flat"?0.5:2.5, y1=deep?Math.min(18,d.ly+6):d.type==="flat"?6.5:10; figZone(F,d.x0,d.x1,y0,y1,deep); } });
  OFF.forEach(o=>figDot(F,o[1],o[2],o[0]));
  defs.forEach(d=>{
    if(d.role==="man"){ const r=targets.find(q=>q.id===d.assign.id); if(r) figLine(F,[[d.pos.x,d.pos.y],[r.x0,r.y0+0.6]],"rgba(232,65,44,0.95)",2,[5,4]); }
    figDef(F,d.pos.x,d.pos.y, d.robber?"robber":d.bracket?(d.role==="man"?"under":"over"):d.role==="man"?"man":d.type);
  });
  if(rusher){ figDef(F,15,7,"rusher","#9e1b12"); figLine(F,[[15,6.2],[15,-1.5]],"rgba(255,201,51,0.9)",2,[3,4],true); }
}
function figPlay(cv,play,opt){
  const F=figCtx(cv,-6,18); if(!F) return; opt=opt||{};
  const cols=["#5fe08a","#5ab8ff","#ff6b5a","#c8a8ff"];
  play.players.forEach(p=>{ const pts=p.route.pts; if(pts.length>1) figLine(F,pts,COLORS[p.id]||"#ffc933",3,p.dashed?[6,5]:[],p.route.after==="run");
    else if(p.id!=="Q"){} });
  play.players.forEach(p=>figDot(F,p.x,p.y,p.id));
  if(opt.prog){ (play.prog||[]).slice(0,4).forEach((id,i)=>{ const p=play.players.find(q=>q.id===id); if(!p) return; const end=p.route.pts[p.route.pts.length-1];
    const [a,b]=F.P(end[0],end[1]); const g=F.g; g.beginPath(); g.arc(a,b-12,10,0,Math.PI*2); g.fillStyle=cols[i]; g.fill(); g.strokeStyle="#0d1117"; g.lineWidth=2; g.stroke();
    g.fillStyle="#0d1117"; g.font="14px 'Jersey 10', sans-serif"; g.textAlign="center"; g.textBaseline="middle"; g.fillText(String(i+1),a,b-11); }); }
  if(opt.key){ figDef(F,opt.key[0],opt.key[1],"KEY","#ff6b5a"); }
}
function figRoutes(cv){
  const F=figCtx(cv,-3,20); if(!F) return;
  const x=7, list=[["go","GO"],["post","POST"],["corner","CORNER"],["dig","DIG/IN"],["out","OUT"],["curl","CURL"],["hitch","HITCH"],["slant","SLANT"],["flat","FLAT"],["wheel","WHEEL"]];
  const pal=["#ffc933","#5ab8ff","#ff8c2a","#c8a8ff","#5fe08a","#ff6b5a","#f4f0e2","#22b3a6","#ffd6e0","#b8bec6"];
  const nudge={corner:-1.9, wheel:0.4, curl:0.2, hitch:-0.2};
  list.forEach(([k,l],i)=>{ const pts=libPts(k,x,0,null,false); figLine(F,pts,pal[i],2.6,[],LIB[k].after==="run"); const e=pts[pts.length-1];
    const left=e[0]<x-0.5; figText(F,left?0.6:Math.min(e[0]+0.6,24),e[1]+0.9+(nudge[k]||0),l,pal[i],12,"left"); });
  figDot(F,x,0,"X"); figText(F,22,-1.5,"ball / middle of the field ▶","#f4f0e2",12);
}
function figHighLow(cv){
  const F=figCtx(cv,-4,14); if(!F) return;
  figLine(F,[[25,0],[25,9],[23.8,8.4]],"#ff8c2a",3,[],false); figLine(F,[[19,0],[20.5,1.4],[27.5,2]],"#b35ce8",3,[],true);
  figDot(F,25,0,"X"); figDot(F,19,0,"Y"); figDot(F,15,-2.8,"Q");
  figDef(F,24,4.8,"flat defender");
  figText(F,25,11,"HIGH (curl)","#ff8c2a",14); figText(F,27,3.5,"LOW (flat)","#b35ce8",14,"right");
  figText(F,9,7,"He can't cover both.","#ffc933",15); figText(F,9,5.2,"Sinks → throw LOW.  Jumps → throw HIGH.","#ffffff",13);
}
function figHorizontal(cv){
  const F=figCtx(cv,-4,12); if(!F) return;
  figLine(F,[[9,0],[9,5.5]],"#b35ce8",3); figLine(F,[[21,0],[21,5.5]],"#22b3a6",3);
  figDot(F,9,0,"Y"); figDot(F,21,0,"Z"); figDot(F,15,-2.8,"Q"); figDot(F,15,0,"C");
  figDef(F,15,6,"hook");
  figLine(F,[[13.5,6.5],[10.5,6.5]],"#ffc933",2,[3,3],true); figLine(F,[[16.5,6.5],[19.5,6.5]],"#ffc933",2,[3,3],true);
  figText(F,15,9.5,"Throw away from the way he moves","#ffffff",13);
}
function figLeverage(cv){
  const F=figCtx(cv,-3,11); if(!F) return;
  figText(F,7.5,9.8,"Defender INSIDE","#ffc933",14); figText(F,22.5,9.8,"Defender OUTSIDE","#ffc933",14);
  figDot(F,5,0,"X"); figDef(F,6.6,4,"inside"); figLine(F,[[5,0],[5,5],[1.2,5]],"#5fe08a",3,[],true); figLine(F,[[5,5],[9,8]],"rgba(255,107,90,0.8)",2,[4,4]);
  figText(F,3,7,"OUT ✓","#5fe08a",13); figText(F,10.5,8.6,"slant ✗","#ff6b5a",12);
  figDot(F,22,0,"Z"); figDef(F,20.4,4,"outside"); figLine(F,[[22,0],[22,1.5],[26.5,6.5]],"rgba(255,107,90,0.8)",2,[4,4]); figLine(F,[[22,0],[22,1.5],[17.5,6.5]],"#5fe08a",3,[],true);
  figText(F,16,7.6,"SLANT ✓","#5fe08a",13); figText(F,27.5,7.6,"✗","#ff6b5a",13);
}
function figLobBullet(cv){
  const F=figCtx(cv,-4,16); if(!F) return;
  figDot(F,15,-2.8,"Q"); figDot(F,15,13,"Y"); figDef(F,15,6,"underneath");
  figLine(F,[[15.3,-1.6],[15.3,12]],"#ffc933",3,[],true); figText(F,18.6,4.2,"BULLET: low and fast","#ffc933",12,"left");
  const g=F.g; g.strokeStyle="#ffffff"; g.lineWidth=2.5; g.setLineDash([2,6]); g.beginPath(); const a=F.P(14.6,-1.6), c=F.P(5,6), e=F.P(14.6,12); g.moveTo(a[0],a[1]); g.quadraticCurveTo(c[0],c[1],e[0],e[1]); g.stroke(); g.setLineDash([]);
  figText(F,3.5,9,"LOB: over","#ffffff",12,"left"); figText(F,3.5,7.8,"the defender","#ffffff",12,"left");
  figText(F,15,3.6,"tipped?","#ff6b5a",12);
}
function figRush(cv){
  const F=figCtx(cv,-6,9); if(!F) return;
  figDot(F,15,-4.3,"Q"); figDef(F,15,7,"rusher","#9e1b12"); figLine(F,[[15,6.2],[15,-3]],"#ffc933",2,[4,4],true);
  figText(F,17.5,6.9,"7 yds off the line","#ffffff",12,"left");
  figText(F,19,2.6,"Rookie ≈ 2.9 s","#5fe08a",14,"left"); figText(F,19,1.2,"Varsity ≈ 2.3 s","#5ab8ff",14,"left"); figText(F,19,-0.2,"Elite ≈ 1.2–1.5 s","#ff8c5a",14,"left");
  figText(F,8,-2.2,"QB can't cross","#5ab8ff",12); figText(F,8,-3.4,"the blue line","#5ab8ff",12);
}
function figField(cv){
  const W=cv.clientWidth||340, d=Math.min(window.devicePixelRatio||1,2.5), H=Math.round(W*0.62);
  cv.width=Math.round(W*d); cv.height=Math.round(H*d); cv.style.aspectRatio=W+"/"+H;
  const g=cv.getContext && cv.getContext("2d"); if(!g||!g.setTransform) return; g.setTransform(d,0,0,d,0,0);
  // sideways field: 70 yds + two 10-yd end zones across, 25 wide down
  const L=90, sx=W/L, X=v=>v*sx, top=H*0.12, fh=H*0.66;
  g.fillStyle="#0d1117"; g.fillRect(0,0,W,H);
  g.fillStyle="#4f9c45"; g.fillRect(0,top,W,fh);
  g.fillStyle="rgba(90,184,255,0.35)"; g.fillRect(0,top,X(10),fh); g.fillRect(X(80),top,X(10),fh);
  g.fillStyle="rgba(255,107,90,0.25)"; g.fillRect(X(40),top,X(5),fh); g.fillRect(X(75),top,X(5),fh);
  g.fillStyle="#f4f0e2"; [10,45,80].forEach(v=>g.fillRect(X(v)-1,top,2,fh));
  g.fillStyle="#5ab8ff"; g.fillRect(X(25)-1.5,top,3,fh); g.fillStyle="#ffc933"; g.fillRect(X(32)-1,top,2,fh);
  g.font="12px 'Jersey 10', sans-serif"; g.textAlign="center"; g.textBaseline="middle"; g.fillStyle="#f4f0e2";
  [5,85].forEach(v=>{ g.save(); g.translate(X(v),top+fh/2); g.rotate(-Math.PI/2); g.fillText("END ZONE",0,0); g.restore(); }); g.fillText("MIDFIELD",X(45),top-8);
  g.fillStyle="#5ab8ff"; g.fillText("LOS",X(25),top+fh+10); g.fillStyle="#ffc933"; g.fillText("rush line (7 yds)",X(32)+28,top+fh+22);
  g.fillStyle="#ff9a8a"; g.fillText("no-run zones (NFL FLAG)",X(60),top+fh+10);
  g.fillStyle="#a9b2a1"; g.fillText("NFL FLAG: 25–30 yds wide × 70 long + 10-yd end zones",W/2,H-6);
}
let FIGS;
function stdPlay(name){ return STANDARD5.find(p=>p.name===name); }

/* ---------------- manual content ----------------
   Blocks: ["p",html] ["h",text] ["ul",[html...]] ["fig",type,arg,caption] ["tip",html] ["pro",html] ["note",html] ["table",[rows]] ["practice",{label,coverage,play}] ["src",[[label,url]...]]
   Text is our own static HTML (no user content). */
const SRC={
  rules:["NFL FLAG Official Playing Rules (rev. 2025)","https://cdn.mediavalet.com/usca/rcx/DgBtnnoMFUCXWCBQE3YN2w/XMiAtpBTH0er4fUrKeYJAQ/Original/NFL_Flag_Rulebook_21423.pdf"],
  howto:["NFL FLAG — How to play","https://nflflag.com/flag-football-rules/how-to-play-flag-football"],
  def5:["NFL FLAG — 5 on 5 defense guide","https://nflflag.com/flag-football-plays/5-on-5-flag-football-defense"],
  plays:["NFL FLAG — Plays & formations","https://nflflag.com/flag-football-plays"],
  usafRoutes:["USA Flag — Route tree","https://dev.usaflag.org/?p=4267"],
  slantflat:["USA Football — Slant-flat and how the QB should read it","https://blogs.usafootball.com/blog/7512/detailing-slant-flat-and-how-the-quarterback-should-read-it"],
  reads:["USA Football — Basic knowledge about reads","https://blogs.usafootball.com/blog/7291/basic-knowledge-about-reads"],
  verts:["USA Football — AJ Smith on 4 Verticals","https://blogs.usafootball.com/blog/7368/podcast-review-aj-smith-talks-all-things-about-4-verticals"],
  boxone:["USA Football — Box-and-one pass rush drill","https://blogs.usafootball.com/blog/1306/box-and-one-drill-develops-a-good-pass-rush-in-flag-football"],
  prog:["PlaybookTech First Down — Progression read","https://firstdown.playbooktech.com/coaches-community/flag-football-progression-read"],
  qbreads:["PlaybookTech First Down — QB reads","https://firstdown.playbooktech.com/coaches-community/flag-football-quarterback-reads"],
  curlflat:["PlaybookTech First Down — Curl-flat read","https://firstdown.playbooktech.com/coaches-community/flag-football-curl-flat-read"],
  mesh:["PlaybookTech First Down — Coaching mesh","https://firstdown.playbooktech.com/coaches-community/coaching-the-mesh-concept-correctly"],
  youngqb:["PlaybookTech First Down — Teaching young QBs coverage","https://firstdown.playbooktech.com/coaches-community/teaching-young-quarterbacks-coverage"],
  manzone:["PlaybookTech First Down — Man vs zone recognition","https://firstdown.playbooktech.com/coaches-community/teach-receivers-to-recognize-man-vs-zone-coverage"],
  beaters:["Youth Football Online — 7v7 coverage beaters","https://youthfootballonline.com/7v7-flag-football-coverage-beaters/"],
  readcov:["Youth Football Online — Teaching QBs to read coverages","https://youthfootballonline.com/teaching-quarterbacks-to-read-defensive-coverages"],
  iflagdef:["iFlag — 5 on 5 defense strategy guide","https://iflag.org/the-best-5-on-5-flag-football-defense-strategy-guide/"],
  iflagqb:["iFlag — Mastering the flag QB position","https://iflag.org/the-complete-guide-to-mastering-the-flag-football-quarterback-position/"],
  smash:["WRWR — Smash concept","https://wrwr.substack.com/p/its-time-to-smash-the-competition"],
  flood:["Coach Kou — Sail/Flood","https://coachkoufootball.substack.com/p/nfl-pass-concepts-4-sailflood-route"],
  dagger:["Coach Kou — Dagger","https://coachkoufootball.substack.com/p/dagger"],
  stick:["FootballPlayCard — Stick concept","https://footballplaycard.com/blog/mastering-the-stick-concept-football"],
  leverage:["Matt Waldman RSP — Leverage","https://mattwaldmanrsp.com/2022/12/13/matt-waldmans-rsp-nfl-scouting-glossary-accounting-for-leverage-with-qb-tanner-mckee-stanford/"],
  mojo:["MOJO — What is zone defense","https://www.mojo.sport/coachs-corner/what-is-zone-defense/"]
};
function covChapter(id,title,cov,level,body,srcs,figArg){
  return {id,title,level,group:"COVERAGES",blocks:[["fig","coverage",figArg||cov,"How "+(figArg||cov)+" lines up in 5v5. Yellow boxes = short zones, blue = deep zones, dashed red = man assignments."]].concat(body,
    COV_COACH[cov] ? [["practice",{label:"PRACTICE VS "+cov.toUpperCase(),coverage:cov}]] : [], [["src",srcs]])};
}
function conChapter(id,name,stretch,beats,readHtml,body,srcs,key){
  const p=stdPlay(name);
  return {id,title:name,level:"all",group:"CONCEPTS",blocks:[
    p?["fig","play",{play:p,prog:true,key},"The "+name+" concept. Numbers = read order (green 1st, blue 2nd, red 3rd)."]:["p",""],
    ["table",[["Stretches",stretch],["Beats",beats],["Read",readHtml]]]
  ].concat(body,[["practice",{label:"RUN "+name.toUpperCase(),play:name}],["src",srcs]])};
}
let MANUAL;

/* ---------------- manual rendering ---------------- */
let MAN_CUR=null;
function openManual(id){
  els.manual.classList.remove("hidden");
  if(id) showChapter(id); else showChapterList();
}
function openManualFromGame(id){ openManual(id); }
function closeManual(){ els.manual.classList.add("hidden"); }

function lvlTag(l){ const s=document.createElement("span"); s.className="lvl "+l; s.textContent=l.toUpperCase(); return s; }
function showChapterList(){
  MAN_CUR=null; els.manTitle.textContent="COACH'S MANUAL"; const body=els.manBody; body.innerHTML="";
  const groups=[]; MANUAL.forEach(c=>{ let g=groups.find(x=>x.name===c.group); if(!g){ g={name:c.group,ch:[]}; groups.push(g); } g.ch.push(c); });
  groups.forEach(g=>{
    const box=document.createElement("div"); box.className="man-group";
    const l=document.createElement("div"); l.className="section-label"; l.textContent=g.name; box.appendChild(l);
    g.ch.forEach(c=>{ const b=document.createElement("button"); b.className="ch-btn"; b.type="button";
      const t=document.createElement("b"); t.textContent=c.title; b.append(t,lvlTag(c.level)); b.addEventListener("click",()=>showChapter(c.id)); box.appendChild(b); });
    body.appendChild(box);
  });
  els.manual.scrollTop=0;
}
function showChapter(id){
  const i=MANUAL.findIndex(c=>c.id===id); if(i<0){ showChapterList(); return; }
  const c=MANUAL[i]; MAN_CUR=id; els.manTitle.textContent=c.title.toUpperCase();
  const body=els.manBody; body.innerHTML="";
  const wrap=document.createElement("div"); wrap.className="man-ch";
  const tag=document.createElement("div"); tag.appendChild(lvlTag(c.level)); wrap.appendChild(tag);
  const figs=[];
  c.blocks.forEach(bk=>{
    const [k,a,b,cap]=bk; let el;
    if(k==="p"){ el=document.createElement("p"); el.innerHTML=a; }
    else if(k==="h"){ el=document.createElement("h3"); el.textContent=a; }
    else if(k==="ul"){ el=document.createElement("ul"); a.forEach(t=>{ const li=document.createElement("li"); li.innerHTML=t; el.appendChild(li); }); }
    else if(k==="tip"||k==="pro"||k==="note"){ el=document.createElement("div"); el.className="man-"+k; el.innerHTML=(k==="pro"?"<b>PRO:</b> ":"")+a; }
    else if(k==="table"){ el=document.createElement("table"); el.className="man-table"; a.forEach(r=>{ const tr=document.createElement("tr"); r.forEach(cell=>{ const td=document.createElement("td"); td.innerHTML=cell; tr.appendChild(td); }); el.appendChild(tr); }); }
    else if(k==="fig"){ el=document.createElement("figure"); const cv=document.createElement("canvas"); el.appendChild(cv); if(cap){ const fc=document.createElement("figcaption"); fc.textContent=cap; el.appendChild(fc); } figs.push([cv,a,b]); }
    else if(k==="practice"){ el=document.createElement("button"); el.className="btn alt sm"; el.type="button"; el.textContent=a.label; el.addEventListener("click",()=>practiceFromManual(a)); }
    else if(k==="src"){ el=document.createElement("div"); el.className="man-src"; el.innerHTML="<b>Sources</b><br>"; a.forEach(s=>{ const link=document.createElement("a"); link.href=s[1]; link.target="_blank"; link.rel="noopener"; link.textContent=s[0]; el.appendChild(link); el.appendChild(document.createElement("br")); }); }
    if(el) wrap.appendChild(el);
  });
  const nav=document.createElement("div"); nav.className="man-nav";
  if(i>0){ const p=document.createElement("button"); p.className="btn alt"; p.type="button"; p.textContent="◀ "+MANUAL[i-1].title; p.addEventListener("click",()=>showChapter(MANUAL[i-1].id)); nav.appendChild(p); }
  if(i<MANUAL.length-1){ const n=document.createElement("button"); n.className="btn"; n.type="button"; n.textContent=MANUAL[i+1].title+" ▶"; n.addEventListener("click",()=>showChapter(MANUAL[i+1].id)); nav.appendChild(n); }
  wrap.appendChild(nav);
  body.appendChild(wrap);
  els.manual.scrollTop=0;
  requestAnimationFrame(()=>figs.forEach(([cv,type,arg])=>{ try{ (FIGS[type]||(()=>{}))(cv,type==="play"?arg.play:arg,type==="play"?arg:undefined); }catch(e){} }));
}
function practiceFromManual(o){
  closeManual();
  if(state.tut){ cancelAnimationFrame(rafId); clearInterval(studyTimer); tutRestore(); }
  if(state.phase && state.phase!=="idle" && !els.gameScreen.classList.contains("hidden")){ cancelAnimationFrame(rafId); clearInterval(studyTimer); clearOverlays(); }
  state.tut=null;
  state.book="standard"; state.squad=5; state.playPick=o.play||"random"; state.drillMode="quick_read";
  refreshSetupUI();
  startSession("quick_read",{coverage:o.coverage||null});
}

/* ============================================================
   TUTORIAL — guided lessons that run on the real game engine
============================================================ */

const TUT_KEY="qbbrain.tutorial.v1";
let TUT_DONE={}; 
function tutSave(){ try{ localStorage.setItem(TUT_KEY,JSON.stringify(TUT_DONE)); }catch(_){} }
const completed=r=>r==="GOOD READ"||r==="RISKY";
const LESSONS=[
  {id:"l1", title:"Your first throw", sub:"Meet your team, snap it, pull back and throw", reps:[
    {play:"Slant-Flat", coverage:"Cover 3", rush:"none", steps:[
      {say:"Welcome, QB! I'm your coach. Let's learn this together — one step at a time.", wait:"next"},
      {say:"This is <b>you</b>: the quarterback, <b>Q</b>. The <b>center (C)</b> snaps you the ball — and he can catch passes too.", hl:["Q","C"], wait:"next"},
      {say:"<b>X, Y and Z</b> are your receivers. The colored lines are the routes they'll run after the snap.", hl:["X","Y","Z"], wait:"next"},
      {say:"The <b>red players</b> are the defense. The <b>blue line</b> is the line of scrimmage. As QB you can never run past it — you have to throw.", hl:"def", wait:"next"},
      {say:"No rusher this time, so take your time. Tap <b>SNAP</b> to start the play.", wait:"snap"},
      {say:"Now <b>pull back anywhere on the field</b> — like a slingshot. The dotted arc shows where the ball will land. Pull further to throw further.", wait:"aim"},
      {say:"Aim the circle at an open receiver and <b>let go</b> to throw!", wait:"result"}
    ], pass:r=>completed(r.result),
    win:"That's it! Snap, find the open guy, throw. Everything else builds on this.",
    fail:"Close! Aim the landing circle a little in front of the receiver — he's moving. Try again."}
  ]},
  {id:"l2", title:"Lob or bullet", sub:"Two kinds of throws and when to use each", reps:[
    {play:"Slant-Flat", coverage:"Cover 2", rush:"none", steps:[
      {say:"Every throw starts as a <b>LOB</b> — it goes up and over defenders, but it's slower.", wait:"next"},
      {say:"A <b>BULLET</b> is low and fast. It beats defenders to the spot on short routes like this slant. Short and quick = bullet.", hl:["X","Z"], wait:"next"},
      {say:"Snap it.", wait:"snap"},
      {say:"Pull back to aim, and while you're still pulling <b>tap the screen with a second finger</b> — it switches to BULLET (gold dots). On a computer press <b>Space</b>.", wait:"toggle"},
      {say:"Bullet! Now throw it to the slant.", wait:"result"}
    ], pass:r=>completed(r.result) && r.type==="bullet",
    win:"Perfect. Bullets for short and crossing routes, lobs to get over a defender.",
    fail:"Let's do it again — make sure the dots turn gold (BULLET) before you let go."}
  ]},
  {id:"l3", title:"Beat the rusher", sub:"The rusher, the clock and the scramble stick", reps:[
    {play:"Spacing", coverage:"Cover 3", rush:"slow", steps:[
      {say:"Now the <b>rusher (R)</b> is coming. He starts 7 yards back and attacks you at the snap. The bar at the top shows how close he is.", hl:"rusher", wait:"next"},
      {say:"The <b>stick</b> in the corner moves you. Slide away from the rusher to buy time — but you still can't cross the blue line.", wait:"next"},
      {say:"Snap it, and use the stick to move.", wait:"snap"},
      {say:"Move with the stick…", wait:"scramble"},
      {say:"Good! Now get the ball out before he gets to you.", wait:"result"}
    ], pass:r=>r.result!=="SACKED" && r.result!=="INTERCEPTED",
    win:"You beat the rush. Remember: the pass clock might say 7 seconds, but the rusher gets there way sooner.",
    fail:"He got you. Move away from him with the stick and throw a little sooner."}
  ]},
  {id:"l4", title:"Man or zone?", sub:"The first thing to read before every snap", mode:"tutorial_id", reps:[
    {play:"Spacing", coverage:"Man", steps:[
      {say:"Before every snap, look at the defense. In <b>MAN</b> coverage each defender lines up on one receiver and follows him everywhere.", hl:"def", wait:"next"},
      {say:"See how each red defender is right across from a receiver? What coverage is this?", wait:"coverage"},
      {say:"Now snap it and watch: in man, defenders turn and run <b>with</b> their receiver.", wait:"snap"},
      {say:"Watch them follow…", wait:"result"}
    ], pass:r=>r.correct,
    win:"Man coverage: tight, eyes on their guy, they go where he goes.",
    fail:"That was MAN — every defender was matched up on one receiver. Let's look again."},
    {play:"Spacing", coverage:"Cover 3", steps:[
      {say:"Different look. In <b>ZONE</b> coverage defenders guard <b>areas</b> and watch the QB. Count the deep defenders — three back there.", hl:"def", wait:"next"},
      {say:"Three deep, one short. What is it?", wait:"coverage"},
      {say:"Snap and watch them drop to spots instead of chasing receivers.", wait:"snap"},
      {say:"See them sink into areas?", wait:"result"}
    ], pass:r=>r.correct,
    win:"Cover 3: three deep defenders split the field in thirds. The short areas are where you throw.",
    fail:"That was Cover 3 — three deep, everyone watching the QB. Try again."}
  ]},
  {id:"l5", title:"Count the safeties", sub:"One deep or two deep tells you where to throw", mode:"tutorial_id", reps:[
    {play:"Spacing", coverage:"Cover 2", steps:[
      {say:"Count the deep defenders (safeties). <b>Two deep</b> means the middle of the field is <b>open</b> — that's Cover 2.", hl:"def", wait:"next"},
      {say:"Two high. Name it.", wait:"coverage"},
      {say:"Snap it.", wait:"snap"},
      {say:"Each safety takes half the deep field.", wait:"result"}
    ], pass:r=>r.correct, win:"Cover 2. The holes: between the corner and safety, and the deep middle.", fail:"Two deep = Cover 2. Again!"},
    {play:"Spacing", coverage:"Cover 1", steps:[
      {say:"Now <b>one deep</b> safety in the middle, everyone else tight on a receiver — man underneath with help on top.", hl:"def", wait:"next"},
      {say:"One high plus man. Name it.", wait:"coverage"},
      {say:"Snap it.", wait:"snap"},
      {say:"The safety helps over the top; everyone else follows a receiver.", wait:"result"}
    ], pass:r=>r.correct, win:"Cover 1. Attack the sides and short throws; look the safety off before going deep.", fail:"One deep + man underneath = Cover 1. Again!"}
  ]},
  {id:"l6", title:"Your first progression", sub:"Read one defender: Smash vs Cover 2", reps:[
    {play:"Smash", coverage:"Cover 2", rush:"slow", prog:true, steps:[
      {say:"This is <b>Smash</b>. The numbers show your <b>read order</b> — look at #1 first, then #2.", wait:"next"},
      {say:"Against Cover 2, watch the <b>corner</b> on the outside. He can't cover the short hitch and the deep corner route at the same time.", hl:"def", wait:"next"},
      {say:"If he steps up on the hitch, throw the corner route <b>over</b> him (lob). If he sinks, hit the hitch (bullet). Snap it!", wait:"snap"},
      {say:"Watch the corner and throw where he isn't…", wait:"result"}
    ], pass:r=>r.result==="GOOD READ"||r.result==="RISKY",
    win:"That's a real QB read — you watched one defender and threw away from him.",
    fail:"Watch the corner, not the receivers. Throw to whichever route he doesn't take."}
  ]},
  {id:"l7", title:"Beat man with Mesh", sub:"Crossers that rub defenders", reps:[
    {play:"Mesh", coverage:"Man", rush:"normal", steps:[
      {say:"Against <b>man</b>, use crossing routes. In <b>Mesh</b>, two receivers cross close together so their defenders run into traffic.", hl:["Y","Z"], wait:"next"},
      {say:"Throw to whichever crosser comes out clean — quickly, with a bullet. Snap it!", wait:"snap"},
      {say:"Watch the crossers…", wait:"result"}
    ], pass:r=>completed(r.result),
    win:"Man beater! Quick throws and crossers make man coverage pay.",
    fail:"Get it out sooner — throw to the first crosser who's clear of his defender."}
  ]},
  {id:"l8", title:"Audibles & hot routes", sub:"Change the play at the line", reps:[
    {play:"Four Verticals", coverage:"Cover 3", rush:"slow", steps:[
      {say:"You called <b>Four Verticals</b>, but they're in <b>Cover 3</b> — three deep defenders waiting for deep balls. Not great.", hl:"def", wait:"next"},
      {say:"Tap <b>AUDIBLE</b>. You can check to another play, or tap one receiver and give him a new route (a hot route). Try changing something.", wait:"audible"},
      {say:"Nice change. Tap DONE, then SNAP and attack underneath.", wait:"snap"},
      {say:"Take the easy completion…", wait:"result"}
    ], pass:r=>completed(r.result),
    win:"That's what audibles are for — see the coverage, put the play in the right spot.",
    fail:"Against Cover 3 the short throws are open. Audible to a quick route and try again."}
  ]}
];

const TUT={i:0, rep:0, step:0, save:null, last:null, lessonMode:null};
function tutLesson(){ return LESSONS[TUT.i]; }
function tutRep(){ return tutLesson().reps[TUT.rep]; }
function tutStep(){ return tutRep().steps[TUT.step]; }
function startLesson(i){
  closeManual();
  TUT.i=i; TUT.rep=0; TUT.step=0; TUT.last=null;
  TUT.save={difficulty:state.difficulty, throwMode:state.throwMode, showProgression:state.showProgression, squad:state.squad, book:state.book, playPick:state.playPick};
  state.difficulty="rookie"; state.throwMode="pull"; state.squad=5; state.book="standard";
  state.tut=TUT;
  startSession(tutLesson().mode||"tutorial");
}
function tutRestore(){
  if(TUT.save){ Object.assign(state,TUT.save); TUT.save=null; }
  state.tut=null; refreshSetupUI();
}
function tutRepCfg(){
  const r=tutRep();
  return {play:STANDARD5.find(p=>p.name===r.play)||STANDARD5[0], coverage:r.coverage, ask:(tutLesson().mode==="tutorial_id")};
}
// applied to every tutorial rep right after it's built
function tutAdjustRep(rep){
  const r=tutRep();
  state.showProgression=!!r.prog;
  if(r.rush==="none"){ rep.rushDelay=999; rep.delayPlan=999; rep.rushPlan="straight"; }
  else if(r.rush==="slow"){ rep.rushPlan="straight"; rep.rushSpeed=3.4; rep.rushDelay=0.4; rep.rusher.x=GEO.CX; }
  else { rep.rushPlan="straight"; rep.rusher.x=GEO.CX; }
  rep.disguised=false; rep.shownCoverage=rep.actualCoverage;
}
function tutRender(){
  if(!state.tut) return;
  const st=tutStep(); if(!st) return;
  els.coachBubble.classList.remove("hidden","low");
  els.cbText.innerHTML=st.say;
  els.cbBtn.classList.toggle("hidden", st.wait!=="next");
  els.cbBtn.textContent="NEXT";
  els.studyBanner.classList.add("hidden"); els.playTag.classList.add("hidden");
  if(state.phase==="study"){
    const showSnap = st.wait==="snap" || st.wait==="audible";
    els.controls.classList.toggle("hidden", !(showSnap) || st.wait==="coverage" || AUD.open);
    els.primaryBtn.classList.toggle("hidden", st.wait!=="snap");
    audibleShow(st.wait==="audible" || (st.wait==="snap" && TUT.i===LESSONS.length-1));
    els.coverageSheet.classList.toggle("hidden", st.wait!=="coverage");
    tutDrawHighlight(st.hl);
  }
}
function tutDrawHighlight(hl){
  if(state.phase!=="study" || !state.rep) return;
  drawStatic(); if(!hl) return;
  const rep=state.rep, pulse=(s,col)=>{ ctx.beginPath(); ctx.arc(s.x,s.y,VIEW.PR*2,0,Math.PI*2); ctx.strokeStyle=col; ctx.lineWidth=3.5; ctx.stroke(); };
  if(Array.isArray(hl)) hl.forEach(id=>{ const p=playerById(rep,id); if(p&&p._px) pulse(p._px,"#ffc933"); });
  else if(hl==="def"){ rep.defenders.forEach(d=>pulse(toPx(d.pos.x,d.pos.y),"#ff6b5a")); const y=toPx(0,0).y; ctx.fillStyle="rgba(90,184,255,0.55)"; ctx.fillRect(0,y-4,cw,8); }
  else if(hl==="rusher"){ pulse(toPx(rep.rusher.x,rep.rusher.y),"#ffc933"); }
}
function tutAdvance(){
  TUT.step++;
  const st=tutStep();
  if(!st) return;
  tutRender();
}

// events from the game engine
function tutEvent(name,data){
  if(!state.tut) return;
  if(name==="ready"){
    TUT.step=0;
    if(TUT.retry){ const k=tutRep().steps.findIndex(x=>x.wait!=="next"); TUT.step=Math.max(0,k); TUT.retry=false; }
    tutRender(); return; }
  const st=tutStep(); if(!st) return;
  if(name==="result"){ tutOnResult(data); return; }
  if(st.wait===name){ tutAdvance(); }
  else if(name==="snap" && st.wait!=="snap"){ // snapped early: jump to the first step after the snap
    const k=tutRep().steps.findIndex(s=>s.wait==="snap"); if(k>=0 && k>=TUT.step){ TUT.step=k+1; tutRender(); }
  }
  else if(name==="coverage" && st.wait!=="coverage"){ const k=tutRep().steps.findIndex(s=>s.wait==="coverage"); if(k>=0){ TUT.step=k+1; tutRender(); } }
  else if((name==="hot"||name==="audible") && st.wait==="audible"){ tutAdvance(); }
}
function tutOnResult(data){
  const r=tutRep(), ok=r.pass(data);
  TUT.last={ok};
  els.coachBubble.classList.remove("hidden","low");
  els.cbText.innerHTML=(ok?"<b>✓ </b>":"")+(ok?r.win:r.fail);
  els.cbBtn.classList.remove("hidden");
  const lastRep = TUT.rep>=tutLesson().reps.length-1;
  els.cbBtn.textContent = ok ? (lastRep ? "LESSON COMPLETE ▶" : "NEXT ▶") : "TRY AGAIN";
  els.nextRepBtn.textContent = els.cbBtn.textContent;
}
function tutAfterResult(){
  if(!state.tut) return;
  const ok=TUT.last && TUT.last.ok;
  els.coachBubble.classList.add("hidden");
  if(!ok){ TUT.retry=true; startRep(); return; }
  if(TUT.rep < tutLesson().reps.length-1){ TUT.rep++; TUT.step=0; startRep(); return; }
  // lesson complete
  TUT_DONE[tutLesson().id]=true; tutSave();
  tutExit(true);
}
function tutExit(finished){
  cancelAnimationFrame(rafId); clearInterval(studyTimer); clearOverlays();
  els.coachBubble.classList.add("hidden");
  const wasLast = TUT.i>=LESSONS.length-1;
  tutRestore();
  showScreen("learnScreen");
  if(finished && !wasLast) highlightNextLesson();
}
function highlightNextLesson(){ renderLessons(); }
function renderLessons(){
  const list=els.lessonList; list.innerHTML="";
  const firstOpen=LESSONS.findIndex(l=>!TUT_DONE[l.id]);
  LESSONS.forEach((l,i)=>{
    const b=document.createElement("button"); b.type="button"; b.className="lesson"+(TUT_DONE[l.id]?" done":"")+(i===firstOpen?" next":"");
    const n=document.createElement("span"); n.className="n"; n.textContent=TUT_DONE[l.id]?"✓":String(i+1);
    const d=document.createElement("div"); const t=document.createElement("b"); t.textContent=l.title; const s=document.createElement("small"); s.textContent=l.sub; d.append(t,s);
    b.append(n,d); b.addEventListener("click",()=>startLesson(i)); list.appendChild(b);
  });
  const done=LESSONS.filter(l=>TUT_DONE[l.id]).length;
  els.tutProgress.textContent=" · "+done+"/"+LESSONS.length;
  els.learnSummary.textContent = done ? "Tutorial "+done+"/"+LESSONS.length+" · Coach's Manual" : "Tutorial · Coach's Manual";
}

// first-launch nudge

/* ---------------- coach talk setting ---------------- */
function renderCoachRow(){
  buildChoiceRow(els.coachRow,[
    {key:"auto",title:"Auto",sub:"Simple on Rookie"},
    {key:"simple",title:"Simple",sub:"Quick verdict + tip"},
    {key:"full",title:"Full",sub:"The whole breakdown"}
  ], state.coachTalk||"auto", k=>{ state.coachTalk=k; });
}

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  SCREENS.push("learnScreen");
  ["learnScreen","manual","manBack","manTitle","manClose","manBody","manualOpenBtn","lessonList","tutProgress","tutResetBtn",
   "coachBubble","cbText","cbBtn","newbieCard","newbieX","learnSummary","coachRow"].forEach(id=>{ els[id]=document.getElementById(id); });
  FIGS = {coverage:figCoverage, play:figPlay, routes:figRoutes, highlow:figHighLow, horizontal:figHorizontal, leverage:figLeverage, lobbullet:figLobBullet, rush:figRush, field:figField};
  MANUAL = [
    {id:"start",title:"Start here",level:"rookie",group:"START HERE",blocks:[
      ["p","Welcome to QB Brain. This manual teaches you how a flag football quarterback thinks: how to recognize the defense, where the ball should go, and why. Chapters are tagged <b>ROOKIE</b> (start here), <b>ALL</b> (everyone) and <b>PRO</b> (advanced)."],
      ["tip","<b>The whole job in one sentence:</b> know where the ball is going before the snap, check the defense, and get it out on time to the receiver the defense can't cover."],
      ["ul",["New to flag? Read <b>How flag works</b>, <b>Your team and the defense</b>, then play the <b>Tutorial</b>.","Know the basics? Jump to <b>Man vs zone</b> and <b>Progressions</b>.","Already a QB? The <b>Concepts</b> chapters list the key defender and the if/then read for each play."]]
    ]},
    {id:"basics",title:"How flag football works",level:"rookie",group:"START HERE",blocks:[
      ["fig","field",null,"An NFL FLAG field. QB Brain lets you set the length (50–100 yds) and width (20–53)."],
      ["p","Flag football is non-contact: instead of tackling, the defense pulls a flag off the ball carrier's belt. There's no blocking. The offense gets downs to cross midfield and then downs to score."],
      ["h","Rules that matter to a QB"],
      ["ul",[
        "<b>Rushers start 7 yards back.</b> In NFL FLAG, up to two players may rush and must line up 7 yards off the line of scrimmage. In QB Brain there is always one rusher.",
        "<b>The QB can't run the ball past the line.</b> NFL FLAG: the QB \"cannot directly run with the ball across the line of scrimmage.\" He can only become a runner after a handoff, pitch or lateral.",
        "<b>Everyone is eligible</b>, including the center who snaps the ball.",
        "<b>Pass clock:</b> NFL FLAG gives the QB 7 seconds to throw. The rusher usually gets there much sooner.",
        "<b>Pitches and handoffs</b> are only legal behind the line in NFL FLAG.",
        "<b>Sack:</b> the QB's flag pulled behind the line. A safety (QB sacked in his own end zone) is 2 points for the defense."
      ]],
      ["note","Leagues differ. Some allow no rush at all with a 4–5 second clock (common in 7v7), some ban laterals entirely, some make the center ineligible. QB Brain uses: one rusher from 7 yards, QB never crosses the line, center eligible."],
      ["src",[SRC.rules,SRC.howto]]
    ]},
    {id:"team",title:"Your team and the defense",level:"rookie",group:"START HERE",blocks:[
      ["fig","coverage","Cover 2","Your offense (circles) vs a defense (triangles)."],
      ["ul",[
        "<b>Q — quarterback.</b> Takes the snap, reads the defense, throws.",
        "<b>C — center.</b> Snaps the ball, then runs a route. Often your safest checkdown in the middle.",
        "<b>X, Y, Z (and H, F in 7v7) — receivers.</b> X and Z usually line up outside, Y/H inside (the slot).",
        "<b>Rusher (R).</b> Starts 7 yards off the ball and attacks the QB at the snap. The bar at the top of the screen shows how close he is.",
        "<b>Defenders.</b> Either guard one receiver each (<b>man</b>) or guard an area (<b>zone</b>). Deep defenders are often called safeties."
      ]],
      ["tip","Before every snap ask two questions: <b>Who is rushing?</b> and <b>How many defenders are deep?</b>"]
    ]},
    {id:"controls",title:"How to play QB Brain",level:"rookie",group:"START HERE",blocks:[
      ["ul",[
        "<b>Snap:</b> tap SNAP. Before that, study the defense — the countdown is just a guide.",
        "<b>Throw (pullback meter):</b> pull back anywhere on the field like a slingshot; the dotted arc shows where it lands. It starts as a <b>lob</b>. Tap a second finger while pulling for a <b>bullet</b> (Space or right-click on a computer).",
        "<b>Throw (tap mode):</b> tap a receiver for a bullet, hold him for a lob. Pick the mode in Settings.",
        "<b>Scramble:</b> use the stick in the corner (WASD/arrows on a computer). You can't cross the blue line.",
        "<b>Audible:</b> before the snap tap AUDIBLE to check to another play or hot-route one receiver.",
        "<b>Full Drive:</b> call your play before every down, move the chains, score.",
        "<b>After each play</b> your coach explains what happened — including your <b>key defender</b> read. Tap <b>COACH VIEW</b> to freeze the moment you threw and see who was open.",
        "<b>Film Room</b> (in Drills): call man/zone, the coverage, your key defender and your first read before the snap — then see whether the defense rotated.",
        "<b>QB Profile</b> tracks your tendencies across sessions and recommends drills."
      ]],
      ["h","Modes"],
      ["ul",["<b>QB Brain:</b> sometimes asks you to call the coverage, then you make the throw.","<b>Coverage ID:</b> name the coverage only — great for learning tells.","<b>Quick Read:</b> no questions, just find the throw fast.","<b>Film Room:</b> pre-snap quiz, live rep, then the PRE-SNAP → POST-SNAP reveal.","<b>Full Drive:</b> real downs and distance."]]
    ]},
    {id:"throw-types",title:"Lob vs bullet",level:"rookie",group:"THROWING",blocks:[
      ["fig","lobbullet",null,"A bullet stays low, so a defender in the lane can tip it. A lob goes over him but hangs in the air longer."],
      ["ul",[
        "<b>Bullet (line drive):</b> short and crossing routes — slants, drags, hitches, outs. Gets there before the defense can react.",
        "<b>Lob (touch):</b> when you need to get it <i>over</i> an underneath defender and in front of a deep one — corners, wheels, go routes, seams against a trailing defender.",
        "<b>Lead the receiver</b> to where he's going, on the side away from the nearest defender."
      ]],
      ["tip","Rule of thumb: <b>over the short defender = lob; in front of the deep defender = bullet.</b>"],
      ["note","Coaching sources agree on ball placement (\"put the ball where the receiver can make the catch, away from the defender\"). The exact lob-vs-bullet rule above is our coaching rule of thumb, not an official rule."],
      ["src",[["Scouting Academy — Ball placement","https://scoutingacademy.com/glossary-entry-ball-placement/"]]]
    ]},
    {id:"read-clock",title:"Beating the rush",level:"all",group:"THROWING",blocks:[
      ["fig","rush",null,"How long the QB Brain rusher takes to get home on each difficulty (straight rush)."],
      ["p","The pass clock may say 7 seconds, but a rusher coming from 7 yards gets to you much faster. USA Football's pass-rush drill counts from 7 and suggests cutting it to 3–4 seconds to raise the urgency."],
      ["ul",[
        "<b>Know your answer before the snap</b> — which side, which receiver is 1st.",
        "<b>Throw on time:</b> the ball should come out as your receiver makes his break, not after he looks wide open.",
        "<b>Scramble away from the rusher</b>, not into him. Rushers aim at the QB's throwing shoulder.",
        "<b>No intentional grounding in NFL FLAG</b> — throwing it away beats taking a sack."
      ]],
      ["pro","Elite rushers get home in about 1.2–1.5 seconds. That's one read. Pick the matchup pre-snap and throw it as the receiver breaks."],
      ["src",[SRC.boxone,SRC.rules,["PlaybookTech — Your QB needs help","https://firstdown.playbooktech.com/coaches-community/your-flag-football-quarterback-needs-help"]]]
    ]},
    {id:"routes",title:"The route tree",level:"rookie",group:"ROUTES",blocks:[
      ["fig","routes",null,"The basic routes from one receiver (X on the left). \"Inside\" means toward the ball."],
      ["table",[
        ["<b>Route</b>","<b>Flag depth · coaching point</b>"],
        ["Flat","0–2 yds to the sideline. Quick outlet; stretches the flat defender."],
        ["Slant","Break at 3–5 yds, about 45° inside. Best vs man; needs room to cross the defender's face."],
        ["Hitch","5–7 yds, stop and turn back to the QB. Throw as he turns."],
        ["Curl","5–12 yds, turn back inside. Sit in a zone hole; keep moving vs man."],
        ["Out","About 5 yds, 90° cut to the sideline. Line up inside so there's room."],
        ["In / Dig","3–10 yds, 90° cut to the middle."],
        ["Drag","2–4 yds across the field. Keep running vs man, settle vs zone."],
        ["Corner","5–10 yd stem, then 45° to the sideline. Usually a lob."],
        ["Post","5–10 yd stem, then 45° to the middle. Beats man deep."],
        ["Go","Straight downfield, 2–3 yds of room from the sideline."],
        ["Seam","Vertical up the middle. Vs two deep safeties, bend it into the open middle."],
        ["Wheel","Starts like a flat, turns upfield. Great vs man, especially off a rub."],
        ["Stick / Snag","Short option routes (~5 yds): sit vs zone, break away vs man."]
      ]],
      ["tip","In the Create a Play editor every route depth is adjustable. Shorten routes to your QB's arm and your clock."],
      ["src",[SRC.usafRoutes,SRC.plays,["National Football Post — Route tree","https://www.nationalfootballpost.com/inside-the-playbook-the-nfl-route-tree"]]]
    ]},
    {id:"cov-overview",title:"Man vs zone",level:"rookie",group:"COVERAGES",blocks:[
      ["p","Every coverage is built from two ideas. In <b>man</b>, each defender guards one receiver wherever he goes. In <b>zone</b>, each defender guards an area and covers whoever comes into it."],
      ["table",[["<b>Look for</b>","<b>Man</b>","<b>Zone</b>"],["Alignment","Tight on receivers","Spread out, some deep"],["Eyes","On their receiver","On the QB"],["After the snap","Turn and run with him (hips)","Drop to a spot, keep you in front"],["Beat it with","Quick throws, crossers, rubs","Throws to open grass between defenders"]]],
      ["tip","Simple post-snap test: watch one defender over a slot receiver. If he runs with him, it's man. If he sinks to a spot, it's zone."],
      ["pro","Count the deep defenders pre-snap: <b>one deep</b> = middle of the field closed (Cover 1 or Cover 3). <b>Two deep</b> = middle open (Cover 2). <b>None deep</b> = man or an underneath zone."],
      ["src",[SRC.manzone,SRC.readcov,SRC.mojo]]
    ]},
    covChapter("cov-man","Man (Cover 0)","Man","rookie",[
      ["p","Each defender pairs up with one receiver. In 5v5 that's four defenders in man plus the rusher, and nobody deep to help."],
      ["ul",["<b>Tell:</b> defenders tight on receivers, eyes on their man; when a receiver moves, his defender goes with him.","<b>Weakness:</b> no help. Quick throws, crossers that rub defenders (Mesh), slants and double moves.","<b>Where to throw:</b> to the receiver who wins his route — the moment he breaks away."]],
      ["tip","Man defenders turn their back to you. A ball thrown on time, away from the defender, is hard to stop."]],[SRC.def5,SRC.beaters,SRC.iflagdef]),
    covChapter("cov-1","Cover 1","Cover 1","all",[
      ["p","Man coverage underneath, plus one free safety deep in the middle about 10 yards off."],
      ["ul",["<b>Tell:</b> one deep defender in the middle (middle of the field <b>closed</b>), the rest tight on receivers.","<b>Weakness:</b> the sides and quick throws. Off-man defenders have trouble driving on short routes.","<b>Watch out:</b> the safety reads your shoulders — look him off before throwing deep."]],
      ["tip","Slant-flat and out routes beat Cover 1. Deep post? Only after you move the safety with your eyes."]],[SRC.def5,SRC.beaters,SRC.youngqb]),
    covChapter("cov-2","Cover 2","Cover 2","all",[
      ["p","Two safeties split the deep field in halves about 10 yards off; the corners play short."],
      ["ul",["<b>Tell:</b> two deep defenders, middle of the field <b>open</b>.","<b>Weakness:</b> the hole between the corner and the safety on each side, the deep middle seam, and short throws toward the middle.","<b>Beat it with:</b> Smash (hitch + corner), post-corner, seams between the safeties."]],
      ["tip","Read the corner on Smash: if he comes up on the hitch, throw the corner route over him."]],[SRC.def5,SRC.beaters,SRC.smash]),
    covChapter("cov-3","Cover 3","Cover 3","all",[
      ["p","Three defenders deep in thirds. In NFL FLAG's 5v5 guide, Cover 3 uses <b>no rusher</b>: three deep and two short. QB Brain's version keeps a rusher, so only one defender covers the short middle."],
      ["fig","coverage","Cover 3 (no rush)","NFL FLAG's 5v5 Cover 3: three deep, two short, nobody rushing."],
      ["ul",["<b>Tell:</b> three deep players who keep everything in front of them.","<b>Weakness:</b> underneath — flats, hitches, outs, ins in front of the deep defenders.","<b>Beat it with:</b> Flood, Curl-Flat, Slant-Flat, Stick."]],
      ["tip","Against Cover 3, take the easy completion underneath and let your receiver run."]],[SRC.def5,SRC.beaters,SRC.flood]),
    covChapter("cov-under","Underneath zone","Underneath Zone","all",[
      ["p","Every defender sits in a short-to-medium zone with eyes on the QB and no real deep help."],
      ["ul",["<b>Tell:</b> defenders at short depth, staring at the QB.","<b>Weakness:</b> deep. Seams, posts and corners behind the short defenders.","<b>Watch out:</b> short throws into a zone defender's eyes get picked. Throw to grass."]],
      ["tip","Find the window between two zone defenders — or over the top."]],[SRC.mojo,SRC.iflagdef]),
    {id:"cov-more",title:"Other flag defenses",level:"pro",group:"COVERAGES",blocks:[
      ["p","These show up in real flag games. QB Brain's defense doesn't run them yet, but you should know them."],
      ["fig","coverage","Cover 4","Cover 4 (quarters): four deep defenders and a rusher."],
      ["p","<b>Cover 4 / four across:</b> four defenders about 10 yards deep plus a rusher. Coaches use it near the goal line. Weakness: lots of open space short — take the underneath throws, and use floods with several levels."],
      ["fig","coverage","2-2 Box","The 2-2 box: two short, two deep."],
      ["p","<b>2-2 box:</b> two short and two deep. Weak in the middle and against quick reads. Defenses often line up all five across and spin to it at the snap to disguise it."],
      ["fig","coverage","3-1","The 3-1: three short, one deep."],
      ["p","<b>3-1:</b> outside defenders 3–5 yards off check quick routes and drags, then bail deep; one safety rotates with the play. Good against bunch, weaker against spread formations."],
      ["src",[SRC.def5,SRC.iflagdef,["PlaybookTech — 5v5 defense changeup","https://firstdown.playbooktech.com/coaches-community/5v5-flag-football-defense-changeup"]]]
    ]},
    {id:"cov-7v7",title:"7v7: layered coverages",level:"pro",group:"COVERAGES",blocks:[
      ["p","7v7 is a different processing job than 5v5. Most 7v7 formats have <b>no rusher and a 4-second clock</b>, so all seven defenders cover — two safeties, robbers, brackets and late rotations. You have more time, but the windows are smaller and the picture changes after the snap."],
      ["note","QB Brain 7v7 defaults to the no-rush 4-second clock with seven in coverage. You can switch to one rusher in Settings → 7v7 Pass Rush."],
      ["fig","coverage","7:Robber","Cover 1 Robber: one deep safety, a robber in the middle hole, man outside."],
      ["p","<b>Robber:</b> the robber sits at 6–8 yds in the middle and reads your eyes to jump digs and crossers. Attack outside, or look at the middle to pull him and throw behind him."],
      ["fig","coverage","7:Bracket","Bracket: two defenders on the biggest threat."],
      ["p","<b>Bracket:</b> your best receiver gets a defender underneath and one over the top. That means someone else is one-on-one or free — find him."],
      ["fig","coverage","7:2-Man","2-Man: two deep halves, man underneath."],
      ["p","<b>2-Man:</b> looks like Cover 2 before the snap, but the underneath players turn and run with receivers. Crossers and rubs are the answer; the safeties are too deep to help short."],
      ["fig","coverage","7:Cover 4","Cover 4 (quarters) with seven: four deep, three short."],
      ["p","<b>Cover 4:</b> four deep defenders take away everything vertical. Be patient: hit the hitches, outs and checkdowns underneath."],
      ["tip","5v5 rewards quick decisions and your center as the hot read. 7v7 rewards patience: confirm the shell after the snap, find the key, then throw on time before the clock."],
      ["src",[["Under Armour — What is 7-on-7 football","https://www.underarmour.com/en-us/t/playbooks/football/what-is-7-on-7-football-format"],SRC.beaters]]
    ]},
    {id:"read-presnap",title:"Pre-snap: count the safeties",level:"all",group:"READING THE DEFENSE",blocks:[
      ["p","Before the snap, the most useful thing you can do is <b>count how many defenders are deep</b>. That tells you whether the middle of the field is open or closed."],
      ["fig","coverage","Cover 2","Two deep = middle OPEN. Attack the seam between them and the sidelines underneath."],
      ["fig","coverage","Cover 1","One deep = middle CLOSED. Attack the flats, the outside and quick routes."],
      ["ul",["<b>Two high:</b> Cover 2 (or quarters). Throw the hole behind the corner, the deep middle, short middle.","<b>One high:</b> Cover 1 or Cover 3. Throw outside and underneath; look the safety off before going deep.","<b>None high:</b> man or an underneath zone. Quick throws vs man, over the top vs zone.","<b>Look at cushion and eyes:</b> tight and staring at receivers = man; deep cushion and eyes on you = zone.","<b>No rusher in 5v5?</b> Usually means an extra player in coverage (often Cover 3)."]],
      ["pro","Disguises: on Varsity and Elite the defense can show one look and rotate at the snap. Make your pre-snap guess, then check the safeties again right after the snap."],
      ["src",[SRC.readcov,SRC.youngqb,["Dummies — How a QB reads the defense","https://www.dummies.com/article/home-auto-hobbies/sports-recreation/fantasy-sports/fantasy-football/how-a-quarterback-reads-the-defense-in-a-football-game-186814/"]]]
    ]},
    {id:"read-key",title:"Read one defender",level:"all",group:"READING THE DEFENSE",blocks:[
      ["p","You can't watch everyone. Good concepts put <b>one defender</b> in a bind — two receivers he can't both cover. Watch him and throw where he isn't."],
      ["h","High-low (vertical stretch)"],
      ["fig","highlow",null,"Curl-flat: the flat defender can't cover the curl (high) and the flat (low) at once."],
      ["h","Horizontal stretch"],
      ["fig","horizontal",null,"Two receivers at the same depth on either side of one zone defender."],
      ["tip","Coaches put it simply: \"If you try to see it all, you're going to get lost.\" Key one defender."],
      ["src",[SRC.curlflat,SRC.slantflat,SRC.qbreads]]
    ]},
    {id:"read-leverage",title:"Leverage: throw away from it",level:"all",group:"READING THE DEFENSE",blocks:[
      ["fig","leverage",null,"If the defender is inside, the outside-breaking route is open, and the other way around."],
      ["p","<b>Leverage</b> is which side of the receiver the defender lines up on. A defender shading inside is protecting the slant and the middle; he's giving up the out. A defender shading outside gives up the slant."],
      ["tip","<b>Throw away from leverage.</b> Put the ball on the receiver's shoulder that's away from the defender."],
      ["src",[SRC.leverage,SRC.manzone]]
    ]},
    {id:"read-progression",title:"Progressions: 1-2-3",level:"rookie",group:"READING THE DEFENSE",blocks:[
      ["fig","play",{play:STANDARD5.find(p=>p.name==="Smash"),prog:true},"Smash: 1st read (green), 2nd (blue), 3rd (red)."],
      ["p","A <b>progression</b> is the order you look at your receivers. If #1 is covered, move your eyes (and feet) to #2, then #3, then your checkdown. You set the read order for your own plays in the editor."],
      ["ul",["<b>Beginners:</b> read half the field. Coaches often use colors — green = 1st, blue = 2nd, red = 3rd — and simple if/then rules.","<b>Full-field read:</b> after the front side is covered, swing to the backside. Takes more time than an Elite rusher gives you.","<b>Your checkdown</b> (often the center) shows up late — he's your answer when everything else is covered."]],
      ["table",[["<b>Read</b>","<b>When (rule of thumb)</b>"],["1st","As the receiver breaks — about 1.5–2 s"],["2nd","About 2.5–3 s"],["Checkdown / throw away","Before the rusher arrives"]]],
      ["note","The timing table is our coaching rule of thumb based on how fast QB Brain's rusher arrives; real games vary."],
      ["pro","Read the <b>key defender</b>, not the receivers. On Smash you watch the corner: he decides between the hitch and the corner route for you."],
      ["src",[SRC.prog,SRC.reads,SRC.qbreads]]
    ]},
    {id:"read-disguise",title:"Disguises & rotations",level:"pro",group:"READING THE DEFENSE",blocks:[
      ["p","Good defenses show you one thing before the snap and play another. That's why the pre-snap read is a <b>guess</b> and the post-snap read is the <b>answer</b>. The Film Room trains exactly this."],
      ["table",[["<b>Disguise</b>","<b>What you see → what it becomes</b>","<b>The clue</b>"],
        ["Rotation","Two-high (Cover 2) → one-high (Cover 3 or Cover 1), or the reverse","A safety rotates down or a corner bails deep right at the snap"],
        ["Bluff man → zone","Defenders tight on receivers → they drop to spots","They turn their eyes to the QB instead of running with the receiver"],
        ["Bluff zone → man","Soft, spread-out look → everyone matches a receiver","A 'zone' defender turns his hips and runs with a route"]]],
      ["tip","Pre-snap: make your best guess and pick your key. At the snap: look at the safeties again. Did the shell change? Then let your key defender tell you where to go."],
      ["pro","Your key defender doesn't care about the disguise. Whatever the coverage turns into, he still has to pick one of your two receivers."],
      ["src",[SRC.readcov,SRC.youngqb,["PlaybookTech — 5v5 defense changeup","https://firstdown.playbooktech.com/coaches-community/5v5-flag-football-defense-changeup"]]]
    ]},
    {id:"read-keydef",title:"Key defender reads",level:"all",group:"READING THE DEFENSE",blocks:[
      ["fig","play",{play:STANDARD5.find(p=>p.name==="Smash"),prog:true,key:[5,4]},"Smash: the corner (KEY) can't take both the hitch and the corner route."],
      ["p","Most good pass concepts put <b>one defender</b> in a bind. Find him before the snap, watch him after it, and throw to the receiver he didn't take."],
      ["table",[["<b>Concept</b>","<b>Key</b>","<b>If he… → throw</b>"],
        ["Smash","Corner","sinks → hitch · squats → corner route"],
        ["Slant-Flat","Flat defender","widens → slant · squeezes → flat"],
        ["Curl-Flat","Flat defender","jumps the flat → curl · sinks → flat"],
        ["Stick","Flat/hook defender","widens → stick · sits on stick → flat"],
        ["Flood","Flat defender","widens → out · sinks → flat"],
        ["Drive / Levels","Middle (hook) defender","sits shallow → dig · drops → shallow"],
        ["Four Verticals","Deep safety","leans one way → throw the other seam"]]],
      ["tip","QB Brain grades this after every play: who the key was, what he did and when, the correct read, and whether your ball came out on time."],
      ["src",[SRC.slantflat,SRC.curlflat,SRC.smash,SRC.stick,SRC.flood,SRC.verts]]
    ]},
    conChapter("con-slantflat","Slant-Flat","Horizontal + inside/outside","Cover 3 and Cover 1",
      "Key the flat defender. He widens → throw the slant. He squeezes the slant → throw the flat.",
      [["p","A classic quick-game concept. The slant and the flat go opposite ways around the same defender. USA Football teaches the same read against Cover 3 and Cover 1."]],[SRC.slantflat,SRC.curlflat],[7,4]),
    conChapter("con-smash","Smash","High-low on the corner","Cover 2",
      "Key the corner. He steps up on the hitch → throw the corner route over him. He sinks → hit the hitch.",
      [["p","The outside receiver runs a hitch at about 5 yards; the inside receiver runs a corner behind it. The Cover 2 corner can't cover both."]],[SRC.smash,SRC.beaters],[5,4]),
    conChapter("con-stick","Stick","Horizontal","Zone and man",
      "Key the flat defender. He widens with the flat → throw the stick. He sits on the stick → throw the flat.",
      [["p","Stick (5–6 yards, sit vs zone, break away vs man) plus a flat and a go to clear deep."]],[SRC.stick],[21,4]),
    conChapter("con-snag","Snag","High-low + horizontal (triangle)","Man and Cover 3",
      "Flat → snag → corner. Stay on that side; whichever one the defender doesn't take is open.",
      [["p","Three routes on one side make a triangle around the defenders: something short, something at 5 yards, something deep."]],[SRC.plays,SRC.prog]),
    conChapter("con-flood","Flood","Three levels on one side","Cover 3",
      "Peek the deep route, then key the flat defender: he widens → throw the out; he sinks → throw the flat.",
      [["p","A go/post up top, an out in the middle and a flat underneath — three levels against two defenders on that side."]],[SRC.flood,SRC.beaters],[22,4]),
    conChapter("con-levels","Levels","High-low inside","Zone (and man in flag)",
      "Two in-breaking routes stacked: if the hook defender drops under the deep one, hit the short one, and the reverse.",
      [["p","Coaches stress that the deep in-route must get every inch of its depth so the levels stay separated."]],[["PlaybookTech — 7v7 NFL concepts","https://firstdown.playbooktech.com/coaches-community/?p=37186"]]),
    conChapter("con-mesh","Mesh","Horizontal + rub","Man",
      "The two crossers rub each other's defenders. Throw to the one who comes out clean. Vs zone, sit him in the hole.",
      [["p","Two shallow crossers pass close to each other (legal in flag as long as nobody blocks). Man defenders have to fight through traffic."],["tip","Easy read for young QBs: whoever is open first coming across your face."]],[SRC.mesh]),
    conChapter("con-drive","Drive","Horizontal (shallow + dig)","Man and Cover 4",
      "Key the middle defender: he sits shallow → throw the dig; he drops → throw the shallow.",
      [["p","A shallow cross and a deeper dig go the same direction, putting the middle defender in a high-low bind."]],[["PlaybookTech — 7v7 NFL concepts","https://firstdown.playbooktech.com/coaches-community/?p=37186"]]),
    conChapter("con-verts","Four Verticals","Vertical","One-high and two-high looks",
      "Key the deep safety: throw the seam away from him. Against two high, the inside receiver bends into the open middle.",
      [["p","Four receivers go deep at once — more vertical threats than deep defenders."],["tip","Throw it with some air, leading him away from the safety. If everyone is covered, check it down."]],[SRC.verts]),
    conChapter("con-spacing","Spacing","Horizontal","Zone",
      "Receivers settle at the same depth across the field. Find the window between two zone defenders.",
      [["note","Spacing is a common concept, but we didn't find a strong flag-specific source for it. This read is our coaching summary."]],[SRC.plays]),
    {id:"pro-mistakes",title:"Common QB mistakes",level:"all",group:"PRO",blocks:[
      ["ul",[
        "<b>Trying to read everything.</b> Key one defender.",
        "<b>Holding the ball.</b> The clock is 7 seconds; the rusher is 2 or less on Elite.",
        "<b>Staring down your receiver.</b> Deep defenders read your shoulders — look them off.",
        "<b>Throwing late over the middle vs zone.</b> The window closes as the hook defender drifts.",
        "<b>Lobbing into tight coverage.</b> Lobs hang; drive it in or move on.",
        "<b>Ignoring down and distance.</b> 3rd & 2 and 3rd & 15 are different throws.",
        "<b>Running too many plays badly.</b> Master a few core concepts first."
      ]],
      ["h","Coaching cues"],
      ["ul",["\"Key one defender.\"","\"Middle open or closed?\"","\"Throw away from leverage.\"","\"Know where the ball is going before the snap.\""]],
      ["h","Drills you can do in QB Brain"],
      ["ul",["<b>Coverage ID on Elite</b> — tells and disguises.","<b>Quick Read on Elite</b> — like USA Football's box-and-one drill with the count cut to 3–4 seconds.","<b>Run one concept 10 times</b> from the manual's PRACTICE buttons against the coverage it beats — then against one it doesn't."]],
      ["src",[SRC.iflagqb,["iFlag — 5 tips for beginner QBs","https://iflag.org/5-flag-football-tips-for-beginner-quarterbacks/"],SRC.boxone]]
    ]},
    {id:"glossary",title:"Glossary",level:"rookie",group:"PRO",blocks:[
      ["table",[
        ["<b>LOS</b>","Line of scrimmage — where the ball is snapped (blue line)."],
        ["<b>Rusher</b>","The defender who attacks the QB, starting 7 yds back."],
        ["<b>Man</b>","Each defender guards one receiver."],
        ["<b>Zone</b>","Each defender guards an area."],
        ["<b>Safety</b>","A deep defender."],
        ["<b>MOFO / MOFC</b>","Middle of the field open (two deep) / closed (one deep)."],
        ["<b>Leverage</b>","Which side of the receiver the defender is on."],
        ["<b>Progression</b>","The order you read your receivers."],
        ["<b>Key defender</b>","The one defender you watch to decide where to throw."],
        ["<b>High-low</b>","Two receivers at different depths on one defender."],
        ["<b>Checkdown</b>","Your last, safest short option."],
        ["<b>Hot route</b>","Changing one receiver's route at the line."],
        ["<b>Audible</b>","Changing the whole play at the line."],
        ["<b>Rub</b>","Receivers crossing close so defenders run into traffic (no blocking allowed)."],
        ["<b>Disguise</b>","Showing one coverage and playing another after the snap."]
      ]]
    ]},
    {id:"sources",title:"Sources",level:"pro",group:"PRO",blocks:[
      ["p","This manual is built from official rules and established flag and football coaching sources. Where we filled a gap with our own coaching judgment, the chapter says so."],
      ["src",Object.keys(SRC).map(k=>SRC[k])]
    ]}
  ];
  els.manClose.addEventListener("click",closeManual);
  els.manBack.addEventListener("click",()=>{ if(MAN_CUR) showChapterList(); else closeManual(); });
  els.manualOpenBtn.addEventListener("click",()=>openManual(null));
  MODES.tutorial={label:"Tutorial", askCoverageChance:0, throws:true};
  MODES.tutorial_id={label:"Tutorial", askCoverageChance:1, throws:false};
  try{ TUT_DONE=JSON.parse(localStorage.getItem(TUT_KEY)||"{}")||{}; }catch(_){ TUT_DONE={}; }
  els.cbBtn.addEventListener("click",(e)=>{
    e.stopPropagation();
    if(!state.tut) return;
    const st=tutStep();
    if(st && st.wait==="next"){ tutAdvance(); return; }
    tutAfterResult();
  });
  els.tutResetBtn.addEventListener("click",()=>{ TUT_DONE={}; tutSave(); renderLessons(); });
  (function(){
    let dismissed=false; try{ dismissed=localStorage.getItem("qbbrain.newbieDismissed")==="1"; }catch(_){}
    if(!dismissed && !Object.keys(TUT_DONE).length) els.newbieCard.classList.remove("hidden");
    els.newbieCard.addEventListener("click",(e)=>{
      if(e.target===els.newbieX){ els.newbieCard.classList.add("hidden"); try{ localStorage.setItem("qbbrain.newbieDismissed","1"); }catch(_){} return; }
      els.newbieCard.classList.add("hidden"); showScreen("learnScreen");
    });
  })();
  on("screen",id=>{ if(id==="learnScreen") renderLessons(); });
  renderLessons();
  on("setup",renderCoachRow);
  renderCoachRow();
}

export { figCtx, figDot, figDef, figLine, figText, figZone, FIG_OFF5, FIG_OFF7, figCoverage, figPlay, figRoutes, figHighLow, figHorizontal, figLeverage, figLobBullet, figRush, figField, FIGS, stdPlay, SRC, covChapter, conChapter, MANUAL, MAN_CUR, openManual, openManualFromGame, closeManual, lvlTag, showChapterList, showChapter, practiceFromManual, TUT_KEY, TUT_DONE, tutSave, completed, LESSONS, TUT, tutLesson, tutRep, tutStep, startLesson, tutRestore, tutRepCfg, tutAdjustRep, tutRender, tutDrawHighlight, tutAdvance, tutEvent, tutOnResult, tutAfterResult, tutExit, highlightNextLesson, renderLessons, renderCoachRow };
