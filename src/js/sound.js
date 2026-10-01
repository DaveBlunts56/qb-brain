import { state } from "./state.js";

/* ============================================================
   SOUND — tiny WebAudio synth (no files). Starts on the first tap (iOS rule).
============================================================ */
let SFX;

/* ---- runs once at startup, in module order (see main.js) ---- */
export function init(){
  SFX = (()=>{
    let ac=null, master=null, nbuf=null;
    function A(){
      if(!state.sound) return null;
      if(!ac){
        const AC=(typeof window!=="undefined")&&(window.AudioContext||window.webkitAudioContext);
        if(!AC) return null;
        try{ ac=new AC(); master=ac.createGain(); master.gain.value=0.55; master.connect(ac.destination); }catch(_){ ac=null; return null; }
      }
      if(ac.state==="suspended"){ try{ ac.resume(); }catch(_){} }
      return ac;
    }
    function noise(){
      if(nbuf) return nbuf;
      const n=Math.floor(ac.sampleRate*2); nbuf=ac.createBuffer(1,n,ac.sampleRate);
      const d=nbuf.getChannelData(0); for(let i=0;i<n;i++) d[i]=Math.random()*2-1;
      return nbuf;
    }
    function env(g,t,vol,att,dur){ g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+att); g.gain.exponentialRampToValueAtTime(0.0001,t+dur); }
    function tone(type,f0,f1,dur,vol,delay){
      const a=A(); if(!a) return null; const t=a.currentTime+(delay||0);
      const o=a.createOscillator(), g=a.createGain(); o.type=type;
      o.frequency.setValueAtTime(f0,t); if(f1) o.frequency.exponentialRampToValueAtTime(f1,t+dur);
      env(g,t,vol,0.008,dur); o.connect(g); g.connect(master); o.start(t); o.stop(t+dur+0.05); return o;
    }
    function hiss(ft,f0,f1,q,dur,vol,delay,att){
      const a=A(); if(!a) return; const t=a.currentTime+(delay||0);
      const src=a.createBufferSource(); src.buffer=noise(); src.loop=true;
      const f=a.createBiquadFilter(); f.type=ft; f.Q.value=q; f.frequency.setValueAtTime(f0,t); if(f1) f.frequency.exponentialRampToValueAtTime(f1,t+dur);
      const g=a.createGain(); env(g,t,vol,att||0.01,dur);
      src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random()); src.stop(t+dur+0.05);
    }
    return {
      unlock(){ A(); },
      whistle(){ const a=A(); if(!a) return; const t=a.currentTime;
        const o=a.createOscillator(), lfo=a.createOscillator(), lg=a.createGain(), g=a.createGain();
        o.type="sine"; o.frequency.value=2750; lfo.frequency.value=32; lg.gain.value=180;
        lfo.connect(lg); lg.connect(o.frequency); env(g,t,0.13,0.02,0.42);
        o.connect(g); g.connect(master); o.start(t); lfo.start(t); o.stop(t+0.45); lfo.stop(t+0.45);
        hiss("bandpass",2750,null,6,0.4,0.05,0,0.02); },
      snap(){ tone("square",180,90,0.07,0.12); hiss("lowpass",900,null,1,0.06,0.15); },
      throwIt(lob){ hiss("bandpass",lob?600:1400,lob?1200:2600,2.5,lob?0.35:0.22,0.16); },
      toggle(lob){ tone("square",lob?660:880,null,0.05,0.05); },
      catchIt(){ tone("sine",170,65,0.14,0.55); hiss("lowpass",500,null,1,0.08,0.25); },
      bounce(){ [0,0.24,0.42,0.55].forEach((d,i)=>tone("sine",140-i*12,60,0.09,0.4*Math.pow(0.6,i),d)); },
      swat(){ hiss("bandpass",1800,700,1.5,0.12,0.4); tone("sine",200,90,0.08,0.3); },
      flag(){ hiss("highpass",2200,5000,0.8,0.18,0.35,0.005); tone("square",520,1040,0.08,0.06,0.02); },
      sackThud(){ tone("sine",95,38,0.28,0.7); hiss("lowpass",300,null,1,0.25,0.25); },
      cheer(big){ hiss("bandpass",1100,1500,0.6,big?1.8:1.0,big?0.3:0.16,0.05,big?0.25:0.15); hiss("bandpass",2400,2800,1.2,big?1.6:0.8,big?0.12:0.06,0.1,0.25); },
      groan(){ hiss("bandpass",520,260,1.2,1.1,0.22,0.05,0.2); },
      click(){ tone("square",440,null,0.03,0.05); }
    };
  })();
  ["pointerdown","keydown"].forEach(ev=>{ if(typeof window!=="undefined" && window.addEventListener) window.addEventListener(ev,()=>SFX.unlock(),{capture:true}); });
}

export { SFX };
