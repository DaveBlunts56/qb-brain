import { BANDS, account, addPlayer, configured, deleteAccount, exportData, fetchPlayers, nicknameProblem, removePlayer, resetPassword, signIn, signOut, signUp, signedIn, status, syncNow, updatePlayer } from "./cloud.js";
import { on } from "./config.js";
import { SCREENS, showScreen } from "./setup.js";
import { els } from "./state.js";
import { activePlayer, getDoc, players, setActive } from "./store.js";

/* ============================================================
   ACCOUNT UI — parent gate, sign in / create account, players, sync status, export, delete.
   Kids never type an email: a parent signs in once, then kids just pick their player.
============================================================ */

let gatePassed = false, gateThen = null, authMode = "signin", editing = null, delArm = 0;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function reloadApp(){ if(typeof location !== "undefined" && location.reload) location.reload(); }

/* ---- grown-ups gate (keeps young kids out of account settings) ---- */
function openGate(then){
  if(gatePassed){ then(); return; }
  gateThen = then;
  const a = 6 + Math.floor(Math.random() * 4), b = 6 + Math.floor(Math.random() * 4), ans = a * b;
  els.gateQ.textContent = "What is " + a + " × " + b + "?";
  const opts = [ans, ans + a, ans - b, ans + 10].sort(() => Math.random() - 0.5);
  els.gateOpts.innerHTML = "";
  opts.forEach(v => { const btn = document.createElement("button"); btn.type = "button"; btn.className = "film-opt"; btn.textContent = String(v);
    btn.addEventListener("click", () => { if(v === ans){ gatePassed = true; els.gateSheet.classList.add("hidden"); const t = gateThen; gateThen = null; if(t) t(); } else { els.gateMsg.textContent = "Not quite — ask a parent or guardian."; } });
    els.gateOpts.appendChild(btn); });
  els.gateMsg.textContent = "";
  els.gateSheet.classList.remove("hidden");
}
function openAccount(){ openGate(() => { showScreen("accountScreen"); }); }

/* ---- home: who's playing ---- */
function syncWord(){
  if(!configured()) return "";
  if(!signedIn()) return "Not signed in";
  if(!activePlayer().cloud) return "Guest — not synced";
  return { syncing: "Syncing…", ok: "Synced", offline: "Offline — will sync", error: "Sync problem", guest: "Guest — not synced", off: "" }[status.state] || "";
}
function renderPlayerBar(){
  els.playerBar.classList.toggle("hidden", !configured());     // no accounts on this copy: nothing to switch
  els.acctOpenBtn.classList.toggle("hidden", !configured());
  const p = activePlayer();
  els.playerName.textContent = p.cloud ? p.nickname : "GUEST";
  els.playerSync.textContent = configured() ? syncWord() : "Progress saved on this device";
  els.playerSync.className = "pb-sync " + (status.state === "ok" && p.cloud ? "ok" : status.state === "error" ? "bad" : "");
}
function openSwitcher(){
  const list = els.switchList; list.innerHTML = "";
  const cur = activePlayer().id;
  [{ id: "local", nickname: "Guest", band: null, sub: "This device only" }].concat(players()).forEach(p => {
    const b = document.createElement("button"); b.type = "button"; b.className = "switch-row" + (p.id === cur ? " on" : "");
    b.innerHTML = "<b>" + esc(p.nickname) + "</b><small>" + esc(p.sub || (p.band ? p.band + " · synced" : "Synced")) + "</small>" + (p.id === cur ? "<i>PLAYING</i>" : "");
    b.addEventListener("click", () => { els.switchSheet.classList.add("hidden"); if(p.id !== cur){ setActive(p.id); reloadApp(); } });
    list.appendChild(b);
  });
  els.switchManage.textContent = signedIn() ? "MANAGE PLAYERS (GROWN-UPS)" : "PARENTS: SIGN IN TO SYNC";
  els.switchManage.classList.toggle("hidden", !configured());
  els.switchSheet.classList.remove("hidden");
}

/* ---- account screen ---- */
function render(){
  const signed = signedIn();
  els.acctNotSet.classList.toggle("hidden", configured());
  els.acctOut.classList.toggle("hidden", !configured() || signed);
  els.acctIn.classList.toggle("hidden", !configured() || !signed);
  if(!configured()) return;
  if(!signed){ renderAuth(); return; }
  els.acctEmail.textContent = account().email || "";
  renderPlayers(); renderSync();
}
function renderAuth(){
  const create = authMode === "create";
  els.authTabs.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.k === authMode));
  els.authConsent.classList.toggle("hidden", !create);
  els.authPw.setAttribute("autocomplete", create ? "new-password" : "current-password");
  els.authGo.textContent = create ? "CREATE ACCOUNT" : "SIGN IN";
  els.authForgot.classList.toggle("hidden", create);
}
function renderPlayers(){
  const list = els.acctPlayers; list.innerHTML = "";
  const cur = activePlayer().id, ps = players();
  if(!ps.length){ const d = document.createElement("div"); d.className = "help"; d.textContent = "No players yet. Add one for each kid who plays (or yourself)."; list.appendChild(d); }
  ps.forEach(p => {
    const row = document.createElement("div"); row.className = "acct-player" + (p.id === cur ? " on" : "");
    row.innerHTML = "<div><b>" + esc(p.nickname) + "</b><small>" + (p.band ? esc(p.band) : "No age group") + (p.id === cur ? " · playing now" : "") + "</small></div>";
    const btns = document.createElement("div"); btns.className = "chip-row";
    if(p.id !== cur){ const go = document.createElement("button"); go.type = "button"; go.className = "chip"; go.textContent = "PLAY AS"; go.addEventListener("click", () => { setActive(p.id); reloadApp(); }); btns.appendChild(go); }
    const ed = document.createElement("button"); ed.type = "button"; ed.className = "chip"; ed.textContent = "EDIT"; ed.addEventListener("click", () => openPlayerForm(p)); btns.appendChild(ed);
    row.appendChild(btns); list.appendChild(row);
  });
  els.addPlayerBtn.classList.toggle("hidden", ps.length >= 8);
}
function renderSync(){
  const p = activePlayer();
  const t = status.at ? new Date(status.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  els.syncLine.textContent = !p.cloud ? "You're playing as Guest, which stays on this device. Pick a player to sync."
    : status.state === "ok" ? "Synced" + (t ? " at " + t : "") + " — " + p.nickname + "'s progress is backed up."
    : status.state === "syncing" ? "Syncing…" : status.state === "offline" ? "Offline. Progress is saved here and will sync when you're back online."
    : status.state === "error" ? "Sync problem: " + status.msg : "Not synced yet.";
}

/* ---- player form (add / edit) ---- */
function openPlayerForm(p){
  editing = p || null;
  els.pfTitle.textContent = p ? "EDIT PLAYER" : "ADD PLAYER";
  els.pfNick.value = p ? p.nickname : "";
  renderBands(p ? p.band : null);
  const localReps = ((getDoc("profile", "local") || {}).data || { recs: [] }).recs.length;
  const showBring = !p && !players().length && localReps > 0;
  els.pfBringRow.classList.toggle("hidden", !showBring);
  els.pfBring.checked = showBring;
  els.pfBringText.textContent = "Start with this device's progress (" + localReps + (localReps === 1 ? " rep" : " reps") + ", plus plays and lessons)";
  els.pfRemove.classList.toggle("hidden", !p); els.pfRemove.textContent = "REMOVE PLAYER"; delArm = 0;
  els.pfMsg.textContent = "";
  els.playerForm.classList.remove("hidden");
  setTimeout(() => { try{ els.pfNick.focus(); }catch(_){} }, 50);
}
let formBand = null;
function renderBands(sel){
  formBand = sel || null; els.pfBands.innerHTML = "";
  BANDS.forEach(b => { const c = document.createElement("button"); c.type = "button"; c.className = "chip" + (b === formBand ? " on" : ""); c.textContent = b;
    c.addEventListener("click", () => renderBands(formBand === b ? null : b)); els.pfBands.appendChild(c); });
}
async function savePlayerForm(){
  const prob = nicknameProblem(els.pfNick.value); if(prob){ els.pfMsg.textContent = prob; return; }
  busy(els.pfSave, true);
  try{
    if(editing){ await updatePlayer(editing.id, els.pfNick.value, formBand); }
    else {
      const row = await addPlayer(els.pfNick.value, formBand, els.pfBring.checked);
      if(players().length === 1 || els.pfBring.checked){ els.playerForm.classList.add("hidden"); setActive(row.id); reloadApp(); return; }
    }
    els.playerForm.classList.add("hidden"); render(); renderPlayerBar();
  }catch(e){ els.pfMsg.textContent = e.message; }
  busy(els.pfSave, false);
}
async function removeFromForm(){
  if(!editing) return;
  if(!delArm){ delArm = 1; els.pfRemove.textContent = "TAP AGAIN: DELETE " + editing.nickname.toUpperCase() + "'S PROGRESS FOR GOOD"; return; }
  const wasActive = activePlayer().id === editing.id;
  try{ await removePlayer(editing.id); els.playerForm.classList.add("hidden"); if(wasActive) reloadApp(); else { render(); renderPlayerBar(); } }
  catch(e){ els.pfMsg.textContent = e.message; }
}

/* ---- auth form ---- */
function busy(btn, on){ btn.disabled = on; btn.classList.toggle("busy", on); }
async function submitAuth(){
  const email = els.authEmail.value.trim(), pw = els.authPw.value;
  els.authMsg.textContent = "";
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ els.authMsg.textContent = "Enter the email address for the account."; return; }
  if(pw.length < 8){ els.authMsg.textContent = "Passwords are at least 8 characters."; return; }
  if(authMode === "create" && !els.authAgree.checked){ els.authMsg.textContent = "Please confirm you're a parent, guardian or coach — or 13 or older."; return; }
  busy(els.authGo, true);
  try{
    if(authMode === "create"){
      const r = await signUp(email, pw);
      if(r.confirm){ els.authMsg.textContent = "Almost done: check " + email + " for a confirmation link, then come back and sign in."; authMode = "signin"; renderAuth(); }
    } else await signIn(email, pw);
    els.authPw.value = "";
    render(); renderPlayerBar();
    if(signedIn() && !players().length) openPlayerForm(null);
  }catch(e){ els.authMsg.textContent = e.message; }
  busy(els.authGo, false);
}

export function init(){
  SCREENS.push("accountScreen");
  ["accountScreen","acctNotSet","acctOut","acctIn","acctEmail","acctPlayers","addPlayerBtn","syncLine","syncNowBtn","exportBtn","signOutBtn","deleteAcctBtn",
   "authTabs","authEmail","authPw","authConsent","authAgree","authGo","authForgot","authMsg",
   "gateSheet","gateQ","gateOpts","gateMsg","gateCancel","switchSheet","switchList","switchManage","switchClose","playerBar","playerName","playerSync","acctOpenBtn",
   "playerForm","pfTitle","pfNick","pfBands","pfBringRow","pfBring","pfBringText","pfSave","pfCancel","pfRemove","pfMsg"].forEach(id => { els[id] = $(id); });
  els.playerBar.addEventListener("click", openSwitcher);
  els.switchClose.addEventListener("click", () => els.switchSheet.classList.add("hidden"));
  els.switchManage.addEventListener("click", () => { els.switchSheet.classList.add("hidden"); openAccount(); });
  els.acctOpenBtn.addEventListener("click", openAccount);
  els.gateCancel.addEventListener("click", () => { els.gateSheet.classList.add("hidden"); gateThen = null; });
  els.authTabs.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { authMode = b.dataset.k; els.authMsg.textContent = ""; renderAuth(); }));
  els.authGo.addEventListener("click", submitAuth);
  els.authPw.addEventListener("keydown", e => { if(e.key === "Enter") submitAuth(); });
  els.authForgot.addEventListener("click", async () => {
    const email = els.authEmail.value.trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ els.authMsg.textContent = "Type your email above first, then tap Forgot password."; return; }
    try{ await resetPassword(email); els.authMsg.textContent = "If there's an account for " + email + ", a reset link is on its way."; }catch(e){ els.authMsg.textContent = e.message; }
  });
  els.addPlayerBtn.addEventListener("click", () => openPlayerForm(null));
  els.pfSave.addEventListener("click", savePlayerForm);
  els.pfCancel.addEventListener("click", () => els.playerForm.classList.add("hidden"));
  els.pfRemove.addEventListener("click", removeFromForm);
  els.syncNowBtn.addEventListener("click", async () => { busy(els.syncNowBtn, true); try{ await fetchPlayers(); }catch(_){} await syncNow(); busy(els.syncNowBtn, false); render(); });
  els.exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "qb-brain-data.json"; document.body.appendChild(a); a.click(); a.remove();
  });
  els.signOutBtn.addEventListener("click", async () => { const wasCloud = await signOut(); if(wasCloud) reloadApp(); else { render(); renderPlayerBar(); } });
  els.deleteAcctBtn.addEventListener("click", async () => {
    if(delArm !== 2){ delArm = 2; els.deleteAcctBtn.textContent = "TAP AGAIN: DELETE THE ACCOUNT AND ALL PLAYERS FOR GOOD"; return; }
    try{ await deleteAccount(); reloadApp(); }catch(e){ els.syncLine.textContent = e.message; }
  });
  on("screen", id => { if(id === "accountScreen"){ delArm = 0; els.deleteAcctBtn.textContent = "DELETE ACCOUNT"; render(); } if(id === "homeScreen") renderPlayerBar(); });
  on("cloud:status", () => { renderPlayerBar(); if(!els.accountScreen.classList.contains("hidden")) renderSync(); });
  on("cloud:changed", () => { renderPlayerBar(); if(!els.accountScreen.classList.contains("hidden")) render(); });
  renderPlayerBar();
}
export { openAccount, openGate, renderPlayerBar };
