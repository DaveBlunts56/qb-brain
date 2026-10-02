import { emit } from "./config.js";

/* ============================================================
   STORE — everything QB Brain saves, per player.
   Each kind of data is one document {upd, data} (upd = last-changed time, used to merge with the cloud).
   Kinds: settings · plays (My Plays + audibles) · tutorial · profile (QB Profile reps) · progress (sessions, streak days, bests)
   Players: "local" is the no-account player on this device; cloud players come from a parent's account.
   Device-only flags (install tip, "new here" card) stay outside this and never sync.
============================================================ */

const KINDS = ["settings", "plays", "tutorial", "profile", "progress"];
const LEGACY = { settings: "qbbrain.settings.v1", tutorial: "qbbrain.tutorial.v1", profile: "qbbrain.profile.v1" };
const ACTIVE_KEY = "qbbrain.active", PLAYERS_KEY = "qbbrain.players";

function lsGet(k){ try{ return localStorage.getItem(k); }catch(_){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); return true; }catch(_){ return false; } }
function lsDel(k){ try{ localStorage.removeItem(k); }catch(_){} }
const docKey = (pid, kind) => "qbbrain.p." + pid + "." + kind;

// v1.9 and earlier kept one player's data under fixed keys: copy it into the "local" player once.
function migrateLegacy(){
  if(lsGet("qbbrain.migrated.v2")) return;
  const now = Date.now();
  Object.keys(LEGACY).forEach(kind => {
    const raw = lsGet(LEGACY[kind]); if(raw == null || lsGet(docKey("local", kind))) return;
    try{ lsSet(docKey("local", kind), JSON.stringify({ upd: now, data: JSON.parse(raw) })); }catch(_){}
  });
  const p = lsGet("qbbrain.myplays.v1"), a = lsGet("qbbrain.audibles.v1");
  if((p || a) && !lsGet(docKey("local", "plays"))){
    try{ lsSet(docKey("local", "plays"), JSON.stringify({ upd: now, data: { plays: JSON.parse(p || "[]"), audibles: JSON.parse(a || "{}"), gone: {} } })); }catch(_){}
  }
  lsSet("qbbrain.migrated.v2", "1");
}
/* ---- players ---- */
function players(){ try{ return JSON.parse(lsGet(PLAYERS_KEY) || "[]") || []; }catch(_){ return []; } }
function setPlayers(list){ lsSet(PLAYERS_KEY, JSON.stringify(list)); }
function activeId(){ const id = lsGet(ACTIVE_KEY) || "local"; return id === "local" || players().some(p => p.id === id) ? id : "local"; }
function activePlayer(){ const id = activeId(); return id === "local" ? { id: "local", nickname: "Guest", cloud: false } : Object.assign({ cloud: true }, players().find(p => p.id === id)); }
function setActive(id){ lsSet(ACTIVE_KEY, id); }
function forgetPlayer(id){ KINDS.forEach(k => lsDel(docKey(id, k))); setPlayers(players().filter(p => p.id !== id)); if(activeId() === id) setActive("local"); }

/* ---- documents ---- */
function getDoc(kind, pid){
  try{ const o = JSON.parse(lsGet(docKey(pid || activeId(), kind)) || "null"); return o && typeof o === "object" && "data" in o ? o : null; }catch(_){ return null; }
}
function load(kind, fallback){ const d = getDoc(kind); return d ? d.data : fallback; }
// app code calls save(); the cloud sync listens for "data:saved"
function save(kind, data){
  const cur = getDoc(kind);
  if(cur && JSON.stringify(cur.data) === JSON.stringify(data)) return true;   // nothing changed: keep the old time
  const ok = lsSet(docKey(activeId(), kind), JSON.stringify({ upd: Date.now(), data }));
  if(ok) emit("data:saved", kind);
  return ok;
}
// sync writes merged documents without re-triggering a push
function putDoc(kind, doc, pid){ lsSet(docKey(pid || activeId(), kind), JSON.stringify(doc)); }
function copyPlayer(from, to){ KINDS.forEach(k => { const d = getDoc(k, from); if(d) putDoc(k, d, to); }); }

export function init(){ migrateLegacy(); }
export { KINDS, players, setPlayers, activeId, activePlayer, setActive, forgetPlayer, getDoc, load, save, putDoc, copyPlayer, lsGet, lsSet };
