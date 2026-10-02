import { emit, on } from "./config.js";
import { SCREENS, showScreen } from "./setup.js";
import { els } from "./state.js";
import { lsGet, lsSet } from "./store.js";

/* ============================================================
   QB BRAIN PRO — the one place that decides who has Pro, and the Upgrade screen.

   Who has Pro (has() below):
     · beta builds (package.json "channel": "beta"): everyone — testers get it all — unless
       "Preview as Free" is on in Settings, so the Free experience can be checked
     · otherwise: the signed-in account's row in the `entitlements` table (supabase/schema.sql).
       The app can only READ that row. It is written by the payment webhook on the server
       (supabase/functions/stripe-webhook), so nothing done in the app can grant Pro.
       Offline, the last answer is kept until the paid period ends (plus a 3-day grace).
   Buying: the Upgrade button asks the server for a checkout link (supabase/functions/create-checkout)
   and opens it. Until those functions are deployed and connected, the button says so — it never fakes a purchase.
============================================================ */

const FEATURES = {
  elite:     { name: "Elite difficulty",        sub: "A real speed rusher, frequent disguises, 2.5s to study" },
  film:      { name: "Film Room",               sub: "Read the look, name the key, pick the read, then see the post-snap rotation" },
  adaptive:  { name: "Adaptive training",       sub: "Every rep built from your profile: more of what you miss" },
  drills:    { name: "Targeted drills",         sub: "One-tap drills for your weakest coverages, concepts and habits" },
  analytics: { name: "Full QB Profile",         sub: "Coach's diagnosis, success by coverage, rotations and concepts" },
  history:   { name: "Full progress history",   sub: "Every session on your score chart, not just the last 10" }
};
const FREE_LIST = ["All modes on Rookie and Varsity", "5v5 and 7v7", "Full Drive", "Tutorial and Coach's Manual", "Create a Play and share codes", "QB Dashboard, rank and streaks", "Share your score"];
// Prices shown on the Upgrade screen. Set these to match the prices in your payment provider.
const PLANS = [
  { key: "yearly",  name: "YEARLY",  price: "$29.99", per: "/year",  note: "Best value — about $2.50 a month" },
  { key: "monthly", name: "MONTHLY", price: "$4.99",  per: "/month", note: "Cancel any time" }
];

// eslint-disable-next-line no-undef
const CHANNEL = typeof __QB_CHANNEL__ !== "undefined" ? __QB_CHANNEL__ : "stable";
const BETA = CHANNEL === "beta";
const ENT_KEY = "qbbrain.entitlement", PREVIEW_KEY = "qbbrain.previewFree";
const GRACE = 3 * 864e5;

let ent;                 // {plan, status, current_period_end, checked} — read from the device on first use
let checkout = { ready: false, signedIn: false };   // filled in by cloud.js when accounts are on
let focus = null;        // which feature sent the player to the Upgrade screen

function loadEnt(){ try{ ent = JSON.parse(lsGet(ENT_KEY) || "null"); }catch(_){ ent = null; } }
function previewFree(){ return BETA && lsGet(PREVIEW_KEY) === "1"; }
function curEnt(){ if(ent === undefined) loadEnt(); return ent; }
function entActive(e){
  if(!e || e.plan !== "pro" || !["active", "trialing", "past_due"].includes(e.status)) return false;
  if(!e.current_period_end) return true;
  return new Date(e.current_period_end).getTime() + GRACE > Date.now();
}
function isPro(){ return BETA ? !previewFree() : entActive(curEnt()); }
function has(feature){ return isPro() || !FEATURES[feature]; }
function proSource(){ return BETA ? (previewFree() ? "preview-free" : "beta") : entActive(curEnt()) ? "subscription" : "free"; }

// gate an action: run it with Pro, otherwise show the Upgrade screen for that feature
function requirePro(feature, then){ if(has(feature)){ then && then(); return true; } openUpgrade(feature); return false; }
function proTag(){ return '<i class="pro-tag" aria-label="Pro feature">PRO</i>'; }

/* ---- Upgrade screen ---- */
let backTo = "homeScreen";
function openUpgrade(feature){
  focus = feature || null;
  const cur = document.querySelector(".screen:not(.hidden)");
  backTo = cur && cur.id !== "upgradeScreen" ? cur.id : "homeScreen";
  showScreen("upgradeScreen");
}
function renderUpgrade(){
  const pro = isPro(), src = proSource();
  els.upHead.textContent = focus && !pro ? FEATURES[focus].name + " is part of QB Brain Pro." : pro ? "You have QB Brain Pro." : "Train like a starter.";
  const list = els.upPro; list.innerHTML = "";
  Object.keys(FEATURES).forEach(k => {
    const li = document.createElement("li"); li.className = k === focus ? "focus" : "";
    li.innerHTML = "<b></b><span></span>"; li.firstChild.textContent = FEATURES[k].name; li.lastChild.textContent = FEATURES[k].sub; list.appendChild(li);
  });
  const fl = els.upFree; fl.innerHTML = "";
  FREE_LIST.forEach(t => { const li = document.createElement("li"); li.textContent = t; fl.appendChild(li); });
  const plans = els.upPlans; plans.innerHTML = "";
  PLANS.forEach((p, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "plan" + (i === 0 ? " on" : ""); b.dataset.k = p.key;
    b.innerHTML = "<small></small><b></b><span></span><em></em>";
    b.children[0].textContent = p.name; b.children[1].textContent = p.price; b.children[2].textContent = p.per; b.children[3].textContent = p.note;
    b.addEventListener("click", () => { plans.querySelectorAll(".plan").forEach(x => x.classList.toggle("on", x === b)); });
    plans.appendChild(b);
  });
  els.upPlans.classList.toggle("hidden", pro);
  els.upBuy.classList.toggle("hidden", pro);
  els.upStatus.textContent =
    src === "beta" ? "BETA TESTER: every Pro feature is unlocked in this build. Turn on \"Preview as Free\" in Settings to see what Free players get."
    : src === "preview-free" ? "Previewing the Free version (beta). Turn \"Preview as Free\" off in Settings to unlock everything again."
    : src === "subscription" ? "Pro is active on this account" + (ent && ent.current_period_end ? " — renews or ends " + new Date(ent.current_period_end).toLocaleDateString() : "") + "."
    : "";
  els.upMsg.textContent = "";
  els.upRestore.classList.toggle("hidden", BETA || !checkout.ready);
}
function selectedPlan(){ const b = els.upPlans.querySelector(".plan.on"); return b ? b.dataset.k : PLANS[0].key; }
function buy(){
  els.upMsg.textContent = "";
  if(BETA){ els.upMsg.textContent = "This is the beta build, so there's nothing to buy — Pro is already on for testers."; return; }
  if(!checkout.ready){ els.upMsg.textContent = "Checkout isn't connected in this version of QB Brain yet. Nothing has been charged."; return; }
  if(!checkout.signedIn){ els.upMsg.textContent = "A parent or guardian needs to sign in first (Settings → Account), so Pro is tied to the account and works on every device."; emit("account:open"); return; }
  emit("pro:checkout", { plan: selectedPlan(), returnTo: "upgrade" });   // cloud.js asks the server for a checkout link (after the grown-ups check)
  els.upMsg.textContent = "Opening secure checkout…";
}

/* ---- PRO tags on gated controls ---- */
function markGated(){
  document.querySelectorAll("[data-pro]").forEach(el => {
    el.classList.toggle("is-locked", !has(el.dataset.pro));
    if(!el.querySelector(".pro-tag")) el.insertAdjacentHTML("beforeend", proTag());
  });
  if(els.proLink){ const pro = isPro(); els.proLink.classList.toggle("on", pro);
    els.proLinkText.textContent = pro ? (BETA ? "PRO UNLOCKED · BETA" : "QB BRAIN PRO · ACTIVE") : "GO PRO · ADVANCED TRAINING"; }
  if(els.previewFreeSwitch) els.previewFreeSwitch.classList.toggle("on", previewFree());
}
function setEntitlement(e){
  const before = isPro();
  ent = e ? Object.assign({}, e, { checked: Date.now() }) : { plan: "free", status: "inactive", checked: Date.now() };
  lsSet(ENT_KEY, JSON.stringify(ent));
  if(before !== isPro()) emit("pro:changed", isPro());
  markGated();
}
function flipPreview(){
  lsSet(PREVIEW_KEY, previewFree() ? "0" : "1");
  emit("pro:changed", isPro()); markGated();
}

export function init(){
  SCREENS.push("upgradeScreen");
  ["upgradeScreen", "upHead", "upPro", "upFree", "upPlans", "upBuy", "upRestore", "upStatus", "upMsg", "upBack", "proLink", "proLinkText", "previewFreeRow", "previewFreeSwitch"].forEach(id => { els[id] = document.getElementById(id); });
  curEnt();
  els.upBuy.addEventListener("click", buy);
  els.upRestore.addEventListener("click", () => { els.upMsg.textContent = "Checking your account…"; emit("pro:refresh"); });
  els.upBack.addEventListener("click", () => showScreen(backTo));
  if(els.proLink) els.proLink.addEventListener("click", () => openUpgrade(null));
  if(els.previewFreeRow){
    els.previewFreeRow.classList.toggle("hidden", !BETA);
    els.previewFreeSwitch.addEventListener("click", flipPreview);
    els.previewFreeSwitch.addEventListener("keydown", e => { if(e.key === " " || e.key === "Enter"){ e.preventDefault(); flipPreview(); } });
  }
  on("screen", id => { if(id === "upgradeScreen") renderUpgrade(); else focus = null; markGated(); });
  on("setup", markGated);
  // from cloud.js (accounts builds): who is signed in, whether checkout exists, and the account's entitlement
  on("pro:entitlement", setEntitlement);
  on("pro:checkout-state", s => { checkout = Object.assign(checkout, s); if(!els.upgradeScreen.classList.contains("hidden")) renderUpgrade(); });
  on("pro:checkout-error", msg => { els.upMsg.textContent = msg; });
  on("pro:returned", how => { openUpgrade(null); els.upMsg.textContent = how === "success" ? "Thanks! Confirming your payment…" : "Checkout cancelled — nothing was charged."; });
  on("pro:refreshed", () => { if(!els.upgradeScreen.classList.contains("hidden")){ renderUpgrade(); els.upMsg.textContent = isPro() ? "Pro is active." : "No Pro subscription found on this account."; } });
  markGated();
}
export { FEATURES, PLANS, BETA, isPro, has, requirePro, openUpgrade, proTag, proSource, markGated, setEntitlement, entActive };
