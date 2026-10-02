// Test-only handles for the automated test suite (tests/). Installed only when the page sets
// window.__QB_TEST__ before the app loads, so the shipped app exposes nothing extra.
import { state } from "./state.js";
import { BOOKS } from "./plays.js";
import { buildRep, playerById } from "./rep.js";
import { holderAt, stepPlayers, livePos, passerPos, passerIdAt } from "./rep.js";
import { posAt } from "./paths.js";
import { updateDefenders, updateRusher, isSacked, nearestDefender } from "./defense.js";
import { releaseBall, flightTime } from "./input.js";
import { dist } from "./config.js";
import { toPx } from "./canvas.js";
import { FILM } from "./film.js";
import { setupKeyRead, analyzeKeyRead, keyPlanText, findKeyPair } from "./keyread.js";
import { recordDefHist } from "./coach.js";
import { MANUAL, LESSONS, openManual, startLesson, TUT } from "./learn.js";
import { pickCall, newStoredPlay, playToStored, encodePlay, decodePlay, SQUAD_IDS } from "./playbook.js";
import { LIB_ORDER, myToPlay, QB_ACTIONS } from "./myplays.js";
import { profileMetrics, profileDiagnose, DRILLS, startDrill, PROFILE } from "./profile.js";
import { adaptivePlan, currentPlan, coveragePool } from "./train.js";
import { rankBadge } from "./dashboard.js";
import { CHALLENGES, todays, met } from "./challenge.js";
import { progressDoc, recordSession, streakInfo } from "./progress.js";
import { rankFor, sessionStats } from "./score.js";

export function installTestHooks(){
  if(typeof window==="undefined" || !window.__QB_TEST__) return;
  window.__qbState = state;
  window.__qbSim = {holderAt, BOOKS, buildRep, stepPlayers, releaseBall, flightTime, livePos, updateDefenders, updateRusher, isSacked, posAt, passerPos, passerIdAt, nearestDefender, dist};
  window.__qbKey = {setupKeyRead, analyzeKeyRead, keyPlanText, findKeyPair, recordDefHist};
  window.__qbFilm = {FILM,
    keyPx:()=>{ const r=FILM.rep; if(!r||!r.keyRead) return null; return toPx(r.keyRead.key.pos.x,r.keyRead.key.pos.y); },
    readPx:()=>{ const r=FILM.rep; if(!FILM.best) return null; return playerById(r,FILM.best.best.id)._px; }};
  window.__qbLearn = {MANUAL, LESSONS, openManual, startLesson, TUT};
  window.__qbPickCall = pickCall;
  window.__qbMy = {myToPlay, newStoredPlay, playToStored, LIB_ORDER, QB_ACTIONS, SQUAD_IDS};
  window.__qbCode = {encodePlay, decodePlay};
  window.__qbProfile = {profileMetrics, profileDiagnose, DRILLS, startDrill, get recs(){ return PROFILE.recs; }};
  window.__qbTrain = {adaptivePlan, currentPlan, coveragePool};
  window.__qbChallenge = {CHALLENGES, todays, met};
  window.__qbProgress = {progressDoc, recordSession, streakInfo, rankFor, sessionStats, rankBadge};
}
