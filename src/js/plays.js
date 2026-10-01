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

/* ============================================================
   BIG DAWZ  — the user's own 5v5 playbook, transcribed from the diagrams.
   Coordinates in yards: x across (0-30, ball at 15), y downfield from the LOS.
   passer: who throws the ball; a later entry means a lateral/pitch to that player.
============================================================ */
let BIGDAWZ;

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
  BIGDAWZ = [
    {name:"Mesh", form:"Offset", kind:"pass", prog:["Y","X","Z","C"],
     note:"Beats man (the crossers rub the defenders). Vs zone, sit the center in the hole.",
     players:[QB(),
      pl("C",15,0,C_([[15,0],[17.5,2],[18.5,4.5],[18.1,7]],"seam")),
      pl("X",10.5,0,C_([[10.5,0],[12.5,1.8],[21.6,2.4]],"mesh cross")),
      pl("Z",18.7,0,C_([[18.7,0],[18.1,2.3],[15,3.8],[11.2,4.3]],"mesh cross")),
      pl("Y",17,-2.3,C_([[17,-2.3],[23.5,-0.3],[25.8,10]],"wheel"))]},
    {name:"Drive", form:"Offset", kind:"pass", prog:["Z","Y","X","C"],
     note:"High-low on the middle defender: shallow and dig go the same way. If he sinks, hit the shallow; if he jumps it, hit the dig.",
     players:[QB(),
      pl("C",15,0,C_([[15,0],[13.5,2],[11,3],[6.7,3.4]],"drag")),
      pl("Z",8.6,0,C_([[8.6,0],[10.5,2.5],[13,3.8],[20.7,4.3]],"shallow")),
      pl("Y",11.6,-1.2,C_([[11.6,-1.2],[11.5,8.5],[20.6,8.1]],"dig")),
      pl("X",18.2,0,C_([[18.2,0],[21.6,1.6],[24,3.5],[24.9,9.3]],"out-and-up"))]},
    {name:"Post Between Corners", form:"Offset", kind:"pass", prog:["Z","Y","X","C"],
     note:"Post between two corners: the deep middle defender can only take one. Center's out is the checkdown.",
     players:[QB(),
      pl("C",15,0,C_([[15,0],[15.3,4.2],[23.5,4.3]],"out")),
      pl("X",11.4,0,C_([[11.4,0],[11.6,10.3],[7,12.8]],"corner")),
      pl("Z",19.4,0,C_([[19.4,0],[19.6,11],[15.4,14]],"post")),
      pl("Y",17.3,-2,C_([[17.3,-2],[17.6,9.8],[25.3,12.8]],"corner"))]},
    {name:"Spread V-In", form:"Spread", kind:"pass", prog:["Z","Y","C","X"],
     note:"Corner over the in: read the defender on Y's side. If he carries the corner, the in is open underneath.",
     players:[QB(),
      pl("C",15,0,C_([[15,0],[15.5,1.8],[18,2.6],[27.4,2.7]],"drag")),
      pl("X",10,0,C_([[10,0],[9.1,8.8],[8,7.3]],"curl","sit")),
      pl("Z",19.9,0,C_([[19.9,0],[19.9,8.8],[25.8,12.2]],"corner")),
      pl("Y",26.3,0,C_([[26.3,0],[27.8,6.7],[20.2,7.8]],"in"))]},
    {name:"Triangle 1", form:"Pistol (T)", kind:"trick", prog:["Y","X","Q","C"],
     passer:[{id:"Q",until:0.75},{id:"T"}],
     note:"Q pitches to T and releases, so the rusher has to redirect. T throws.",
     players:[pl("Q",15,-4.3,C_([[15,-4.3],[18,-3.5],[23,-1],[27.7,2]],"QB release"),{target:true,delay:0.8}),
      pl("T",11,-7.3,null),
      pl("C",15,0,C_([[15,0],[10,1.5],[2.9,2.3]],"flat")),
      pl("X",3.8,0,C_([[3.8,0],[6,2.5],[10,4],[21.2,4.6]],"shallow cross")),
      pl("Y",26.2,0,C_([[26.2,0],[26.1,8.7],[15.2,13.3]],"post"))]},
    {name:"Goaline", form:"Stack right", kind:"pass", prog:["Y","Z","X","C"],
     note:"Stack gives free releases vs man. QB rolls toward the stack, which shortens the throws.",
     players:[pl("Q",15,-4.3,C_([[15,-4.3],[19.3,-5]],"rollout","stop")),
      pl("C",15,0,C_([[15,0],[13,2.5],[8.1,4]],"shallow")),
      pl("Y",26.2,0,C_([[26.2,0],[26.2,3.1],[24,5.5],[21,6.8]],"slant")),
      pl("Z",26.2,-2.5,C_([[26.2,-2.5],[26.6,2],[25.5,7],[22.8,10.8]],"fade-post")),
      pl("X",26.1,-4.9,C_([[26.1,-4.9],[25.2,-1.5],[24.5,0.7]],"quick hitch","sit"))]},
    {name:"PA Jet Sweep", form:"Under center", kind:"pass", prog:["Y","X","C","Z"],
     note:"Jet fake pulls the underneath defenders left, then the QB boots right. Shot play to Y.",
     players:[pl("Q",15,-1.6,C_([[15,-1.6],[15.2,-3.5],[17,-5.2],[21.2,-5.6]],"bootleg","stop")),
      pl("C",15,0,C_([[15,0],[22.2,2.7]],"angle")),
      pl("X",3.8,0,C_([[3.8,0],[4.3,6.5],[10.4,10.7]],"post")),
      pl("Z",21.4,0,C_([[21.4,0],[21.3,-1.5],[19,-2.6],[15,-2.8],[6.4,-2.8]],"jet fake"),{dashed:true}),
      pl("Y",26.3,0,C_([[26.3,0],[26.4,15]],"go"))]},
    {name:"Stack Smash", form:"Stack right", kind:"pass", prog:["Z","Y","C","X"],
     note:"Classic smash high-low on the corner: corner route over the out. Throw opposite what the corner does.",
     players:[QB(),
      pl("C",15,0,C_([[15,0],[15.2,6.2],[22.8,6.2]],"out")),
      pl("X",10,0,C_([[10,0],[10.5,13.5],[14.6,17]],"deep post")),
      pl("Z",20.3,0,C_([[20.3,0],[20.6,11.6],[27.4,16.8]],"corner")),
      pl("Y",20.2,-2,C_([[20.2,-2],[21.5,1.5],[24,4.5],[27,6.2]],"arrow"))]},
    {name:"Jet Sweep", form:"Spread", kind:"run", prog:["Z","Y","X","C"],
     note:"Run play. Give the jet (throw/pitch to Z behind the line) unless the edge defender is already there.",
     players:[pl("Q",15,-4.1,null),
      pl("C",15,0,C_([[15,0],[15,11.9],[10,16]],"corner (clear)")),
      pl("X",3.8,0,C_([[3.8,0],[3.5,13.5],[7.9,17]],"post (clear)")),
      pl("Z",9.3,0,C_([[9.3,0],[9.8,-1.5],[13,-2.8],[20,-3],[23,-2],[24.9,0.9]],"jet sweep"),{dashed:true}),
      pl("Y",26.4,0,C_([[26.4,0],[26.4,15]],"go (clear)"))]},
    {name:"Bunch - Goaline", form:"Tight bunch", kind:"pass", prog:["Z","X","Y","C"],
     note:"Bunch creates natural picks vs man. Short, quick throws — ball out fast.",
     players:[pl("Q",15,-4.3,C_([[15,-4.3],[17,-5.5],[18.1,-6]],"slide","stop")),
      pl("X",13.2,0,C_([[13.2,0],[13.2,4.3],[19.1,4.5]],"out")),
      pl("C",15,0,C_([[15,0],[13,1.8],[8,3.3],[3.2,4]],"drag")),
      pl("Z",16.8,0,C_([[16.8,0],[16.8,4.7],[21.9,8.3]],"corner")),
      pl("Y",18.6,0,C_([[18.6,0],[17.5,1.8],[13,2.2],[7.4,2.2]],"shallow"))]},
    {name:"Misdirection Run", form:"Offset", kind:"run", prog:["X","C","Y","Z"],
     note:"Run play. Center's drag pulls defenders left; X runs right behind the line.",
     players:[pl("Q",15,-1.6,null),
      pl("Z",13.2,0,C_([[13.2,0],[13.3,15]],"go (clear)")),
      pl("C",15,0,C_([[15,0],[14.9,3],[12,5.5],[2.3,6.7]],"drag")),
      pl("X",5.8,-1.6,C_([[5.8,-1.6],[9.5,-2.6],[13,-3.1],[21.9,-3]],"misdirection run"),{dashed:true}),
      pl("Y",26.3,0,C_([[26.3,0],[26.4,15]],"go (clear)"))]},
    {name:"Disguise Triangle", form:"Offset", kind:"trick", prog:["Y","Z","X"],
     passer:[{id:"Q",until:1.15},{id:"C"}],
     note:"Center snaps, drops into the backfield and gets the pitch. The rusher has to chase a second passer.",
     players:[pl("Q",15,-4.3,C_([[15,-4.3],[10.8,-4.8]],"pitch","stop")),
      pl("C",15,0,C_([[15,0],[19.2,-6.1]],"drop to pass","stop"),{target:false}),
      pl("X",3.8,0,C_([[3.8,0],[4.2,8.4],[15.5,15.3]],"deep post")),
      pl("Z",19.2,-6.1,C_([[19.2,-6.1],[23.5,-4.6],[26.3,-2.5],[27.2,16.6]],"wheel")),
      pl("Y",26.2,0,C_([[26.2,0],[25.4,3.8],[20.5,3.8],[28.5,3.8]],"whip"))]},
    {name:"Fake Sweep Center Shovel", form:"Offset", kind:"pass", prog:["C","Z","X","Y"],
     note:"Sweep fake right, QB slides left: flood the left side with three routes at three depths.",
     players:[pl("Q",15,-1.9,C_([[15,-1.9],[7.4,-1.9]],"slide left","stop")),
      pl("X",3.8,0,C_([[3.8,0],[2.1,4.9],[2,16]],"fade")),
      pl("Z",8.8,0,C_([[8.8,0],[7.7,2.6],[7.5,13.7]],"go")),
      pl("C",15,0,C_([[15,0],[12,4],[8.5,7.5],[6.5,9.5]],"angle")),
      pl("Y",8,-3.7,C_([[8,-3.7],[9,-3.7],[18,-3.7],[23,-2.5],[25.5,1.5],[26.7,6]],"fake sweep → wheel"),{dashed:true})]},
    {name:"Center Wheel", form:"Trips left", kind:"pass", prog:["C","Y","X","Z"],
     note:"Trips left draws the defense over; the center wheels down the left sideline behind it.",
     players:[QB(),
      pl("X",3.8,0,C_([[3.8,0],[3.8,11.9],[8.1,15.1]],"post")),
      pl("Y",7.8,0,C_([[7.8,0],[7.7,7.7],[10.7,10.7]],"short post")),
      pl("Z",11.5,0,C_([[11.5,0],[11.5,3.3],[21.3,5.6]],"drag")),
      pl("C",15,0,C_([[15,0],[13,-1.2],[8,-1.8],[3,-1.6],[1.2,3],[0.8,13]],"wheel"))]},
    {name:"The Matilda Special", form:"Offset", kind:"trick", prog:["Y","X","Z"],
     passer:[{id:"Q",until:1.35},{id:"C"}],
     note:"QB drifts right to pull the rusher, then laterals back to the center who throws.",
     players:[pl("Q",15,-5.3,C_([[15,-5.3],[20.5,-6]],"drift right","stop")),
      pl("C",15,0,C_([[15,0],[9.8,-7.4]],"drop to pass","stop"),{target:false}),
      pl("X",8.9,0,C_([[8.9,0],[9,3.7],[16.2,4.4]],"quick in")),
      pl("Y",11.9,0,C_([[11.9,0],[11.8,6.5],[15.7,9.1]],"short post")),
      pl("Z",17.3,-2.8,C_([[17.3,-2.8],[14,-4.2],[10.4,-4.4],[5,-2],[1.9,0.9]],"swing"))]}
  ];
  BOOKS = {
    standard: {label:"Standard concepts", sub:"Mesh, Smash, Flood, Stick…", plays:{5:STANDARD5,7:STANDARD7}},
    bigdawz:  {label:"Big Dawz", sub:"Your 15 plays (5v5)", plays:{5:BIGDAWZ}}
  };
}

export { sideIn, R, C_, pl, QB, STANDARD5, IDS7, FORM7, r7, mk7, STANDARD7, BIGDAWZ, BOOKS };
