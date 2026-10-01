import { GEO, clamp } from "./config.js";
import { lastFrameT } from "./loop.js";
import { drawFrame, drawStatic } from "./sprites.js";
import { els, state } from "./state.js";

/* ============================================================
   CANVAS
============================================================ */
let ctx;
let cw=0, ch=0, dpr=1;
function setupCanvas(){
  dpr = Math.min(window.devicePixelRatio||1, 2.5);
  const rect = els.fieldWrap.getBoundingClientRect();
  cw = rect.width; ch = rect.height;
  els.field.width = Math.round(cw*dpr);
  els.field.height = Math.round(ch*dpr);
  els.field.style.width = cw+"px";
  els.field.style.height = ch+"px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
  updateView();
}

// Uniform scale: the full field width fits the screen; the LOS sits ~30% up from the bottom.
const VIEW={ppy:13, yHi:40, PR:10};
function updateView(){
  VIEW.ppy = cw/GEO.W;
  const visible = ch/VIEW.ppy;
  VIEW.yHi = visible*0.70;
  VIEW.PR = clamp(VIEW.ppy*0.72, 7, 11);
}
function toPx(x,y){ return {x: x*VIEW.ppy, y: (VIEW.yHi-y)*VIEW.ppy}; }

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  ctx = els.field.getContext("2d");
  window.addEventListener("resize", ()=>{ if(!els.gameScreen.classList.contains("hidden")) setupCanvas(); });
  if(window.ResizeObserver){
    new ResizeObserver(()=>{
      if(els.gameScreen.classList.contains("hidden")||!state.rep) return;
      setupCanvas();
      if(state.phase==="decision") return;
      if(lastFrameT!==null && state.phase==="result") drawFrame(lastFrameT); else drawStatic();
    }).observe(els.fieldWrap);
  }
}

export { ctx, cw, ch, dpr, setupCanvas, VIEW, updateView, toPx };
