import { on } from "./config.js";

/* ============================================================
   MENU BACKGROUND — a pixel-art stadium behind every menu screen.
   Drawn once per screen size at low resolution and scaled up with crisp pixels:
   bright blue sky with pixel clouds, blurred stands and light towers in the distance,
   a striped green field running to the horizon (soft far away, sharp up close).
   Hidden while a play is running — the game field has its own look.
============================================================ */

let canvas = null, lastKey = "";

// fixed seed so the scene looks the same every visit
function rng(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function hex(c){ const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function paint(W, H){
  const px = new Float32Array(W * H * 3);
  const set = (x, y, c) => { if(x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
  const rect = (x, y, w, h, c) => { for(let j = 0; j < h; j++) for(let i = 0; i < w; i++) set(x + i, y + j, c); };
  const R = rng(20261001);
  const horizon = Math.round(H * 0.42);

  // ---- sky: bands of blue with dithered edges (no smooth gradients — it's pixel art)
  const SKY = ["#1b6fe0", "#2584f0", "#3299fb", "#45adff", "#5cbeff", "#78cdff", "#98dcff"].map(hex);
  const band = horizon / SKY.length;
  for(let y = 0; y < horizon; y++){
    const f = y / band, k = Math.min(SKY.length - 1, Math.floor(f)), frac = f - k;
    for(let x = 0; x < W; x++){
      const next = Math.min(SKY.length - 1, k + 1);
      const dither = frac > 0.75 && ((x + y) & 1) === 0;   // checkerboard into the next band
      set(x, y, dither ? SKY[next] : SKY[k]);
    }
  }
  // ---- clouds
  const WHITE = hex("#ffffff"), SHADE = hex("#d4ecff");
  const cloudCount = Math.max(3, Math.round(W / 45));
  for(let c = 0; c < cloudCount; c++){
    const cx = Math.round(R() * W), cy = Math.round(horizon * (0.12 + R() * 0.5)), w = Math.round(14 + R() * 22);
    const puffs = 3 + Math.floor(R() * 3);
    for(let p = 0; p < puffs; p++){
      const px0 = cx + Math.round((p - puffs / 2) * w / puffs), r = Math.round(3 + R() * (w / 4));
      for(let yy = -r; yy <= r; yy++) for(let xx = -r * 1.6; xx <= r * 1.6; xx++){
        if((xx / 1.6) * (xx / 1.6) + yy * yy <= r * r) set(Math.round(px0 + xx), cy + yy, yy > r * 0.35 ? SHADE : WHITE);
      }
    }
    rect(cx - Math.round(w * 0.7), cy + 1, Math.round(w * 1.4), 2, SHADE);   // flat cloud bottom
  }
  // ---- stands across the horizon (these get blurred)
  const standTop = Math.round(horizon - H * 0.085);
  const STAND = hex("#43506a"), STAND2 = hex("#56647f"), ROOF = hex("#2b3346");
  const CROWD = ["#e8412c", "#ffc933", "#f4f0e2", "#5ab8ff", "#2a6fd6", "#9e1b12", "#1f2a3c"].map(hex);
  rect(0, standTop - 2, W, 2, ROOF);
  for(let y = standTop; y < horizon; y++){
    const tier = Math.floor((y - standTop) / 3);
    for(let x = 0; x < W; x++){
      const base = tier % 2 ? STAND : STAND2;
      set(x, y, R() < 0.55 ? CROWD[Math.floor(R() * CROWD.length)] : base);
    }
  }
  // light towers
  const POLE = hex("#3a4152"), LAMP = hex("#fff6c8"), LAMPF = hex("#cfd6e3");
  [0.12, 0.88].forEach(t => {
    const x = Math.round(W * t), top = Math.round(standTop - H * 0.12);
    rect(x, top + 4, 1, standTop - top - 4, POLE);
    rect(x - 4, top, 9, 4, LAMPF);
    for(let i = 0; i < 4; i++) set(x - 3 + i * 2, top + 1, LAMP), set(x - 3 + i * 2, top + 2, LAMP);
  });

  // ---- field in perspective: mowing stripes, yard lines, sidelines, hashes
  const G1 = hex("#3f9a3a"), G2 = hex("#4fb047"), OUT = hex("#2f7a2e"), LINE = hex("#f4f0e2"), POST = hex("#ffc933");
  const depth = y => 60 / (y - horizon + 0.6);                      // world distance shown by row y
  const halfW = y => (y - horizon + 1) * (W * 0.62) / (H - horizon); // sideline spread
  for(let y = horizon; y < H; y++){
    const d = depth(y), dPrev = y > horizon ? depth(y - 1) : 1e9;
    const stripe = Math.floor(d / 1.5) % 2;
    const isLine = Math.floor(d / 3) !== Math.floor(dPrev / 3) && y > horizon + 1;
    const cx = W / 2, hw = halfW(y);
    for(let x = 0; x < W; x++){
      const off = Math.abs(x - cx);
      let c;
      if(off > hw + 0.5) c = OUT;
      else if(off > hw - 0.6) c = LINE;                                  // sideline
      else if(isLine) c = LINE;                                          // yard line
      else if(Math.abs(off - hw * 0.3) < 0.5 && Math.floor(d * 2) % 2 === 0) c = LINE; // hash marks
      else c = stripe ? G1 : G2;
      // near rows are a touch brighter (sun on the turf)
      const lit = Math.min(0.12, (y - horizon) / (H - horizon) * 0.12);
      set(x, y, mix(c, [255, 255, 230], lit));
    }
  }
  // goalpost at the far end
  const gp = Math.round(W / 2), gy = horizon + 1;
  rect(gp, gy - 7, 1, 7, POST); rect(gp - 4, gy - 7, 9, 1, POST); rect(gp - 4, gy - 13, 1, 6, POST); rect(gp + 4, gy - 13, 1, 6, POST);

  // ---- depth of field: blur the sky and stands, fade to sharp across the far field
  const blurred = boxBlur(boxBlur(px, W, H, 1), W, H, 1);
  const sharpFrom = horizon + Math.round((H - horizon) * 0.22);
  const HAZE = hex("#bfe6ff");
  for(let y = 0; y < H; y++){
    const b = y < horizon ? 1 : y >= sharpFrom ? 0 : 1 - (y - horizon) / (sharpFrom - horizon);
    const haze = y < horizon ? Math.max(0, 1 - (horizon - y) / (H * 0.12)) * 0.35 : b * 0.25;
    const vignette = y > H * 0.7 ? (y - H * 0.7) / (H * 0.3) * 0.28 : 0;   // darker at the bottom so menus read
    for(let x = 0; x < W; x++){
      const i = (y * W + x) * 3;
      let c = [px[i] + (blurred[i] - px[i]) * b, px[i + 1] + (blurred[i + 1] - px[i + 1]) * b, px[i + 2] + (blurred[i + 2] - px[i + 2]) * b];
      if(haze) c = mix(c, HAZE, haze);
      if(vignette) c = mix(c, [0, 0, 0], vignette);
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    }
  }
  return px;
}
function boxBlur(src, W, H, r){
  const out = new Float32Array(src.length), tmp = new Float32Array(src.length);
  for(let y = 0; y < H; y++) for(let x = 0; x < W; x++) for(let ch = 0; ch < 3; ch++){
    let s = 0, n = 0; for(let k = -r; k <= r; k++){ const xx = x + k; if(xx >= 0 && xx < W){ s += src[(y * W + xx) * 3 + ch]; n++; } }
    tmp[(y * W + x) * 3 + ch] = s / n;
  }
  for(let y = 0; y < H; y++) for(let x = 0; x < W; x++) for(let ch = 0; ch < 3; ch++){
    let s = 0, n = 0; for(let k = -r; k <= r; k++){ const yy = y + k; if(yy >= 0 && yy < H){ s += tmp[(yy * W + x) * 3 + ch]; n++; } }
    out[(y * W + x) * 3 + ch] = s / n;
  }
  return out;
}

// the backdrop is decoration: if anything about drawing it fails, the menus just keep their plain background
function draw(){ try{ drawScene(); }catch(_){} }
function drawScene(){
  if(!canvas || !canvas.getContext) return;
  const vw = window.innerWidth || 390, vh = window.innerHeight || 844;
  const scale = Math.max(3, Math.min(6, Math.round(Math.min(vw, vh) / 120)));   // ~3–4 screen px per art pixel on phones
  const W = Math.ceil(vw / scale), H = Math.ceil(vh / scale), key = W + "x" + H;
  if(key === lastKey) return;
  lastKey = key;
  const g = canvas.getContext("2d"); if(!g || !g.createImageData) return;
  canvas.width = W; canvas.height = H;
  const img = g.createImageData(W, H); if(!img || !img.data) return;
  const px = paint(W, H);
  for(let i = 0, j = 0; i < W * H; i++, j += 3){ img.data[i * 4] = px[j]; img.data[i * 4 + 1] = px[j + 1]; img.data[i * 4 + 2] = px[j + 2]; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
}

export function init(){
  canvas = document.getElementById("menuBg");
  if(!canvas) return;
  draw();
  let t = null;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(draw, 120); });
  on("screen", id => { canvas.classList.toggle("off", id === "gameScreen"); if(id !== "gameScreen") draw(); });
}
const drawMenuBackground = draw, paintStadium = paint;
export { drawMenuBackground, paintStadium };
