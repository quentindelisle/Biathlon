/* =====================================================================
   Biathlon 5 s / Lancer de ballon — Suivi de performance élèves
   N'EPS numérique — CA1 — © Quentin Delisle
   PWA hors-ligne : données stockées sur l'appareil (localStorage),
   échanges entre tablettes par QR codes.
   ===================================================================== */
'use strict';

const APP_VERSION = '1.0.0';
const STORE_KEY = 'neps_biathlon5s_v1';
const QR_CHUNK = 750;           // caractères par QR (lisible par une caméra de tablette)
const DEFAULT_DIST = 25;        // valeur de départ pour la saisie en mètres
const ADJ = 3;                  // cible facile / difficile : ± 3 m

const COLORS = [
  {k:'rouge', n:'Rouge', c:'#E3262B'}, {k:'bleu', n:'Bleu', c:'#1E5FD8'},
  {k:'jaune', n:'Jaune', c:'#FFD400'}, {k:'vert', n:'Vert', c:'#1FA24A'},
  {k:'orange', n:'Orange', c:'#FF7A00'}, {k:'violet', n:'Violet', c:'#8A2BE2'},
  {k:'rose', n:'Rose', c:'#FF4FA3'}, {k:'blanc', n:'Blanc', c:'#FFFFFF'},
  {k:'noir', n:'Noir', c:'#1A1A1A'}
];
const colorOf = k => COLORS.find(c => c.k === k);

/* ---------------------------------------------------------------------
   État
   --------------------------------------------------------------------- */
function rnd(n){ const a='abcdefghijkmnpqrstuvwxyz23456789'; let s=''; for(let i=0;i<n;i++) s+=a[Math.floor(Math.random()*a.length)]; return s; }
function defaultState(){
  return { v:1, deviceId: rnd(4),
    settings:{ nbLessons:8, current:1, pin:'1234', className:'' },
    students:[], lessons:{}, results:{}, projects:{} };
}
let S;
try { S = JSON.parse(localStorage.getItem(STORE_KEY)) || defaultState(); } catch(e){ S = defaultState(); }
if (!S.deviceId) S.deviceId = rnd(4);
['students','lessons','results','projects'].forEach(k => { if(!S[k]) S[k] = (k==='students'?[]:{}); });

function save(){
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch(e){ toast('⚠️ Enregistrement impossible sur cet appareil'); }
  computeNames();
}

const UI = { view:'home', profTab:'lecons', profUnlocked:false, filter:null, sid:null, back:null, sel:null };

/* ---------------------------------------------------------------------
   Utilitaires
   --------------------------------------------------------------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = v => (v == null || isNaN(v)) ? '—' : (Math.round(v*10)/10).toString().replace('.', ',');
const now = () => Date.now();
function toast(msg, ms=2200){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'), ms); }
function capName(s){ return String(s||'').toLowerCase().replace(/(^|[\s\-'’])([a-zà-ÿ])/g, (m,a,b)=>a+b.toUpperCase()).trim(); }

function modal(html, {onOpen, wide}={}){
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal" ${wide?'style="max-width:760px"':''}>${html}</div></div>`;
  const bg = root.firstElementChild;
  bg.addEventListener('click', e => { if (e.target === bg) closeModal(); });
  if (onOpen) onOpen(bg.firstElementChild);
  return bg.firstElementChild;
}
function closeModal(){ stopScan(); $('#modal-root').innerHTML=''; }
function confirmBox(title, text, okLabel='Valider', danger=false){
  return new Promise(res => {
    const m = modal(`<h2>${esc(title)}</h2><p>${text}</p>
      <div class="btn-row spread"><button class="btn ghost" data-r="0">Annuler</button>
      <button class="btn ${danger?'red':'primary'}" data-r="1">${esc(okLabel)}</button></div>`);
    m.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { closeModal(); res(b.dataset.r==='1'); });
  });
}
function choiceBox(title, text, choices){
  return new Promise(res => {
    const m = modal(`<h2>${esc(title)}</h2><p>${text}</p><div class="btn-row">${
      choices.map((c,i)=>`<button class="btn ${c.cls||''}" data-i="${i}">${esc(c.label)}</button>`).join('')
    }<button class="btn ghost" data-i="-1">Annuler</button></div>`);
    m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { closeModal(); const i=+b.dataset.i; res(i<0?null:choices[i].value); });
  });
}
function numberBox(title, value, {step=0.5, min=0, max=200, unit='m'}={}){
  return new Promise(res => {
    const m = modal(`<h2>${esc(title)}</h2>
      <div class="center"><input type="number" inputmode="decimal" step="${step}" min="${min}" max="${max}" id="nb-in" value="${value ?? ''}" style="font-size:36px;text-align:center;max-width:220px"> <b style="font-size:26px">${unit}</b></div>
      <div class="btn-row spread" style="margin-top:16px"><button class="btn ghost" data-r="0">Annuler</button><button class="btn primary" data-r="1">Valider</button></div>`);
    const inp = m.querySelector('#nb-in'); setTimeout(()=>{inp.focus(); inp.select();}, 50);
    const done = ok => { const v = parseFloat(String(inp.value).replace(',', '.')); closeModal(); res(ok && !isNaN(v) ? Math.min(max, Math.max(min, v)) : null); };
    m.querySelector('[data-r="0"]').onclick = () => done(false);
    m.querySelector('[data-r="1"]').onclick = () => done(true);
    inp.addEventListener('keydown', e => { if (e.key==='Enter') done(true); });
  });
}

/* ---------------------------------------------------------------------
   Élèves & affichage des prénoms
   --------------------------------------------------------------------- */
let NAMES = {};
function computeNames(){
  NAMES = {};
  const by = {};
  S.students.forEach(s => { const p=(s.prenom||s.disp||'').toLowerCase(); (by[p]=by[p]||[]).push(s); });
  S.students.forEach(s => {
    if (!s.prenom) { NAMES[s.id] = s.disp || '?'; return; }       // tablettes : nom d'affichage reçu du prof
    const same = by[s.prenom.toLowerCase()];
    if (same.length < 2) { NAMES[s.id] = s.prenom; return; }
    let n = 1, label;
    do { label = s.prenom + ' ' + (s.nom||'').slice(0,n).toUpperCase() + '.'; n++; }
    while (n <= (s.nom||'').length && same.some(o => o!==s && o.prenom.toLowerCase()===s.prenom.toLowerCase() && (o.nom||'').slice(0,n-1).toUpperCase()===(s.nom||'').slice(0,n-1).toUpperCase()));
    NAMES[s.id] = label;
  });
}
const nameOf = id => NAMES[id] || '?';
const student = id => S.students.find(s => s.id === id);
function sortedStudents(){ return [...S.students].sort((a,b)=> nameOf(a.id).localeCompare(nameOf(b.id),'fr')); }
function newStudentId(){ let id; do { id = rnd(4); } while (S.students.some(s=>s.id===id)); return id; }

/* ---------------------------------------------------------------------
   Leçons, appel, cibles, résultats
   --------------------------------------------------------------------- */
function lesson(n){
  n = +n;
  if (!S.lessons[n]) S.lessons[n] = {};
  const L = S.lessons[n];
  if (L.title == null) L.title = n===1 ? 'Test : sprint 5 s (et tir)' : '';
  if (L.nbCourses == null) L.nbCourses = n===1 ? 2 : 3;
  if (L.nbTirs == null) L.nbTirs = n===1 ? 0 : 5;
  if (L.source == null) L.source = 'test';
  L.manual = L.manual || {}; L.adjust = L.adjust || {}; L.att = L.att || {};
  return L;
}
const curLesson = () => Math.min(S.settings.current || 1, S.settings.nbLessons);
const isLast = n => +n === +S.settings.nbLessons && n > 1;
const attOf = (n, sid) => lesson(n).att[sid] || null;           // 'abs' | 'inap' | null
const present = (n, sid) => !attOf(n, sid);

function res(n, sid){ return (S.results[n] && S.results[n][sid]) || null; }
function setRes(n, sid, fn){
  S.results[n] = S.results[n] || {};
  const r = S.results[n][sid] || { c:[], t:[] };
  fn(r); r.ts = now(); r.d = S.deviceId;
  S.results[n][sid] = r; save();
}
const vals = arr => (arr||[]).filter(v => v != null && !isNaN(v));
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;

/* Cible de test (leçon 1) : meilleure distance ou valeur saisie par l'enseignant */
function testTarget(sid){
  const L1 = lesson(1);
  if (L1.manual[sid] != null) return +L1.manual[sid];
  const v = vals(res(1, sid)?.c);
  return v.length ? Math.max(...v) : null;
}
/* Cible de base (sans ajustement facile/difficile) */
function baseTarget(n, sid, depth=0){
  n = +n;
  if (n <= 1 || depth > 30) return testTarget(sid);
  const L = lesson(n);
  if (L.manual[sid] != null) return +L.manual[sid];
  if (isLast(n) && S.projects[sid] && S.projects[sid].cible != null) return +S.projects[sid].cible;
  const src = L.source;
  if (src === 'test' || !src || +src >= n || +src < 2) return testTarget(sid);
  return baseTarget(+src, sid, depth+1);
}
function targetInfo(n, sid){
  n = +n;
  if (n === 1) { const t = testTarget(sid); return { value:t, base:t, adj:0, test:true }; }
  const L = lesson(n);
  const base = baseTarget(n, sid);
  const adj = +(L.adjust[sid] || 0);
  const value = base == null ? null : Math.round((base + adj)*10)/10;
  const prev = n === 2 ? testTarget(sid) : targetInfo(n-1, sid).value;
  const fromProject = isLast(n) && L.manual[sid] == null && S.projects[sid]?.cible != null;
  const src = L.manual[sid] != null ? 'manuelle' : fromProject ? 'projet' : (L.source === 'test' || !L.source ? 'test L1' : 'leçon ' + L.source);
  return { value, base, adj, prev, changed: prev != null && value != null && Math.abs(prev - value) > 0.01,
           manual: L.manual[sid] != null, fromProject, src };
}
function targetTags(ti){
  let h = '';
  if (ti.adj < 0) h += ` <span class="tag easy">Facile −${ADJ}</span>`;
  if (ti.adj > 0) h += ` <span class="tag hard">Difficile +${ADJ}</span>`;
  if (ti.fromProject) h += ` <span class="tag proj">Projet</span>`;
  else if (ti.manual) h += ` <span class="tag mod">Modifiée</span>`;
  return h;
}
function isComplete(n, sid){
  const L = lesson(n), r = res(n, sid);
  if (!r) return false;
  const c = vals(r.c).length >= L.nbCourses;
  const t = (r.t||[]).filter(v => v != null).length >= L.nbTirs;
  return c && t;
}
const scoreCls = v => v == null ? 's-none' : v >= 5 ? 's-hi' : v >= 3 ? 's-mid' : 's-lo';

/* ---------------------------------------------------------------------
   Conseils automatiques
   --------------------------------------------------------------------- */
function advices(sid){
  const out = [];
  const N = S.settings.nbLessons;
  const done = [];
  for (let n = 2; n <= N; n++) { const v = vals(res(n, sid)?.c); if (v.length) done.push({ n, v, r: res(n, sid) }); }
  if (!done.length) {
    if (vals(res(1, sid)?.c).length) out.push({ cls:'info', t:`Ta cible de départ est <b>${fmt(testTarget(sid))} m</b> en 5 s. À toi de l'atteindre à chaque course !` });
    else out.push({ cls:'info', t:'Pas encore de performances enregistrées.' });
    return out;
  }
  const last = done[done.length-1], prev = done[done.length-2];
  const c = res(last.n, sid).c;
  if (c[0] != null && c[1] != null && c[0] < 4 && c[1] < 4)
    out.push({ cls:'', t:`Leçon ${last.n} : tes premières performances sont inférieures à la cible, pense à bien t'échauffer (gammes, accélérations progressives) avant la 1<sup>re</sup> course.` });
  const all6 = last.v.length >= 2 && last.v.every(v => v === 6);
  const prev6 = prev && prev.v.length >= 2 && prev.v.every(v => v === 6);
  if (all6) out.push({ cls:'', t: prev6
      ? `Tu réussis <b>6/6</b> à chaque course depuis 2 leçons : ta cible est trop facile. Demande à ton enseignant de la revoir (cible difficile +${ADJ} m ou nouvelle cible).`
      : `Tu as réussi <b>6/6</b> à toutes tes courses : peut-être faut-il revoir ta cible à la hausse ?` });
  const m = avg(last.v);
  if (m != null && m <= 2 && last.v.length >= 2)
    out.push({ cls:'', t:`Ta moyenne est de ${fmt(m)}/6 : ta cible est peut-être trop difficile aujourd'hui. Tu peux demander une cible facile (−${ADJ} m).` });
  if (last.v.length >= 3 && c[last.v.length-1] != null && c[0] != null && c[last.v.length-1] <= c[0] - 2)
    out.push({ cls:'', t:`Tes performances baissent sur les dernières courses : récupère bien entre les courses (marche, respiration) et dose ton effort.` });
  if (prev) {
    const d = avg(last.v) - avg(prev.v);
    if (d >= 1) out.push({ cls:'good', t:`Bravo ! Ta moyenne progresse de ${fmt(d)} point(s) entre la leçon ${prev.n} et la leçon ${last.n}.` });
  }
  const tirs = (last.r.t||[]).filter(v => v != null);
  if (tirs.length >= 3) {
    const p = tirs.filter(v => v === 1).length / tirs.length;
    if (p < 0.5) out.push({ cls:'', t:`Au tir : ${Math.round(p*100)} % de réussite. Prends le temps de te stabiliser et de souffler avant de lancer.` });
    else if (p >= 0.8) out.push({ cls:'good', t:`Excellent au tir : ${Math.round(p*100)} % de réussite !` });
  }
  if (!out.length) out.push({ cls:'good', t:'Continue comme ça : tes performances sont proches de ta cible.' });
  return out;
}

/* ---------------------------------------------------------------------
   Rendu général
   --------------------------------------------------------------------- */
function setTop(main, sub, right=''){
  $('#tb-main').textContent = main; $('#tb-sub').textContent = sub || ''; $('#tb-right').innerHTML = right;
}
function lessonLabel(n){ const L = lesson(n); return `Leçon ${n}/${S.settings.nbLessons}` + (L.title ? ' · ' + L.title : ''); }
function go(view, opts={}){ Object.assign(UI, opts); UI.view = view; render(); window.scrollTo(0,0); }

function render(){
  stopScan();
  const v = UI.view, m = $('#main');
  const cls = S.settings.className ? ' · ' + S.settings.className : '';
  const homeBtn = `<button class="btn small" data-action="go" data-view="home">⌂ Accueil</button>`;
  if (v === 'home') { setTop('Biathlon 5 s · CA1' + cls, lessonLabel(curLesson())); m.innerHTML = viewHome(); }
  else if (v === 'saisie') { setTop('Saisie · Leçon ' + curLesson(), lesson(curLesson()).title, homeBtn); m.innerHTML = viewSaisie(); }
  else if (v === 'entry') { setTop('Saisie · ' + nameOf(UI.sid), lessonLabel(curLesson()), `<button class="btn small" data-action="go" data-view="saisie">▦ Tuiles</button>`); m.innerHTML = viewEntry(); bindEntry(); }
  else if (v === 'stats') { setTop('Statistiques', 'Choisis un élève', homeBtn); m.innerHTML = viewStatsTiles(); }
  else if (v === 'statsDetail') { setTop('Stats · ' + nameOf(UI.sid), S.settings.className, `<button class="btn small" data-action="go" data-view="stats">▦ Tuiles</button>`); m.innerHTML = viewStatsDetail(); }
  else if (v === 'prof') { setTop('Espace enseignant', lessonLabel(curLesson()), homeBtn); m.innerHTML = viewProf(); afterProf(); }
  else if (v === 'send') { setTop('Envoyer mes saisies', 'QR code à scanner par l\'enseignant', homeBtn); m.innerHTML = viewSend(); afterSend(); }
  else if (v === 'receive') { setTop('Recevoir la leçon', 'Scanner le QR code de l\'enseignant', homeBtn); m.innerHTML = viewReceive(); afterReceive(); }
}

/* ---------------------------------------------------------------------
   Accueil
   --------------------------------------------------------------------- */
function viewHome(){
  const n = curLesson(), L = lesson(n);
  const pres = S.students.filter(s => present(n, s.id)).length;
  return `<div class="home">
    <img class="home-logo" src="logo-app.png" alt="N'EPS numérique – CA1 Biathlon">
    <div class="home-lesson">
      <div class="big">Leçon ${n} / ${S.settings.nbLessons}</div>
      <div style="font-size:20px;font-weight:800">${esc(L.title || 'Sans titre')}</div>
      <div class="muted" style="font-weight:700">${n===1 ? 'Test sprint : distance en mètres' : L.nbCourses + ' course(s) notée(s) /6'} · ${L.nbTirs} tir(s) · ${pres}/${S.students.length} élève(s) présent(s)</div>
    </div>
    <div class="home-grid">
      <button class="home-btn saisie" data-action="go" data-view="saisie"><span class="ico">✍️</span>Saisie</button>
      <button class="home-btn stats" data-action="go" data-view="stats"><span class="ico">📊</span>Statistiques</button>
      <button class="home-btn prof" data-action="openProf"><span class="ico">🔒</span>Enseignant</button>
    </div>
    <div class="home-sync">
      <button class="btn" data-action="go" data-view="receive">📥 Recevoir la leçon (QR)</button>
      <button class="btn orange" data-action="go" data-view="send">📤 Envoyer mes saisies (QR)</button>
    </div>
    ${S.students.length ? '' : `<div class="card strong center" style="max-width:640px">Aucun élève sur cette tablette.<br>
      <b>Enseignant</b> : importez la liste dans l'espace enseignant.<br><b>Tablette élève</b> : touchez « Recevoir la leçon » et scannez le QR code du professeur.</div>`}
  </div>`;
}

/* ---------------------------------------------------------------------
   Tuiles (commun)
   --------------------------------------------------------------------- */
function band(sid){ const c = colorOf(student(sid)?.g); return c ? `<span class="band" style="background:${c.c};box-shadow:inset -2px 0 0 rgba(0,0,0,.35)"></span>` : '<span class="band"></span>'; }
function filterBar(){
  const used = COLORS.filter(c => S.students.some(s => s.g === c.k));
  if (!used.length) return '';
  return `<div class="filters"><b>Chasubles :</b>
    <button class="chip ${UI.filter?'':'on'}" data-action="filter" data-g="">Tous</button>
    ${used.map(c=>`<button class="chip ${UI.filter===c.k?'on':''}" data-action="filter" data-g="${c.k}"><span class="dot" style="background:${c.c}"></span>${c.n}</button>`).join('')}
  </div>`;
}
const passFilter = s => !UI.filter || s.g === UI.filter;

/* ---------------------------------------------------------------------
   Saisie : tuiles de la leçon en cours
   --------------------------------------------------------------------- */
function viewSaisie(){
  const n = curLesson(), L = lesson(n);
  if (!S.students.length) return `<div class="card strong center">Aucun élève. Recevez la leçon du professeur (QR) depuis l'accueil.</div>`;
  const list = sortedStudents().filter(s => present(n, s.id) && passFilter(s));
  const off = S.students.filter(s => !present(n, s.id)).length;
  return `<div class="card strong"><b style="font-size:20px">Leçon ${n} ${L.title?'– '+esc(L.title):''}</b>
      <div class="muted" style="font-weight:700">${n===1 ? `Test : note la distance parcourue en 5 s (${L.nbCourses} essai(s))` : `${L.nbCourses} course(s) : note de 0 à 6 pour chaque course`} ${L.nbTirs?`· ${L.nbTirs} tir(s)`:''}${off?` · ${off} absent(s)/inapte(s) masqué(s)`:''}</div>
      <div class="muted">Touche la tuile de l'élève que tu observes.</div></div>
    ${filterBar()}
    <div class="tiles">${list.map(s => saisieTile(n, s)).join('') || '<p>Aucun élève dans ce groupe.</p>'}</div>`;
}
function saisieTile(n, s){
  const ti = targetInfo(n, s.id), L = lesson(n), r = res(n, s.id);
  const nc = vals(r?.c).length, nt = (r?.t||[]).filter(v=>v!=null).length;
  const done = isComplete(n, s.id);
  const tgt = n === 1 ? `<div class="target">Test sprint${ti.value!=null?' · meilleur : '+fmt(ti.value)+' m':''}</div>`
                      : `<div class="target">🎯 ${ti.value!=null ? fmt(ti.value)+' m' : 'pas de cible'}${targetTags(ti)}</div>`;
  return `<button class="tile ${done?'done':''}" data-action="entry" data-sid="${s.id}">${band(s.id)}
    ${done?'<span class="check">✓</span>':''}
    <span class="name">${esc(nameOf(s.id))}</span>${tgt}
    <span class="meta">Courses ${nc}/${L.nbCourses}${L.nbTirs?` · Tirs ${nt}/${L.nbTirs}`:''}</span></button>`;
}

/* ---------------------------------------------------------------------
   Saisie : écran d'un élève
   --------------------------------------------------------------------- */
function viewEntry(){
  const n = curLesson(), L = lesson(n), sid = UI.sid, s = student(sid);
  if (!s) return '<p>Élève introuvable.</p>';
  const ti = targetInfo(n, sid), r = res(n, sid) || {c:[],t:[]};
  const list = sortedStudents().filter(x => present(n, x.id) && passFilter(x));
  const i = list.findIndex(x => x.id === sid);
  const prev = list[i-1], next = list[i+1];
  let h = `<div class="entry-head">${band(sid)}<div class="who">${esc(nameOf(sid))}</div>
     <div class="tgt">${n===1 ? `<div class="muted" style="font-weight:800">Leçon 1 · TEST</div><div class="v">${ti.value!=null?fmt(ti.value)+' m':'—'}</div><div class="muted">meilleure distance</div>`
       : `<div class="muted" style="font-weight:800">CIBLE</div><div class="v">${ti.value!=null?fmt(ti.value)+' m':'—'}</div><div>${targetTags(ti)}</div>`}</div></div>
    <div class="btn-row" style="margin-bottom:12px"><button class="btn" data-action="go" data-view="saisie">← Retour aux tuiles</button>
      <span class="saved" id="saved-flag"></span></div>`;
  h += `<h2>${n===1 ? '🏃 Sprint 5 s : distance parcourue' : '🏃 Courses : note sur 6'}</h2>`;
  if (n === 1) {
    h += `<div class="dials">`;
    for (let k = 0; k < L.nbCourses; k++) {
      const v = r.c[k];
      h += `<div class="dial-card dist-card"><h3>Essai ${k+1}</h3>
        <div class="val ${v==null?'unset':''}" data-action="distType" data-k="${k}">${v==null?'— m':fmt(v)+' m'}</div>
        <div class="dist-grid">
          <button data-action="dist" data-k="${k}" data-d="-1">−1</button><button data-action="dist" data-k="${k}" data-d="-0.5">−½</button>
          <button data-action="dist" data-k="${k}" data-d="0.5">+½</button><button data-action="dist" data-k="${k}" data-d="1">+1</button>
        </div>
        <div class="btn-row" style="justify-content:center;margin-top:8px"><button class="btn small" data-action="distType" data-k="${k}">⌨ Taper</button><button class="btn small ghost" data-action="distClear" data-k="${k}">Effacer</button></div>
      </div>`;
    }
    h += `</div>`;
  } else {
    h += `<p class="muted" style="margin-top:-4px;font-weight:700">Tourne la molette (ou touche un chiffre) : nombre de fois où la cible de ${ti.value!=null?fmt(ti.value)+' m':'—'} est atteinte sur 6.</p><div class="dials">`;
    for (let k = 0; k < L.nbCourses; k++) {
      h += `<div class="dial-card"><h3>Course ${k+1}</h3>
        <svg class="dial" viewBox="0 0 200 200" data-k="${k}">${dialInner(r.c[k])}</svg>
        <button class="btn small ghost" data-action="dialClear" data-k="${k}">Effacer</button></div>`;
    }
    h += `</div>`;
  }
  if (L.nbTirs > 0) {
    h += `<h2 style="margin-top:18px">🏀 Tirs (lancer de ballon)</h2><p class="muted" style="margin-top:-4px;font-weight:700">Touche : 1 fois = réussi ✓ · 2 fois = raté ✗ · 3 fois = effacer</p><div class="shots">`;
    for (let k = 0; k < L.nbTirs; k++) {
      const v = (r.t||[])[k];
      h += `<button class="shot ${v===1?'ok':v===0?'ko':''}" data-action="shot" data-k="${k}">${v===1?'✓':v===0?'✗':k+1}</button>`;
    }
    h += `</div><p style="font-weight:800" id="shot-sum">${shotSum(r)}</p>`;
  }
  h += `<div class="nav-bottom">
      <button class="btn" data-action="entry" data-sid="${prev?.id||''}" ${prev?'':'disabled'}>← ${prev?esc(nameOf(prev.id)):'Précédent'}</button>
      <button class="btn primary" data-action="go" data-view="saisie">▦ Tuiles</button>
      <button class="btn" data-action="entry" data-sid="${next?.id||''}" ${next?'':'disabled'}>${next?esc(nameOf(next.id)):'Suivant'} →</button></div>`;
  return h;
}
function shotSum(r){ const t=(r.t||[]).filter(v=>v!=null); return t.length ? `Réussis : ${t.filter(v=>v===1).length} / ${t.length}` : ''; }
function flagSaved(){ const f=$('#saved-flag'); if (f){ f.textContent='✓ Enregistré'; clearTimeout(f._h); f._h=setTimeout(()=>f.textContent='',1500);} }

/* Molette circulaire graduée 0 → 6 */
const DIAL_START = -135, DIAL_STEP = 45, CX = 100, CY = 100;
function pol(r, a){ const t = a*Math.PI/180; return [CX + r*Math.sin(t), CY - r*Math.cos(t)]; }
function arc(r, a0, a1){ const [x0,y0]=pol(r,a0),[x1,y1]=pol(r,a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; }
function dialColor(v){ return v==null ? '#9AA3B5' : v>=5 ? '#12813A' : v>=3 ? '#F07000' : '#D0161B'; }
function dialInner(v){
  const col = dialColor(v);
  let s = `<path d="${arc(80, DIAL_START, -DIAL_START)}" stroke="#DCE2EE" stroke-width="22" fill="none" stroke-linecap="round"/>`;
  if (v != null && v > 0) s += `<path d="${arc(80, DIAL_START, DIAL_START + v*DIAL_STEP)}" stroke="${col}" stroke-width="22" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i <= 6; i++) {
    const a = DIAL_START + i*DIAL_STEP, [x,y] = pol(80, a), on = v === i;
    s += `<g data-val="${i}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${on?19:15}" fill="${on?col:'#fff'}" stroke="${on?'#0A1633':'#0B2A6B'}" stroke-width="3"/>
      <text x="${x.toFixed(1)}" y="${(y+6.5).toFixed(1)}" text-anchor="middle" font-size="${on?20:17}" fill="${on?'#fff':'#0B2A6B'}">${i}</text></g>`;
  }
  s += `<text x="100" y="112" text-anchor="middle" font-size="44" fill="${col}">${v==null?'–':v}</text>
        <text x="100" y="140" text-anchor="middle" font-size="17" fill="#5B6478">sur 6</text>`;
  return s;
}
function bindEntry(){
  const n = curLesson(), sid = UI.sid;
  document.querySelectorAll('svg.dial').forEach(svg => {
    const k = +svg.dataset.k;
    let dragging = false, cur = res(n, sid)?.c?.[k] ?? null;
    const valFromEvent = e => {
      const b = svg.getBoundingClientRect();
      const x = (e.clientX - b.left) * 200 / b.width - CX, y = (e.clientY - b.top) * 200 / b.height - CY;
      if (Math.hypot(x, y) < 28) return null;                   // centre : pas de changement
      let a = Math.atan2(x, -y) * 180 / Math.PI;                  // 0 = haut, sens horaire
      if (a > 157.5) a = 135; if (a < -157.5) a = -135;
      return Math.max(0, Math.min(6, Math.round((a - DIAL_START) / DIAL_STEP)));
    };
    const show = v => { svg.innerHTML = dialInner(v); };
    svg.addEventListener('pointerdown', e => { e.preventDefault(); dragging = true; svg.setPointerCapture(e.pointerId);
      const v = valFromEvent(e); if (v != null) { cur = v; show(v); } });
    svg.addEventListener('pointermove', e => { if (!dragging) return; const v = valFromEvent(e); if (v != null && v !== cur) { cur = v; show(v); } });
    const end = () => { if (!dragging) return; dragging = false;
      if (cur != null && cur !== (res(n, sid)?.c?.[k] ?? null)) { setRes(n, sid, r => { r.c[k] = cur; }); flagSaved(); } };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  });
}

/* ---------------------------------------------------------------------
   Statistiques
   --------------------------------------------------------------------- */
function viewStatsTiles(){
  if (!S.students.length) return `<div class="card strong center">Aucun élève.</div>`;
  return `${filterBar()}<div class="tiles">${sortedStudents().filter(passFilter).map(s => {
    const n = curLesson(), ti = targetInfo(n, s.id);
    const lastScores = []; for (let k = 2; k <= S.settings.nbLessons; k++) { const v = vals(res(k,s.id)?.c); if (v.length) lastScores.push(avg(v)); }
    const m = lastScores.length ? lastScores[lastScores.length-1] : null;
    return `<button class="tile" data-action="statsDetail" data-sid="${s.id}">${band(s.id)}
      <span class="name">${esc(nameOf(s.id))}</span>
      <span class="target">🎯 ${ti.value!=null?fmt(ti.value)+' m':'—'}${n>1?targetTags(ti):''}</span>
      <span class="meta">${m!=null?`Dernière moyenne : ${fmt(m)}/6`:`Test : ${fmt(testTarget(s.id))} m`}</span></button>`; }).join('')}</div>`;
}
function barChart(items, max, cls=''){
  return `<div class="bar-chart ${cls}">${items.map(it => `<div class="b" style="height:${it.v==null?0:Math.max(2, it.v/max*100)}%;${it.v==null?'background:transparent':''}"><span>${it.v==null?'':it.lbl}</span></div>`).join('')}</div>
    <div class="bar-labels">${items.map(it=>`<span>L${it.n}</span>`).join('')}</div>`;
}
function viewStatsDetail(){
  const sid = UI.sid, s = student(sid); if (!s) return '';
  const N = S.settings.nbLessons;
  const col = colorOf(s.g);
  // --- Course
  let run = '', shoot = '';
  const runBars = [], shootBars = [];
  for (let n = 1; n <= N; n++) {
    const L = lesson(n), r = res(n, sid), a = attOf(n, sid), ti = targetInfo(n, sid);
    const title = L.title ? `<div class="ls-title">${esc(L.title)}</div>` : '';
    const status = a === 'abs' ? '<span class="tag abs">Absent</span>' : a === 'inap' ? '<span class="tag inapte">Inapte</span>' : '';
    const c = r?.c || [];
    if (n === 1) {
      run += `<div class="lesson-stat"><div class="ls-head"><b>Leçon 1 · Test</b><span>Cible obtenue : <b style="color:var(--blue)">${fmt(testTarget(sid))} m</b>${lesson(1).manual[sid]!=null?' <span class="tag mod">Modifiée</span>':''} ${status}</span></div>${title}
        <div class="scores">${c.length ? c.map(v=>`<span class="sc ${v==null?'s-none':'s-dist'}">${v==null?'—':fmt(v)+' m'}</span>`).join('') : '<span class="muted">Pas de mesure</span>'}</div></div>`;
    } else {
      const v = vals(c); const m = avg(v);
      runBars.push({ n, v: m, lbl: fmt(m) });
      const chg = ti.changed ? ` <span class="tag mod">Cible changée (avant ${fmt(ti.prev)} m)</span>` : '';
      run += `<div class="lesson-stat"><div class="ls-head"><b>Leçon ${n}${isLast(n)?' (dernière)':''}</b>
        <span>🎯 <b style="color:var(--blue)">${ti.value!=null?fmt(ti.value)+' m':'—'}</b>${targetTags(ti)}${chg} ${status}</span></div>${title}
        <div class="scores">${Array.from({length: Math.max(L.nbCourses, c.length)}, (_,k)=>c[k]).map(x=>`<span class="sc ${scoreCls(x)}">${x==null?'—':x+'/6'}</span>`).join('')}
        ${m!=null?`<span style="font-weight:900;align-self:center">moy. ${fmt(m)}/6</span>`:''}</div></div>`;
    }
    const t = (r?.t||[]).filter(x=>x!=null);
    const ok = t.filter(x=>x===1).length;
    if (L.nbTirs > 0 || t.length) {
      shootBars.push({ n, v: t.length ? ok/t.length*100 : null, lbl: t.length ? Math.round(ok/t.length*100)+'%' : '' });
      shoot += `<div class="lesson-stat"><div class="ls-head"><b>Leçon ${n}</b><span>${t.length?`<b>${ok}/${t.length}</b> réussis (${Math.round(ok/t.length*100)} %)`:'<span class="muted">—</span>'} ${status}</span></div>
        <div class="scores">${(r?.t||[]).map(x=>`<span class="sc ${x===1?'s-hi':x===0?'s-lo':'s-none'}">${x===1?'✓':x===0?'✗':'·'}</span>`).join('')}</div></div>`;
    }
  }
  // --- Projet dernière leçon
  const P = S.projects[sid] || {};
  const lastTi = targetInfo(N, sid);
  const suggested = P.cible ?? (N > 1 ? targetInfo(N-1, sid).value : null) ?? testTarget(sid);
  let tgList = `<div class="tg-list"><span class="it">L1 test : ${fmt(testTarget(sid))} m</span>`;
  for (let n = 2; n < N; n++) { const ti = targetInfo(n, sid); tgList += `<span class="it">L${n} : ${fmt(ti.value)} m${ti.adj<0?' (F)':ti.adj>0?' (D)':''}</span>`; }
  tgList += `</div>`;
  const locked = lesson(N).manual[sid] != null;
  return `<div class="entry-head">${col?`<span class="band" style="background:${col.c}"></span>`:''}<div class="who">${esc(nameOf(sid))}</div>
      <div class="tgt"><div class="muted" style="font-weight:800">CIBLE LEÇON ${curLesson()}</div><div class="v">${fmt(targetInfo(curLesson(), sid).value)} m</div></div></div>
    <div class="btn-row" style="margin-bottom:12px"><button class="btn" data-action="go" data-view="stats">← Retour aux tuiles</button></div>
    <div class="card strong"><h2>💡 Conseils</h2>${advices(sid).map(a=>`<div class="advice ${a.cls}">${a.t}</div>`).join('')}</div>
    <div class="stats-cols">
      <div class="card strong"><h2>🏃 Course (sprint 5 s)</h2>
        ${runBars.some(b=>b.v!=null) ? `<div class="muted" style="font-weight:700">Moyenne /6 par leçon</div>${barChart(runBars, 6)}` : ''}
        ${run}</div>
      <div class="card strong"><h2>🏀 Tir (basket)</h2>
        ${shootBars.some(b=>b.v!=null) ? `<div class="muted" style="font-weight:700">% de réussite par leçon</div>${barChart(shootBars, 100, 'green')}` : ''}
        ${shoot || '<p class="muted">Pas de tir prévu pour l\'instant.</p>'}</div>
    </div>
    <div class="card strong" id="projet"><h2>📝 Mon projet pour la dernière leçon (leçon ${N})</h2>
      <div class="muted" style="font-weight:700">Rappel de mes cibles :</div>${tgList}
      ${locked ? `<div class="advice info">L'enseignant a fixé ta cible de la dernière leçon : <b>${fmt(lastTi.value)} m</b>.</div>` : ''}
      <div class="row" style="margin:10px 0"><b style="font-size:20px">Ma cible pour la leçon ${N} :</b>
        <div class="stepper"><button data-action="projStep" data-d="-0.5">−</button><span class="val" id="proj-cible" data-v="${suggested ?? ''}">${suggested!=null?fmt(suggested)+' m':'—'}</span><button data-action="projStep" data-d="0.5">+</button></div></div>
      <label class="field">Mon projet (ce que je vais faire pour réussir)
        <textarea id="proj-text" placeholder="Ex. : je choisis ${suggested!=null?fmt(suggested+1):'…'} m car j'ai réussi 6/6 plusieurs fois. Je vais m'échauffer…">${esc(P.texte||'')}</textarea></label>
      <div class="btn-row" style="margin-top:10px"><button class="btn green" data-action="projSave">💾 Enregistrer mon projet</button>
        ${P.ts?`<span class="muted">Enregistré le ${new Date(P.ts).toLocaleDateString('fr-FR')}</span>`:''}</div>
    </div>`;
}

/* ---------------------------------------------------------------------
   Espace enseignant
   --------------------------------------------------------------------- */
function openProf(){
  if (UI.profUnlocked) return go('prof');
  let code = '';
  const m = modal(`<h2 class="center">🔒 Code enseignant</h2><div class="pin-dots">${'<span></span>'.repeat(4)}</div>
    <div class="pin-pad">${[1,2,3,4,5,6,7,8,9,'⌫',0,'✕'].map(k=>`<button data-k="${k}">${k}</button>`).join('')}</div>
    <p class="center muted" style="font-size:14px">Code par défaut : 1234 (modifiable dans l'onglet Export / Réglages)</p>`);
  const dots = m.querySelectorAll('.pin-dots span');
  m.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === '✕') return closeModal();
    if (k === '⌫') code = code.slice(0,-1); else if (code.length < 4) code += k;
    dots.forEach((d,i)=>d.classList.toggle('f', i < code.length));
    if (code.length === 4) {
      if (code === String(S.settings.pin || '1234')) { UI.profUnlocked = true; closeModal(); go('prof'); }
      else { toast('Code incorrect'); code=''; dots.forEach(d=>d.classList.remove('f')); }
    }
  });
}
const PROF_TABS = [['lecons','📅 Cycle & leçons'],['eleves','👥 Élèves'],['appel','✅ Appel'],['cibles','🎯 Cibles'],['groupes','🎽 Chasubles'],['partage','🔄 QR tablettes'],['export','📁 Export / Réglages']];
function viewProf(){
  const t = UI.profTab;
  let body = '';
  if (t === 'lecons') body = profLecons();
  else if (t === 'eleves') body = profEleves();
  else if (t === 'appel') body = profAppel();
  else if (t === 'cibles') body = profCibles();
  else if (t === 'groupes') body = profGroupes();
  else if (t === 'partage') body = profPartage();
  else if (t === 'export') body = profExport();
  return `<div class="tabs">${PROF_TABS.map(([k,l])=>`<button class="tab ${t===k?'on':''}" data-action="profTab" data-tab="${k}">${l}</button>`).join('')}</div>${body}`;
}
function afterProf(){ if (UI.profTab === 'groupes') bindGroups(); }

function stepper(action, attrs, val, disp){
  return `<div class="stepper"><button data-action="${action}" ${attrs} data-d="-1">−</button><span class="val">${disp ?? val}</span><button data-action="${action}" ${attrs} data-d="1">+</button></div>`;
}
function profLecons(){
  const N = S.settings.nbLessons, cur = curLesson();
  let rows = '';
  for (let n = 1; n <= N; n++) {
    const L = lesson(n);
    let srcSel = '';
    if (n >= 2) {
      srcSel = `<label class="field">Cible utilisée<select data-field="source" data-n="${n}">
        <option value="test" ${L.source==='test'?'selected':''}>Cible du test (leçon 1)</option>
        ${Array.from({length:n-2},(_,i)=>i+2).map(k=>`<option value="${k}" ${String(L.source)===String(k)?'selected':''}>Reprendre la cible de la leçon ${k}</option>`).join('')}
      </select></label>`;
    }
    rows += `<div class="lesson-row"><div class="lesson-num ${n===cur?'cur':''}">${n}</div><div class="lesson-fields">
      <label class="field full">Titre / contenu de la leçon${n===1?' (test)':''}${isLast(n)?' — dernière leçon : projet élève':''}
        <input type="text" data-field="title" data-n="${n}" value="${esc(L.title)}" placeholder="Ex. : Courir à sa cible puis tirer au panier…"></label>
      <div class="field">${n===1?'Essais de sprint':'Nombre de courses'}${stepper('lessonStep', `data-n="${n}" data-k="nbCourses"`, L.nbCourses)}</div>
      <div class="field">Nombre de tirs${stepper('lessonStep', `data-n="${n}" data-k="nbTirs"`, L.nbTirs)}</div>
      <div class="full">${srcSel}</div>
    </div></div>`;
  }
  return `<div class="card strong"><h2>Leçon en cours</h2>
      <p class="muted" style="font-weight:700;margin-top:-4px">Les tablettes s'ouvrent sur cette leçon et ne peuvent saisir que sur elle (pensez à renvoyer le QR aux tablettes après un changement).</p>
      <div class="lesson-picker">${Array.from({length:N},(_,i)=>i+1).map(n=>`<button class="lp ${n===cur?'on':''}" data-action="setCurrent" data-n="${n}">${n}</button>`).join('')}</div></div>
    <div class="card"><h2>Cycle</h2><div class="row">
      <label class="field grow">Classe / groupe<input type="text" data-field="className" value="${esc(S.settings.className)}" placeholder="Ex. : 2nde 4"></label>
      <div class="field">Nombre de leçons du cycle${stepper('nbLessons','',N)}</div></div></div>
    <div class="card"><h2>Leçons</h2>
      <p class="muted" style="margin-top:-4px">Leçon 1 = test : on relève la distance (m) parcourue en 5 s ; la meilleure devient la cible. Leçons suivantes : chaque course est notée sur 6.</p>${rows}</div>`;
}
function profEleves(){
  const list = sortedStudents();
  return `<div class="card strong"><h2>Importer la liste (Pronote)</h2>
      <p class="muted" style="margin-top:-4px">Fichier <b>.xlsx</b> ou <b>.csv</b> : « NOM Prénom » en colonne A, <u>ou</u> Nom en colonne A et Prénom en colonne B. Les lignes d'en-tête sont ignorées.</p>
      <div class="btn-row"><label class="btn primary">📂 Choisir un fichier<input type="file" id="file-students" accept=".xlsx,.xls,.csv,.txt" hidden></label></div></div>
    <div class="card"><h2>Ajouter un élève</h2><div class="row">
      <label class="field grow">Nom<input type="text" id="add-nom" placeholder="DUPONT"></label>
      <label class="field grow">Prénom<input type="text" id="add-prenom" placeholder="Léa"></label>
      <button class="btn green" data-action="addStudent" style="align-self:flex-end">＋ Ajouter</button></div></div>
    <div class="card"><div class="btn-row spread"><h2 style="margin:0">${list.length} élève(s)</h2>${list.length?'<button class="btn small red" data-action="clearStudents">Vider la liste</button>':''}</div>
      <table class="simple" style="margin-top:8px"><tr><th>Affiché</th><th>Nom complet</th><th></th></tr>
      ${list.map(s=>`<tr><td><b>${esc(nameOf(s.id))}</b></td><td>${esc((s.nom||'').toUpperCase())} ${esc(s.prenom||s.disp||'')}</td>
        <td style="text-align:right"><button class="btn small ghost" data-action="delStudent" data-sid="${s.id}">🗑 Retirer</button></td></tr>`).join('')}</table></div>`;
}
function profAppel(){
  const n = curLesson(), L = lesson(n);
  const abs = S.students.filter(s=>attOf(n,s.id)==='abs').length, inap = S.students.filter(s=>attOf(n,s.id)==='inap').length;
  return `<div class="card strong"><h2>Appel · Leçon ${n}</h2><div class="muted" style="font-weight:700">${S.students.length-abs-inap} présent(s) · ${abs} absent(s) · ${inap} inapte(s). Les absents et inaptes n'apparaissent pas dans la saisie du jour.</div></div>
    <div class="tiles">${sortedStudents().map(s => { const a = attOf(n,s.id);
      return `<div class="att-tile ${a==='abs'?'abs':a==='inap'?'inapte':''}">${band(s.id)}<div class="name">${esc(nameOf(s.id))}</div>
        <div class="btn-row"><button class="btn ${a==='abs'?'abs-on':''}" data-action="att" data-sid="${s.id}" data-v="abs">Absent</button>
        <button class="btn ${a==='inap'?'inapte-on':''}" data-action="att" data-sid="${s.id}" data-v="inap">Inapte</button></div></div>`; }).join('')}</div>`;
}
function profCibles(){
  const n = curLesson(), L = lesson(n);
  const list = sortedStudents();
  if (n === 1) {
    return `<div class="card strong"><h2>Leçon 1 · Test</h2><p class="muted" style="margin-top:-4px">La cible de chaque élève = sa meilleure distance au test. Vous pouvez la corriger à la main.</p></div>
      <div class="tiles">${list.map(s => { const r = vals(res(1,s.id)?.c); const t = testTarget(s.id);
        return `<div class="att-tile tg-tile">${band(s.id)}<div class="name">${esc(nameOf(s.id))}</div>
          <div class="tv">${t!=null?fmt(t)+' m':'—'} ${L.manual[s.id]!=null?'<span class="tag mod">Modifiée</span>':''}</div>
          <div class="muted">Mesures : ${r.length?r.map(fmt).join(' · ')+' m':'aucune'}</div>
          <div class="btn-row" style="margin-top:6px"><button class="btn small" data-action="manualTarget" data-sid="${s.id}">✎ Modifier</button>
          ${L.manual[s.id]!=null?`<button class="btn small ghost" data-action="resetTarget" data-sid="${s.id}">Réinit.</button>`:''}</div></div>`; }).join('')}</div>`;
  }
  const opts = `<option value="test" ${L.source==='test'?'selected':''}>Cible du test (leçon 1)</option>` +
    Array.from({length:n-2},(_,i)=>i+2).map(k=>`<option value="${k}" ${String(L.source)===String(k)?'selected':''}>Cible de la leçon ${k}</option>`).join('');
  return `<div class="card strong"><h2>Cibles · Leçon ${n}${isLast(n)?' (dernière : projet élève)':''}</h2>
      <label class="field" style="max-width:520px">Cible de base pour toute la classe<select data-field="source" data-n="${n}">${opts}</select></label>
      <p class="muted" style="font-weight:700">Par élève : <b style="color:var(--green)">Facile −${ADJ} m</b> / Normal / <b style="color:var(--red)">Difficile +${ADJ} m</b> (élève pas en forme, trop à l'aise…), ou cible modifiée à la main.${isLast(n)?' À la dernière leçon, la cible choisie par l\'élève dans son projet est utilisée.':''}</p></div>
    <div class="tiles">${list.map(s => { const ti = targetInfo(n, s.id); const a = attOf(n, s.id);
      return `<div class="att-tile tg-tile ${a?'':''}">${band(s.id)}<div class="name">${esc(nameOf(s.id))} ${a==='abs'?'<span class="tag abs">Abs.</span>':a==='inap'?'<span class="tag inapte">Inapte</span>':''}</div>
        <div class="tv">${ti.value!=null?fmt(ti.value)+' m':'—'}</div>
        <div class="muted" style="font-size:14px;font-weight:700">Base ${fmt(ti.base)} m (${ti.src})${ti.changed?` · avant ${fmt(ti.prev)} m`:''}</div>
        <div class="seg" style="margin:8px 0"><button class="easy ${ti.adj<0?'on':''}" data-action="adjust" data-sid="${s.id}" data-v="-${ADJ}">Facile</button>
          <button class="norm ${!ti.adj?'on':''}" data-action="adjust" data-sid="${s.id}" data-v="0">Normal</button>
          <button class="hard ${ti.adj>0?'on':''}" data-action="adjust" data-sid="${s.id}" data-v="${ADJ}">Difficile</button></div>
        <div class="btn-row"><button class="btn small" data-action="manualTarget" data-sid="${s.id}">✎ Modifier</button>
          ${ti.manual?`<button class="btn small ghost" data-action="resetTarget" data-sid="${s.id}">Réinit.</button>`:''}</div></div>`; }).join('')}</div>`;
}
function profGroupes(){
  const zone = (k, label, colr) => {
    const items = sortedStudents().filter(s => (s.g||'') === k);
    return `<div class="gzone" data-zone="${k}"><h3 data-action="dropSel" data-zone="${k}">${colr?`<span class="dot" style="background:${colr}"></span>`:''}${label} <span class="muted">(${items.length})</span></h3>
      <div class="gitems">${items.map(s=>`<div class="gitem ${UI.sel===s.id?'sel':''}" data-gid="${s.id}" style="${colr?`border-left:12px solid ${colr}`:''}">${esc(nameOf(s.id))}</div>`).join('')}</div></div>`;
  };
  return `<div class="card strong"><h2>Groupes de chasubles</h2><p class="muted" style="margin-top:-4px;font-weight:700">Faites glisser les prénoms dans la couleur voulue (ou touchez un prénom puis le titre d'une couleur). La couleur apparaît sur la tuile de l'élève.</p>
      <button class="btn small ghost" data-action="clearGroups">Tout retirer</button></div>
    <div class="groups">${zone('', 'Sans chasuble', null)}${COLORS.map(c=>zone(c.k, c.n, c.c)).join('')}</div>`;
}
function bindGroups(){
  let drag = null;
  document.querySelectorAll('.gitem').forEach(el => {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      drag = { id: el.dataset.gid, x0: e.clientX, y0: e.clientY, el, ghost: null, moved: false };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (!drag || drag.el !== el) return;
      if (!drag.moved && Math.hypot(e.clientX-drag.x0, e.clientY-drag.y0) < 8) return;
      if (!drag.moved) { drag.moved = true; drag.ghost = el.cloneNode(true); drag.ghost.classList.add('drag-ghost'); document.body.appendChild(drag.ghost); el.style.opacity = .3; }
      drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
      document.querySelectorAll('.gzone').forEach(z => z.classList.remove('hover'));
      const z = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gzone'); if (z) z.classList.add('hover');
      // défilement automatique près des bords
      if (e.clientY < 90) window.scrollBy(0, -12); else if (e.clientY > innerHeight - 60) window.scrollBy(0, 12);
    });
    const end = e => {
      if (!drag || drag.el !== el) return;
      const d = drag; drag = null;
      if (d.ghost) d.ghost.remove();
      document.querySelectorAll('.gzone').forEach(z => z.classList.remove('hover'));
      if (!d.moved) { UI.sel = UI.sel === d.id ? null : d.id; render(); return; }
      const z = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gzone');
      if (z) { const s = student(d.id); s.g = z.dataset.zone || null; UI.sel = null; save(); }
      render();
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  });
}
function profPartage(){
  return `<div class="card strong"><h2>1 · Envoyer la leçon aux tablettes</h2>
      <p class="muted" style="margin-top:-4px;font-weight:700">Liste des élèves (prénoms seulement), leçon en cours, cibles, chasubles, appel et résultats déjà centralisés. Sur chaque tablette : Accueil → « Recevoir la leçon (QR) ».</p>
      <button class="btn primary" data-action="showFullQR">📤 Afficher le QR de la leçon ${curLesson()}</button></div>
    <div class="card strong"><h2>2 · Récupérer les saisies des tablettes</h2>
      <p class="muted" style="margin-top:-4px;font-weight:700">Sur chaque tablette : Accueil → « Envoyer mes saisies (QR) », puis scannez ici. Les données sont fusionnées (la saisie la plus récente est conservée).</p>
      <button class="btn orange" data-action="scanResults">📷 Scanner une tablette</button></div>
    <div class="card"><h2>Sans caméra : par fichier</h2><div class="btn-row">
      <button class="btn" data-action="fileFull">💾 Fichier leçon (.json)</button>
      <label class="btn">📂 Importer un fichier (.json)<input type="file" id="file-sync" accept=".json,application/json" hidden></label></div></div>`;
}
function profExport(){
  return `<div class="card strong"><h2>Export Excel</h2><p class="muted" style="margin-top:-4px">Synthèse par élève + détail de chaque leçon (cibles, courses, tirs, appel, projet).</p>
      <button class="btn green" data-action="exportXlsx">📊 Exporter en .xlsx</button></div>
    <div class="card"><h2>Sauvegarde complète</h2><div class="btn-row">
      <button class="btn" data-action="backup">💾 Sauvegarder (.json)</button>
      <label class="btn">♻️ Restaurer<input type="file" id="file-restore" accept=".json,application/json" hidden></label></div></div>
    <div class="card"><h2>Code enseignant</h2><div class="row">
      <label class="field"><span>Nouveau code (4 chiffres)</span><input type="password" inputmode="numeric" maxlength="4" id="new-pin" style="max-width:180px"></label>
      <button class="btn" data-action="setPin" style="align-self:flex-end">Changer</button></div></div>
    <div class="card"><h2>Réinitialiser</h2><div class="btn-row">
      <button class="btn small ghost" data-action="clearResults">Effacer tous les résultats</button>
      <button class="btn small red" data-action="resetAll">Tout effacer (nouveau cycle)</button></div>
      <p class="muted" style="font-size:14px">Version ${APP_VERSION} · appareil ${esc(S.deviceId)}</p></div>`;
}

/* ---------------------------------------------------------------------
   Import de la liste d'élèves (Pronote, xlsx / csv)
   --------------------------------------------------------------------- */
async function readSheetRows(file){
  if (!window.XLSX) throw new Error('Bibliothèque Excel non chargée');
  const buf = await file.arrayBuffer();
  let wb;
  if (/\.(csv|txt)$/i.test(file.name)) {
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const FS = (first.match(/;/g)||[]).length >= (first.match(/,/g)||[]).length && first.includes(';') ? ';' : (first.includes('\t') ? '\t' : ',');
    wb = XLSX.read(text, { type:'string', FS, raw:true });
  } else wb = XLSX.read(buf, { type:'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:'' });
}
const HEADER_RX = /^(nom|noms|élève|élèves|eleve|eleves|nom\s*(et)?\s*pr[ée]nom|pr[ée]nom|identit[ée]|classe)\b/i;
const isNameLike = s => !!s && /^[A-Za-zÀ-ÖØ-öø-ÿ'’\- .]+$/.test(s) && !/\d/.test(s);
function parseStudents(rows){
  const out = [];
  rows.forEach((row, i) => {
    const a = String(row[0]||'').trim().replace(/\s+/g,' '), b = String(row[1]||'').trim().replace(/\s+/g,' ');
    if (!a) return;
    if (HEADER_RX.test(a) && (i < 3 || !b || HEADER_RX.test(b))) return;
    if (!isNameLike(a)) return;
    let nom, prenom;
    if (b && isNameLike(b) && !HEADER_RX.test(b)) { nom = a; prenom = b; }
    else {
      const tk = a.split(' ');
      const isUp = t => t === t.toUpperCase() && /[A-ZÀ-Ý]/.test(t);
      let k = 0; while (k < tk.length && isUp(tk[k])) k++;
      if (k === 0) { nom = tk[0]; prenom = tk.slice(1).join(' '); }          // pas de majuscules : 1er mot = nom
      else if (k === tk.length) { nom = tk.slice(0, Math.max(1,k-1)).join(' '); prenom = tk.slice(Math.max(1,k-1)).join(' '); }
      else { nom = tk.slice(0,k).join(' '); prenom = tk.slice(k).join(' '); }
      if (!prenom) { prenom = nom; }
    }
    out.push({ nom: nom.toUpperCase(), prenom: capName(prenom) });
  });
  return out;
}
async function importStudentsFile(file){
  try {
    const list = parseStudents(await readSheetRows(file));
    if (!list.length) return toast('Aucun élève reconnu dans ce fichier');
    let mode = 'add';
    if (S.students.length) {
      mode = await choiceBox('Importer ' + list.length + ' élève(s)', `La liste contient déjà ${S.students.length} élève(s).`,
        [{label:'Ajouter à la liste', value:'add', cls:'primary'}, {label:'Remplacer la liste', value:'replace', cls:'red'}]);
      if (!mode) return;
    }
    if (mode === 'replace') { S.students = []; S.results = {}; S.projects = {}; Object.values(S.lessons).forEach(L => { L.manual={}; L.adjust={}; L.att={}; }); }
    let added = 0;
    list.forEach(p => {
      if (S.students.some(s => s.nom === p.nom && (s.prenom||'').toLowerCase() === p.prenom.toLowerCase())) return;
      S.students.push({ id: newStudentId(), nom: p.nom, prenom: p.prenom, g: null }); added++;
    });
    save(); render(); toast(`✓ ${added} élève(s) importé(s)`);
  } catch(e){ console.error(e); toast('⚠️ Lecture impossible : ' + e.message, 3500); }
}

/* ---------------------------------------------------------------------
   Export Excel
   --------------------------------------------------------------------- */
function exportXlsx(){
  if (!window.XLSX) return toast('Bibliothèque Excel non chargée');
  const N = S.settings.nbLessons;
  const syn = [], det = [];
  const head = ['Nom', 'Prénom', 'Affiché', 'Chasuble', 'Cible test L1 (m)'];
  for (let n = 2; n <= N; n++) head.push(`L${n} cible (m)`, `L${n} moy /6`, `L${n} tirs`);
  head.push('Projet : cible (m)', 'Projet : texte');
  syn.push(head);
  let maxC = 0, maxT = 0; for (let n = 1; n <= N; n++) { maxC = Math.max(maxC, lesson(n).nbCourses); maxT = Math.max(maxT, lesson(n).nbTirs); }
  det.push(['Nom','Prénom','Leçon','Titre','Statut','Cible de base (m)','Ajustement (m)','Cible (m)', ...Array.from({length:maxC},(_,k)=>`Course ${k+1}`), 'Moyenne', 'Tirs réussis', 'Tirs saisis']);
  sortedStudents().forEach(s => {
    const nom = s.nom || '', pre = s.prenom || s.disp || '';
    const row = [nom, pre, nameOf(s.id), colorOf(s.g)?.n || '', testTarget(s.id) ?? ''];
    for (let n = 2; n <= N; n++) {
      const ti = targetInfo(n, s.id), r = res(n, s.id), a = attOf(n, s.id), v = vals(r?.c), t = (r?.t||[]).filter(x=>x!=null);
      row.push(ti.value ?? '', a==='abs' ? 'ABS' : a==='inap' ? 'INAPTE' : (v.length ? Math.round(avg(v)*100)/100 : ''), t.length ? `${t.filter(x=>x===1).length}/${t.length}` : '');
    }
    row.push(S.projects[s.id]?.cible ?? '', S.projects[s.id]?.texte ?? '');
    syn.push(row);
    for (let n = 1; n <= N; n++) {
      const ti = targetInfo(n, s.id), r = res(n, s.id), a = attOf(n, s.id), v = vals(r?.c), t = (r?.t||[]).filter(x=>x!=null);
      det.push([nom, pre, n, lesson(n).title, a==='abs'?'Absent':a==='inap'?'Inapte':'Présent',
        n===1 ? '' : (ti.base ?? ''), n===1 ? '' : (ti.adj || 0), ti.value ?? '',
        ...Array.from({length:maxC},(_,k)=> r?.c?.[k] ?? ''), v.length && n>1 ? Math.round(avg(v)*100)/100 : '',
        t.length ? t.filter(x=>x===1).length : '', t.length || '']);
    }
  });
  const wb = XLSX.utils.book_new();
  const w1 = XLSX.utils.aoa_to_sheet(syn); w1['!cols'] = head.map((_,i)=>({wch: i<3?16:12}));
  const w2 = XLSX.utils.aoa_to_sheet(det); w2['!cols'] = det[0].map((_,i)=>({wch: i===3?30:12}));
  XLSX.utils.book_append_sheet(wb, w1, 'Synthèse');
  XLSX.utils.book_append_sheet(wb, w2, 'Détail par leçon');
  const lessons = []; for (let n = 1; n <= N; n++) lessons.push([n, lesson(n).title, lesson(n).nbCourses, lesson(n).nbTirs, n===1?'Test':(lesson(n).source==='test'?'Test L1':'Leçon '+lesson(n).source)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Leçon','Titre','Courses','Tirs','Cible de base'], ...lessons]), 'Leçons');
  const name = `Biathlon5s_${(S.settings.className||'classe').replace(/[^\wÀ-ÿ-]+/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, name);
  toast('✓ Fichier Excel créé');
}

/* ---------------------------------------------------------------------
   Échanges : paquets, compression, QR codes
   --------------------------------------------------------------------- */
function buildFull(){
  return { k:'full', from:S.deviceId, at:now(), st:{
    settings:{ nbLessons:S.settings.nbLessons, current:curLesson(), className:S.settings.className },
    students: S.students.map(s => ({ id:s.id, disp:nameOf(s.id), g:s.g||null })),
    lessons: S.lessons, results: S.results, projects: S.projects } };
}
function buildMine(){
  const results = {}, projects = {};
  let count = 0;
  Object.entries(S.results).forEach(([n, byS]) => Object.entries(byS).forEach(([sid, r]) => {
    if (r.d === S.deviceId) { (results[n] = results[n] || {})[sid] = r; count++; } }));
  Object.entries(S.projects).forEach(([sid, p]) => { if (p.d === S.deviceId) { projects[sid] = p; count++; } });
  return { pkt: { k:'res', from:S.deviceId, at:now(), results, projects }, count };
}
function mergeData(results, projects){
  let n = 0;
  Object.entries(results||{}).forEach(([l, byS]) => Object.entries(byS||{}).forEach(([sid, r]) => {
    S.results[l] = S.results[l] || {};
    const cur = S.results[l][sid];
    if (!cur || (r.ts||0) > (cur.ts||0)) { S.results[l][sid] = r; n++; }
  }));
  Object.entries(projects||{}).forEach(([sid, p]) => {
    const cur = S.projects[sid];
    if (!cur || (p.ts||0) > (cur.ts||0)) { S.projects[sid] = p; n++; }
  });
  return n;
}
async function applyPacket(p){
  if (!p || !p.k) throw new Error('Données non reconnues');
  if (p.k === 'full') {
    const st = p.st;
    if (S.students.some(s => s.nom) && p.from !== S.deviceId) {
      const ok = await confirmBox('Remplacer la liste de cet appareil ?', 'Cet appareil contient une liste d\'élèves complète (enseignant). La leçon reçue la remplacera par les prénoms seuls.', 'Remplacer', true);
      if (!ok) return;
    }
    S.settings.nbLessons = st.settings.nbLessons; S.settings.current = st.settings.current; S.settings.className = st.settings.className || '';
    S.students = st.students.map(s => ({ id:s.id, disp:s.disp, g:s.g }));
    S.lessons = st.lessons || {};
    const n = mergeData(st.results, st.projects);
    save(); toast(`✓ Leçon ${st.settings.current} reçue : ${S.students.length} élèves`, 3000);
    go('home');
    return n;
  }
  if (p.k === 'res') {
    const n = mergeData(p.results, p.projects);
    save(); toast(`✓ Tablette ${p.from} : ${n} saisie(s) nouvelle(s) ou mise(s) à jour`, 3500);
    return n;
  }
  throw new Error('Type de données inconnu');
}

const b64enc = u8 => { let s=''; for (let i=0;i<u8.length;i+=0x8000) s += String.fromCharCode.apply(null, u8.subarray(i,i+0x8000)); return btoa(s); };
const b64dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function streamBytes(u8, ts){ const st = new Blob([u8]).stream().pipeThrough(ts); return new Uint8Array(await new Response(st).arrayBuffer()); }
async function encodePacket(obj){
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (window.CompressionStream) {
    try { return 'z' + b64enc(await streamBytes(raw, new CompressionStream('deflate-raw'))); } catch(e){}
  }
  return 'j' + b64enc(raw);
}
async function decodePacket(str){
  const flag = str[0], bytes = b64dec(str.slice(1));
  let raw = bytes;
  if (flag === 'z') {
    if (!window.DecompressionStream) throw new Error('Appareil trop ancien pour décompresser');
    raw = await streamBytes(bytes, new DecompressionStream('deflate-raw'));
  }
  return JSON.parse(new TextDecoder().decode(raw));
}
function chunkQR(payload, type){
  const id = rnd(4), parts = [];
  const n = Math.max(1, Math.ceil(payload.length / QR_CHUNK));
  for (let i = 0; i < n; i++) parts.push(`B5|${type}|${id}|${i+1}|${n}|` + payload.slice(i*QR_CHUNK, (i+1)*QR_CHUNK));
  return parts;
}
function qrDataURL(text){
  const qr = qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make();
  return qr.createDataURL(8, 2);
}

/* Affichage d'une série de QR (défilement automatique) */
let qrTimer = null;
function showQRSeries(parts, container, title){
  let i = 0, auto = parts.length > 1;
  const draw = () => {
    container.innerHTML = `<div class="qr-box">
      ${title?`<h2 class="center">${title}</h2>`:''}
      <img src="${qrDataURL(parts[i])}" alt="QR code ${i+1}/${parts.length}">
      <div class="qr-part">${parts.length>1?`QR ${i+1} / ${parts.length}`:'QR unique'}</div>
      ${parts.length>1?`<div class="btn-row"><button class="btn" data-q="prev">←</button>
        <button class="btn ${auto?'orange':''}" data-q="auto">${auto?'⏸ Pause':'▶ Défilement auto'}</button>
        <button class="btn" data-q="next">→</button></div>
        <p class="muted center" style="font-weight:700;max-width:460px">Tenez la tablette qui scanne face à l'écran : les ${parts.length} QR défilent seuls, le scanner assemble tout.</p>`:''}
    </div>`;
    container.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      const q = b.dataset.q;
      if (q === 'auto') auto = !auto;
      if (q === 'prev') { auto = false; i = (i - 1 + parts.length) % parts.length; }
      if (q === 'next') { auto = false; i = (i + 1) % parts.length; }
      draw();
    });
  };
  clearInterval(qrTimer);
  qrTimer = setInterval(() => { if (auto && document.body.contains(container)) { i = (i+1) % parts.length; draw(); } else if (!document.body.contains(container)) clearInterval(qrTimer); }, 1400);
  draw();
}

/* Scanner (caméra + jsQR) */
let scan = null;
function stopScan(){
  if (!scan) return;
  scan.stopped = true;
  if (scan.stream) scan.stream.getTracks().forEach(t => t.stop());
  scan = null;
}
async function startScan(container, expectType, onDone){
  stopScan();
  container.innerHTML = `<div class="scan-wrap"><video playsinline muted autoplay></video><div class="scan-frame"></div></div>
    <div style="max-width:520px;margin:12px auto"><div class="progress"><div style="width:0%"></div></div>
    <p class="center" style="font-weight:900;font-size:20px" id="scan-msg">Visez le QR code…</p></div>`;
  const video = container.querySelector('video'), bar = container.querySelector('.progress>div'), msg = container.querySelector('#scan-msg');
  const me = scan = { stopped:false, parts:{}, id:null, n:0 };
  try {
    me.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false });
  } catch(e) {
    msg.innerHTML = '⚠️ Caméra inaccessible. Autorisez la caméra (réglages du navigateur) ou utilisez l\'échange par fichier.';
    return;
  }
  if (me.stopped) { me.stream.getTracks().forEach(t=>t.stop()); return; }
  video.srcObject = me.stream; try { await video.play(); } catch(e){}
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently:true });
  const tick = async () => {
    if (me.stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const sc = Math.min(1, 800 / video.videoWidth);
      cv.width = Math.round(video.videoWidth * sc); cv.height = Math.round(video.videoHeight * sc);
      ctx.drawImage(video, 0, 0, cv.width, cv.height);
      const img = ctx.getImageData(0, 0, cv.width, cv.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts:'dontInvert' });
      if (code && code.data && code.data.startsWith('B5|')) {
        const [, type, id, i, n] = code.data.split('|', 5);
        const data = code.data.split('|').slice(5).join('|');
        if (expectType && type !== expectType) {
          msg.textContent = type === 'F' ? 'Ceci est un QR de leçon (prof), pas une saisie de tablette.' : 'Ceci est un QR de saisies (tablette), pas une leçon.';
        } else {
          if (me.id !== id) { me.id = id; me.parts = {}; me.n = +n; }
          if (!me.parts[i]) { me.parts[i] = data; if (navigator.vibrate) navigator.vibrate(40); }
          const got = Object.keys(me.parts).length;
          bar.style.width = (got / me.n * 100) + '%';
          msg.textContent = me.n > 1 ? `QR reçus : ${got} / ${me.n}` : 'QR reçu !';
          if (got === me.n) {
            const payload = Array.from({length: me.n}, (_, k) => me.parts[k+1]).join('');
            stopScan();
            try { await onDone(await decodePacket(payload)); }
            catch(e) { console.error(e); toast('⚠️ ' + e.message, 3500); }
            return;
          }
        }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* Vues d'échange côté tablette */
function viewSend(){
  const { count } = buildMine();
  return `<div class="card strong center"><b style="font-size:20px">${count} saisie(s) faite(s) sur cette tablette</b>
    <div class="muted" style="font-weight:700">L'enseignant scanne ce QR dans « Espace enseignant → QR tablettes → Scanner une tablette ».</div></div>
    <div id="qr-area" class="center">Préparation…</div>
    <div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn" data-action="fileMine">💾 Enregistrer en fichier à la place</button></div>`;
}
async function afterSend(){
  const { pkt } = buildMine();
  const payload = await encodePacket(pkt);
  const area = $('#qr-area'); if (!area) return;
  showQRSeries(chunkQR(payload, 'R'), area, '');
}
function viewReceive(){
  return `<div class="card strong center"><b style="font-size:20px">Scannez le QR « leçon » affiché par l'enseignant</b>
    <div class="muted" style="font-weight:700">La tablette s'ouvrira ensuite sur la leçon choisie par le professeur. Les saisies déjà faites ici sont conservées.</div></div>
    <div id="scan-area"></div>
    <div class="btn-row" style="justify-content:center;margin-top:12px"><label class="btn">📂 Importer un fichier (.json)<input type="file" id="file-sync" accept=".json,application/json" hidden></label></div>`;
}
function afterReceive(){ startScan($('#scan-area'), 'F', p => applyPacket(p)); }

function downloadJSON(obj, name){
  const blob = new Blob([JSON.stringify(obj)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function importSyncFile(file){
  try {
    const obj = JSON.parse(await file.text());
    if (obj.k) await applyPacket(obj);
    else if (obj.settings && obj.students) {
      if (!(await confirmBox('Restaurer la sauvegarde ?', 'Toutes les données de cet appareil seront remplacées.', 'Restaurer', true))) return;
      const dev = S.deviceId; S = obj; S.deviceId = dev; save(); toast('✓ Sauvegarde restaurée'); go('home');
    } else throw new Error('Fichier non reconnu');
    render();
  } catch(e){ toast('⚠️ ' + e.message, 3500); }
}

/* ---------------------------------------------------------------------
   Actions (délégation d'événements)
   --------------------------------------------------------------------- */
const A = {
  go: d => go(d.view),
  openProf: () => openProf(),
  profTab: d => { UI.profTab = d.tab; UI.sel = null; render(); },
  filter: d => { UI.filter = d.g || null; render(); },
  entry: d => { if (d.sid) go('entry', { sid: d.sid }); },
  statsDetail: d => go('statsDetail', { sid: d.sid }),

  // saisie
  dist: d => { const n = curLesson(), sid = UI.sid, k = +d.k;
    setRes(n, sid, r => { const prevVals = vals(r.c); const base = r.c[k] ?? (prevVals.length ? prevVals[prevVals.length-1] : (testTarget(sid) ?? DEFAULT_DIST));
      r.c[k] = Math.max(0, Math.round((base + (r.c[k]==null ? 0 : +d.d))*10)/10); });
    render(); flagSaved(); },
  distType: async d => { const n = curLesson(), sid = UI.sid, k = +d.k;
    const v = await numberBox(`Essai ${k+1} : distance en 5 s`, res(n,sid)?.c?.[k] ?? '', { step:0.5, min:0, max:80 });
    if (v != null) { setRes(n, sid, r => { r.c[k] = Math.round(v*10)/10; }); render(); flagSaved(); } },
  distClear: d => { setRes(curLesson(), UI.sid, r => { r.c[+d.k] = null; }); render(); },
  dialClear: d => { setRes(curLesson(), UI.sid, r => { r.c[+d.k] = null; }); render(); },
  shot: d => { const k = +d.k; setRes(curLesson(), UI.sid, r => { r.t = r.t || []; const v = r.t[k]; r.t[k] = v == null ? 1 : v === 1 ? 0 : null; });
    render(); flagSaved(); },

  // projet élève
  projStep: d => { const el = $('#proj-cible'); let v = parseFloat(el.dataset.v); if (isNaN(v)) v = DEFAULT_DIST;
    v = Math.max(0, Math.round((v + (+d.d))*10)/10); el.dataset.v = v; el.textContent = fmt(v) + ' m'; },
  projSave: () => { const v = parseFloat($('#proj-cible').dataset.v);
    S.projects[UI.sid] = { cible: isNaN(v) ? null : v, texte: $('#proj-text').value.trim(), ts: now(), d: S.deviceId };
    save(); toast('✓ Projet enregistré'); render(); },

  // prof : leçons
  setCurrent: d => { S.settings.current = +d.n; save(); render(); toast(`Leçon ${d.n} sélectionnée`); },
  nbLessons: d => { S.settings.nbLessons = Math.max(2, Math.min(30, S.settings.nbLessons + (+d.d))); if (S.settings.current > S.settings.nbLessons) S.settings.current = S.settings.nbLessons; save(); render(); },
  lessonStep: d => { const L = lesson(d.n); const min = d.k === 'nbCourses' ? 1 : 0; L[d.k] = Math.max(min, Math.min(20, L[d.k] + (+d.d))); save(); render(); },

  // prof : élèves
  addStudent: () => { const nom = $('#add-nom').value.trim(), pre = $('#add-prenom').value.trim();
    if (!pre) return toast('Indiquez au moins le prénom');
    S.students.push({ id:newStudentId(), nom: nom.toUpperCase(), prenom: capName(pre), g:null }); save(); render(); toast('✓ ' + capName(pre) + ' ajouté(e)'); },
  delStudent: async d => { if (await confirmBox('Retirer ' + nameOf(d.sid) + ' ?', 'Ses résultats seront conservés dans les sauvegardes existantes mais n\'apparaîtront plus.', 'Retirer', true)) {
    S.students = S.students.filter(s => s.id !== d.sid); save(); render(); } },
  clearStudents: async () => { if (await confirmBox('Vider la liste ?', 'Tous les élèves et leurs résultats seront supprimés de cet appareil.', 'Vider', true)) {
    S.students = []; S.results = {}; S.projects = {}; save(); render(); } },

  // prof : appel
  att: d => { const L = lesson(curLesson()); L.att[d.sid] = L.att[d.sid] === d.v ? undefined : d.v; if (!L.att[d.sid]) delete L.att[d.sid]; save(); render(); },

  // prof : cibles
  adjust: d => { const L = lesson(curLesson()); if (+d.v) L.adjust[d.sid] = +d.v; else delete L.adjust[d.sid]; save(); render(); },
  manualTarget: async d => { const n = curLesson(), L = lesson(n);
    const cur = n === 1 ? testTarget(d.sid) : baseTarget(n, d.sid);
    const v = await numberBox(`${n===1?'Cible test':'Cible de base'} de ${nameOf(d.sid)}`, cur ?? '', { step:0.5, min:0, max:80 });
    if (v != null) { L.manual[d.sid] = Math.round(v*10)/10; save(); render(); } },
  resetTarget: d => { delete lesson(curLesson()).manual[d.sid]; save(); render(); },

  // prof : groupes
  dropSel: d => { if (!UI.sel) return; const s = student(UI.sel); if (s) { s.g = d.zone || null; save(); } UI.sel = null; render(); },
  clearGroups: () => { S.students.forEach(s => s.g = null); save(); render(); },

  // prof : partage
  showFullQR: async () => {
    const payload = await encodePacket(buildFull());
    const parts = chunkQR(payload, 'F');
    const m = modal(`<div id="qr-modal"></div><div class="btn-row" style="justify-content:center;margin-top:10px"><button class="btn primary" data-close>Fermer</button></div>`, { wide:true });
    m.querySelector('[data-close]').onclick = closeModal;
    showQRSeries(parts, m.querySelector('#qr-modal'), `Leçon ${curLesson()} → tablettes`);
  },
  scanResults: () => {
    const m = modal(`<h2>Scanner une tablette</h2><div id="scan-modal"></div><div class="btn-row" style="justify-content:center;margin-top:10px"><button class="btn primary" data-close>Terminer</button></div>`, { wide:true });
    m.querySelector('[data-close]').onclick = () => { closeModal(); render(); };
    const again = () => startScan(m.querySelector('#scan-modal'), 'R', async p => { await applyPacket(p); setTimeout(() => { if (document.body.contains(m)) again(); }, 1200); });
    again();
  },
  fileFull: () => downloadJSON(buildFull(), `Biathlon5s_lecon${curLesson()}.json`),
  fileMine: () => downloadJSON(buildMine().pkt, `Biathlon5s_saisies_${S.deviceId}.json`),

  // export / réglages
  exportXlsx: () => exportXlsx(),
  backup: () => downloadJSON(S, `Biathlon5s_sauvegarde_${new Date().toISOString().slice(0,10)}.json`),
  setPin: () => { const v = $('#new-pin').value.trim(); if (!/^\d{4}$/.test(v)) return toast('4 chiffres requis'); S.settings.pin = v; save(); $('#new-pin').value=''; toast('✓ Code modifié'); },
  clearResults: async () => { if (await confirmBox('Effacer tous les résultats ?', 'Performances, tirs et projets seront supprimés (la liste et les leçons restent).', 'Effacer', true)) { S.results = {}; S.projects = {}; save(); render(); } },
  resetAll: async () => { if (await confirmBox('Tout effacer ?', 'Élèves, leçons, résultats : cet appareil repart à zéro (le code enseignant est conservé).', 'Tout effacer', true)) {
    const pin = S.settings.pin, dev = S.deviceId; S = defaultState(); S.settings.pin = pin; S.deviceId = dev; save(); go('home'); } },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el.dataset, el); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'file-students' && t.files[0]) { importStudentsFile(t.files[0]); t.value=''; return; }
  if ((t.id === 'file-sync' || t.id === 'file-restore') && t.files[0]) { importSyncFile(t.files[0]); t.value=''; return; }
  const f = t.dataset.field; if (!f) return;
  if (f === 'className') { S.settings.className = t.value.trim(); save(); }
  if (f === 'title') { lesson(t.dataset.n).title = t.value.trim(); save(); }
  if (f === 'source') { lesson(t.dataset.n).source = t.value === 'test' ? 'test' : +t.value; save(); render(); }
});

/* ---------------------------------------------------------------------
   Démarrage
   --------------------------------------------------------------------- */
for (let n = 1; n <= S.settings.nbLessons; n++) lesson(n);
computeNames();
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});
