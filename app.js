/* =====================================================================
   Biathlon 5 s / Lancer long — Suivi de performance élèves
   N'EPS numérique — CA1 — By Quentin Delisle & Gwilherm Rocher
   PWA hors-ligne : données stockées sur l'appareil (localStorage),
   échanges entre tablettes par QR codes.
   Mesure : 1 point par plot atteint.
     Sprint 5 s : plot 1 = 15 km/h, plot 2 = 16 km/h … plot 11 = 25 km/h
     Lancer long : plot 1 à 4 m, puis un plot tous les 2 m (8 plots, jusqu'à 12)
   ===================================================================== */
'use strict';

const APP_VERSION = '2.0.0';
const STORE_KEY = 'neps_biathlon5s_v2';
const QR_CHUNK = 750;           // caractères par QR (lisible par une caméra de tablette)

/* Les deux épreuves du biathlon */
const ACT = {
  s: { id:'s', key:'c', ico:'🏃', label:'Sprint 5 s', att:'nbCourses', base:'baseCourses', plots:'plotsS', ecart:'ecartS',
       man:'manual', adj:'adjust', proj:'cibleS', maxPlots:11, minPlots:3, word:'course',
       unit: k => `${14+k} km/h`, detail: k => `${fmt((14+k)/3.6*5)} m en 5 s` },
  b: { id:'b', key:'b', ico:'🏀', label:'Lancer long', att:'nbTirs', base:'baseTirs', plots:'plotsB', ecart:'ecartB',
       man:'manualB', adj:'adjustB', proj:'cibleB', maxPlots:12, minPlots:3, word:'lancer',
       unit: k => `${2*k+2} m`, detail: k => `plot à ${2*k+2} m` },
};
const plotTxt = (a, k) => k == null ? '—' : k === 0 ? 'aucun plot' : `Plot ${k} · ${ACT[a].unit(k)}`;
const plotShort = (a, k) => k == null ? '—' : `P${k} · ${ACT[a].unit(k)}`;

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
const DEFAULT_SETTINGS = { nbLessons:8, current:1, pin:'0000', className:'',
  baseCourses:3, baseTirs:3, plotsS:11, plotsB:8, ecartS:2, ecartB:1 };
function defaultState(){
  return { v:2, deviceId: rnd(4), settings:{ ...DEFAULT_SETTINGS },
    students:[], lessons:{}, results:{}, projects:{} };
}
let S;
try { S = JSON.parse(localStorage.getItem(STORE_KEY)) || defaultState(); } catch(e){ S = defaultState(); }
if (!S.deviceId) S.deviceId = rnd(4);
S.settings = { ...DEFAULT_SETTINGS, ...(S.settings||{}) };
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
  if (L.title == null) L.title = n===1 ? 'Test : sprint 5 s et lancer long' : '';
  if (L.source == null) L.source = 'test';
  ['manual','adjust','manualB','adjustB','att'].forEach(k => { L[k] = L[k] || {}; });
  return L;
}
const curLesson = () => Math.min(S.settings.current || 1, S.settings.nbLessons);
const isLast = n => +n === +S.settings.nbLessons && n > 1;
const attOf = (n, sid) => lesson(n).att[sid] || null;           // 'abs' | 'inap' | null
const present = (n, sid) => !attOf(n, sid);
const maxPlots = a => +S.settings[ACT[a].plots];
/* Nombre de tentatives : base commune à toutes les leçons, ajustable leçon par leçon */
const nbAtt = (n, a) => { const v = lesson(n)[ACT[a].att]; return v == null ? +S.settings[ACT[a].base] : +v; };
const isOverride = (n, a) => lesson(n)[ACT[a].att] != null;

function res(n, sid){ return (S.results[n] && S.results[n][sid]) || null; }
function setRes(n, sid, fn){
  S.results[n] = S.results[n] || {};
  const r = S.results[n][sid] || { c:[], b:[] };
  r.c = r.c || []; r.b = r.b || [];
  fn(r); r.ts = now(); r.d = S.deviceId;
  S.results[n][sid] = r; save();
}
const perf = (n, sid, a) => res(n, sid)?.[ACT[a].key] || [];
const vals = arr => (arr||[]).filter(v => v != null && !isNaN(v));
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
const clampT = (a, v) => v == null ? null : Math.max(1, Math.min(maxPlots(a), Math.round(v)));

/* Cible issue du test (leçon 1) : meilleur plot atteint, ou valeur fixée par l'enseignant */
function testTarget(sid, a){
  const L1 = lesson(1);
  if (L1[ACT[a].man][sid] != null) return +L1[ACT[a].man][sid];
  const v = vals(perf(1, sid, a));
  return v.length ? clampT(a, Math.max(...v)) : null;
}
/* Cible de base d'une leçon (sans facile / difficile) */
function baseTarget(n, sid, a, depth=0){
  n = +n;
  if (n <= 1 || depth > 30) return testTarget(sid, a);
  const L = lesson(n);
  if (L[ACT[a].man][sid] != null) return +L[ACT[a].man][sid];
  if (isLast(n) && S.projects[sid] && S.projects[sid][ACT[a].proj] != null) return +S.projects[sid][ACT[a].proj];
  const src = L.source;
  if (src === 'test' || !src || +src >= n || +src < 2) return testTarget(sid, a);
  return baseTarget(+src, sid, a, depth+1);
}
function targetInfo(n, sid, a){
  n = +n;
  if (n === 1) { const t = testTarget(sid, a); return { value:t, base:t, adj:0, test:true, manual: lesson(1)[ACT[a].man][sid] != null }; }
  const L = lesson(n);
  const base = baseTarget(n, sid, a);
  const sign = +(L[ACT[a].adj][sid] || 0);
  const adj = sign * +S.settings[ACT[a].ecart];
  const value = base == null ? null : clampT(a, base + adj);
  const prev = n === 2 ? testTarget(sid, a) : targetInfo(n-1, sid, a).value;
  const fromProject = isLast(n) && L[ACT[a].man][sid] == null && S.projects[sid]?.[ACT[a].proj] != null;
  const src = L[ACT[a].man][sid] != null ? 'modifiée' : fromProject ? 'projet' : (L.source === 'test' || !L.source ? 'test L1' : 'leçon ' + L.source);
  return { value, base, adj, sign, prev, changed: prev != null && value != null && prev !== value,
           manual: L[ACT[a].man][sid] != null, fromProject, src };
}
function targetTags(ti, a){
  let h = '';
  const e = S.settings[ACT[a].ecart];
  if (ti.sign < 0) h += ` <span class="tag easy">Facile −${e}</span>`;
  if (ti.sign > 0) h += ` <span class="tag hard">Difficile +${e}</span>`;
  if (ti.fromProject) h += ` <span class="tag proj">Projet</span>`;
  else if (ti.manual) h += ` <span class="tag mod">Modifiée</span>`;
  return h;
}
function isComplete(n, sid){
  return vals(perf(n, sid, 's')).length >= nbAtt(n, 's') && vals(perf(n, sid, 'b')).length >= nbAtt(n, 'b');
}
/* Couleur d'une performance par rapport à la cible */
function scoreCls(v, t){
  if (v == null) return 's-none';
  if (t == null) return 's-dist';
  return v >= t ? 's-hi' : v >= t - 1 ? 's-mid' : 's-lo';
}

/* ---------------------------------------------------------------------
   Conseils automatiques
   --------------------------------------------------------------------- */
function advicesFor(sid, a){
  const out = [], A_ = ACT[a], N = S.settings.nbLessons;
  const done = [];
  for (let n = 2; n <= N; n++) { const v = vals(perf(n, sid, a)); if (v.length) done.push({ n, v, raw: perf(n, sid, a), t: targetInfo(n, sid, a).value }); }
  const P = A_.ico + ' ';
  if (!done.length) {
    const t = testTarget(sid, a);
    if (t != null) out.push({ cls:'info', t:`${P}Ta cible de départ : <b>${plotTxt(a, t)}</b>. À toi de l'atteindre à chaque ${A_.word} !` });
    return out;
  }
  const last = done[done.length-1], prev = done[done.length-2], t = last.t, c = last.raw;
  if (t != null && c[0] != null && c[1] != null && c[0] < t && c[1] < t)
    out.push({ cls:'', t:`${P}Leçon ${last.n} : tes premières performances sont inférieures à la cible, pense à bien t'échauffer${a==='s'?' (gammes, accélérations progressives)':' (lancers progressifs, épaules)'} avant de commencer.` });
  const allOk = t != null && last.v.length >= 2 && last.v.every(v => v >= t);
  const prevOk = prev && prev.t != null && prev.v.length >= 2 && prev.v.every(v => v >= prev.t);
  const above = t != null && last.v.filter(v => v > t).length;
  if (allOk) out.push({ cls:'', t: (prevOk || above >= 2)
      ? `${P}Tu atteins ta cible à <b>chaque ${A_.word}</b>${prevOk?' depuis 2 leçons':''} : elle est sans doute trop facile. Demande à ton enseignant de la revoir (plot supérieur ou cible difficile).`
      : `${P}Tu as atteint ta cible à toutes tes tentatives : peut-être faut-il la revoir à la hausse ?` });
  const m = avg(last.v);
  if (t != null && m != null && last.v.length >= 2 && m <= t - 2)
    out.push({ cls:'', t:`${P}En moyenne tu atteins le plot ${fmt(m)} pour une cible au plot ${t} : ta cible est peut-être trop difficile aujourd'hui. Tu peux demander une cible facile.` });
  const lastIdx = c.length - 1;
  if (last.v.length >= 3 && c[lastIdx] != null && c[0] != null && c[lastIdx] <= c[0] - 2)
    out.push({ cls:'', t:`${P}Tes performances baissent sur les dernières tentatives : récupère bien entre chaque ${A_.word} et dose ton effort.` });
  if (prev) {
    const d = avg(last.v) - avg(prev.v);
    if (d >= 1) out.push({ cls:'good', t:`${P}Bravo ! Tu progresses de ${fmt(d)} plot(s) en moyenne entre la leçon ${prev.n} et la leçon ${last.n}.` });
  }
  return out;
}
function advices(sid){
  const out = [...advicesFor(sid, 's'), ...advicesFor(sid, 'b')];
  if (!out.length) out.push({ cls: vals(perf(1,sid,'s')).length ? 'good' : 'info',
    t: vals(perf(1,sid,'s')).length ? 'Continue comme ça : tes performances sont proches de tes cibles.' : 'Pas encore de performances enregistrées.' });
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
      <div class="big">Leçon ${n} / ${S.settings.nbLessons}${n===1?' · TEST':''}</div>
      <div style="font-size:20px;font-weight:800">${esc(L.title || 'Sans titre')}</div>
      <div class="muted" style="font-weight:700">🏃 ${nbAtt(n,'s')} sprint(s) de 5 s · 🏀 ${nbAtt(n,'b')} lancer(s) long(s) · ${pres}/${S.students.length} élève(s) présent(s)</div>
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
  return `<div class="card strong"><b style="font-size:20px">Leçon ${n}${n===1?' · TEST':''} ${L.title?'– '+esc(L.title):''}</b>
      <div class="muted" style="font-weight:700">🏃 ${nbAtt(n,'s')} sprint(s) de 5 s · 🏀 ${nbAtt(n,'b')} lancer(s) long(s) · 1 point par plot atteint${off?` · ${off} absent(s)/inapte(s) masqué(s)`:''}</div>
      <div class="muted">Touche la tuile de l'élève que tu observes.</div></div>
    ${filterBar()}
    <div class="tiles">${list.map(s => saisieTile(n, s)).join('') || '<p>Aucun élève dans ce groupe.</p>'}</div>`;
}
function tileTarget(n, sid, a){
  const ti = targetInfo(n, sid, a);
  if (n === 1) return `<div class="target">${ACT[a].ico} ${ti.value!=null?'Test : '+plotShort(a, ti.value):'Test'}</div>`;
  return `<div class="target">${ACT[a].ico} 🎯 ${ti.value!=null ? plotShort(a, ti.value) : '—'}${targetTags(ti, a)}</div>`;
}
function saisieTile(n, s){
  const done = isComplete(n, s.id);
  return `<button class="tile ${done?'done':''}" data-action="entry" data-sid="${s.id}">${band(s.id)}
    ${done?'<span class="check">✓</span>':''}
    <span class="name">${esc(nameOf(s.id))}</span>${tileTarget(n, s.id, 's')}${tileTarget(n, s.id, 'b')}
    <span class="meta">Sprints ${vals(perf(n,s.id,'s')).length}/${nbAtt(n,'s')} · Lancers ${vals(perf(n,s.id,'b')).length}/${nbAtt(n,'b')}</span></button>`;
}

/* ---------------------------------------------------------------------
   Saisie : écran d'un élève
   --------------------------------------------------------------------- */
function viewEntry(){
  const n = curLesson(), sid = UI.sid, s = student(sid);
  if (!s) return '<p>Élève introuvable.</p>';
  const list = sortedStudents().filter(x => present(n, x.id) && passFilter(x));
  const i = list.findIndex(x => x.id === sid);
  const prev = list[i-1], next = list[i+1];
  const head = a => { const ti = targetInfo(n, sid, a);
    return `<div class="tgt-box"><div class="muted" style="font-weight:800">${ACT[a].ico} ${n===1?'TEST ':'CIBLE '}${ACT[a].label.toUpperCase()}</div>
      <div class="v">${ti.value!=null?'Plot '+ti.value:'—'}</div><div style="font-weight:800">${ti.value!=null?ACT[a].unit(ti.value):''}${n>1?targetTags(ti, a):''}</div></div>`; };
  let h = `<div class="entry-head">${band(sid)}<div class="who">${esc(nameOf(sid))}</div><div class="tgt">${head('s')}${head('b')}</div></div>
    <div class="btn-row" style="margin-bottom:12px"><button class="btn" data-action="go" data-view="saisie">← Retour aux tuiles</button>
      <span class="saved" id="saved-flag"></span></div>`;
  ['s','b'].forEach(a => {
    const A_ = ACT[a], nb = nbAtt(n, a), p = perf(n, sid, a), t = targetInfo(n, sid, a).value, mx = maxPlots(a);
    if (!nb) return;
    h += `<h2 style="margin-top:14px">${A_.ico} ${A_.label} · ${nb} ${A_.word}${nb>1?'s':''}</h2>
      <p class="muted" style="margin-top:-6px;font-weight:700">Tourne la molette (ou touche un chiffre) : dernier plot atteint, de 0 à ${mx}
      (${a==='s' ? `plot 1 = 15 km/h … plot ${mx} = ${14+mx} km/h` : `plot 1 à 4 m … plot ${mx} à ${2*mx+2} m`}).${t!=null && n>1?` <b style="color:var(--orange)">Cible : plot ${t}</b>`:''}</p>
      <div class="dials">`;
    for (let k = 0; k < nb; k++) {
      h += `<div class="dial-card"><h3>${A_.word[0].toUpperCase()+A_.word.slice(1)} ${k+1}</h3>
        <svg class="dial" viewBox="0 0 200 200" data-a="${a}" data-k="${k}">${dialInner(p[k], mx, n>1?t:null, a)}</svg>
        <button class="btn small ghost" data-action="dialClear" data-a="${a}" data-k="${k}">Effacer</button></div>`;
    }
    h += `</div>`;
  });
  h += `<div class="nav-bottom">
      <button class="btn" data-action="entry" data-sid="${prev?.id||''}" ${prev?'':'disabled'}>← ${prev?esc(nameOf(prev.id)):'Précédent'}</button>
      <button class="btn primary" data-action="go" data-view="saisie">▦ Tuiles</button>
      <button class="btn" data-action="entry" data-sid="${next?.id||''}" ${next?'':'disabled'}>${next?esc(nameOf(next.id)):'Suivant'} →</button></div>`;
  return h;
}
function flagSaved(){ const f=$('#saved-flag'); if (f){ f.textContent='✓ Enregistré'; clearTimeout(f._h); f._h=setTimeout(()=>f.textContent='',1500);} }

/* Molette circulaire graduée de 0 au nombre de plots */
const DIAL_START = -135, DIAL_SPAN = 270, CX = 100, CY = 100, DR = 80;
function pol(r, a){ const t = a*Math.PI/180; return [CX + r*Math.sin(t), CY - r*Math.cos(t)]; }
function arc(r, a0, a1){ const [x0,y0]=pol(r,a0),[x1,y1]=pol(r,a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; }
function dialColor(v, t){ return v==null ? '#9AA3B5' : t==null ? '#0B2A6B' : v>=t ? '#12813A' : v>=t-1 ? '#F07000' : '#D0161B'; }
function dialInner(v, max, t, a){
  const col = dialColor(v, t), step = DIAL_SPAN / max;
  const rr = max > 9 ? 12.5 : 15, ro = max > 9 ? 16 : 19, fs = max > 9 ? 14 : 17;
  let s = `<path d="${arc(DR, DIAL_START, -DIAL_START)}" stroke="#DCE2EE" stroke-width="20" fill="none" stroke-linecap="round"/>`;
  if (v != null && v > 0) s += `<path d="${arc(DR, DIAL_START, DIAL_START + v*step)}" stroke="${col}" stroke-width="20" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i <= max; i++) {
    const ang = DIAL_START + i*step, [x,y] = pol(DR, ang), on = v === i, isT = t === i;
    if (isT) s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${ro+4}" fill="none" stroke="#F07000" stroke-width="4" stroke-dasharray="4 3"/>`;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${on?ro:rr}" fill="${on?col:'#fff'}" stroke="${on?'#0A1633':'#0B2A6B'}" stroke-width="2.5"/>
      <text x="${x.toFixed(1)}" y="${(y+(on?6.5:5)).toFixed(1)}" text-anchor="middle" font-size="${on?fs+3:fs}" fill="${on?'#fff':'#0B2A6B'}">${i}</text>`;
  }
  s += `<text x="100" y="104" text-anchor="middle" font-size="42" fill="${col}">${v==null?'–':v}</text>
        <text x="100" y="128" text-anchor="middle" font-size="15" fill="#5B6478">${v==null?'plot':v===0?'aucun plot':esc(ACT[a].unit(v))}</text>
        ${t!=null?`<text x="100" y="192" text-anchor="middle" font-size="14" fill="#F07000">🎯 cible ${t}</text>`:''}`;
  return s;
}
function bindEntry(){
  const n = curLesson(), sid = UI.sid;
  document.querySelectorAll('svg.dial').forEach(svg => {
    const k = +svg.dataset.k, a = svg.dataset.a, key = ACT[a].key, max = maxPlots(a);
    const t = n > 1 ? targetInfo(n, sid, a).value : null, step = DIAL_SPAN / max;
    let dragging = false, cur = res(n, sid)?.[key]?.[k] ?? null;
    const valFromEvent = e => {
      const b = svg.getBoundingClientRect();
      const x = (e.clientX - b.left) * 200 / b.width - CX, y = (e.clientY - b.top) * 200 / b.height - CY;
      if (Math.hypot(x, y) < 30) return null;                   // centre : pas de changement
      let ang = Math.atan2(x, -y) * 180 / Math.PI;               // 0 = haut, sens horaire
      if (ang > 157.5) ang = 135; if (ang < -157.5) ang = -135;
      return Math.max(0, Math.min(max, Math.round((ang - DIAL_START) / step)));
    };
    const show = v => { svg.innerHTML = dialInner(v, max, t, a); };
    svg.addEventListener('pointerdown', e => { e.preventDefault(); dragging = true; svg.setPointerCapture(e.pointerId);
      const v = valFromEvent(e); if (v != null) { cur = v; show(v); } });
    svg.addEventListener('pointermove', e => { if (!dragging) return; const v = valFromEvent(e); if (v != null && v !== cur) { cur = v; show(v); } });
    const end = () => { if (!dragging) return; dragging = false;
      if (cur != null && cur !== (res(n, sid)?.[key]?.[k] ?? null)) { setRes(n, sid, r => { r[key][k] = cur; }); flagSaved(); } };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  });
}

/* ---------------------------------------------------------------------
   Statistiques
   --------------------------------------------------------------------- */
function lastAvg(sid, a){ let m = null; for (let k = 2; k <= S.settings.nbLessons; k++) { const v = vals(perf(k, sid, a)); if (v.length) m = avg(v); } return m; }
function viewStatsTiles(){
  if (!S.students.length) return `<div class="card strong center">Aucun élève.</div>`;
  const n = curLesson();
  return `${filterBar()}<div class="tiles">${sortedStudents().filter(passFilter).map(s => {
    const ms = lastAvg(s.id, 's'), mb = lastAvg(s.id, 'b');
    return `<button class="tile" data-action="statsDetail" data-sid="${s.id}">${band(s.id)}
      <span class="name">${esc(nameOf(s.id))}</span>${tileTarget(n, s.id, 's')}${tileTarget(n, s.id, 'b')}
      <span class="meta">${ms!=null||mb!=null?`Dernières moyennes : 🏃 ${fmt(ms)} · 🏀 ${fmt(mb)}`:'Pas encore de leçon après le test'}</span></button>`; }).join('')}</div>`;
}
function barChart(items, max, cls=''){
  return `<div class="bar-chart ${cls}">${items.map(it => `<div class="col">
      ${it.v!=null?`<div class="b" style="height:${Math.max(2, it.v/max*100)}%"><span>${it.lbl}</span></div>`:''}
      ${it.t!=null?`<i class="tl" style="bottom:${it.t/max*100}%"></i>`:''}</div>`).join('')}</div>
    <div class="bar-labels">${items.map(it=>`<span>L${it.n}</span>`).join('')}</div>`;
}
function statsColumn(sid, a){
  const A_ = ACT[a], N = S.settings.nbLessons, mx = maxPlots(a);
  let html = '', bars = [];
  for (let n = 1; n <= N; n++) {
    const L = lesson(n), p = perf(n, sid, a), at = attOf(n, sid), ti = targetInfo(n, sid, a), v = vals(p), m = avg(v);
    const status = at === 'abs' ? '<span class="tag abs">Absent</span>' : at === 'inap' ? '<span class="tag inapte">Inapte</span>' : '';
    const title = L.title ? `<div class="ls-title">${esc(L.title)}</div>` : '';
    const nb = Math.max(nbAtt(n, a), p.length);
    const scores = `<div class="scores">${Array.from({length:nb},(_,k)=>p[k]).map(x=>`<span class="sc ${n===1?(x==null?'s-none':'s-dist'):scoreCls(x, ti.value)}">${x==null?'—':'P'+x}</span>`).join('')}
      ${m!=null?`<span style="font-weight:900;align-self:center">moy. ${fmt(m)}</span>`:''}</div>`;
    if (n === 1) {
      html += `<div class="lesson-stat"><div class="ls-head"><b>Leçon 1 · Test</b><span>Cible obtenue : <b style="color:var(--blue)">${plotShort(a, ti.value)}</b>${ti.manual?' <span class="tag mod">Modifiée</span>':''} ${status}</span></div>${title}${scores}</div>`;
    } else {
      bars.push({ n, v: m, lbl: fmt(m), t: ti.value });
      const chg = ti.changed ? ` <span class="tag mod">Cible changée (avant P${ti.prev})</span>` : '';
      html += `<div class="lesson-stat"><div class="ls-head"><b>Leçon ${n}${isLast(n)?' (dernière)':''}</b>
        <span>🎯 <b style="color:var(--blue)">${plotShort(a, ti.value)}</b>${targetTags(ti, a)}${chg} ${status}</span></div>${title}${scores}</div>`;
    }
  }
  return `<div class="card strong"><h2>${A_.ico} ${A_.label}</h2>
    ${bars.some(b=>b.v!=null) ? `<div class="muted" style="font-weight:700">Plot moyen atteint par leçon <span style="color:var(--orange)">(— cible)</span></div>${barChart(bars, mx, a==='b'?'green':'')}` : ''}
    ${html}</div>`;
}
function viewStatsDetail(){
  const sid = UI.sid, s = student(sid); if (!s) return '';
  const N = S.settings.nbLessons, col = colorOf(s.g), cur = curLesson();
  const P = S.projects[sid] || {};
  const projRow = a => {
    const A_ = ACT[a], locked = lesson(N)[A_.man][sid] != null, lastTi = targetInfo(N, sid, a);
    const sug = P[A_.proj] ?? (N > 2 ? targetInfo(N-1, sid, a).value : testTarget(sid, a));
    let list = `<div class="tg-list"><span class="it">L1 test : ${plotShort(a, testTarget(sid, a))}</span>`;
    for (let n = 2; n < N; n++) { const ti = targetInfo(n, sid, a); list += `<span class="it">L${n} : P${ti.value ?? '—'}${ti.sign<0?' (F)':ti.sign>0?' (D)':''}</span>`; }
    list += `</div>`;
    return `<h3 style="margin-top:12px">${A_.ico} ${A_.label}</h3>${list}
      ${locked ? `<div class="advice info">L'enseignant a fixé ta cible : <b>${plotTxt(a, lastTi.value)}</b>.</div>` :
      `<div class="row" style="margin:6px 0"><b style="font-size:19px">Ma cible :</b>
        <div class="stepper"><button data-action="projStep" data-a="${a}" data-d="-1">−</button>
        <span class="val proj-val" id="proj-${a}" data-v="${sug ?? ''}" style="min-width:190px">${sug!=null?plotShort(a, sug):'—'}</span>
        <button data-action="projStep" data-a="${a}" data-d="1">+</button></div></div>`}`;
  };
  return `<div class="entry-head">${col?`<span class="band" style="background:${col.c}"></span>`:''}<div class="who">${esc(nameOf(sid))}</div>
      <div class="tgt"><div class="tgt-box"><div class="muted" style="font-weight:800">🏃 CIBLE L${cur}</div><div class="v">${plotShort('s', targetInfo(cur, sid, 's').value)}</div></div>
      <div class="tgt-box"><div class="muted" style="font-weight:800">🏀 CIBLE L${cur}</div><div class="v">${plotShort('b', targetInfo(cur, sid, 'b').value)}</div></div></div></div>
    <div class="btn-row" style="margin-bottom:12px"><button class="btn" data-action="go" data-view="stats">← Retour aux tuiles</button></div>
    <div class="card strong"><h2>💡 Conseils</h2>${advices(sid).map(a=>`<div class="advice ${a.cls}">${a.t}</div>`).join('')}</div>
    <div class="stats-cols">${statsColumn(sid, 's')}${statsColumn(sid, 'b')}</div>
    <div class="card strong" id="projet"><h2>📝 Mon projet pour la dernière leçon (leçon ${N})</h2>
      <div class="muted" style="font-weight:700">Rappel de toutes mes cibles, puis je choisis mes cibles pour la dernière leçon.</div>
      ${projRow('s')}${projRow('b')}
      <label class="field" style="margin-top:12px">Mon projet (ce que je vais faire pour réussir)
        <textarea id="proj-text" placeholder="Ex. : je vise le plot 7 en sprint car j'ai atteint le plot 6 à chaque course. Je vais bien m'échauffer…">${esc(P.texte||'')}</textarea></label>
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
    <p class="center muted" style="font-size:14px">Code par défaut : 0000 (modifiable dans l'onglet Export / Réglages)</p>`);
  const dots = m.querySelectorAll('.pin-dots span');
  m.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === '✕') return closeModal();
    if (k === '⌫') code = code.slice(0,-1); else if (code.length < 4) code += k;
    dots.forEach((d,i)=>d.classList.toggle('f', i < code.length));
    if (code.length === 4) {
      if (code === String(S.settings.pin || '0000')) { UI.profUnlocked = true; closeModal(); go('prof'); }
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
function rangeField(label, val, attrs, min, max, extra=''){
  return `<div class="field range-field">${label} <b class="rv">${val}</b>${extra}
    <input type="range" min="${min}" max="${max}" step="1" value="${val}" ${attrs}></div>`;
}
function plotTable(){
  const s = Array.from({length: maxPlots('s')}, (_,i)=>i+1), b = Array.from({length: maxPlots('b')}, (_,i)=>i+1);
  return `<div class="stats-cols" style="margin-top:10px">
    <table class="simple"><tr><th>🏃 Plot</th><th>Vitesse</th><th>Distance du départ</th></tr>
      ${s.map(k=>`<tr><td><b>${k}</b></td><td>${14+k} km/h</td><td>${fmt((14+k)/3.6*5)} m</td></tr>`).join('')}</table>
    <table class="simple"><tr><th>🏀 Plot</th><th>Distance de la ligne de lancer</th></tr>
      ${b.map(k=>`<tr><td><b>${k}</b></td><td>${2*k+2} m</td></tr>`).join('')}</table></div>`;
}
function profLecons(){
  const N = S.settings.nbLessons, cur = curLesson(), st = S.settings;
  let rows = '';
  for (let n = 1; n <= N; n++) {
    const L = lesson(n);
    let srcSel = '';
    if (n >= 2) {
      srcSel = `<label class="field">Cibles utilisées<select data-field="source" data-n="${n}">
        <option value="test" ${L.source==='test'?'selected':''}>Cibles du test (leçon 1)</option>
        ${Array.from({length:n-2},(_,i)=>i+2).map(k=>`<option value="${k}" ${String(L.source)===String(k)?'selected':''}>Reprendre les cibles de la leçon ${k}</option>`).join('')}
      </select></label>`;
    }
    const attF = a => { const ov = isOverride(n, a);
      return rangeField(`${ACT[a].ico} ${a==='s'?'Sprints':'Lancers'} :`, nbAtt(n, a), `data-field="att" data-n="${n}" data-a="${a}"`, 0, 10,
        ov ? ` <button class="btn small ghost" data-action="attReset" data-n="${n}" data-a="${a}">↺ base</button>` : ' <span class="muted">(base)</span>'); };
    rows += `<div class="lesson-row"><div class="lesson-num ${n===cur?'cur':''}">${n}</div><div class="lesson-fields">
      <label class="field full">Titre / contenu de la leçon${n===1?' (test)':''}${isLast(n)?' — dernière leçon : projet élève':''}
        <input type="text" data-field="title" data-n="${n}" value="${esc(L.title)}" placeholder="Ex. : Courir à sa cible puis lancer long…"></label>
      ${attF('s')}${attF('b')}
      <div class="full">${srcSel}</div>
    </div></div>`;
  }
  return `<div class="card strong"><h2>Leçon en cours</h2>
      <p class="muted" style="font-weight:700;margin-top:-4px">Les tablettes s'ouvrent sur cette leçon et ne peuvent saisir que sur elle (pensez à renvoyer le QR aux tablettes après un changement).</p>
      <div class="lesson-picker">${Array.from({length:N},(_,i)=>i+1).map(n=>`<button class="lp ${n===cur?'on':''}" data-action="setCurrent" data-n="${n}">${n}</button>`).join('')}</div></div>
    <div class="card"><h2>Cycle</h2><div class="row">
      <label class="field grow">Classe / groupe<input type="text" data-field="className" value="${esc(st.className)}" placeholder="Ex. : 2nde 4"></label>
      <div class="field">Nombre de leçons du cycle${stepper('nbLessons','',N)}</div></div></div>
    <div class="card strong"><h2>Tentatives (base de chaque leçon)</h2>
      <p class="muted" style="margin-top:-4px;font-weight:700">Valeur appliquée à toutes les leçons ; ajustable ensuite leçon par leçon avec les curseurs plus bas.</p>
      <div class="lesson-fields" style="grid-template-columns:1fr 1fr">
        ${rangeField('🏃 Sprints de 5 s :', st.baseCourses, 'data-field="set" data-k="baseCourses"', 1, 10)}
        ${rangeField('🏀 Lancers longs :', st.baseTirs, 'data-field="set" data-k="baseTirs"', 1, 10)}</div></div>
    <div class="card strong"><h2>Plots (1 point par plot atteint)</h2>
      <div class="lesson-fields" style="grid-template-columns:1fr 1fr">
        ${rangeField('🏃 Plots sprint :', st.plotsS, 'data-field="set" data-k="plotsS"', 3, 11, ` <span class="muted">15 → ${14+st.plotsS} km/h</span>`)}
        ${rangeField('🏀 Plots lancer :', st.plotsB, 'data-field="set" data-k="plotsB"', 3, 12, ` <span class="muted">4 → ${2*st.plotsB+2} m</span>`)}
        ${rangeField('🏃 Écart cible facile / difficile :', st.ecartS, 'data-field="set" data-k="ecartS"', 1, 3, ` plot(s) <span class="muted">≈ ${fmt(st.ecartS*5/3.6)} m</span>`)}
        ${rangeField('🏀 Écart cible facile / difficile :', st.ecartB, 'data-field="set" data-k="ecartB"', 1, 3, ` plot(s) <span class="muted">= ${2*st.ecartB} m</span>`)}
      </div>
      <details style="margin-top:10px"><summary style="font-weight:900;font-size:18px;cursor:pointer">📏 Mise en place des plots (distances)</summary>${plotTable()}</details></div>
    <div class="card"><h2>Leçons</h2>
      <p class="muted" style="margin-top:-4px">Leçon 1 = test : le meilleur plot atteint devient la cible de l'élève (sprint et lancer). Les molettes vont de 0 au nombre de plots réglé ci-dessus.</p>${rows}</div>`;
}
function profCibles(){
  const n = curLesson(), L = lesson(n);
  const list = sortedStudents();
  const block = (sid, a) => {
    const ti = targetInfo(n, sid, a), A_ = ACT[a];
    if (n === 1) {
      const r = vals(perf(1, sid, a));
      return `<div class="tg-act"><div class="tg-h">${A_.ico} ${A_.label}</div>
        <div class="tv">${ti.value!=null?plotShort(a, ti.value):'—'} ${ti.manual?'<span class="tag mod">Modifiée</span>':''}</div>
        <div class="muted" style="font-size:14px;font-weight:700">Mesures : ${r.length?r.map(x=>'P'+x).join(' · '):'aucune'}</div>
        <div class="btn-row" style="margin-top:6px"><button class="btn small" data-action="manualTarget" data-sid="${sid}" data-a="${a}">✎ Modifier</button>
        ${ti.manual?`<button class="btn small ghost" data-action="resetTarget" data-sid="${sid}" data-a="${a}">Réinit.</button>`:''}</div></div>`;
    }
    return `<div class="tg-act"><div class="tg-h">${A_.ico} ${A_.label}</div>
      <div class="tv">${ti.value!=null?plotShort(a, ti.value):'—'}</div>
      <div class="muted" style="font-size:14px;font-weight:700">Base P${ti.base ?? '—'} (${ti.src})${ti.changed?` · avant P${ti.prev}`:''}</div>
      <div class="seg" style="margin:6px 0"><button class="easy ${ti.sign<0?'on':''}" data-action="adjust" data-sid="${sid}" data-a="${a}" data-v="-1">Facile</button>
        <button class="norm ${!ti.sign?'on':''}" data-action="adjust" data-sid="${sid}" data-a="${a}" data-v="0">Normal</button>
        <button class="hard ${ti.sign>0?'on':''}" data-action="adjust" data-sid="${sid}" data-a="${a}" data-v="1">Difficile</button></div>
      <div class="btn-row"><button class="btn small" data-action="manualTarget" data-sid="${sid}" data-a="${a}">✎ Modifier</button>
        ${ti.manual?`<button class="btn small ghost" data-action="resetTarget" data-sid="${sid}" data-a="${a}">Réinit.</button>`:''}</div></div>`;
  };
  const head = n === 1
    ? `<div class="card strong"><h2>Leçon 1 · Test</h2><p class="muted" style="margin-top:-4px">La cible de chaque élève = son meilleur plot atteint au test (sprint et lancer). Vous pouvez la corriger à la main.</p></div>`
    : `<div class="card strong"><h2>Cibles · Leçon ${n}${isLast(n)?' (dernière : projet élève)':''}</h2>
      <label class="field" style="max-width:520px">Cibles de base pour toute la classe<select data-field="source" data-n="${n}">
        <option value="test" ${L.source==='test'?'selected':''}>Cibles du test (leçon 1)</option>
        ${Array.from({length:n-2},(_,i)=>i+2).map(k=>`<option value="${k}" ${String(L.source)===String(k)?'selected':''}>Cibles de la leçon ${k}</option>`).join('')}</select></label>
      <p class="muted" style="font-weight:700">Par élève et par épreuve : <b style="color:var(--green)">Facile</b> (🏃 −${S.settings.ecartS} plot(s), 🏀 −${S.settings.ecartB}) / Normal / <b style="color:var(--red)">Difficile</b> (+), ou cible modifiée à la main.${isLast(n)?' À la dernière leçon, les cibles choisies par l\'élève dans son projet sont utilisées.':''}</p></div>`;
  return head + `<div class="tiles">${list.map(s => { const at = attOf(n, s.id);
    return `<div class="att-tile tg-tile">${band(s.id)}<div class="name">${esc(nameOf(s.id))} ${at==='abs'?'<span class="tag abs">Abs.</span>':at==='inap'?'<span class="tag inapte">Inapte</span>':''}</div>
      ${block(s.id, 's')}${block(s.id, 'b')}</div>`; }).join('')}</div>`;
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
  const num = v => v == null ? '' : v;
  const r2 = v => v == null ? '' : Math.round(v*100)/100;
  const head = ['Nom', 'Prénom', 'Affiché', 'Chasuble', 'Test sprint (plot)', 'Test sprint (km/h)', 'Test lancer (plot)', 'Test lancer (m)'];
  for (let n = 2; n <= N; n++) head.push(`L${n} sprint cible`, `L${n} sprint moy.`, `L${n} lancer cible`, `L${n} lancer moy.`);
  head.push('Projet : cible sprint', 'Projet : cible lancer', 'Projet : texte');
  const syn = [head];
  let maxA = 0; for (let n = 1; n <= N; n++) maxA = Math.max(maxA, nbAtt(n,'s'), nbAtt(n,'b'));
  const det = [['Nom','Prénom','Leçon','Titre','Statut','Épreuve','Cible (plot)','Cible','Ajustement (plots)',
    ...Array.from({length:maxA},(_,k)=>`Tentative ${k+1}`), 'Moyenne (plot)', 'Meilleur (plot)']];
  sortedStudents().forEach(s => {
    const nom = s.nom || '', pre = s.prenom || s.disp || '';
    const ts = testTarget(s.id,'s'), tb = testTarget(s.id,'b');
    const row = [nom, pre, nameOf(s.id), colorOf(s.g)?.n || '', num(ts), ts!=null?14+ts:'', num(tb), tb!=null?2*tb+2:''];
    for (let n = 2; n <= N; n++) {
      const at = attOf(n, s.id);
      ['s','b'].forEach(a => { const v = vals(perf(n, s.id, a));
        row.push(num(targetInfo(n, s.id, a).value), at==='abs' ? 'ABS' : at==='inap' ? 'INAPTE' : (v.length ? r2(avg(v)) : '')); });
    }
    const P = S.projects[s.id] || {};
    row.push(num(P.cibleS), num(P.cibleB), P.texte || '');
    syn.push(row);
    for (let n = 1; n <= N; n++) {
      const at = attOf(n, s.id);
      ['s','b'].forEach(a => {
        const ti = targetInfo(n, s.id, a), p = perf(n, s.id, a), v = vals(p);
        det.push([nom, pre, n, lesson(n).title, at==='abs'?'Absent':at==='inap'?'Inapte':'Présent', ACT[a].label,
          num(ti.value), ti.value!=null ? ACT[a].unit(ti.value) : '', n===1 ? '' : (ti.adj || 0),
          ...Array.from({length:maxA},(_,k)=> num(p[k])), v.length ? r2(avg(v)) : '', v.length ? Math.max(...v) : '']);
      });
    }
  });
  const wb = XLSX.utils.book_new();
  const w1 = XLSX.utils.aoa_to_sheet(syn); w1['!cols'] = head.map((_,i)=>({wch: i<3?16:13}));
  const w2 = XLSX.utils.aoa_to_sheet(det); w2['!cols'] = det[0].map((_,i)=>({wch: i===3?30:12}));
  XLSX.utils.book_append_sheet(wb, w1, 'Synthèse');
  XLSX.utils.book_append_sheet(wb, w2, 'Détail par leçon');
  const lessons = []; for (let n = 1; n <= N; n++) lessons.push([n, lesson(n).title, nbAtt(n,'s'), nbAtt(n,'b'), n===1?'Test':(lesson(n).source==='test'?'Test L1':'Leçon '+lesson(n).source)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Leçon','Titre','Sprints','Lancers','Cibles de base'], ...lessons]), 'Leçons');
  const plots = [['Plot','Sprint : vitesse (km/h)','Sprint : distance en 5 s (m)','Lancer : distance (m)']];
  for (let k = 1; k <= Math.max(maxPlots('s'), maxPlots('b')); k++)
    plots.push([k, k<=maxPlots('s')?14+k:'', k<=maxPlots('s')?Math.round((14+k)/3.6*5*100)/100:'', k<=maxPlots('b')?2*k+2:'']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plots), 'Plots');
  const name = `Biathlon5s_${(S.settings.className||'classe').replace(/[^\wÀ-ÿ-]+/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, name);
  toast('✓ Fichier Excel créé');
}

/* ---------------------------------------------------------------------
   Échanges : paquets, compression, QR codes
   --------------------------------------------------------------------- */
function buildFull(){
  return { k:'full', from:S.deviceId, at:now(), st:{
    settings:{ nbLessons:S.settings.nbLessons, current:curLesson(), className:S.settings.className,
      baseCourses:S.settings.baseCourses, baseTirs:S.settings.baseTirs, plotsS:S.settings.plotsS, plotsB:S.settings.plotsB, ecartS:S.settings.ecartS, ecartB:S.settings.ecartB },
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
    const pin = S.settings.pin; S.settings = { ...DEFAULT_SETTINGS, ...st.settings, pin };
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
  dialClear: d => { const key = ACT[d.a].key; setRes(curLesson(), UI.sid, r => { r[key][+d.k] = null; }); render(); },

  // projet élève
  projStep: d => { const a = d.a, el = $('#proj-' + a); let v = parseInt(el.dataset.v);
    if (isNaN(v)) v = Math.ceil(maxPlots(a)/2); else v += +d.d;
    v = Math.max(1, Math.min(maxPlots(a), v)); el.dataset.v = v; el.textContent = plotShort(a, v); },
  projSave: () => { const P = S.projects[UI.sid] || {};
    const g = a => { const el = $('#proj-' + a); if (!el) return P[ACT[a].proj] ?? null; const v = parseInt(el.dataset.v); return isNaN(v) ? null : v; };
    S.projects[UI.sid] = { cibleS: g('s'), cibleB: g('b'), texte: $('#proj-text').value.trim(), ts: now(), d: S.deviceId };
    save(); toast('✓ Projet enregistré'); render(); },

  // prof : leçons
  setCurrent: d => { S.settings.current = +d.n; save(); render(); toast(`Leçon ${d.n} sélectionnée`); },
  nbLessons: d => { S.settings.nbLessons = Math.max(2, Math.min(30, S.settings.nbLessons + (+d.d))); if (S.settings.current > S.settings.nbLessons) S.settings.current = S.settings.nbLessons; save(); render(); },
  attReset: d => { delete lesson(d.n)[ACT[d.a].att]; save(); render(); },

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
  adjust: d => { const o = lesson(curLesson())[ACT[d.a].adj]; if (+d.v) o[d.sid] = +d.v; else delete o[d.sid]; save(); render(); },
  manualTarget: async d => { const n = curLesson(), a = d.a, L = lesson(n);
    const cur = n === 1 ? testTarget(d.sid, a) : baseTarget(n, d.sid, a);
    const v = await numberBox(`${ACT[a].ico} ${n===1?'Cible test':'Cible de base'} de ${nameOf(d.sid)} (1 à ${maxPlots(a)})`, cur ?? '', { step:1, min:1, max:maxPlots(a), unit:'plot' });
    if (v != null) { L[ACT[a].man][d.sid] = Math.round(v); save(); render(); } },
  resetTarget: d => { delete lesson(curLesson())[ACT[d.a].man][d.sid]; save(); render(); },

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
  if (f === 'att') { const L = lesson(t.dataset.n), a = t.dataset.a, v = +t.value;
    if (v === +S.settings[ACT[a].base]) delete L[ACT[a].att]; else L[ACT[a].att] = v; save(); render(); }
  if (f === 'set') { S.settings[t.dataset.k] = +t.value; save(); render(); }
  if (f === 'source') { lesson(t.dataset.n).source = t.value === 'test' ? 'test' : +t.value; save(); render(); }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.type === 'range') { const rv = t.closest('.range-field')?.querySelector('.rv'); if (rv) rv.textContent = t.value; }
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

