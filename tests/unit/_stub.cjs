// Minimal fake DOM so the game engine can run headless in Node (no browser).
const fs=require('fs');
function mkEl(id){
  const el={id,_cls:new Set(),_h:{},style:{},children:[],textContent:'',dataset:{},value:'',disabled:false,
    classList:{add:c=>el._cls.add(c),remove:c=>el._cls.delete(c),toggle:(c,f)=>{(f===undefined?!el._cls.has(c):f)?el._cls.add(c):el._cls.delete(c)},contains:c=>el._cls.has(c)},
    addEventListener:(t,f)=>{const pv=el._h[t]; el._h[t]= pv ? (e)=>{pv(e); return f(e);} : f;},removeEventListener:()=>{},appendChild:c=>el.children.push(c),append:(...c)=>el.children.push(...c),insertBefore:(c)=>el.children.push(c),prepend:(...c)=>el.children.unshift(...c),
    querySelector:()=>({style:{}}),querySelectorAll:()=>el._qsa||[],getBoundingClientRect:()=>({left:0,top:0,width:390,height:520}),
    setPointerCapture(){},getContext:()=>new Proxy({},{get:(t,k)=>k==='measureText'?()=>({width:40}):()=>{},set:()=>true}),firstElementChild:{textContent:''}};
  let html=''; Object.defineProperty(el,'innerHTML',{get:()=>html,set:v=>{html=v;if(v==='')el.children.length=0;}});
  return el;
}
const els={};
const tt=mkEl('throwType'); const bb=mkEl('b1'); bb.dataset.k='bullet'; const lb=mkEl('b2'); lb.dataset.k='lob'; tt._qsa=[bb,lb]; els.throwType=tt;
global.document={getElementById:id=>els[id]||(els[id]=mkEl(id)),createElement:()=>mkEl('n'),querySelectorAll:()=>[]};
global.__now=1000; global.performance={now:()=>global.__now};
global.__raf=null; global.requestAnimationFrame=f=>{global.__raf=f;return 1}; global.cancelAnimationFrame=()=>{global.__raf=null};
global.window={devicePixelRatio:2,addEventListener(){},__QB_TEST__:true};
global.setInterval=()=>1; global.clearInterval=()=>{}; global.setTimeout=(f)=>{f();return 1}; global.clearTimeout=()=>{};
// bundle the app straight from src/ (no HTML) and run it against this fake DOM
const esbuild=require('esbuild'), path=require('path');
const code=esbuild.buildSync({entryPoints:[path.join(__dirname,'../../src/js/main.js')],bundle:true,format:'iife',write:false,logLevel:'error',define:{__QB_FEATURES__:JSON.stringify({accounts:false}),__QB_CLOUD__:'null'}}).outputFiles[0].text;
(0,eval)(code);
module.exports={els,lob:lb,bullet:bb};
