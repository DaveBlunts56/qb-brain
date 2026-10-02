import { emit } from "./config.js";
import { diffLabel, modeLabel, rankBadge } from "./dashboard.js";
import { paintStadium } from "./menubg.js";
import { lastResult } from "./progress.js";
import { MIN_REPS } from "./score.js";
import { els } from "./state.js";
import { activePlayer } from "./store.js";

/* ============================================================
   RESULTS — the QB Brain Score at the top of the session summary, and a Share Result image
   (1080×1920, phone-vertical) for messages and stories. The image is drawn here on a canvas,
   with the same pixel stadium as the menus, so a shared score looks like QB Brain and says where to get it.
============================================================ */

const APP_URL = "daveblunts56.github.io/qb-brain";
const $ = id => document.getElementById(id);
function appUrl(){ try{ if(/^https?:$/.test(location.protocol) && !/localhost|127\.0\.0\.1/.test(location.hostname)) return (location.host + location.pathname).replace(/\/(index\.html)?$/, ""); }catch(_){} return APP_URL; }

/* ---- the stat lines a result shows: only what this session actually measured ---- */
function statLines(s){
  const out = [];
  if(s.cov != null) out.push(["Coverage Recognition", s.cov + "%"]);
  if(s.pressN) out.push(["Under Pressure", s.press + "%"]);
  if(s.spd != null) out.push(["Decision Speed", s.spd.toFixed(2) + "s"]);
  if(s.read != null) out.push(["Read Accuracy", s.read + "%"]);
  return out;
}
function badges(r){
  const out = [], b = r.rankBefore, a = r.rankAfter;
  if(a.rank && (!b.rank || a.index > b.index)) out.push({ t: b.rank ? "RANK UP: " + a.rank.name : "RANKED: " + a.rank.name, hot: true });
  if(r.records.includes("score")) out.push({ t: "NEW BEST SCORE", hot: true });
  if(r.records.includes("cov")) out.push({ t: "BEST COVERAGE ID", hot: true });
  if(r.records.includes("spd")) out.push({ t: "QUICKEST RELEASE", hot: true });
  if(r.records.includes("drive")) out.push({ t: "LONGEST DRIVE", hot: true });
  if(r.streak.current > 1 && r.streak.current > (r.streakBefore || 0)) out.push({ t: r.streak.current + "-DAY STREAK", hot: false });
  return out;
}

/* ---- on the summary screen (built from elements, no innerHTML lookups) ---- */
function el(tag, cls, text){ const e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }
function renderResultCard(){
  const box = els.resultCard; if(!box) return;
  const r = lastResult();
  if(!r || !r.session){ box.classList.add("hidden"); return; }
  box.classList.remove("hidden"); box.innerHTML = "";
  const s = r.session, a = r.rankAfter;
  if(s.sc == null){
    const none = el("div", "rc-none");
    none.append(el("b", null, "QB BRAIN SCORE"), el("span", null, "Sessions need " + MIN_REPS + "+ reps for a score — this one had " + s.n + ". Keep going next time and it counts toward your rank and streak."));
    box.appendChild(none); return;
  }
  const top = el("div", "rc-top"), sc = el("div", "rc-score"), rk = el("div", "rc-rank"), badge = el("span", "rc-badge");
  badge.innerHTML = rankBadge(a.rank ? a.index : null, 4);
  sc.append(el("small", null, "QB BRAIN SCORE"), el("b", null, String(s.sc)));
  rk.append(badge, el("small", null, a.rank ? "RANK" : a.toGo + " MORE TO RANK"), el("b", null, a.rank ? a.rank.name : "UNRANKED"));
  top.append(sc, rk);
  const st = el("div", "rc-stats");
  statLines(s).forEach(([k, v]) => { const d = el("div"); d.append(el("span", null, k), el("b", null, v)); st.appendChild(d); });
  const ch = el("div", "rc-chips");
  badges(r).forEach(x => ch.appendChild(el("span", "streak-chip" + (x.hot ? " on" : ""), x.t)));
  const btn = el("button", "btn rc-share", "SHARE RESULT"); btn.type = "button"; btn.id = "shareBtn";
  btn.addEventListener("click", () => openShareCard(r));
  box.append(top, st, ch, btn);
}

/* ---- the share image ---- */
function svgImage(svg){ return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }); }
function outlined(g, text, x, y, fill, w){
  g.lineJoin = "miter"; g.lineWidth = w || 12; g.strokeStyle = "#000"; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y);
}
async function drawCard(r){
  const W = 1080, H = 1920, s = r.session, a = r.rankAfter;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"); if(!g) return null;
  try{ if(document.fonts && document.fonts.load) await Promise.all([document.fonts.load('100px "Jersey 10"'), document.fonts.load('40px "Pixelify Sans"')]); }catch(_){}
  // background: the menu stadium at 1 art-pixel = 6 px
  const aw = 180, ah = 320, px = paintStadium(aw, ah), small = document.createElement("canvas"); small.width = aw; small.height = ah;
  const sg = small.getContext("2d"), img = sg.createImageData(aw, ah);
  for(let i = 0, j = 0; i < aw * ah; i++, j += 3){ img.data[i * 4] = px[j]; img.data[i * 4 + 1] = px[j + 1]; img.data[i * 4 + 2] = px[j + 2]; img.data[i * 4 + 3] = 255; }
  sg.putImageData(img, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(small, 0, 0, W, H);
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  // logo
  g.font = '200px "Jersey 10", "Pixelify Sans", sans-serif';
  const qbw = g.measureText("QB ").width, brw = g.measureText("BRAIN").width, lx = W / 2 - (qbw + brw) / 2;
  g.textAlign = "left"; outlined(g, "QB", lx + 8, 262, "#000", 0); outlined(g, "QB", lx, 254, "#fff", 14);
  outlined(g, "BRAIN", lx + qbw + 8, 262, "#000", 0); outlined(g, "BRAIN", lx + qbw, 254, "#ffc933", 14);
  g.textAlign = "center"; g.font = '40px "Pixelify Sans", sans-serif';
  g.fillStyle = "rgba(13,17,23,.85)"; const sub = "FLAG FOOTBALL READ TRAINER", sw = g.measureText(sub).width + 40; g.fillRect(W / 2 - sw / 2, 296, sw, 62);
  g.fillStyle = "#f4f0e2"; g.fillText(sub, W / 2, 342);
  // panel: sized to the stats this session measured, centred in the space between logo and footer
  const lines = statLines(s).slice(0, 4);
  const pw = W - 140, ph = 760 + lines.length * 118, px0 = 70, py0 = Math.round(400 + (H - 250 - 400 - ph) / 2);
  g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(px0, py0 + 14, pw, ph);
  g.fillStyle = "rgba(13,17,23,.93)"; g.fillRect(px0, py0, pw, ph);
  g.lineWidth = 9; g.strokeStyle = "#000"; g.strokeRect(px0 + 4.5, py0 + 4.5, pw - 9, ph - 9);
  g.font = '64px "Jersey 10", sans-serif'; g.fillStyle = "#ffc933"; g.fillText("QB BRAIN SCORE", W / 2, py0 + 110);
  g.font = '330px "Jersey 10", sans-serif'; outlined(g, String(s.sc), W / 2 + 10, py0 + 400, "#000", 0); g.fillStyle = "#ffc933"; g.fillText(String(s.sc), W / 2, py0 + 390);
  // rank
  const badge = await svgImage(rankBadge(a.rank ? a.index : null, 9));
  const rankName = a.rank ? a.rank.name : "UNRANKED";
  g.font = '86px "Jersey 10", sans-serif'; const rw = g.measureText(rankName).width, bw = badge ? 108 : 0, gap = badge ? 26 : 0;
  const rx = W / 2 - (rw + bw + gap) / 2;
  if(badge) g.drawImage(badge, rx, py0 + 440, 108, 99);
  g.textAlign = "left"; g.fillStyle = "#fff"; g.fillText(rankName, rx + bw + gap, py0 + 518);
  g.textAlign = "center"; g.font = '34px "Pixelify Sans", sans-serif'; g.fillStyle = "#a9b2a1"; g.fillText("RANK", W / 2, py0 + 590);
  // stats
  let y = py0 + 690;
  lines.forEach(([k, v]) => {
    g.fillStyle = "#161c26"; g.fillRect(px0 + 50, y - 66, pw - 100, 100);
    g.textAlign = "left"; g.font = '44px "Pixelify Sans", sans-serif'; g.fillStyle = "#f4f0e2"; g.fillText(k, px0 + 84, y);
    g.textAlign = "right"; g.font = '78px "Jersey 10", sans-serif'; g.fillStyle = "#ffc933"; g.fillText(v, px0 + pw - 84, y + 4);
    y += 118;
  });
  // what it was
  const who = activePlayer().cloud ? activePlayer().nickname.toUpperCase() + " · " : "";
  const what = who + (s.plan || modeLabel(s.m)).toUpperCase() + " · " + s.sq + "V" + s.sq + " · " + diffLabel(s.d).toUpperCase() + " · " + s.n + " REPS";
  g.textAlign = "center"; g.font = '34px "Pixelify Sans", sans-serif'; g.fillStyle = "#a9b2a1";
  g.fillText(what, W / 2, py0 + ph - 60, pw - 80);
  // footer
  g.fillStyle = "rgba(13,17,23,.88)"; g.fillRect(0, H - 250, W, 250);
  g.fillStyle = "#ffc933"; g.fillRect(0, H - 250, W, 8);
  g.font = '58px "Jersey 10", sans-serif'; g.fillStyle = "#fff"; g.fillText("CAN YOU READ THE DEFENSE?", W / 2, H - 150);
  g.font = '40px "Pixelify Sans", sans-serif'; g.fillStyle = "#5ab8ff"; g.fillText(appUrl(), W / 2, H - 82);
  return c;
}
let cardBlob = null, cardUrl = null;
async function openShareCard(r){
  els.shareSheet.classList.remove("hidden"); els.shareMsg.textContent = "Making your card…"; els.shareImg.removeAttribute("src");
  const c = await drawCard(r);
  if(!c){ els.shareMsg.textContent = "Couldn't draw the card on this device."; return; }
  cardBlob = await new Promise(res => c.toBlob(res, "image/png"));
  if(cardUrl) URL.revokeObjectURL(cardUrl);
  cardUrl = URL.createObjectURL(cardBlob); els.shareImg.src = cardUrl;
  const file = typeof File === "function" ? new File([cardBlob], "qb-brain-score.png", { type: "image/png" }) : null;
  const canFiles = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  els.shareGo.textContent = canFiles ? "SHARE" : "SAVE IMAGE";
  els.shareMsg.textContent = canFiles ? "" : "Saves the picture. On iPhone you can also press and hold the card.";
  els.shareGo.onclick = async () => {
    if(canFiles){
      try{ await navigator.share({ files: [file], title: "My QB Brain Score", text: "QB Brain Score: " + r.session.sc + " — can you read the defense? " + "https://" + appUrl() + "/" }); emit("share:done", "share"); }
      catch(e){ if(e && e.name !== "AbortError") els.shareMsg.textContent = "Sharing didn't work here — use SAVE IMAGE instead."; }
      return;
    }
    const a = document.createElement("a"); a.href = cardUrl; a.download = "qb-brain-score.png"; document.body.appendChild(a); a.click(); a.remove(); emit("share:done", "download");
  };
}

export function init(){
  ["resultCard", "shareSheet", "shareImg", "shareGo", "shareClose", "shareMsg"].forEach(id => { els[id] = $(id); });
  if(els.shareClose) els.shareClose.addEventListener("click", () => els.shareSheet.classList.add("hidden"));
}
export { renderResultCard, drawCard, openShareCard, statLines };
