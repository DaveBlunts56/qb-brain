import { emit, on } from "./config.js";
import { BOOKS, C_, pl, sideIn } from "./plays.js";
import { load, save } from "./store.js";

/* ============================================================
   MY PLAYS — plays you build in the editor, saved on this device.
   Stored format (template yards, ball at x=15, LOS y=0):
   {uid,name,squad,form,note,players:[{id,x,y,route:{mode:"lib",type,depth,flip}|{mode:"draw",rel:[[dx,dy]...]}|{mode:"qb",action},after,delay}],prog,pitch}
============================================================ */
// Route library used by the editor and hot routes. i = +1 means "toward the ball".
const LIB = {
  go:      {name:"go",       after:"run", d:null, f:(x,y,d,i)=>[[x,y],[x,y+18]]},
  seam:    {name:"seam",     after:"run", d:null, f:(x,y,d,i)=>[[x,y],[x+i*0.8,y+18]]},
  slant:   {name:"slant",    after:"run", d:5,    f:(x,y,d,i)=>[[x,y],[x,y+1.5],[x+i*6,y+1.5+d]]},
  hitch:   {name:"hitch",    after:"sit", d:5.5,  f:(x,y,d,i)=>[[x,y],[x,y+d+0.7],[x+i*0.4,y+d]]},
  stick:   {name:"stick",    after:"sit", d:5.5,  f:(x,y,d,i)=>[[x,y],[x,y+d],[x+i*1.8,y+d]]},
  sit:     {name:"sit",      after:"sit", d:5,    f:(x,y,d,i)=>[[x,y],[x,y+d]]},
  curl:    {name:"curl",     after:"sit", d:10,   f:(x,y,d,i)=>[[x,y],[x,y+d+1],[x+i*1.5,y+d-0.5]]},
  comeback:{name:"comeback", after:"sit", d:12,   f:(x,y,d,i)=>[[x,y],[x,y+d],[x-i*2,y+d-2.5]]},
  out:     {name:"out",      after:"run", d:6,    f:(x,y,d,i)=>[[x,y],[x,y+d],[x-i*5,y+d]]},
  in:      {name:"in",       after:"run", d:6,    f:(x,y,d,i)=>[[x,y],[x,y+d],[x+i*6,y+d]]},
  dig:     {name:"dig",      after:"run", d:10,   f:(x,y,d,i)=>[[x,y],[x,y+d],[x+i*9,y+d]]},
  corner:  {name:"corner",   after:"run", d:10,   f:(x,y,d,i)=>[[x,y],[x,y+d],[x-i*5,y+d+5]]},
  post:    {name:"post",     after:"run", d:10,   f:(x,y,d,i)=>[[x,y],[x,y+d],[x+i*5,y+d+5]]},
  flat:    {name:"flat",     after:"run", d:2,    f:(x,y,d,i)=>[[x,y],[x-i*1.5,y+1.5],[x-i*6,y+d]]},
  drag:    {name:"drag",     after:"run", d:3,    f:(x,y,d,i)=>[[x,y],[x+i*1.5,y+d],[x+i*14,y+d+0.4]]},
  wheel:   {name:"wheel",    after:"run", d:null, f:(x,y,d,i)=>[[x,y],[x-i*4,y+1],[x-i*6,y+5],[x-i*6.3,y+16]]},
  swing:   {name:"swing",    after:"run", d:null, f:(x,y,d,i)=>[[x,y],[x-i*3,y-1],[x-i*7,y+0.5],[x-i*8,y+3]]},
  stay:    {name:"stay home",after:"stop",d:null, f:(x,y,d,i)=>[[x,y]]}
};
const LIB_ORDER=["go","slant","hitch","out","in","flat","sit","stick","curl","comeback","dig","corner","post","drag","seam","wheel","swing","stay"];
const HOT_ROUTES=["go","slant","hitch","out","in","flat","sit","corner","post","drag"];
// QB actions after the snap (template coords around his alignment)
const QB_ACTIONS = {
  drop3:  {name:"3-step drop", f:(x,y)=>[[x,y],[x,y-2.25]], speed:3, stride:0.75},
  drop5:  {name:"5-step drop", f:(x,y)=>[[x,y],[x,y-3.75]], speed:3.4, stride:0.75},
  stay:   {name:"stays in pocket", f:(x,y)=>[[x,y],[x,y-0.05]]},
  rollR:  {name:"rollout", f:(x,y)=>[[x,y],[x+1.5,y-1.5],[x+6,y-2]]},
  rollL:  {name:"rollout", f:(x,y)=>[[x,y],[x-1.5,y-1.5],[x-6,y-2]]},
  bootR:  {name:"bootleg", f:(x,y)=>[[x,y],[x-1,y-1.5],[x+2,y-3],[x+6,y-3.2]]},
  bootL:  {name:"bootleg", f:(x,y)=>[[x,y],[x+1,y-1.5],[x-2,y-3],[x-6,y-3.2]]}
};
function libPts(type,x,y,depth,flip){
  const L=LIB[type]||LIB.go, i=sideIn(x)*(flip?-1:1);
  return L.f(x,y,depth==null?L.d:depth,i);
}
// absolute template points for a stored player's route
function storedRoutePts(p){
  const r=p.route||{mode:"lib",type:"go"};
  if(r.mode==="lib") return libPts(r.type,p.x,p.y,r.depth,r.flip);
  if(r.mode==="qb") return (QB_ACTIONS[r.action]||QB_ACTIONS.drop3).f(p.x,p.y);
  return [[p.x,p.y]].concat((r.rel||[]).map(q=>[p.x+q[0],p.y+q[1]]));
}
function storedRouteName(p){
  const r=p.route||{};
  if(r.mode==="lib") return (LIB[r.type]||LIB.go).name;
  if(r.mode==="qb") return (QB_ACTIONS[r.action]||QB_ACTIONS.drop3).name;
  return r.name||"custom route";
}
function storedAfter(p){
  if(p.after) return p.after;
  const r=p.route||{};
  if(r.mode==="lib") return (LIB[r.type]||LIB.go).after;
  if(r.mode==="qb") return "stop";
  return "run";
}
// stored play -> engine play (same shape as the built-in books)
function myToPlay(sp){
  const pitchTo = sp.pitch && sp.pitch.to;
  const players = sp.players.map(p=>{
    const pts=storedRoutePts(p), name=storedRouteName(p), after=storedAfter(p);
    const opts={};
    if(p.delay!=null) opts.delay=p.delay;
    if(p.id==="Q"){
      opts.target=false;
      const A=p.route&&p.route.mode==="qb" ? QB_ACTIONS[p.route.action]||QB_ACTIONS.drop3 : null;
      if(A && A.speed){ opts.speed=A.speed; opts.stride=A.stride; if(opts.delay==null) opts.delay=0.1; }
    }
    if(p.id===pitchTo) opts.target=false;
    if(p.motion) opts.dashed=true;
    return pl(p.id,p.x,p.y,C_(pts,name,after),opts);
  });
  const targets=players.filter(q=>q.target).map(q=>q.id);
  const prog=(sp.prog||[]).filter(id=>targets.includes(id));
  targets.forEach(id=>{ if(!prog.includes(id)) prog.push(id); });
  const strip=v=>String(v==null?"":v).replace(/[<>&"`]/g,"");
  const play={name:strip(sp.name).slice(0,28)||"My play", form:strip(sp.form||"Custom").slice(0,20), kind: pitchTo?"trick":"pass", prog, note:strip(sp.note).slice(0,300), players, custom:true, uid:sp.uid, squad:sp.squad};
  if(pitchTo) play.passer=[{id:"Q",until:sp.pitch.at||0.9},{id:pitchTo}];
  return play;
}
let MY_PLAYS=[];          // stored format; each play carries upd (last edit time) for merging devices
let AUDIBLES={};          // play key -> [play keys]
let GONE={};              // uid -> time deleted (so a deleted play doesn't come back from another device)
function loadMyPlays(){
  const d=load("plays",null)||{};
  MY_PLAYS=Array.isArray(d.plays)?d.plays:[]; AUDIBLES=d.audibles&&typeof d.audibles==="object"?d.audibles:{}; GONE=d.gone&&typeof d.gone==="object"?d.gone:{};
  rebuildCustomBook();
}
function deleteMyPlay(uid){ MY_PLAYS=MY_PLAYS.filter(q=>q.uid!==uid); GONE[uid]=Date.now(); }
function saveMyPlays(){
  save("plays",{plays:MY_PLAYS, audibles:AUDIBLES, gone:GONE});
  rebuildCustomBook();
}
function rebuildCustomBook(){
  const out={5:[],7:[]};
  MY_PLAYS.forEach(sp=>{ try{ const p=myToPlay(sp); p.key="my:"+sp.uid; (out[sp.squad]||out[5]).push(p); }catch(_){} });
  BOOKS.custom.plays=out;
}

// stable keys for built-in plays (used by audible lists)

function booksForSquad(sq){
  const list=[];
  if(BOOKS.custom.plays[sq] && BOOKS.custom.plays[sq].length) list.push({key:"custom",label:"My Plays",plays:BOOKS.custom.plays[sq]});
  if(sq===5) list.push({key:"bigdawz",label:"Big Dawz",plays:BOOKS.bigdawz.plays[5]});
  list.push({key:"standard",label:"Standard",plays:BOOKS.standard.plays[sq]});
  return list;
}
function playByKey(key){
  for(const bk of ["custom","bigdawz","standard"]){ const b=BOOKS[bk]; for(const sq in b.plays){ const f=b.plays[sq].find(p=>p.key===key); if(f) return f; } }
  return null;
}
function audiblesFor(play){ return (AUDIBLES[play.key]||[]).map(playByKey).filter(p=>p && p.squad===play.squad && p.key!==play.key); }

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  BOOKS.custom={label:"My Plays", sub:"Plays you built", plays:{5:[],7:[]}};
  ["standard","bigdawz"].forEach(bk=>{ const b=BOOKS[bk]; Object.keys(b.plays).forEach(sq=>b.plays[sq].forEach(p=>{ p.key=bk+":"+sq+":"+p.name; p.squad=+sq; })); });
  loadMyPlays();
  on("data:changed",k=>{ if(k==="plays"){ loadMyPlays(); emit("plays:changed"); } });
}

export { LIB, LIB_ORDER, HOT_ROUTES, QB_ACTIONS, libPts, storedRoutePts, storedRouteName, storedAfter, myToPlay, MY_PLAYS, AUDIBLES, loadMyPlays, deleteMyPlay, saveMyPlays, rebuildCustomBook, booksForSquad, playByKey, audiblesFor, GONE };
