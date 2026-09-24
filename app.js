/* =====================================================================
   Biathlon 5 s / Basket — Suivi de performance élèves
   N'EPS numérique — CA1 — Quentin Delisle et Gwilherm Rocher
   PWA hors-ligne : données stockées sur l'appareil (localStorage),
   échanges entre tablettes par QR codes.
   Mesure : 1 point par plot atteint.
     Sprint 5 s : plot 1 = 15 km/h, plot 2 = 16 km/h … plot 11 = 25 km/h
     Basket (tir long) : plot 1 à 4 m, puis un plot tous les 2 m (1 à 20 plots)
   ===================================================================== */
'use strict';

const APP_VERSION = '4.0.0';
const STORE_KEY = 'neps_biathlon5s_v2';
const QR_CHUNK = 440;           // caractères base45 par QR (QR version 11 max : facile à lire par une caméra)

/* Les deux épreuves du biathlon */
const ACT = {
  s: { id:'s', key:'c', ico:'🏃', label:'Sprint 5 s', att:'nbCourses', base:'baseCourses', plots:'plotsS', ecart:'ecartS',
       man:'manual', adj:'adjust', proj:'cibleS', maxPlots:20, minPlots:1, word:'course',
       unit: k => `${14+k} km/h`, detail: k => `${fmt((14+k)/3.6*5)} m en 5 s` },
  b: { id:'b', key:'b', ico:'🏀', label:'Basket', att:'nbTirs', base:'baseTirs', plots:'plotsB', ecart:'ecartB',
       man:'manualB', adj:'adjustB', proj:'cibleB', maxPlots:20, minPlots:1, word:'tir',
       unit: k => `${2*k+2} m`, detail: k => `plot à ${2*k+2} m` },
};
const pts = k => `${k} pt${k>1?'s':''}`;
const plotTxt = (a, k) => k == null ? '—' : k === 0 ? 'aucun plot' : `plot ${k} (${ACT[a].unit(k)})`;
const plotShort = (a, k) => k == null ? '—' : `${pts(k)} · ${ACT[a].unit(k)}`;

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
S.settings.plotsB = Math.min(20, S.settings.plotsB); S.settings.plotsS = Math.min(20, S.settings.plotsS);
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
  if (L.title == null) L.title = '';
  if (L.source == null || L.source === 'test') L.source = (L.source === 'test' && n === 2) ? 1 : 'prev';   // reprise des anciennes données
  if (L.calc == null) L.calc = 'max';
  ['manual','adjust','manualB','adjustB','att'].forEach(k => { L[k] = L[k] || {}; });
  return L;
}
const curLesson = () => Math.min(S.settings.current || 1, S.settings.nbLessons);
const isLast = n => +n === +S.settings.nbLessons && n > 1;
const attOf = (n, sid) => lesson(n).att[sid] || null;           // 'abs' | 'inap' | null
const present = (n, sid) => !attOf(n, sid);
const maxPlots = a => Math.min(ACT[a].maxPlots, +S.settings[ACT[a].plots]);
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
const hasSource = n => typeof lesson(n).source === 'number' && lesson(n).source < n;

/* Cible calculée à partir des résultats d'une leçon (meilleur plot ou moyenne arrondie) */
function targetFromResults(x, sid, a, calc){
  const v = vals(perf(x, sid, a));
  if (!v.length) return null;
  return clampT(a, calc === 'avg' ? avg(v) : Math.max(...v));
}
/* Cible de base (sans facile / difficile). Une cible reste la norme jusqu'au prochain changement :
   modification à la main, ou « utiliser les résultats de la leçon X ». */
function baseTarget(n, sid, a, depth=0){
  n = +n;
  if (n < 1 || depth > 40) return null;
  const L = lesson(n);
  if (L[ACT[a].man][sid] != null) return +L[ACT[a].man][sid];
  if (isLast(n) && S.projects[sid] && S.projects[sid][ACT[a].proj] != null) return +S.projects[sid][ACT[a].proj];
  const fx = L[a === 's' ? 'fixedS' : 'fixedB'];
  if (fx && fx[sid] != null) return +fx[sid];            // cibles reçues du professeur (QR léger)
  if (hasSource(n)) { const t = targetFromResults(L.source, sid, a, L.calc); if (t != null) return t; }
  return baseTarget(n - 1, sid, a, depth + 1);
}
function targetInfo(n, sid, a){
  n = +n;
  const L = lesson(n);
  const base = baseTarget(n, sid, a);
  const sign = +(L[ACT[a].adj][sid] || 0);
  const adj = sign * +S.settings[ACT[a].ecart];
  const value = base == null ? null : clampT(a, base + adj);
  const prev = n > 1 ? targetInfo(n-1, sid, a).value : null;
  const manual = L[ACT[a].man][sid] != null;
  const fromProject = isLast(n) && !manual && S.projects[sid]?.[ACT[a].proj] != null;
  const fromRes = !manual && !fromProject && hasSource(n) && targetFromResults(L.source, sid, a, L.calc) != null;
  const src = manual ? 'fixée à la main' : fromProject ? 'projet élève' : fromRes ? `résultats L${L.source}` : base == null ? 'à définir' : `reprise de L${n-1}`;
  return { value, base, adj, sign, prev, changed: prev != null && value != null && prev !== value,
           manual, fromProject, fromRes, src };
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
/* Échelle de couleur : écart entre la performance et la cible (en plots) */
const LEVELS = [
  { k:'l-vg', min: 2,  bg:'#0B4F1C', fg:'#fff', t:'Bien au-dessus (+2 et plus)' },
  { k:'l-g2', min: 1,  bg:'#1E8E3E', fg:'#fff', t:'Au-dessus (+1)' },
  { k:'l-g',  min: 0,  bg:'#86DC96', fg:'#0A1633', t:'Cible atteinte' },
  { k:'l-y',  min:-1,  bg:'#FFD84D', fg:'#0A1633', t:'Juste en dessous (−1)' },
  { k:'l-o1', min:-2,  bg:'#FFB066', fg:'#0A1633', t:'En dessous (−2)' },
  { k:'l-o2', min:-3,  bg:'#F07000', fg:'#fff', t:'Loin en dessous (−3)' },
  { k:'l-r',  min:-99, bg:'#D0161B', fg:'#fff', t:'Très loin en dessous (−4 et moins)' },
];
function level(v, t){ if (v == null || t == null) return null; const d = v - t; return LEVELS.find(l => d >= l.min); }
function scoreCls(v, t){
  if (v == null) return 's-none';
  if (t == null) return 's-dist';
  return level(v, t).k;
}
function legend(){
  return `<div class="legend">${LEVELS.map(l=>`<span><i style="background:${l.bg}"></i>${l.t}</span>`).join('')}</div>`;
}

/* ---------------------------------------------------------------------
   Conseils automatiques
   --------------------------------------------------------------------- */
function advicesFor(sid, a){
  const out = [], A_ = ACT[a], N = S.settings.nbLessons;
  const done = [];
  for (let n = 1; n <= N; n++) { const v = vals(perf(n, sid, a)); if (v.length) done.push({ n, v, raw: perf(n, sid, a), t: targetInfo(n, sid, a).value }); }
  const P = A_.ico + ' ';
  if (!done.length) {
    const t = targetInfo(curLesson(), sid, a).value;
    if (t != null) out.push({ cls:'info', t:`${P}Ta cible : <b>${plotTxt(a, t)}</b>, soit ${pts(t)} à marquer à chaque ${A_.word} !` });
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
    out.push({ cls:'', t:`${P}En moyenne tu marques ${fmt(m)} points pour une cible de ${pts(t)} : ta cible est peut-être trop difficile aujourd'hui. Tu peux demander une cible facile.` });
  const lastIdx = c.length - 1;
  if (last.v.length >= 3 && c[lastIdx] != null && c[0] != null && c[lastIdx] <= c[0] - 2)
    out.push({ cls:'', t:`${P}Tes performances baissent sur les dernières tentatives : récupère bien entre chaque ${A_.word} et dose ton effort.` });
  if (prev) {
    const d = avg(last.v) - avg(prev.v);
    if (d >= 1) out.push({ cls:'good', t:`${P}Bravo ! Tu progresses de ${fmt(d)} point(s) en moyenne entre la leçon ${prev.n} et la leçon ${last.n}.` });
  }
  return out;
}
function advices(sid){
  const out = [...advicesFor(sid, 's'), ...advicesFor(sid, 'b')];
  const any = vals(perf(1,sid,'s')).length || Object.keys(S.results).some(n => res(n, sid));
  if (!out.length) out.push({ cls: any ? 'good' : 'info', t: any ? 'Continue comme ça : tes performances sont proches de tes cibles.' : 'Pas encore de performances enregistrées.' });
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
  else if (v === 'entry') { setTop('Saisie · ' + nameOf(UI.sid), lessonLabel(curLesson()), `<button class="btn small" data-action="go" data-view="saisie">▦ Élèves</button>`); m.innerHTML = viewEntry(); bindEntry(); }
  else if (v === 'stats') { setTop('Statistiques', 'Choisis un élève', homeBtn); m.innerHTML = viewStatsTiles(); }
  else if (v === 'statsDetail') { setTop('Stats · ' + nameOf(UI.sid), S.settings.className, `<button class="btn small" data-action="go" data-view="stats">▦ Élèves</button>`); m.innerHTML = viewStatsDetail(); }
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
      <div class="muted" style="font-weight:700">🏃 ${nbAtt(n,'s')} sprint(s) de 5 s · 🏀 ${nbAtt(n,'b')} tir(s) basket · ${pres}/${S.students.length} élève(s) présent(s)</div>
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
    ${S.students.length ? '' : `<div class="card strong center" style="max-width:640px">Aucun élève</div>`}
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
      <div class="muted" style="font-weight:700">🏃 ${nbAtt(n,'s')} sprint(s) de 5 s · 🏀 ${nbAtt(n,'b')} tir(s) basket · 1 point par plot atteint${off?` · ${off} absent(s)/inapte(s) masqué(s)`:''}</div></div>
    ${filterBar()}
    <div class="tiles">${list.map(s => saisieTile(n, s)).join('') || '<p>Aucun élève dans ce groupe.</p>'}</div>`;
}
function tileTarget(n, sid, a){
  const ti = targetInfo(n, sid, a);
  return `<div class="target">${ACT[a].ico} 🎯 ${ti.value!=null ? plotShort(a, ti.value) : 'cible à définir'}${targetTags(ti, a)}</div>`;
}
function saisieTile(n, s){
  const done = isComplete(n, s.id);
  return `<button class="tile ${done?'done':''}" data-action="entry" data-sid="${s.id}">${band(s.id)}
    ${done?'<span class="check">✓</span>':''}
    <span class="name">${esc(nameOf(s.id))}</span>${tileTarget(n, s.id, 's')}${tileTarget(n, s.id, 'b')}
    <span class="meta">🏃 ${vals(perf(n,s.id,'s')).length}/${nbAtt(n,'s')} · 🏀 ${vals(perf(n,s.id,'b')).length}/${nbAtt(n,'b')}</span></button>`;
}

/* ---------------------------------------------------------------------
   Saisie : écran d'un élève
   --------------------------------------------------------------------- */
function targetCol(n, sid, a){
  const ti = targetInfo(n, sid, a), v = ti.value;
  const dist = v == null ? '' : a === 's' ? `${fmt((14+v)/3.6*5)} m` : `${2*v+2} m`;
  return `<aside class="tcol tcol-${a}"><div class="ico">${ACT[a].ico}</div><div class="lbl">CIBLE</div>
    <div class="v">${v!=null?v:'—'}</div><div class="lbl">${v!=null?(v>1?'points':'point'):'à définir'}</div>
    ${v!=null?`<div class="dist">${dist}</div>${a==='s'?`<small>${14+v} km/h</small>`:''}<small>plot ${v}</small>`:''}
    ${ti.sign<0?'<span class="tag easy">Facile</span>':ti.sign>0?'<span class="tag hard">Difficile</span>':''}</aside>`;
}
function viewEntry(){
  const n = curLesson(), sid = UI.sid, s = student(sid);
  if (!s) return '<p>Élève introuvable.</p>';
  const list = sortedStudents().filter(x => present(n, x.id) && passFilter(x));
  const i = list.findIndex(x => x.id === sid);
  const prev = list[i-1], next = list[i+1];
  let h = `<div class="entry-name">${band(sid)}<div class="who">${esc(nameOf(sid))}</div>
    <span class="saved" id="saved-flag"></span>
    <button class="btn" data-action="go" data-view="saisie" style="margin-left:auto">← Retour aux élèves</button></div>`;
  ['s','b'].forEach(a => {
    const A_ = ACT[a], nb = nbAtt(n, a), p = perf(n, sid, a), t = targetInfo(n, sid, a).value, mx = maxPlots(a);
    if (!nb) return;
    const W = A_.word[0].toUpperCase() + A_.word.slice(1);
    h += `<section class="entry-sec sec-${a}">${targetCol(n, sid, a)}<div class="sec-main">
      <h2>${A_.ico} ${A_.label} · ${nb} ${A_.word}${nb>1?'s':''}</h2>
      <div class="dials">`;
    for (let k = 0; k < nb; k++) {
      h += `<div class="dial-card dial-${a}"><h3><span class="big-ico">${A_.ico}</span> ${W} ${k+1}</h3>
        <svg class="dial${mx>12?' big':''}" viewBox="0 0 200 200" data-a="${a}" data-k="${k}">${dialInner(p[k], mx, t, a)}</svg>
        ${t!=null?`<div class="dial-tgt">🎯 cible ${pts(t)}</div>`:''}
        <button class="btn small ghost" data-action="dialClear" data-a="${a}" data-k="${k}">Effacer</button></div>`;
    }
    h += `</div></div></section>`;
  });
  h += `<div class="nav-bottom">
      <button class="btn" data-action="entry" data-sid="${prev?.id||''}" ${prev?'':'disabled'}>← ${prev?esc(nameOf(prev.id)):'Précédent'}</button>
      <button class="btn primary" data-action="go" data-view="saisie">▦ Retour aux élèves</button>
      <button class="btn" data-action="entry" data-sid="${next?.id||''}" ${next?'':'disabled'}>${next?esc(nameOf(next.id)):'Suivant'} →</button></div>`;
  return h;
}
function flagSaved(){ const f=$('#saved-flag'); if (f){ f.textContent='✓ Enregistré'; clearTimeout(f._h); f._h=setTimeout(()=>f.textContent='',1500);} }

/* Molette circulaire graduée de 0 au nombre de plots */
const DIAL_START = -135, DIAL_SPAN = 270, CX = 100, CY = 100, DR = 80;
function pol(r, a){ const t = a*Math.PI/180; return [CX + r*Math.sin(t), CY - r*Math.cos(t)]; }
function arc(r, a0, a1){ const [x0,y0]=pol(r,a0),[x1,y1]=pol(r,a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; }
function dialColor(v, t){ return v==null ? '#9AA3B5' : t==null ? '#0B2A6B' : level(v, t).bg; }
function dialText(v, t){ return v==null || t==null ? '#fff' : level(v, t).fg; }
function dialInner(v, max, t, a){
  const col = dialColor(v, t), step = DIAL_SPAN / max;
  const [rr, ro, fs] = max <= 9 ? [15, 19, 17] : max <= 12 ? [12.5, 16, 14] : max <= 16 ? [10, 14, 12] : [8.5, 13, 10.5];
  let s = `<path d="${arc(DR, DIAL_START, -DIAL_START)}" stroke="#DCE2EE" stroke-width="20" fill="none" stroke-linecap="round"/>`;
  if (v != null && v > 0) s += `<path d="${arc(DR, DIAL_START, DIAL_START + v*step)}" stroke="${col}" stroke-width="20" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i <= max; i++) {
    const ang = DIAL_START + i*step, [x,y] = pol(DR, ang), on = v === i, isT = t === i;
    if (isT) s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${ro+4}" fill="none" stroke="#F07000" stroke-width="4" stroke-dasharray="4 3"/>`;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${on?ro:rr}" fill="${on?col:'#fff'}" stroke="${on?'#0A1633':'#0B2A6B'}" stroke-width="2.5"/>
      <text x="${x.toFixed(1)}" y="${(y+(on?6.5:5)).toFixed(1)}" text-anchor="middle" font-size="${on?fs+3:fs}" fill="${on?dialText(v, t):'#0B2A6B'}">${i}</text>`;
  }
  s += `<circle cx="100" cy="92" r="30" fill="${v==null?'#fff':col}" stroke="${v==null?'#DCE2EE':'#0A1633'}" stroke-width="2.5"/>
        <text x="100" y="106" text-anchor="middle" font-size="38" fill="${v==null?'#9AA3B5':dialText(v, t)}">${v==null?'–':v}</text>
        <text x="100" y="140" text-anchor="middle" font-size="15" fill="#5B6478">${v==null?'plot':v===0?'aucun plot':esc(ACT[a].unit(v))}</text>
        <text x="100" y="188" text-anchor="middle" font-size="34">${ACT[a].ico}</text>`;
  return s;
}
function bindEntry(){
  const n = curLesson(), sid = UI.sid;
  document.querySelectorAll('svg.dial').forEach(svg => {
    const k = +svg.dataset.k, a = svg.dataset.a, key = ACT[a].key, max = maxPlots(a);
    const t = targetInfo(n, sid, a).value, step = DIAL_SPAN / max;
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
    const scores = `<div class="scores">${Array.from({length:nb},(_,k)=>p[k]).map(x=>`<span class="sc ${scoreCls(x, ti.value)}">${x==null?'—':x}</span>`).join('')}
      ${m!=null?`<span style="font-weight:900;align-self:center">moy. ${fmt(m)}</span>`:''}</div>`;
    bars.push({ n, v: m, lbl: fmt(m), t: ti.value });
    const chg = ti.changed ? ` <span class="tag mod">Cible changée (avant ${pts(ti.prev)})</span>` : '';
    html += `<div class="lesson-stat"><div class="ls-head"><b>Leçon ${n}${isLast(n)?' (dernière)':''}</b>
      <span>🎯 <b style="color:var(--blue)">${ti.value!=null?plotShort(a, ti.value):'—'}</b>${targetTags(ti, a)}${chg} ${status}</span></div>${title}${scores}</div>`;
  }
  return `<div class="card strong"><h2>${A_.ico} ${A_.label}</h2>
    ${bars.some(b=>b.v!=null) ? `<div class="muted" style="font-weight:700">Points moyens par leçon <span style="color:var(--orange)">(- - cible)</span></div>${barChart(bars, mx, a==='b'?'green':'')}` : ''}
    ${html}</div>`;
}
function viewStatsDetail(){
  const sid = UI.sid, s = student(sid); if (!s) return '';
  const N = S.settings.nbLessons, col = colorOf(s.g), cur = curLesson();
  const P = S.projects[sid] || {};
  const projRow = a => {
    const A_ = ACT[a], locked = lesson(N)[A_.man][sid] != null, lastTi = targetInfo(N, sid, a);
    const sug = P[A_.proj] ?? targetInfo(N-1, sid, a).value;
    let list = `<div class="tg-list">`;
    for (let n = 1; n < N; n++) { const ti = targetInfo(n, sid, a); list += `<span class="it">L${n} : ${ti.value!=null?pts(ti.value):'—'}${ti.sign<0?' (F)':ti.sign>0?' (D)':''}</span>`; }
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
    <div class="btn-row" style="margin-bottom:12px"><button class="btn" data-action="go" data-view="stats">← Retour aux élèves</button></div>
    <div class="card strong"><h2>💡 Conseils</h2>${advices(sid).map(a=>`<div class="advice ${a.cls}">${a.t}</div>`).join('')}</div>
    <div class="card"><b>Couleurs : écart entre tes points et ta cible</b>${legend()}</div>
    <div class="stats-cols">${statsColumn(sid, 's')}${statsColumn(sid, 'b')}</div>
    <div class="card strong" id="projet"><h2>📝 Mon projet pour la dernière leçon (leçon ${N})</h2>
      
      ${projRow('s')}${projRow('b')}
      <label class="field" style="margin-top:12px">Mon projet
        <textarea id="proj-text" >${esc(P.texte||'')}</textarea></label>
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
    const srcSel = sourceSelect(n, 'Cibles de cette leçon');
    const attF = a => { const ov = isOverride(n, a);
      return rangeField(`${ACT[a].ico} ${a==='s'?'Sprints':'Tirs'} :`, nbAtt(n, a), `data-field="att" data-n="${n}" data-a="${a}"`, 0, 10,
        ov ? ` <button class="btn small ghost" data-action="attReset" data-n="${n}" data-a="${a}">↺ base</button>` : ' <span class="muted">(base)</span>'); };
    rows += `<div class="lesson-row"><div class="lesson-num ${n===cur?'cur':''}">${n}</div><div class="lesson-fields">
      <label class="field full">Titre / contenu de la leçon${isLast(n)?' — dernière leçon : projet élève':''}
        <input type="text" data-field="title" data-n="${n}" value="${esc(L.title)}" ></label>
      ${attF('s')}${attF('b')}
      <div class="full">${srcSel}</div>
    </div></div>`;
  }
  return `<div class="card strong"><h2>Leçon en cours</h2>
      
      <div class="lesson-picker">${Array.from({length:N},(_,i)=>i+1).map(n=>`<button class="lp ${n===cur?'on':''}" data-action="setCurrent" data-n="${n}">${n}</button>`).join('')}</div></div>
    <div class="card"><h2>Cycle</h2><div class="row">
      <label class="field grow">Classe / groupe<input type="text" data-field="className" value="${esc(st.className)}" placeholder="Ex. : 2nde 4"></label>
      <div class="field">Nombre de leçons du cycle${stepper('nbLessons','',N)}</div></div></div>
    <div class="card strong"><h2>Tentatives (base de chaque leçon)</h2>
      
      <div class="lesson-fields" style="grid-template-columns:1fr 1fr">
        ${rangeField('🏃 Sprints de 5 s :', st.baseCourses, 'data-field="set" data-k="baseCourses"', 1, 10)}
        ${rangeField('🏀 Tirs basket :', st.baseTirs, 'data-field="set" data-k="baseTirs"', 1, 10)}</div></div>
    <div class="card strong"><h2>Plots (1 point par plot atteint)</h2>
      <div class="lesson-fields" style="grid-template-columns:1fr 1fr">
        ${rangeField('🏃 Plots sprint :', st.plotsS, 'data-field="set" data-k="plotsS"', 1, 20, ` <span class="muted">15 → ${14+st.plotsS} km/h</span>`)}
        ${rangeField('🏀 Plots basket :', st.plotsB, 'data-field="set" data-k="plotsB"', 1, 20, ` <span class="muted">4 → ${2*st.plotsB+2} m</span>`)}
        ${rangeField('🏃 Écart cible facile / difficile :', st.ecartS, 'data-field="set" data-k="ecartS"', 1, 3, ` plot(s) <span class="muted">≈ ${fmt(st.ecartS*5/3.6)} m</span>`)}
        ${rangeField('🏀 Écart cible facile / difficile :', st.ecartB, 'data-field="set" data-k="ecartB"', 1, 3, ` plot(s) <span class="muted">= ${2*st.ecartB} m</span>`)}
      </div>
      <details style="margin-top:10px"><summary style="font-weight:900;font-size:18px;cursor:pointer">📏 Mise en place des plots (distances)</summary>${plotTable()}</details></div>
    <div class="card"><h2>Leçons</h2>
      ${rows}</div>`;
}
function sourceSelect(n, label){
  const L = lesson(n);
  const count = x => S.students.filter(st => vals(perf(x, st.id, 's')).length || vals(perf(x, st.id, 'b')).length).length;
  const opts = `<option value="prev" ${!hasSource(n)?'selected':''}>${n===1?'Cibles fixées à la main (ci-dessous)':`Garder les cibles en cours (leçon ${n-1})`}</option>` +
    Array.from({length:n-1},(_,i)=>i+1).map(x=>`<option value="${x}" ${hasSource(n)&&L.source===x?'selected':''}>Utiliser les résultats de la leçon ${x} comme cibles (${count(x)} élève(s))</option>`).join('');
  return `<div class="row"><label class="field grow">${label}<select data-field="source" data-n="${n}" ${n===1?'disabled':''}>${opts}</select></label>
    ${hasSource(n)?`<label class="field">Calcul<select data-field="calc" data-n="${n}">
      <option value="max" ${L.calc!=='avg'?'selected':''}>Meilleur plot atteint</option>
      <option value="avg" ${L.calc==='avg'?'selected':''}>Moyenne arrondie</option></select></label>`:''}</div>`;
}
function profCibles(){
  const n = curLesson();
  const list = sortedStudents();
  const block = (sid, a) => {
    const ti = targetInfo(n, sid, a), A_ = ACT[a];
    return `<div class="tg-act"><div class="tg-h">${A_.ico} ${A_.label}</div>
      <div class="row" style="gap:8px"><div class="stepper"><button data-action="tgStep" data-sid="${sid}" data-a="${a}" data-d="-1">−</button>
        <span class="val" style="min-width:74px">${ti.base!=null?pts(ti.base):'—'}</span>
        <button data-action="tgStep" data-sid="${sid}" data-a="${a}" data-d="1">+</button></div>
        ${ti.manual?`<button class="btn small ghost" data-action="resetTarget" data-sid="${sid}" data-a="${a}">↺</button>`:''}</div>
      <div class="muted" style="font-size:14px;font-weight:700">${ti.base!=null?ACT[a].unit(ti.base)+' · ':''}${ti.src}${ti.changed?` · avant ${pts(ti.prev)}`:''}</div>
      <div class="seg" style="margin:6px 0"><button class="easy ${ti.sign<0?'on':''}" data-action="adjust" data-sid="${sid}" data-a="${a}" data-v="-1">Facile</button>
        <button class="norm ${!ti.sign?'on':''}" data-action="adjust" data-sid="${sid}" data-a="${a}" data-v="0">Normal</button>
        <button class="hard ${ti.sign>0?'on':''}" data-action="adjust" data-sid="${sid}" data-a="${a}" data-v="1">Difficile</button></div>
      ${ti.sign?`<div style="font-weight:900;color:var(--blue)">Cible du jour : ${pts(ti.value)}</div>`:''}</div>`;
  };
  const bulk = a => { const v = UI['bulk'+a] ?? Math.ceil(maxPlots(a)/2);
    return `<div class="row" style="gap:8px"><b>${ACT[a].ico} ${ACT[a].label}</b>
      <div class="stepper"><button data-action="bulkStep" data-a="${a}" data-d="-1">−</button><span class="val" style="min-width:150px">${plotShort(a, v)}</span><button data-action="bulkStep" data-a="${a}" data-d="1">+</button></div>
      <button class="btn small" data-action="bulkApply" data-a="${a}">Appliquer à tous</button></div>`; };
  return `<div class="card strong"><h2>🎯 Cibles · Leçon ${n}${isLast(n)?' (dernière : projet élève)':''}</h2>
      ${sourceSelect(n, 'Cibles de la classe')}
      <details><summary style="font-weight:900;cursor:pointer">Même cible pour toute la classe…</summary><div style="display:grid;gap:10px;margin-top:10px">${bulk('s')}${bulk('b')}</div></details></div>
    <div class="tiles">${list.map(s => { const at = attOf(n, s.id);
    return `<div class="att-tile tg-tile">${band(s.id)}<div class="name">${esc(nameOf(s.id))} ${at==='abs'?'<span class="tag abs">Abs.</span>':at==='inap'?'<span class="tag inapte">Inapte</span>':''}</div>
      ${block(s.id, 's')}${block(s.id, 'b')}</div>`; }).join('')}</div>`;
}
function profEleves(){
  const list = sortedStudents();
  return `<div class="card strong"><h2>Importer la liste (Pronote)</h2>
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
  return `<div class="card strong"><h2>Appel · Leçon ${n}</h2><div class="muted" style="font-weight:700">${S.students.length-abs-inap} présent(s) · ${abs} absent(s) · ${inap} inapte(s).</div></div>
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
  return `<div class="card strong"><h2>Groupes de chasubles</h2>
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
  return `<div class="card strong"><h2>1 · QR « Élèves »</h2>
      <button class="btn primary" data-action="showQR" data-kind="N">📤 Afficher le QR Élèves</button></div>
    <div class="card strong"><h2>2 · QR « Leçon ${curLesson()} »</h2>
      <button class="btn primary" data-action="showQR" data-kind="L">📤 Afficher le QR Leçon ${curLesson()}</button></div>
    <div class="card strong"><h2>3 · Récupérer les saisies</h2>
      <button class="btn orange" data-action="scanResults">📷 Scanner une tablette</button></div>
    <div class="card"><h2>Autres options</h2><div class="btn-row">
      <button class="btn" data-action="showFullQR" data-light="0">Historique complet (plusieurs QR)</button>
      <button class="btn" data-action="fileFull">📤 Partager en fichier</button>
      <label class="btn">📂 Importer un fichier<input type="file" id="file-sync" accept=".json,application/json" hidden></label></div></div>`;
}
function profExport(){
  return `<div class="card strong"><h2>Export Excel</h2>
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
  const head = ['Nom', 'Prénom', 'Affiché', 'Chasuble'];
  for (let n = 1; n <= N; n++) head.push(`L${n} sprint cible`, `L${n} sprint moy.`, `L${n} basket cible`, `L${n} basket moy.`);
  head.push('Projet : cible sprint', 'Projet : cible basket', 'Projet : texte');
  const syn = [head];
  let maxA = 0; for (let n = 1; n <= N; n++) maxA = Math.max(maxA, nbAtt(n,'s'), nbAtt(n,'b'));
  const det = [['Nom','Prénom','Leçon','Titre','Statut','Épreuve','Cible (points)','Cible (plot)','Ajustement (plots)',
    ...Array.from({length:maxA},(_,k)=>`Tentative ${k+1}`), 'Moyenne (points)', 'Meilleur (points)']];
  sortedStudents().forEach(s => {
    const nom = s.nom || '', pre = s.prenom || s.disp || '';
    const row = [nom, pre, nameOf(s.id), colorOf(s.g)?.n || ''];
    for (let n = 1; n <= N; n++) {
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
          num(ti.value), ti.value!=null ? ACT[a].unit(ti.value) : '', (ti.adj || 0),
          ...Array.from({length:maxA},(_,k)=> num(p[k])), v.length ? r2(avg(v)) : '', v.length ? Math.max(...v) : '']);
      });
    }
  });
  const wb = XLSX.utils.book_new();
  const w1 = XLSX.utils.aoa_to_sheet(syn); w1['!cols'] = head.map((_,i)=>({wch: i<3?16:13}));
  const w2 = XLSX.utils.aoa_to_sheet(det); w2['!cols'] = det[0].map((_,i)=>({wch: i===3?30:12}));
  XLSX.utils.book_append_sheet(wb, w1, 'Synthèse');
  XLSX.utils.book_append_sheet(wb, w2, 'Détail par leçon');
  const lessons = []; for (let n = 1; n <= N; n++) lessons.push([n, lesson(n).title, nbAtt(n,'s'), nbAtt(n,'b'), hasSource(n) ? `Résultats L${lesson(n).source} (${lesson(n).calc==='avg'?'moyenne':'meilleur'})` : (n===1?'À la main':'Reprise leçon précédente')]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Leçon','Titre','Sprints','Tirs basket','Cibles de base'], ...lessons]), 'Leçons');
  const plots = [['Plot','Sprint : vitesse (km/h)','Sprint : distance en 5 s (m)','Basket : distance (m)']];
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
function buildFull(light=false){
  const cur = curLesson();
  let results = S.results, fixed = null;
  if (light) {                     // QR léger : cibles déjà calculées + résultats de la leçon en cours seulement
    results = S.results[cur] ? { [cur]: S.results[cur] } : {};
    fixed = { n: cur, t: {} };
    S.students.forEach(st => { fixed.t[st.id] = [baseTarget(cur, st.id, 's'), baseTarget(cur, st.id, 'b')]; });
  }
  const lessons = JSON.parse(JSON.stringify(S.lessons));
  if (light) Object.entries(lessons).forEach(([n, L]) => { if (+n !== cur) { delete L.manual; delete L.manualB; delete L.adjust; delete L.adjustB; delete L.att; } });
  return { k:'full', light, from:S.deviceId, at:now(), st:{
    settings:{ nbLessons:S.settings.nbLessons, current:cur, className:S.settings.className,
      baseCourses:S.settings.baseCourses, baseTirs:S.settings.baseTirs, plotsS:S.settings.plotsS, plotsB:S.settings.plotsB, ecartS:S.settings.ecartS, ecartB:S.settings.ecartB },
    students: S.students.map(s => ({ id:s.id, disp:nameOf(s.id), g:s.g||null })),
    lessons, fixed, results, projects: light ? {} : S.projects } };
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
    if (st.fixed) { const L = lesson(st.fixed.n); L.fixedS = {}; L.fixedB = {};
      Object.entries(st.fixed.t).forEach(([sid, [a, b]]) => { if (a != null) L.fixedS[sid] = a; if (b != null) L.fixedB[sid] = b; }); }
    const n = mergeData(st.results, st.projects);
    save(); toast(`✓ Leçon ${st.settings.current} reçue : ${S.students.length} élèves`, 3000);
    go('home');
    return n;
  }
  if (p.k === 'names') {
    if (S.students.some(s => s.nom)) {
      const ok = await confirmBox('Remplacer la liste de cet appareil ?', 'Cet appareil contient la liste complète (enseignant).', 'Remplacer', true);
      if (!ok) return;
    }
    S.students = p.students.map(s => ({ id:s.id, disp:s.disp, g:s.g }));
    if (p.className != null) S.settings.className = p.className;
    save(); toast(`✓ ${S.students.length} élèves reçus`, 3000);
    return 'continue';
  }
  if (p.k === 'lesson') {
    const list = S.students;                      // même ordre que le QR « Élèves »
    if (!list.length || listHash(list.map(s => s.id)) !== p.hash) { toast('⚠️ Scannez d\'abord le QR « Élèves »', 4000); throw new Error('Liste des élèves différente'); }
    const pin = S.settings.pin; S.settings = { ...S.settings, ...p.settings, pin };
    const L = lesson(p.settings.current);
    L.title = p.title; L.nbCourses = p.nbC; L.nbTirs = p.nbT;
    L.fixedS = {}; L.fixedB = {}; L.manual = {}; L.manualB = {}; L.adjust = {}; L.adjustB = {}; L.att = {};
    list.forEach((s, i) => { const r = p.rows[i]; if (!r) return;
      if (r.tS != null) L.fixedS[s.id] = r.tS; if (r.tB != null) L.fixedB[s.id] = r.tB;
      if (r.aS) L.adjust[s.id] = r.aS; if (r.aB) L.adjustB[s.id] = r.aB; if (r.att) L.att[s.id] = r.att; s.g = r.g; });
    save(); toast(`✓ Leçon ${p.settings.current} reçue`, 3000); go('home');
    return 1;
  }
  if (p.k === 'res') {
    const n = mergeData(p.results, p.projects);
    save(); toast(`✓ Tablette ${p.from} : ${n} saisie(s) nouvelle(s) ou mise(s) à jour`, 3500);
    return n;
  }
  throw new Error('Type de données inconnu');
}

/* =====================================================================
   Format binaire compact (v4) : QR très petits, faciles à lire
   N = liste des élèves (une fois par cycle) · L = leçon du jour · R = saisies d'une tablette
   ===================================================================== */
function BW(){ const b = []; return {
  u8(v){ b.push((v ?? 0) & 255); }, u16(v){ b.push((v>>8)&255, v&255); },
  u32(v){ b.push((v>>>24)&255, (v>>>16)&255, (v>>>8)&255, v&255); },
  id(s){ const t = String(s||'').padEnd(4,' ').slice(0,4); for (let i = 0; i < 4; i++) b.push(t.charCodeAt(i) & 255); },
  str(s, max=255){ let u = new TextEncoder().encode(String(s||'')); if (u.length > max) u = u.slice(0, max);
    if (max > 255) this.u16(u.length); else b.push(u.length); u.forEach(x => b.push(x)); },
  bytes(){ return new Uint8Array(b); } }; }
function BR(u){ let i = 0; return {
  u8(){ return u[i++]; }, u16(){ const v = (u[i]<<8)|u[i+1]; i += 2; return v; },
  u32(){ const v = ((u[i]<<24)>>>0) + (u[i+1]<<16) + (u[i+2]<<8) + u[i+3]; i += 4; return v; },
  id(){ let t = ''; for (let k = 0; k < 4; k++) t += String.fromCharCode(u[i++]); return t.trim(); },
  str(long=false){ const n = long ? this.u16() : u[i++]; const t = new TextDecoder().decode(u.slice(i, i+n)); i += n; return t; },
  end(){ return i >= u.length; } }; }
function listHash(ids){ let h = 0x811c9dc5; for (const c of ids.join(',')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
const GIDX = k => { const i = COLORS.findIndex(c => c.k === k); return i < 0 ? 0 : i + 1; };
const GKEY = i => i ? COLORS[i-1]?.k || null : null;
const NUL = 255, nv = v => v == null ? NUL : Math.max(0, Math.min(254, v)), vn = v => v === NUL ? null : v;

function binNames(){
  const w = BW(); w.u8('N'.charCodeAt(0)); w.u8(1);
  w.str(S.settings.className, 60); w.u8(S.students.length);
  sortedStudents().forEach(s => { w.id(s.id); w.u8(GIDX(s.g)); w.str(nameOf(s.id), 40); });
  return w.bytes();
}
function binLesson(){
  const cur = curLesson(), L = lesson(cur), st = S.settings, list = sortedStudents();
  const w = BW(); w.u8('L'.charCodeAt(0)); w.u8(1);
  w.u32(listHash(list.map(s => s.id)));
  [st.nbLessons, cur, st.baseCourses, st.baseTirs, st.plotsS, st.plotsB, st.ecartS, st.ecartB, nbAtt(cur,'s'), nbAtt(cur,'b')].forEach(v => w.u8(v));
  w.str(L.title, 80); w.u8(list.length);
  list.forEach(s => {
    const aS = +(L.adjust[s.id]||0), aB = +(L.adjustB[s.id]||0), at = attOf(cur, s.id);
    w.u8(nv(baseTarget(cur, s.id, 's'))); w.u8(nv(baseTarget(cur, s.id, 'b')));
    w.u8((aS<0?1:aS>0?2:0) | ((aB<0?1:aB>0?2:0)<<2) | ((at==='abs'?1:at==='inap'?2:0)<<4));
    w.u8(GIDX(s.g));
  });
  return w.bytes();
}
function binResults(){
  const w = BW(); w.u8('R'.charCodeAt(0)); w.u8(1); w.id(S.deviceId);
  const ents = [], projs = [];
  Object.entries(S.results).forEach(([n, byS]) => Object.entries(byS).forEach(([sid, r]) => { if (r.d === S.deviceId) ents.push([+n, sid, r]); }));
  Object.entries(S.projects).forEach(([sid, p]) => { if (p.d === S.deviceId) projs.push([sid, p]); });
  w.u16(ents.length);
  ents.forEach(([n, sid, r]) => { w.id(sid); w.u8(n); w.u32(Math.floor((r.ts||0)/1000));
    const c = r.c||[], b = r.b||[]; w.u8(c.length); c.forEach(v => w.u8(nv(v))); w.u8(b.length); b.forEach(v => w.u8(nv(v))); });
  w.u8(projs.length);
  projs.forEach(([sid, p]) => { w.id(sid); w.u8(nv(p.cibleS)); w.u8(nv(p.cibleB)); w.u32(Math.floor((p.ts||0)/1000)); w.str(p.texte||'', 600); });
  return { bytes: w.bytes(), count: ents.length + projs.length };
}
function binDecode(u){
  const r = BR(u), t = String.fromCharCode(r.u8()); r.u8();
  if (t === 'N') {
    const className = r.str(), n = r.u8(), students = [];
    for (let i = 0; i < n; i++) { const id = r.id(), g = GKEY(r.u8()), disp = r.str(); students.push({ id, disp, g }); }
    return { k:'names', className, students };
  }
  if (t === 'L') {
    const hash = r.u32(); const v = []; for (let i = 0; i < 10; i++) v.push(r.u8());
    const title = r.str(), n = r.u8(), rows = [];
    for (let i = 0; i < n; i++) { const tS = vn(r.u8()), tB = vn(r.u8()), f = r.u8(), g = GKEY(r.u8());
      rows.push({ tS, tB, aS: [0,-1,1][f&3], aB: [0,-1,1][(f>>2)&3], att: [null,'abs','inap'][(f>>4)&3], g }); }
    const [nbLessons, current, baseCourses, baseTirs, plotsS, plotsB, ecartS, ecartB, nbC, nbT] = v;
    return { k:'lesson', hash, settings:{ nbLessons, current, baseCourses, baseTirs, plotsS, plotsB, ecartS, ecartB }, nbC, nbT, title, rows };
  }
  if (t === 'R') {
    const from = r.id(), n = r.u16(), results = {}, projects = {};
    for (let i = 0; i < n; i++) { const sid = r.id(), les = r.u8(), ts = r.u32()*1000;
      const nc = r.u8(), c = []; for (let k = 0; k < nc; k++) c.push(vn(r.u8()));
      const nb = r.u8(), b = []; for (let k = 0; k < nb; k++) b.push(vn(r.u8()));
      (results[les] = results[les] || {})[sid] = { c, b, ts, d: from }; }
    const np = r.u8();
    for (let i = 0; i < np; i++) { const sid = r.id(), cS = vn(r.u8()), cB = vn(r.u8()), ts = r.u32()*1000, texte = r.str(true);
      projects[sid] = { cibleS:cS, cibleB:cB, texte, ts, d: from }; }
    return { k:'res', from, results, projects };
  }
  throw new Error('QR inconnu');
}
async function encodeBin(u8){
  if (window.CompressionStream) { try { const z = await streamBytes(u8, new CompressionStream('deflate-raw')); if (z.length < u8.length) return 'Y' + b45enc(z); } catch(e){} }
  return 'X' + b45enc(u8);
}

/* Compactage des résultats pour des QR codes plus petits */
function packRP(results, projects){
  const D = [], di = d => { let i = D.indexOf(d); if (i < 0) { D.push(d); i = D.length-1; } return i; };
  let T = Infinity;
  Object.values(results||{}).forEach(byS => Object.values(byS||{}).forEach(r => { if (r.ts) T = Math.min(T, r.ts); }));
  Object.values(projects||{}).forEach(p => { if (p.ts) T = Math.min(T, p.ts); });
  T = isFinite(T) ? Math.floor(T/1000) : 0;
  const R = {}, P = {};
  Object.entries(results||{}).forEach(([n, byS]) => { R[n] = {}; Object.entries(byS||{}).forEach(([sid, r]) => {
    R[n][sid] = [r.c||[], r.b||[], Math.floor((r.ts||0)/1000) - T, di(r.d)]; }); });
  Object.entries(projects||{}).forEach(([sid, p]) => { P[sid] = [p.cibleS ?? null, p.cibleB ?? null, p.texte||'', Math.floor((p.ts||0)/1000) - T, di(p.d)]; });
  return { T, D, R, P };
}
function unpackRP(z){
  const results = {}, projects = {};
  Object.entries(z.R||{}).forEach(([n, byS]) => { results[n] = {}; Object.entries(byS).forEach(([sid, a]) => {
    results[n][sid] = { c:a[0], b:a[1], ts:(z.T + a[2])*1000, d:z.D[a[3]] }; }); });
  Object.entries(z.P||{}).forEach(([sid, a]) => { projects[sid] = { cibleS:a[0], cibleB:a[1], texte:a[2], ts:(z.T + a[3])*1000, d:z.D[a[4]] }; });
  return { results, projects };
}
function packPacket(p){
  const q = JSON.parse(JSON.stringify(p));
  if (q.st) { q.st.z = packRP(q.st.results, q.st.projects); delete q.st.results; delete q.st.projects;
    Object.values(q.st.lessons||{}).forEach(L => Object.keys(L).forEach(k => { if (L[k] && typeof L[k]==='object' && !Object.keys(L[k]).length) delete L[k]; })); }
  else if (q.results) { q.z = packRP(q.results, q.projects); delete q.results; delete q.projects; }
  return q;
}
function unpackPacket(q){
  if (q.st && q.st.z) { Object.assign(q.st, unpackRP(q.st.z)); delete q.st.z; }
  else if (q.z) { Object.assign(q, unpackRP(q.z)); delete q.z; }
  return q;
}
/* Base45 : alphabet du mode « alphanumérique » des QR codes (≈ 30 % de données en plus par QR) */
const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
function b45enc(u8){ let s = '';
  for (let i = 0; i < u8.length; i += 2) {
    if (i + 1 < u8.length) { let x = u8[i]*256 + u8[i+1]; const c = x % 45; x = (x-c)/45; const d = x % 45; const e = (x-d)/45; s += B45[c] + B45[d] + B45[e]; }
    else { const x = u8[i], c = x % 45, d = (x-c)/45; s += B45[c] + B45[d]; }
  } return s; }
function b45dec(s){ const out = [];
  for (let i = 0; i < s.length; i += 3) {
    const c = B45.indexOf(s[i]), d = B45.indexOf(s[i+1]);
    if (i + 2 < s.length) { const x = c + d*45 + B45.indexOf(s[i+2])*2025; out.push(x >> 8, x & 255); }
    else out.push(c + d*45);
  } return new Uint8Array(out); }
async function streamBytes(u8, ts){ const st = new Blob([u8]).stream().pipeThrough(ts); return new Uint8Array(await new Response(st).arrayBuffer()); }
async function encodePacket(obj){
  const raw = new TextEncoder().encode(JSON.stringify(packPacket(obj)));
  if (window.CompressionStream) {
    try { return 'Z' + b45enc(await streamBytes(raw, new CompressionStream('deflate-raw'))); } catch(e){}
  }
  return 'J' + b45enc(raw);
}
async function decodePacket(str){
  if (str[0] === 'z' || str[0] === 'j') {           // ancien format (base64)
    let raw = Uint8Array.from(atob(str.slice(1)), c => c.charCodeAt(0));
    if (str[0] === 'z') raw = await streamBytes(raw, new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(raw));
  }
  if (str[0] === 'X') return binDecode(b45dec(str.slice(1)));
  if (str[0] === 'Y') return binDecode(await streamBytes(b45dec(str.slice(1)), new DecompressionStream('deflate-raw')));
  const flag = str[0], bytes = b45dec(str.slice(1));
  let raw = bytes;
  if (flag === 'Z') {
    if (!window.DecompressionStream) throw new Error('Appareil trop ancien pour décompresser');
    raw = await streamBytes(bytes, new DecompressionStream('deflate-raw'));
  }
  return unpackPacket(JSON.parse(new TextDecoder().decode(raw)));
}
function chunkQR(payload, type, max=QR_CHUNK){
  const id = rnd(3).toUpperCase(), parts = [];
  const n = Math.max(1, Math.ceil(payload.length / max));
  const per = Math.ceil(payload.length / n);          // morceaux égaux = QR les moins denses possible
  for (let i = 0; i < n; i++) parts.push(`B5:${type}:${id}:${i+1}:${n}:` + payload.slice(i*per, (i+1)*per));
  return parts;
}
function qrDataURL(text){
  const qr = qrcode(0, 'L'); qr.addData(text, 'Alphanumeric'); qr.make();
  return qr.createDataURL(10, 40);   // marge blanche = 4 modules (zone de silence obligatoire)
}
/* Lecture d'un morceau scanné : « B5:F:ID:i:n:données » */
function parsePart(txt){
  if (txt && txt.startsWith('B5|')) { const f = txt.split('|'); if (f.length < 6) return null;
    return { type:f[1], id:'L'+f[2], i:+f[3], n:+f[4], data:f.slice(5).join('|') }; }
  if (!txt || !txt.startsWith('B5:')) return null;
  const f = txt.split(':');
  if (f.length < 6) return null;
  return { type:f[1], id:f[2], i:+f[3], n:+f[4], data:f.slice(5).join(':') };
}

/* Affichage d'une série de QR (défilement automatique) */
let qrTimer = null;
function showQRSeries(parts, container, title){
  let i = 0, auto = parts.length > 1, speed = 2000;
  const imgs = parts.map(qrDataURL);
  const draw = () => {
    container.innerHTML = `<div class="qr-box">
      ${title?`<h2 class="center">${title}</h2>`:''}
      <img src="${imgs[i]}" alt="QR code ${i+1}/${parts.length}">
      <div class="qr-part">${parts.length>1?`QR ${i+1} / ${parts.length}`:'QR unique'}</div>
      ${parts.length>1?`<div class="qr-nums">${parts.map((_,k)=>`<button class="${k===i?'on':''}" data-q="${k}">${k+1}</button>`).join('')}</div>
        <div class="btn-row"><button class="btn" data-q="prev">←</button>
        <button class="btn ${auto?'orange':''}" data-q="auto">${auto?'⏸ Pause':'▶ Défilement auto'}</button>
        <button class="btn" data-q="next">→</button></div>`:''}
      
    </div>`;
    container.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      const q = b.dataset.q;
      if (q === 'auto') auto = !auto;
      else if (q === 'prev') { auto = false; i = (i - 1 + parts.length) % parts.length; }
      else if (q === 'next') { auto = false; i = (i + 1) % parts.length; }
      else { auto = false; i = +q; }
      draw();
    });
  };
  clearInterval(qrTimer);
  qrTimer = setInterval(() => { if (!document.body.contains(container)) return clearInterval(qrTimer); if (auto) { i = (i+1) % parts.length; draw(); } }, speed);
  draw();
}

/* Scanner : caméra (détecteur natif si disponible, sinon jsQR sur le centre de l'image en pleine résolution)
   + secours « photo du QR » (appareil photo natif, mise au point automatique) */
let scan = null;
function stopScan(){
  if (!scan) return;
  scan.stopped = true;
  clearTimeout(scan.timer);
  if (scan.stream) scan.stream.getTracks().forEach(t => t.stop());
  scan = null;
}
let nativeDetector, scanCamIdx = 0, scanCamId = null;
async function getNativeDetector(){
  if (nativeDetector !== undefined) return nativeDetector;
  nativeDetector = null;
  try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) nativeDetector = new BarcodeDetector({ formats:['qr_code'] }); } catch(e){}
  return nativeDetector;
}
/* jsQR lit mal les images floues/bruitées en pleine résolution : on réduit l'image par moyennage
   (filtre « boîte », qui efface le bruit du capteur) à plusieurs échelles, en alternant d'une image à l'autre. */
const SCAN_SCALES = [0.4, 0.3, 0.5, 0.24, 0.62, 0.35, 0.8, 0.45];
function grabGray(ctx, cv, src, sx, sy, sw, sh, maxSide){
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw*k), h = Math.round(sh*k);
  cv.width = w; cv.height = h; ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data, g = new Float32Array(w*h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = d[j]*0.3 + d[j+1]*0.59 + d[j+2]*0.11;
  return { g, w, h };
}
function boxDown(G, f){
  const { g, w, h } = G;
  if (f >= 0.999) return G;
  const nw = Math.max(1, Math.round(w*f)), nh = Math.max(1, Math.round(h*f));
  const o = new Float32Array(nw*nh), c = new Float32Array(nw*nh);
  for (let y = 0; y < h; y++) { const yy = Math.min(nh-1, (y*f)|0), row = yy*nw;
    for (let x = 0; x < w; x++) { const i = row + Math.min(nw-1, (x*f)|0); o[i] += g[y*w+x]; c[i]++; } }
  for (let i = 0; i < o.length; i++) o[i] /= c[i] || 1;
  return { g:o, w:nw, h:nh };
}
function jsqrGray(G, both){
  const { g, w, h } = G, d = new Uint8ClampedArray(w*h*4);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) { d[j] = d[j+1] = d[j+2] = g[i]; d[j+3] = 255; }
  const c = jsQR(d, w, h, { inversionAttempts: both ? 'attemptBoth' : 'dontInvert' });
  return c && c.data ? c.data : null;
}
function jsqrOn(ctx, w, h, both){
  const img = ctx.getImageData(0, 0, w, h);
  const c = jsQR(img.data, w, h, { inversionAttempts: both ? 'attemptBoth' : 'dontInvert' });
  return c && c.data ? c.data : null;
}
/* Lecteur ZXing (moteur de lecture professionnel, compilé en WebAssembly, embarqué dans l'appli) */
let zxReady = false;
try {
  if (window.ZXingWASM) ZXingWASM.prepareZXingModule({ overrides:{ locateFile:(path, prefix) => path.endsWith('.wasm') ? new URL('lib/' + path, document.baseURI).href : prefix + path }, fireImmediately:true })
    .then(() => { zxReady = true; }).catch(e => console.warn('ZXing', e));
} catch(e){}
async function zxRead(imgData){
  if (!zxReady) return null;
  try { const r = await ZXingWASM.readBarcodes(imgData, { formats:['QRCode'], tryHarder:true, maxNumberOfSymbols:1 });
    const ok = r.find(x => x.isValid && x.text); return ok ? ok.text : null; } catch(e){ return null; }
}
async function decodeImageSource(src, sw, sh, cv, ctx, frame, all=false){
  const det = await getNativeDetector();
  if (det) { try { const r = await det.detect(src); if (r && r.length) return r.map(x => x.rawValue); } catch(e){} }
  const side = Math.min(sw, sh) * 0.92, sx = (sw - side)/2, sy = (sh - side)/2;
  if (zxReady) {
    // ZXing : cadre central, puis image entière de temps en temps
    const k = Math.min(1, 1000 / side), w = Math.round(side*k);
    cv.width = w; cv.height = w; ctx.drawImage(src, sx, sy, side, side, 0, 0, w, w);
    let t = await zxRead(ctx.getImageData(0, 0, w, w));
    if (t) return [t];
    if (all || frame % 3 === 2) {
      const k2 = Math.min(1, 1280 / Math.max(sw, sh)), w2 = Math.round(sw*k2), h2 = Math.round(sh*k2);
      cv.width = w2; cv.height = h2; ctx.drawImage(src, 0, 0, sw, sh, 0, 0, w2, h2);
      t = await zxRead(ctx.getImageData(0, 0, w2, h2));
      if (t) return [t];
    }
    if (!all && frame % 2 === 0) return [];        // une image sur deux : aussi jsQR (ci-dessous)
  }
  const G = grabGray(ctx, cv, src, sx, sy, side, side, 1100);
  const scales = all ? SCAN_SCALES : [SCAN_SCALES[frame % SCAN_SCALES.length], SCAN_SCALES[(frame+3) % SCAN_SCALES.length]];
  for (const f of scales) {
    const t = jsqrGray(boxDown(G, f * side / G.w), all || frame % 5 === 4);
    if (t) return [t];
  }
  if (all || frame % 4 === 3) {                      // image entière (QR hors du cadre)
    const F = grabGray(ctx, cv, src, 0, 0, sw, sh, 1100);
    for (const f of (all ? [0.35, 0.5, 0.7] : [0.5])) { const t = jsqrGray(boxDown(F, f), all); if (t) return [t]; }
  }
  return [];
}
async function startScan(container, expectType, onDone){
  stopScan();
  container.innerHTML = `<div class="scan-wrap"><video playsinline webkit-playsinline muted autoplay></video><div class="scan-frame"></div></div>
    <div style="max-width:560px;margin:12px auto">
      <div class="scan-parts"></div>
      <p class="center" style="font-weight:900;font-size:20px" id="scan-msg">Démarrage de la caméra…</p>
      <div class="btn-row" style="justify-content:center"><button class="btn" data-cam>🔄 Caméra</button><label class="btn">📷 Photo du QR<input type="file" accept="image/*" capture="environment" hidden class="scan-photo"></label></div></div>`;
  const video = container.querySelector('video'), msg = container.querySelector('#scan-msg'), partsEl = container.querySelector('.scan-parts');
  const me = scan = { stopped:false, parts:{}, id:null, n:0, frame:0 };
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently:true });
  const showParts = () => { partsEl.innerHTML = me.n > 1 ? Array.from({length:me.n},(_,k)=>`<span class="${me.parts[k+1]?'ok':''}">${k+1}</span>`).join('') : ''; };
  let finished = false;
  const handle = async texts => {
    for (const txt of texts) {
      const pt = parsePart(txt);
      if (!pt) { msg.textContent = 'QR non reconnu (ce n\'est pas un QR de l\'appli Biathlon).'; continue; }
      const okTypes = [].concat(expectType || []);
      if (okTypes.length && !okTypes.includes(pt.type)) { msg.textContent = pt.type === 'R' ? 'QR de saisies (tablette) : à scanner par l\'enseignant.' : 'QR de l\'enseignant : à scanner sur les tablettes.'; continue; }
      if (pt.id === me.doneId) continue;            // QR déjà traité (encore devant la caméra)
      if (me.id !== pt.id) { me.id = pt.id; me.parts = {}; me.n = pt.n; }
      if (!me.parts[pt.i]) { me.parts[pt.i] = pt.data; if (navigator.vibrate) navigator.vibrate(40); }
      const got = Object.keys(me.parts).length;
      showParts();
      const miss = Array.from({length:me.n},(_,k)=>k+1).filter(k=>!me.parts[k]);
      msg.textContent = me.n > 1 ? `QR reçus : ${got} / ${me.n}${miss.length && miss.length<=3 ? ' — il manque : ' + miss.join(', ') : ''}` : 'QR reçu !';
      if (got === me.n && !finished) {
        finished = true;
        const payload = Array.from({length: me.n}, (_, k) => me.parts[k+1]).join('');
        me.doneId = me.id; me.id = null; me.parts = {};
        let r;
        try { r = await onDone(await decodePacket(payload)); }
        catch(e) { console.warn(e); toast('⚠️ ' + e.message, 3500); r = 'continue'; }
        if (r === 'continue' && scan === me && !me.stopped) {     // la caméra reste allumée pour le QR suivant
          finished = false; showParts(); msg.textContent = '✓ Reçu'; me.timer = setTimeout(tick, 400);
        } else if (scan === me) stopScan();
        return;
      }
    }
  };
  // secours photo
  container.querySelector('.scan-photo').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    msg.textContent = 'Lecture de la photo…';
    try {
      const bmp = await createImageBitmap(f);
      const pcv = document.createElement('canvas'), pctx = pcv.getContext('2d', { willReadFrequently:true });
      const r = await decodeImageSource(bmp, bmp.width, bmp.height, pcv, pctx, 0, true);
      if (r.length) await handle(r); else msg.textContent = '⚠️ QR non trouvé sur la photo : recommencez en cadrant le QR bien net, en entier.';
    } catch(err) { msg.textContent = '⚠️ Photo illisible'; }
  });
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    msg.innerHTML = '⚠️ Caméra en direct indisponible ici (l\'appli doit être ouverte en https). Utilisez « Prendre le QR en photo ».'; return;
  }
  container.querySelector('[data-cam]').onclick = async () => {
    try { const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      if (cams.length < 2) return toast('Une seule caméra');
      scanCamIdx = (scanCamIdx + 1) % cams.length; scanCamId = cams[scanCamIdx].deviceId;
      startScan(container, expectType, onDone); } catch(e){}
  };
  try {
    const vc = scanCamId ? { deviceId:{ exact: scanCamId }, width:{ ideal:1920 }, height:{ ideal:1080 } } : { facingMode:{ ideal:'environment' }, width:{ ideal:1920 }, height:{ ideal:1080 } };
    me.stream = await navigator.mediaDevices.getUserMedia({ video: vc, audio:false });
  } catch(e) {
    msg.innerHTML = '⚠️ Caméra refusée ou occupée. Autorisez la caméra pour ce site (Réglages → Safari → Appareil photo) ou utilisez « Prendre le QR en photo ».';
    return;
  }
  if (me.stopped) { me.stream.getTracks().forEach(t=>t.stop()); return; }
  const track = me.stream.getVideoTracks()[0];
  try { await track.applyConstraints({ advanced:[{ focusMode:'continuous' }] }); } catch(e){}
  video.setAttribute('playsinline', ''); video.muted = true;
  video.srcObject = me.stream; try { await video.play(); } catch(e){}
  msg.textContent = 'Visez le QR code…';
  const tick = async () => {
    if (me.stopped || finished) return;
    if (video.readyState >= 2 && video.videoWidth) {
      me.frame++;
      try { const r = await decodeImageSource(video, video.videoWidth, video.videoHeight, cv, ctx, me.frame); if (r.length) await handle(r); } catch(e){ console.warn(e); }
    }
    if (!me.stopped && !finished) me.timer = setTimeout(tick, 40);
  };
  tick();
}

/* Vues d'échange côté tablette */
function viewSend(){
  const { count } = buildMine();
  return `<div class="card strong center"><b style="font-size:20px">${count} saisie(s) faite(s) sur cette tablette</b></div>
    <div id="qr-area" class="center">Préparation…</div>
    <div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn" data-action="fileMine">📤 Partager en fichier (AirDrop…) à la place</button></div>`;
}
async function afterSend(){
  const payload = await encodeBin(binResults().bytes);
  const area = $('#qr-area'); if (!area) return;
  showQRSeries(chunkQR(payload, 'R', 260), area, '');
}
function viewReceive(){
  return `<div class="card strong center"><b style="font-size:20px">Scannez le QR « leçon » affiché par l'enseignant</b></div>
    <div id="scan-area"></div>
    <div class="btn-row" style="justify-content:center;margin-top:12px"><label class="btn">📂 Importer un fichier (.json)<input type="file" id="file-sync" accept=".json,application/json" hidden></label></div>`;
}
function afterReceive(){ startScan($('#scan-area'), ['F','N','L'], p => applyPacket(p)); }

async function downloadJSON(obj, name){
  const blob = new Blob([JSON.stringify(obj)], { type:'application/json' });
  try {
    const file = new File([blob], name, { type:'application/json' });
    if (navigator.canShare && navigator.canShare({ files:[file] })) { await navigator.share({ files:[file], title:name }); return; }
  } catch(e) { if (e && e.name === 'AbortError') return; }
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
  tgStep: d => { const n = curLesson(), a = d.a, L = lesson(n); const b = baseTarget(n, d.sid, a);
    L[ACT[a].man][d.sid] = clampT(a, b == null ? Math.ceil(maxPlots(a)/2) : b + (+d.d)); save(); render(); },
  bulkStep: d => { const a = d.a; UI['bulk'+a] = clampT(a, (UI['bulk'+a] ?? Math.ceil(maxPlots(a)/2)) + (+d.d)); render(); document.querySelector('.card details')?.setAttribute('open',''); },
  bulkApply: async d => { const a = d.a, v = UI['bulk'+a] ?? Math.ceil(maxPlots(a)/2), n = curLesson();
    if (!(await confirmBox('Même cible pour tous ?', `${ACT[a].label} : ${plotShort(a, v)} pour tous les élèves à partir de la leçon ${n}.`, 'Appliquer'))) return;
    S.students.forEach(st => { lesson(n)[ACT[a].man][st.id] = v; }); save(); render(); toast('✓ Cibles appliquées'); },
  resetTarget: d => { delete lesson(curLesson())[ACT[d.a].man][d.sid]; save(); render(); },

  // prof : groupes
  dropSel: d => { if (!UI.sel) return; const s = student(UI.sel); if (s) { s.g = d.zone || null; save(); } UI.sel = null; render(); },
  clearGroups: () => { S.students.forEach(s => s.g = null); save(); render(); },

  // prof : partage
  showQR: async d => {
    const bytes = d.kind === 'N' ? binNames() : binLesson();
    const parts = chunkQR(await encodeBin(bytes), d.kind, 260);
    const m = modal(`<div id="qr-modal"></div><div class="btn-row" style="justify-content:center;margin-top:10px"><button class="btn primary" data-close>Fermer</button></div>`, { wide:true });
    m.querySelector('[data-close]').onclick = closeModal;
    showQRSeries(parts, m.querySelector('#qr-modal'), d.kind === 'N' ? 'Élèves' : `Leçon ${curLesson()}`);
  },
  showFullQR: async d => {
    const payload = await encodePacket(buildFull(d.light === '1'));
    const parts = chunkQR(payload, 'F');
    const m = modal(`<div id="qr-modal"></div><div class="btn-row" style="justify-content:center;margin-top:10px"><button class="btn primary" data-close>Fermer</button></div>`, { wide:true });
    m.querySelector('[data-close]').onclick = closeModal;
    showQRSeries(parts, m.querySelector('#qr-modal'), `Leçon ${curLesson()} → tablettes`);
  },
  scanResults: () => {
    const m = modal(`<h2>Scanner une tablette</h2><div id="scan-modal"></div><div class="btn-row" style="justify-content:center;margin-top:10px"><button class="btn primary" data-close>Terminer</button></div>`, { wide:true });
    m.querySelector('[data-close]').onclick = () => { closeModal(); render(); };
    startScan(m.querySelector('#scan-modal'), 'R', async p => { await applyPacket(p); return 'continue'; });
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
  if (f === 'source') { lesson(t.dataset.n).source = t.value === 'prev' ? 'prev' : +t.value; save(); render(); toast('✓ Cibles mises à jour'); }
  if (f === 'calc') { lesson(t.dataset.n).calc = t.value; save(); render(); }
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
const verEl = document.getElementById('app-version'); if (verEl) verEl.textContent = 'Version ' + APP_VERSION;
render();
/* Mise à jour automatique : dès qu'une nouvelle version est publiée, l'appli se recharge toute seule */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache:'none' })
    .then(reg => { reg.update(); setInterval(() => reg.update(), 30*60*1000); document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); }); })
    .catch(()=>{}));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});

