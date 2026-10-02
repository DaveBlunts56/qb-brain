import { emit, on } from "./config.js";
import { mergeDocs, sameDoc } from "./merge.js";
import { KINDS, activePlayer, copyPlayer, forgetPlayer, getDoc, lsGet, lsSet, players, putDoc, setActive, setPlayers } from "./store.js";

/* ============================================================
   CLOUD — parent accounts + sync, talking to a Supabase project over its REST API (no SDK).
   Offline-first: the app always reads/writes the device copy (store.js); sync merges with the
   cloud copy in the background (merge.js). Nothing here runs unless cloud.config.json is filled in.
   Data model (see supabase/schema.sql):
     auth user = the parent/guardian (email + password)
     players   = kids under that account (nickname + optional age group — no emails, no real names needed)
     player_data = one row per player per kind {data, upd}
============================================================ */

/* ---- configuration (filled in at build time from cloud.config.json; tests can override) ---- */
function readConfig(){
  if(typeof window !== "undefined" && window.__QB_TEST__ && window.__QB_CLOUD__) return window.__QB_CLOUD__;
  // eslint-disable-next-line no-undef
  return typeof __QB_CLOUD__ !== "undefined" ? __QB_CLOUD__ : null;
}
let CFG = null;
function configured(){ return !!(CFG && CFG.url && CFG.anonKey); }

/* ---- session ---- */
const SESSION_KEY = "qbbrain.session";
let session = null;
function loadSession(){ try{ session = JSON.parse(lsGet(SESSION_KEY) || "null"); }catch(_){ session = null; } }
function setSession(r){
  session = { access_token: r.access_token, refresh_token: r.refresh_token,
    expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600),
    user: userOf(r.user) };
  lsSet(SESSION_KEY, JSON.stringify(session));
}
// the account's own details: id, email and the display name kept in Supabase user_metadata
function userOf(u){ u = u || {}; const md = u.user_metadata || {}; return { id: u.id, email: u.email, name: cleanName(md.display_name || "") }; }
function cleanName(s){ return String(s || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40); }
function clearSession(){ session = null; try{ localStorage.removeItem(SESSION_KEY); }catch(_){} }
function signedIn(){ return !!(session && session.access_token); }
function account(){ return session ? session.user : null; }

/* ---- HTTP ---- */
class CloudError extends Error { constructor(msg, status){ super(msg); this.status = status; } }
const FRIENDLY = [
  [/invalid login credentials/i, "That email and password don't match."],
  [/already registered|already exists/i, "There's already an account with that email — sign in instead."],
  [/email not confirmed/i, "Check your email and tap the confirmation link first."],
  [/password should be at least|weak password/i, "Use a password with at least 8 characters."],
  [/rate limit|too many/i, "Too many tries — wait a minute and try again."]
];
function friendly(msg, status){
  for(const [re, out] of FRIENDLY) if(re.test(msg || "")) return out;
  if(status >= 500) return "The server had a problem. Try again in a moment.";
  return msg || "Something went wrong (" + status + ").";
}
async function http(path, opts){
  opts = opts || {};
  if(!configured()) throw new CloudError("Cloud sync isn't set up.", 0);
  if(opts.auth !== false) await ensureFresh();
  const headers = { apikey: CFG.anonKey, "Content-Type": "application/json" };
  headers.Authorization = "Bearer " + (opts.auth !== false && session ? session.access_token : CFG.anonKey);
  if(opts.prefer) headers.Prefer = opts.prefer;
  let r;
  try{ r = await fetch(CFG.url.replace(/\/+$/, "") + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch(_){ throw new CloudError("Can't reach the server. Check your connection.", 0); }
  if(r.status === 401 && opts.auth !== false && session && !opts.retried){
    try{ await refresh(); }catch(_){ clearSession(); emit("cloud:changed"); throw new CloudError("Please sign in again.", 401); }
    return http(path, Object.assign({}, opts, { retried: true }));
  }
  const text = await r.text(); let json = null; try{ json = text ? JSON.parse(text) : null; }catch(_){}
  if(!r.ok) throw new CloudError(friendly(json && (json.msg || json.error_description || json.message || json.error), r.status), r.status);
  return json;
}
async function ensureFresh(){ if(session && session.expires_at - 60 < Date.now() / 1000) await refresh(); }
async function refresh(){
  if(!session || !session.refresh_token) throw new CloudError("Please sign in again.", 401);
  const r = await http("/auth/v1/token?grant_type=refresh_token", { method: "POST", auth: false, body: { refresh_token: session.refresh_token } });
  setSession(r);
}

/* ---- auth (the parent's account) ---- */
// where Supabase's emailed links (confirm account, reset password) send people back to
function returnUrl(){ try{ return location.href.split("#")[0].split("?")[0]; }catch(_){ return ""; } }
const back = () => returnUrl() ? "?redirect_to=" + encodeURIComponent(returnUrl()) : "";
async function signUp(email, password, name){
  const r = await http("/auth/v1/signup" + back(), { method: "POST", auth: false, body: { email, password, data: { display_name: cleanName(name) } } });
  if(r && r.access_token){ setSession(r); await afterSignIn(); return { signedIn: true }; }
  return { confirm: true };   // project requires email confirmation first
}
async function signIn(email, password){
  setSession(await http("/auth/v1/token?grant_type=password", { method: "POST", auth: false, body: { email, password } }));
  await afterSignIn();
}
async function afterSignIn(){ await fetchPlayers(); emit("cloud:changed"); }
async function resetPassword(email){ await http("/auth/v1/recover" + back(), { method: "POST", auth: false, body: { email } }); }
/* ---- account settings ---- */
async function updateUser(body){
  const u = await http("/auth/v1/user", { method: "PUT", body });
  if(session && u && u.id){ session.user = userOf(u); lsSet(SESSION_KEY, JSON.stringify(session)); }
  emit("cloud:changed");
  return u;
}
function setDisplayName(name){ return updateUser({ data: { display_name: cleanName(name) } }); }
function changePassword(pw){
  if(String(pw || "").length < 8) return Promise.reject(new CloudError("Use a password with at least 8 characters.", 0));
  return updateUser({ password: pw });
}
/* ---- coming back from an emailed link ----
   Supabase puts the result in the address after "#": access_token + refresh_token + type (signup | recovery | email_change | magiclink),
   or error_description when the link is used up or expired. We sign the person in, tidy the address bar,
   and for a password reset ask for the new password. */
let linkResult = null;
async function readAuthLink(){
  let h = ""; try{ h = location.hash || ""; }catch(_){}
  if(!/access_token=|error_description=/.test(h)) return null;
  const q = new URLSearchParams(h.replace(/^#/, ""));
  try{ history.replaceState(null, "", location.pathname + location.search); }catch(_){}
  if(q.get("error_description")){ linkResult = { error: q.get("error_description").replace(/\+/g, " ") }; return linkResult; }
  session = { access_token: q.get("access_token"), refresh_token: q.get("refresh_token"), expires_at: Math.floor(Date.now() / 1000) + (+q.get("expires_in") || 3600), user: {} };
  try{
    const u = await http("/auth/v1/user");
    setSession({ access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at, user: u });
  }catch(e){ clearSession(); linkResult = { error: e.message }; return linkResult; }
  linkResult = { type: q.get("type") || "signin" };
  return linkResult;
}
// signing out also removes the account's players from this device (shared family/team devices)
async function signOut(){
  try{ if(signedIn()) await http("/auth/v1/logout", { method: "POST" }); }catch(_){}
  const wasCloud = activePlayer().cloud;
  players().forEach(p => forgetPlayer(p.id)); setActive("local"); clearSession();
  emit("cloud:changed");
  return wasCloud;
}
async function deleteAccount(){
  await http("/rest/v1/rpc/delete_my_account", { method: "POST", body: {} });
  players().forEach(p => forgetPlayer(p.id)); setActive("local"); clearSession();
  emit("cloud:changed");
}

/* ---- players (kids under the account) ---- */
const BANDS = ["8U", "10U", "12U", "14U", "HS", "Adult"];
function cleanNickname(s){ return String(s || "").replace(/[^\p{L}\p{N} '\-_.]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16); }
function nicknameProblem(s){
  const n = cleanNickname(s);
  if(!n) return "Pick a nickname.";
  if(/\d{4,}/.test(n)) return "Leave numbers like phone numbers out of the nickname.";
  return null;
}
async function fetchPlayers(){
  const rows = await http("/rest/v1/players?select=id,nickname,band,created_at&order=created_at.asc");
  const list = (rows || []).map(r => ({ id: r.id, nickname: r.nickname, band: r.band || null }));
  const before = players();
  before.filter(p => !list.some(q => q.id === p.id)).forEach(p => forgetPlayer(p.id));   // removed on another device
  setPlayers(list);
  return list;
}
async function addPlayer(nickname, band, bringLocal){
  const rows = await http("/rest/v1/players", { method: "POST", prefer: "return=representation",
    body: { nickname: cleanNickname(nickname), band: BANDS.includes(band) ? band : null } });
  const row = rows && rows[0]; if(!row) throw new CloudError("Couldn't add the player.", 0);
  setPlayers(players().concat([{ id: row.id, nickname: row.nickname, band: row.band || null }]));
  if(bringLocal) copyPlayer("local", row.id);
  return row;
}
async function updatePlayer(id, nickname, band){
  await http("/rest/v1/players?id=eq." + encodeURIComponent(id), { method: "PATCH", prefer: "return=minimal",
    body: { nickname: cleanNickname(nickname), band: BANDS.includes(band) ? band : null } });
  setPlayers(players().map(p => p.id === id ? Object.assign({}, p, { nickname: cleanNickname(nickname), band: BANDS.includes(band) ? band : null }) : p));
}
async function removePlayer(id){
  await http("/rest/v1/players?id=eq." + encodeURIComponent(id), { method: "DELETE", prefer: "return=minimal" });
  forgetPlayer(id);
}

/* ---- sync ---- */
const status = { state: "off", at: 0, msg: "" };
function setStatus(state, msg){ status.state = state; status.msg = msg || ""; if(state === "ok") status.at = Date.now(); emit("cloud:status", status); }
let syncing = false, again = false, timer = null;
async function syncNow(){
  if(!configured() || !signedIn()){ setStatus("off"); return false; }
  const p = activePlayer();
  if(!p.cloud){ setStatus("guest"); return false; }
  if(syncing){ again = true; return false; }
  syncing = true; setStatus("syncing");
  try{
    const rows = await http("/rest/v1/player_data?player_id=eq." + encodeURIComponent(p.id) + "&select=kind,data,upd");
    const remote = {}; (rows || []).forEach(r => { remote[r.kind] = { upd: Number(r.upd) || 0, data: r.data }; });
    const changed = [], uploads = [];
    KINDS.forEach(kind => {
      const local = getDoc(kind), merged = mergeDocs(kind, local, remote[kind]);
      if(!merged) return;
      if(!local || !sameDoc(merged, local) || merged.upd !== local.upd){ putDoc(kind, merged); if(!sameDoc(merged, local)) changed.push(kind); }
      if(!remote[kind] || !sameDoc(merged, remote[kind]) || merged.upd !== remote[kind].upd)
        uploads.push({ player_id: p.id, kind, data: merged.data, upd: merged.upd });
    });
    if(uploads.length) await http("/rest/v1/player_data", { method: "POST", body: uploads, prefer: "resolution=merge-duplicates,return=minimal" });
    changed.forEach(k => emit("data:changed", k));
    setStatus("ok");
    return true;
  }catch(e){
    setStatus(e.status === 0 ? "offline" : "error", e.message);
    return false;
  }finally{
    syncing = false;
    if(again){ again = false; scheduleSync(400); }
  }
}
function scheduleSync(ms){ clearTimeout(timer); timer = setTimeout(syncNow, ms == null ? 2500 : ms); }

// one JSON file with everything this account has synced to this device (privacy: your data, your copy)
function exportData(){
  const out = { app: "QB Brain", exported: new Date().toISOString(), account: account() ? account().email : null, players: [] };
  const list = [{ id: "local", nickname: "Guest (this device only)" }].concat(players());
  list.forEach(p => { const docs = {}; KINDS.forEach(k => { const d = getDoc(k, p.id); if(d) docs[k] = d; }); if(Object.keys(docs).length) out.players.push({ nickname: p.nickname, band: p.band || null, data: docs }); });
  return out;
}

export function init(){
  CFG = readConfig();
  loadSession();
  if(!configured()) return;
  readAuthLink().then(r => {
    if(!r) return;
    if(r.error){ emit("cloud:link", r); return; }
    afterSignIn().catch(() => {}).then(() => { emit("cloud:link", r); syncNow(); });
  });
  on("data:saved", () => { if(signedIn() && activePlayer().cloud) scheduleSync(); });
  if(typeof window !== "undefined" && window.addEventListener){
    window.addEventListener("online", () => scheduleSync(0));
    if(typeof document !== "undefined" && document.addEventListener)
      document.addEventListener("visibilitychange", () => { if(document.visibilityState === "hidden" && signedIn()) syncNow(); });
  }
  if(signedIn()){
    const was = activePlayer().id;
    fetchPlayers().then(() => {
      if(was !== "local" && activePlayer().id === "local" && typeof location !== "undefined") location.reload();   // player was removed elsewhere
      emit("cloud:changed"); return syncNow();
    }).catch(e => setStatus(e.status === 0 ? "offline" : "error", e.message));
  }
}
export { configured, signedIn, account, signUp, setDisplayName, changePassword, cleanName, signIn, signOut, resetPassword, deleteAccount, BANDS, cleanNickname, nicknameProblem,
  fetchPlayers, addPlayer, updatePlayer, removePlayer, syncNow, scheduleSync, status, exportData, CloudError };
