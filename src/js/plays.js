import { CENTER_X } from "./config.js";

/* ============================================================
   ROUTE LIBRARY  (depths follow the standard route tree:
   slant 3-step, hitch/stick 5-6, out any depth, corner/post break ~10 at 45°, dig 10-12)
============================================================ */
function sideIn(x){ return x<CENTER_X?1:-1; }
const R = {
  go:     (x,y)=>({pts:[[x,y],[x,y+18]],after:"run",name:"go"}),
  seam:   (x,y)=>({pts:[[x,y],[x+sideIn(x)*0.8,y+18]],after:"run",name:"seam"}),
  slant:  (x,y)=>({pts:[[x,y],[x,y+1.5],[x+sideIn(x)*6,y+6.5]],after:"run",name:"slant"}),
  hitch:  (x,y,d=5.5)=>({pts:[[x,y],[x,y+d+0.7],[x+sideIn(x)*0.4,y+d]],after:"sit",name:"hitch"}),
  stick:  (x,y)=>({pts:[[x,y],[x,y+5.5],[x+sideIn(x)*1.8,y+5.5]],after:"sit",name:"stick"}),
  sit:    (x,y,d=5)=>({pts:[[x,y],[x,y+d]],after:"sit",name:"sit"}),
  out:    (x,y,d=6)=>({pts:[[x,y],[x,y+d],[x-sideIn(x)*5,y+d]],after:"run",name:"out"}),
  flat:   (x,y)=>({pts:[[x,y],[x-sideIn(x)*1.5,y+1.5],[x-sideIn(x)*6,y+2.2]],after:"run",name:"flat"}),
  corner: (x,y,d=10)=>({pts:[[x,y],[x,y+d],[x-sideIn(x)*5,y+d+5]],after:"run",name:"corner"}),
  post:   (x,y,d=10)=>({pts:[[x,y],[x,y+d],[x+sideIn(x)*5,y+d+5]],after:"run",name:"post"}),
  dig:    (x,y,d=10)=>({pts:[[x,y],[x,y+d],[x+sideIn(x)*9,y+d]],after:"run",name:"dig"}),
  shallow:(x,y,d,dir)=>({pts:[[x,y],[x+dir*1.5,y+d],[x+dir*14,y+d+0.4]],after:"run",name:"shallow cross"}),
  snag:   (x,y)=>({pts:[[x,y],[x,y+5],[x+sideIn(x)*2,y+5.5]],after:"sit",name:"snag"})
};
// custom route from explicit points
function C_(pts,name,after){ return {pts,after:after||"run",name}; }

/* player: id, start, route; Q/T are passers and not targets unless flagged */
function pl(id,x,y,route,opts){
  return Object.assign({id,x,y,route:route||{pts:[[x,y]],after:"stop",name:"stays in"},target:!(id==="Q"||id==="T")},opts||{});
}
const QB = (y)=>pl("Q",15,y===undefined?-4.3:y,null);

/* ============================================================
   STANDARD PLAYBOOK
   5v5 = QB + center (eligible) + X/Y/Z.  7v7 = QB + 6 eligible.
============================================================ */
let STANDARD5;

// 7v7: QB + center (snaps, then eligible) + 5 more
const IDS7 = {"Spread":["X","H","C","Y","Z","F"], "Trips":["X","C","H","Y","Z","F"], "Bunch":["X","C","H","Y","Z","F"]};
const FORM7 = {
  "Spread": [[2,0],[8,0],[15,0],[21,0],[28,0],[11,-1.5]],
  "Trips":  [[2,0],[15,0],[19,0],[23.5,0],[28,0],[11,-1.5]],
  "Bunch":  [[2,0],[15,0],[20.5,0],[23,0],[25.5,0],[11,-1.5]]
};
function r7(type,x,y){
  switch(type){
    case "slant": return R.slant(x,y); case "flat": return R.flat(x,y); case "hitch": return R.hitch(x,y);
    case "out": return R.out(x,y,8); case "corner": return R.corner(x,y); case "vertical": return R.seam(x,y);
    case "go": return R.go(x,y); case "digshallow": return R.dig(x,y,5); case "digdeep": return R.dig(x,y,12);
    case "stick": return R.stick(x,y); case "sit": return R.sit(x,y,5);
    case "mesh": return R.shallow(x,y,3,sideIn(x)); case "meshhigh": return R.shallow(x,y,5.5,sideIn(x));
    case "snag": return R.snag(x,y);
  }
}
function mk7(name,form,types,prog){
  const players=[QB()], ids=IDS7[form];
  FORM7[form].forEach((p,i)=>players.push(pl(ids[i],p[0],p[1],r7(types[i],p[0],p[1]))));
  return {name,form,players,prog:prog.map(i=>ids[i])};
}
let STANDARD7;

let BOOKS;

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  STANDARD5 = [
    {name:"Slant-Flat", form:"Spread", prog:["X","Y","Z","C"], players:[QB(), pl("C",15,0,R.sit(15,0,5)), pl("X",3,0,R.slant(3,0)), pl("Y",9,0,R.flat(9,0)), pl("Z",27,0,R.slant(27,0))]},
    {name:"Mesh", form:"Spread", prog:["Y","Z","C","X"], players:[QB(), pl("C",15,0,R.sit(15,0,7)), pl("X",3,0,R.corner(3,0)), pl("Y",9,0,R.shallow(9,0,2.5,1)), pl("Z",27,0,R.shallow(27,0,4.5,-1))]},
    {name:"Drive", form:"Spread", prog:["Y","X","Z","C"], players:[QB(), pl("C",15,0,R.sit(15,0,6)), pl("X",3,0,R.dig(3,0,10)), pl("Y",9,0,R.shallow(9,0,2.5,1)), pl("Z",27,0,R.go(27,0))]},
    {name:"Smash", form:"Spread", prog:["Y","X","Z","C"], players:[QB(), pl("C",15,0,R.flat(15.1,0)), pl("X",3,0,R.hitch(3,0)), pl("Y",9,0,R.corner(9,0)), pl("Z",27,0,R.go(27,0))]},
    {name:"Flood", form:"Trips", prog:["Z","Y","X","C"], players:[QB(), pl("C",15,0,R.shallow(15,0,3,-1)), pl("Y",19,0,R.flat(19,0)), pl("Z",23,0,R.out(23,0,8)), pl("X",27,0,R.go(27,0))]},
    {name:"Stick", form:"Trips", prog:["Z","Y","X","C"], players:[QB(), pl("C",15,0,R.shallow(15,0,3,-1)), pl("Y",19,0,R.flat(19,0)), pl("Z",23,0,R.stick(23,0)), pl("X",27,0,R.go(27,0))]},
    {name:"Levels", form:"Trips", prog:["Z","X","Y","C"], players:[QB(), pl("C",15,0,R.flat(14.9,0)), pl("Y",19,0,R.seam(19,0)), pl("Z",23,0,R.dig(23,0,5)), pl("X",27,0,R.dig(27,0,10))]},
    {name:"Four Verticals", form:"Spread", prog:["Y","X","Z","C"], players:[QB(), pl("C",15,0,R.sit(15,0,7)), pl("X",3,0,R.go(3,0)), pl("Y",9,0,R.seam(9,0)), pl("Z",27,0,R.go(27,0))]},
    {name:"Spacing", form:"Trips", prog:["Z","Y","X","C"], players:[QB(), pl("C",15,0,R.flat(14.9,0)), pl("Y",19,0,R.sit(19,0,5)), pl("Z",23,0,R.sit(23,0,5)), pl("X",27,0,R.hitch(27,0))]},
    {name:"Snag", form:"Bunch", prog:["Z","X","Y","C"], players:[QB(), pl("C",15,0,R.shallow(15,0,3,-1)), pl("X",21,0,R.snag(21,0)), pl("Y",22.5,-1.3,R.flat(22.5,-1.3)), pl("Z",24,0,R.corner(24,0))]}
  ];
  STANDARD7 = [
    mk7("Slant-Flat","Spread",["slant","flat","sit","flat","slant","sit"],[0,1,4,3,2,5]),
    mk7("Mesh","Spread",["go","mesh","sit","meshhigh","corner","flat"],[1,3,2,4,0,5]),
    mk7("Smash","Spread",["hitch","corner","sit","corner","hitch","flat"],[1,0,3,4,2,5]),
    mk7("Levels","Spread",["go","flat","sit","digshallow","digdeep","sit"],[3,4,2,1,0,5]),
    mk7("Four Verticals","Spread",["go","vertical","sit","vertical","go","flat"],[1,3,0,4,2,5]),
    mk7("Flood","Trips",["go","sit","flat","out","go","sit"],[3,2,4,1,0,5]),
    mk7("Stick","Trips",["go","sit","flat","stick","go","sit"],[3,2,4,1,0,5]),
    mk7("Spacing","Trips",["hitch","sit","sit","sit","hitch","flat"],[2,3,1,4,0,5]),
    mk7("Snag","Bunch",["go","sit","snag","flat","corner","flat"],[4,2,3,1,0,5])
  ];
  BOOKS = {
    standard: {label:"Standard concepts", sub:"Mesh, Smash, Flood, Stick…", plays:{5:STANDARD5,7:STANDARD7}}
  };
}

export { sideIn, R, C_, pl, QB, STANDARD5, IDS7, FORM7, r7, mk7, STANDARD7, BOOKS };
