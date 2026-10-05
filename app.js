/* =====================================================================
   Biathlon 5 s / Basket — Suivi de performance élèves
   N'EPS numérique — CA1 — Quentin Delisle et Gwilherm Rocher
   PWA hors-ligne : données stockées sur l'appareil (localStorage),
   échanges entre tablettes par QR codes.
   Mesure : 1 point par plot atteint.
     Barème réglable (menu prof) : course = vitesse du 1er plot (+1 km/h par plot) et temps de course ;
     lancer = distance du 1er plot et écart entre plots ; maximum de points = nombre de plots.
     Basket (tir long) : plot 1 à 4 m, puis un plot tous les 2 m (1 à 20 plots)
   ===================================================================== */
'use strict';

const APP_VERSION = '8.1.0';
const STORE_KEY = 'neps_biathlon5s_v2';
const QR_CHUNK = 440;           // caractères base45 par QR (QR version 11 max : facile à lire par une caméra)

/* Les deux épreuves du biathlon */
const ACT = {
  s: { id:'s', key:'c', ico:'🏃', get label(){ return 'Sprint ' + fmt(S.settings.timeS) + ' s'; }, att:'nbCourses', base:'baseCourses', plots:'plotsS', ecart:'ecartS',
       man:'manual', adj:'adjust', proj:'cibleS', maxPlots:20, minPlots:1, word:'course',
       unit: k => `${fmt(spdS(k))} km/h`, detail: k => `${fmt(distS(k))} m en ${fmt(S.settings.timeS)} s` },
  b: { id:'b', key:'b', ico:'🏀', label:'Basket', att:'nbTirs', base:'baseTirs', plots:'plotsB', ecart:'ecartB',
       man:'manualB', adj:'adjustB', proj:'cibleB', maxPlots:20, minPlots:1, word:'tir',
       unit: k => `${fmt(distB(k))} m`, detail: k => `plot à ${fmt(distB(k))} m` },
};
const pts = k => `${k} pt${k>1?'s':''}`;
const plotTxt = (a, k) => k == null ? '—' : k === 0 ? 'aucun plot' : `plot ${k} (${ACT[a].unit(k)})`;
const plotShort = (a, k) => k == null ? '—' : `${pts(k)} · ${ACT[a].unit(k)}`;
/* Barème réglable par l'enseignant */
const spdS = k => +S.settings.firstS + (k - 1);                              // vitesse du plot k (km/h), +1 km/h par plot
const distS = k => spdS(k) / 3.6 * +S.settings.timeS;                        // distance à parcourir (m)
const distB = k => +S.settings.firstB + (k - 1) * +S.settings.stepB;         // distance du plot k au lancer (m)

const COLORS = [
  {k:'rouge', n:'Rouge', c:'#E3262B'}, {k:'bleu', n:'Bleu', c:'#1E5FD8'},
  {k:'jaune', n:'Jaune', c:'#FFD400'}, {k:'vert', n:'Vert', c:'#1FA24A'},
  {k:'orange', n:'Orange', c:'#FF7A00'}, {k:'violet', n:'Violet', c:'#8A2BE2'},
  {k:'rose', n:'Rose', c:'#FF4FA3'}, {k:'blanc', n:'Blanc', c:'#FFFFFF'},
  {k:'noir', n:'Noir', c:'#1A1A1A'}, {k:'cyan', n:'Cyan', c:'#00B8D9'},
  {k:'marron', n:'Marron', c:'#8B5A2B'}, {k:'gris', n:'Gris', c:'#8A94A6'},
  {k:'lime', n:'Vert clair', c:'#9BE13C'}, {k:'bordeaux', n:'Bordeaux', c:'#8E1B3A'},
  {k:'marine', n:'Bleu marine', c:'#0B2A6B'}, {k:'turquoise', n:'Turquoise', c:'#14B8A6'},
  {k:'saumon', n:'Saumon', c:'#FF8C7A'}, {k:'kaki', n:'Kaki', c:'#7A7A2E'}
];
const MAX_GROUPS = 18;
const colorOf = k => COLORS.find(c => c.k === k);

/* ---------------------------------------------------------------------
   État
   --------------------------------------------------------------------- */
function rnd(n){ const a='abcdefghijkmnpqrstuvwxyz23456789'; let s=''; for(let i=0;i<n;i++) s+=a[Math.floor(Math.random()*a.length)]; return s; }
const DEFAULT_SETTINGS = { nbLessons:8, current:1, className:'',
  baseCourses:3, baseTirs:3, plotsS:11, plotsB:8, ecartS:2, ecartB:1,
  firstS:15, timeS:5, firstB:4, stepB:2, nbGroups:1, groupColors:['rouge','bleu','jaune','vert','orange','violet','rose','cyan','noir','marron','lime','bordeaux','turquoise','gris','blanc','saumon','marine','kaki'] };
const ROOT_KEY = 'neps_biathlon5s_v3';
/* Plusieurs classes (cycles) sur le même appareil : ROOT = { deviceId, pin, active, classes:{ id: classe } } ;
   S désigne toujours la classe active. */
function newClassState(name, id){
  return { id: id || rnd(4), settings:{ ...DEFAULT_SETTINGS, className: name || '', groupColors:[...DEFAULT_SETTINGS.groupColors] },
    students:[], lessons:{}, results:{}, projects:{}, comp:{} };
}
function normClass(c){
  c.settings = { ...DEFAULT_SETTINGS, ...(c.settings||{}) };
  const gc = c.settings.groupColors || []; c.settings.groupColors = DEFAULT_SETTINGS.groupColors.map((k, i) => gc[i] || k);
  c.settings.plotsB = Math.min(20, c.settings.plotsB); c.settings.plotsS = Math.min(20, c.settings.plotsS);
  delete c.settings.pin;
  ['students','lessons','results','projects','comp'].forEach(k => { if (!c[k]) c[k] = (k==='students'?[]:{}); });
  // ancienne notion « chasuble » (couleur libre) → groupes 1 à 4
  const old = [...new Set(c.students.map(x => x.g).filter(g => g && typeof g === 'string'))];
  if (old.length && c.students.every(x => x.grp == null)) {
    const cols = old.slice(0, 4); c.settings.nbGroups = Math.max(1, cols.length);
    cols.forEach((k, i) => c.settings.groupColors[i] = k);
    c.students.forEach(x => { const i = cols.indexOf(x.g); x.grp = i >= 0 ? i + 1 : 0; });
  }
  c.students.forEach(x => { delete x.g; if (x.grp == null) x.grp = 0; });
  return c;
}
let ROOT, S;
function loadRoot(){
  try { ROOT = JSON.parse(localStorage.getItem(ROOT_KEY)); } catch(e){ ROOT = null; }
  if (!ROOT || !ROOT.classes) {
    ROOT = { v:3, deviceId: rnd(4), pin:'0000', active:null, classes:{} };
    let old = null; try { old = JSON.parse(localStorage.getItem('neps_biathlon5s_v2')); } catch(e){}
    if (old && old.students) {                                   // reprise de la version précédente
      ROOT.deviceId = old.deviceId || ROOT.deviceId; ROOT.pin = (old.settings && old.settings.pin) || '0000';
      const c = { ...old, id: rnd(4) }; delete c.deviceId; delete c.v;
      if (!c.settings.className) c.settings.className = 'Classe 1';
      ROOT.classes[c.id] = c;
    }
  }
  if (!ROOT.deviceId) ROOT.deviceId = rnd(4);
  if (!ROOT.pin) ROOT.pin = '0000';
  Object.values(ROOT.classes).forEach(normClass);
  if (!Object.keys(ROOT.classes).length) { const c = newClassState('Classe 1'); ROOT.classes[c.id] = c; }
  if (!ROOT.classes[ROOT.active]) ROOT.active = Object.keys(ROOT.classes)[0];
  useClass(ROOT.active);
}
function useClass(id){
  ROOT.active = id; S = ROOT.classes[id]; S.deviceId = ROOT.deviceId;
  try { computeNames(); } catch(e){}
}
const className = c => (c || S).settings.className || 'Classe';
loadRoot();

function save(){
  try { localStorage.setItem(ROOT_KEY, JSON.stringify(ROOT)); }
  catch(e){ toast('⚠️ Enregistrement impossible sur cet appareil'); }
  computeNames();
}

const UI = { view:'home', profTab:'menu', profUnlocked:false, filter:null, sid:null, back:null, sel:null };

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
  ['manual','adjust','manualB','adjustB','att','grpOv'].forEach(k => { L[k] = L[k] || {}; });
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
/* Nature de la leçon */
const KINDS = { manuel:'Remplissage manuel', diag:'Évaluation diagnostique', inter:'Diagnostic intermédiaire', finale:'Évaluation finale', theme:'Thème de leçon' };
const KIND_IDX = ['manuel','diag','inter','finale','theme'];
const kindOf = n => lesson(n).kind || 'manuel';
const lessonTitle = n => kindOf(n) === 'manuel' ? (lesson(n).title || '') : kindOf(n) === 'theme' ? (lesson(n).th ? 'Thème : ' + lesson(n).th.n : 'Thème à choisir') : KINDS[kindOf(n)];
/* Dernière leçon (avant n) d'une nature donnée */
function lastKind(kind, n){ for (let k = n - 1; k >= 1; k--) if (kindOf(k) === kind) return k; return null; }
const isFinale = n => kindOf(n) === 'finale';

/* Cible calculée à partir des résultats d'une leçon (meilleur plot ou moyenne arrondie) */
function targetFromResults(x, sid, a, calc){
  const v = vals(perf(x, sid, a));
  if (!v.length) return null;
  return clampT(a, Math.max(...v));
}
/* Cible de base (sans facile / difficile). Une cible reste la norme jusqu'au prochain changement :
   modification à la main, ou « utiliser les résultats de la leçon X ». */
function sourceLesson(n){
  const L = lesson(n);
  if (hasSource(n)) return L.source;
  if (L.source === 'diag') return lastKind('diag', n);
  if (L.source === 'inter') return lastKind('inter', n);
  return null;
}
const projTarget = (sid, a) => S.projects[sid] && S.projects[sid][ACT[a].proj] != null ? +S.projects[sid][ACT[a].proj] : null;
function baseTarget(n, sid, a, depth=0){
  n = +n;
  if (n < 1 || depth > 40) return null;
  const L = lesson(n);
  if (L[ACT[a].man][sid] != null) return +L[ACT[a].man][sid];
  if ((L.source === 'projet' || isFinale(n)) && projTarget(sid, a) != null) return projTarget(sid, a);
  const fx = L[a === 's' ? 'fixedS' : 'fixedB'];
  if (fx && fx[sid] != null) return +fx[sid];            // cibles reçues du professeur (QR)
  if (L.source === 'none') return null;                  // cibles à déterminer (évaluation)
  const src = sourceLesson(n);
  if (src) { const t = targetFromResults(src, sid, a, L.calc); if (t != null) return t; }
  return baseTarget(n - 1, sid, a, depth + 1);
}
function targetInfo(n, sid, a){
  n = +n;
  const L = lesson(n);
  const base = baseTarget(n, sid, a);
  const sign = 0, adj = 0;
  const value = base == null ? null : clampT(a, base);
  const prev = n > 1 ? targetInfo(n-1, sid, a).value : null;
  const manual = L[ACT[a].man][sid] != null;
  const fromProject = !manual && (L.source === 'projet' || isFinale(n)) && projTarget(sid, a) != null;
  const srcL = sourceLesson(n);
  const fromRes = !manual && !fromProject && srcL && targetFromResults(srcL, sid, a, L.calc) != null;
  const src = manual ? 'fixée à la main' : fromProject ? 'projet élève' : fromRes ? `résultats L${srcL}` : L.source === 'none' ? 'à déterminer' : base == null ? 'à définir' : (L.source === 'projet' || isFinale(n)) ? `pas de projet : cible de L${n-1}` : `reprise de L${n-1}`;
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
      ? `${P}Tu atteins ta cible à <b>chaque ${A_.word}</b>${prevOk?' depuis 2 leçons':''} : elle est sans doute trop facile. Demande à ton enseignant de la revoir (plot supérieur).`
      : `${P}Tu as atteint ta cible à toutes tes tentatives : peut-être faut-il la revoir à la hausse ?` });
  const m = avg(last.v);
  if (t != null && m != null && last.v.length >= 2 && m <= t - 2)
    out.push({ cls:'', t:`${P}En moyenne tu marques ${fmt(m)} points pour une cible de ${pts(t)} : ta cible est peut-être trop difficile aujourd'hui. Parles-en à ton enseignant.` });
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
  $('#tb-main').textContent = main; $('#tb-sub').textContent = '🏫 ' + className() + (sub ? ' · ' + sub : ''); $('#tb-right').innerHTML = right;
}
function lessonLabel(n){ const t = lessonTitle(n); return `Leçon ${n}/${S.settings.nbLessons}` + (t ? ' · ' + t : ''); }
function go(view, opts={}){ Object.assign(UI, opts); UI.view = view; render(); window.scrollTo(0,0); }

function render(){
  stopScan();
  let v = UI.view; const m = $('#main');
  if (!ROOT.role) { setTop('Biathlon · CA1', 'Choix du rôle de la tablette'); m.innerHTML = viewRole(); return; }
  const prof = isProfRole();
  /* tablette élève : scanner la séance, saisir, projet (évaluation finale), envoyer */
  if (!prof && !['home','saisie','entry','projet','projetDetail','send','receive'].includes(v)) v = UI.view = 'home';
  /* tablette enseignant : tout passe par l'espace enseignant (code) */
  if (prof && !UI.profUnlocked && v !== 'home') v = UI.view = 'home';
  if (prof && UI.profUnlocked && v === 'home') { v = UI.view = 'prof'; UI.profTab = 'menu'; }
  const homeBtn = `<button class="btn small" data-action="go" data-view="home">⌂ Accueil</button>`;
  const menuBtn = `<button class="btn small" data-action="profTab" data-tab="menu">☰ Menu</button>`;
  const head = sec => prof ? sectHeader(sec) : '';
  if (v === 'home') { setTop('Biathlon · CA1', prof ? 'Tablette enseignant' : 'Tablette élève'); m.innerHTML = prof ? viewHomeProfLocked() : viewHomeEleve(); }
  else if (v === 'saisie') { if (prof) UI.profTab = 'saisieP'; setTop('Saisie · Leçon ' + curLesson(), UI.filter ? groupName(UI.filter) : lessonTitle(curLesson()), prof ? menuBtn : homeBtn); m.innerHTML = head('jour') + viewSaisie(); }
  else if (v === 'entry') { setTop('Saisie · ' + nameOf(UI.sid), lessonLabel(curLesson()), `<button class="btn small" data-action="go" data-view="saisie">▦ Élèves</button>`); m.innerHTML = viewEntry(); bindEntry(); }
  else if (v === 'stats') { UI.profTab = 'statsP'; setTop('Statistiques', 'Choisir un élève', menuBtn); m.innerHTML = head('bilans') + viewStatsTiles(); }
  else if (v === 'projet') { if (prof) UI.profTab = 'projetP'; setTop('Projet de l\'élève', 'Évaluation finale', prof ? menuBtn : homeBtn); m.innerHTML = head('bilans') + viewProjetTiles(); }
  else if (v === 'projetDetail') { setTop('Projet · ' + nameOf(UI.sid), '', `<button class="btn small" data-action="go" data-view="projet">▦ Élèves</button>`); m.innerHTML = viewProjetDetail(); }
  else if (v === 'statsDetail') { setTop('Stats · ' + nameOf(UI.sid), '', `<button class="btn small" data-action="go" data-view="stats">▦ Élèves</button>`); m.innerHTML = viewStatsDetail(); }
  else if (v === 'prof') { setTop('Espace enseignant', lessonLabel(curLesson()), `<button class="btn small" data-action="lockProf">🔒 Verrouiller</button>`); m.innerHTML = viewProf(); afterProf(); }
  else if (v === 'send') { setTop('Envoyer mes saisies', 'QR code à scanner par l\'enseignant', homeBtn); m.innerHTML = viewSend(); afterSend(); }
  else if (v === 'receive') { setTop('Scanner la séance', 'QR affiché par l\'enseignant', homeBtn); m.innerHTML = viewReceive(); afterReceive(); }
}

/* ---------------------------------------------------------------------
   Accueil
   --------------------------------------------------------------------- */
function viewHome(){
  const n = curLesson(), L = lesson(n);
  const pres = S.students.filter(s => present(n, s.id)).length;
  const cls = Object.values(ROOT.classes);
  return `<div class="home">
    <img class="home-logo" src="logo-app.png" alt="N'EPS numérique – CA1 Biathlon">
    ${cls.length > 1 ? `<div class="class-chips">${cls.map(c=>`<button class="class-chip ${c.id===S.id?'on':''}" data-action="selClass" data-id="${c.id}">🏫 ${esc(className(c))}</button>`).join('')}</div>`
      : `<div class="class-chips"><span class="class-chip on">🏫 ${esc(className())}</span></div>`}
    <div class="home-lesson">
      <div class="big">Leçon ${n} / ${S.settings.nbLessons}</div>
      <div style="font-size:20px;font-weight:800">${esc(lessonTitle(n) || 'Sans titre')}</div>
      <div class="muted" style="font-weight:700">🏃 ${nbAtt(n,'s')} sprint(s) de ${fmt(S.settings.timeS)} s · 🏀 ${nbAtt(n,'b')} tir(s) basket · ${pres}/${S.students.length} élève(s) présent(s)</div>
    </div>
    <div class="home-grid">
      <button class="home-btn saisie" data-action="goSaisie"><span class="ico">✍️</span>Saisie</button>
      <button class="home-btn stats" data-action="go" data-view="stats"><span class="ico">📊</span>Statistiques</button>
      <button class="home-btn prof" data-action="openProf"><span class="ico">🔒</span>Enseignant</button>
    </div>
    <div class="home-sync">
      <button class="btn orange" data-action="go" data-view="send">📤 Envoyer mes saisies (QR)</button>
    </div>
    ${S.students.length ? '' : `<div class="card strong center" style="max-width:640px">Aucun élève</div>`}
  </div>`;
}

/* ---------------------------------------------------------------------
   Tuiles (commun)
   --------------------------------------------------------------------- */
const nbGroups = () => Math.max(1, Math.min(MAX_GROUPS, +S.settings.nbGroups || 1));
const groupColor = g => (g >= 1 && g <= nbGroups() && nbGroups() > 1) ? colorOf(S.settings.groupColors[g-1]) : null;
const groupName = g => `Groupe ${g}`;
/* Groupe d'un élève pour une leçon : groupe habituel, sauf changement pour ce jour-là */
function grpOf(sid, n){ const L = lesson(n || curLesson()), ov = L.grpOv[sid]; return ov != null ? +ov : (student(sid)?.grp || 0); }
function band(sid){ const c = groupColor(grpOf(sid)); return c ? `<span class="band" style="background:${c.c};box-shadow:inset -2px 0 0 rgba(0,0,0,.35)"></span>` : '<span class="band"></span>'; }
function filterBar(){
  if (nbGroups() < 2) return '';
  return `<div class="filters">
    <button class="chip ${UI.filter?'':'on'}" data-action="filter" data-g="">Tous</button>
    ${Array.from({length:nbGroups()},(_,i)=>i+1).map(g=>{ const c = groupColor(g);
      return `<button class="chip ${UI.filter===g?'on':''}" data-action="filter" data-g="${g}"><span class="dot" style="background:${c?c.c:'#fff'}"></span>${groupName(g)}</button>`; }).join('')}
  </div>`;
}
const passFilter = s => !UI.filter || UI.filter === 'all' || grpOf(s.id) === UI.filter;

/* ---------------------------------------------------------------------
   Saisie : tuiles de la leçon en cours
   --------------------------------------------------------------------- */
function viewSaisie(){
  const n = curLesson(), L = lesson(n);
  if (!S.students.length) return `<div class="card strong center">Aucun élève. Recevez la leçon du professeur (QR) depuis l'accueil.</div>`;
  if (nbGroups() > 1 && !UI.filter) {
    return `<div class="grp-pick">${Array.from({length:nbGroups()},(_,i)=>i+1).map(g => { const c = groupColor(g);
      const nb = S.students.filter(x => grpOf(x.id, n) === g && present(n, x.id)).length;
      return `<button class="grp-btn" data-action="pickGroup" data-g="${g}"><span class="sw" style="background:${c?c.c:'#ccc'}"></span>${groupName(g)}<small>${nb} élève(s)</small></button>`; }).join('')}
      <button class="grp-btn all" data-action="pickGroup" data-g="all">Toute la classe</button></div>`;
  }
  const list = sortedStudents().filter(s => present(n, s.id) && passFilter(s));
  const off = S.students.filter(s => !present(n, s.id)).length;
  return `<div class="card strong"><div class="row"><b style="font-size:20px" class="grow">Leçon ${n} ${lessonTitle(n)?'– '+esc(lessonTitle(n)):''}</b>
      ${nbGroups() > 1 ? `<button class="btn small" data-action="pickGroup" data-g="">${UI.filter && UI.filter !== 'all' ? '🎽 ' + groupName(UI.filter) + ' · changer' : '🎽 Changer de groupe'}</button>` : ''}</div>
      <div class="muted" style="font-weight:700">🏃 ${nbAtt(n,'s')} sprint(s) de ${fmt(S.settings.timeS)} s · 🏀 ${nbAtt(n,'b')} tir(s) basket · 1 point par plot atteint${off?` · ${off} absent(s)/inapte(s) masqué(s)`:''}</div></div>
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
  const dist = v == null ? '' : a === 's' ? `${fmt(distS(v))} m` : `${fmt(distB(v))} m`;
  return `<aside class="tcol tcol-${a}"><div class="ico">${ACT[a].ico}</div><div class="lbl">CIBLE</div>
    <div class="v">${v!=null?v:'—'}</div><div class="lbl">${v!=null?(v>1?'points':'point'):'à définir'}</div>
    ${v!=null?`<div class="dist">${dist}</div>${a==='s'?`<small>${fmt(spdS(v))} km/h</small>`:''}<small>plot ${v}</small>`:''}
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
  const adv = themeAdvice(n, sid);
  if (adv) h += `<div class="advice ${adv.cls} theme-adv">${adv.t}</div>`;
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
    if (lessonTheme(n)?.a === a) h += obsBlock(n, sid);
  });
  h += wellBlock(n, sid, 'apres');
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

/* =====================================================================
   Thèmes de leçon : critères observables (motricité), observés une fois par leçon
   ===================================================================== */
const OBS = [null,
  { n:'Jamais', c:'#D0161B', f:'#fff' },
  { n:'Parfois', c:'#F07000', f:'#fff' },
  { n:'Souvent', c:'#86DC96', f:'#0A1633' },
  { n:'Toujours', c:'#0B4F1C', f:'#fff' }];
const DEFAULT_THEMES = [
  { id:'pdep', n:'Posture de départ', a:'s', cr:['Semi-vissé', 'Penché en avant', 'Rythme accéléré'] },
  { id:'papp', n:'Premiers appuis', a:'s', cr:['Regard vers le bas', 'Penché en avant', 'Utilise ses bras'] },
  { id:'mvit', n:'Maintien de la vitesse', a:'s', cr:['Se redresse', 'Regard en face', 'Court grand'] },
  { id:'bras', n:'Action des bras', a:'s', cr:['Bras fléchis à 90°', "Bras d'avant en arrière (pas en croix)", 'Épaules relâchées'] },
  { id:'fini', n:'Finir sa course', a:'s', cr:['Ne ralentit pas avant le signal', 'Garde la même foulée', 'Reste gainé'] },
  { id:'arme', n:'Armé et poussée', a:'b', cr:['Ballon au-dessus du front', 'Coude sous le ballon', "Pousse vers le haut et l'avant"] },
  { id:'traj', n:'Appuis et trajectoire', a:'b', cr:['Pieds écartés, stables', 'Fléchit puis pousse sur les jambes', 'Trajectoire en cloche'] },
];
const MAX_CR = 5;
function themes(){ if (!ROOT.themes) ROOT.themes = DEFAULT_THEMES.map(t => ({ ...t, cr:[...t.cr] })); return ROOT.themes; }
const themeById = id => themes().find(t => t.id === id);
const snapTheme = t => t ? { id:t.id, n:t.n, a:t.a, cr:t.cr.filter(Boolean) } : null;
const lessonTheme = n => kindOf(n) === 'theme' ? (lesson(n).th || null) : null;
/* après modification d'un thème : mise à jour des leçons qui l'utilisent (toutes les classes) */
function refreshThemeSnapshots(id){
  const t = themeById(id);
  Object.values(ROOT.classes).forEach(c => Object.values(c.lessons || {}).forEach(L => { if (L.kind === 'theme' && L.th && L.th.id === id) L.th = t ? snapTheme(t) : null; }));
}
/* Forme avant / douleurs : notées par le prof pendant l'appel (anciennes données : saisies par l'élève) */
const fbOf = (n, sid) => (lesson(n).wb?.[sid]?.fb) ?? res(n, sid)?.fb ?? null;
const dlOf = (n, sid) => (lesson(n).wb?.[sid]?.dl) ?? res(n, sid)?.dl ?? [];
const obsOf = (n, sid) => { const th = lessonTheme(n), r = res(n, sid); return th && r && r.ob && r.ob.some(v => v) ? r.ob : null; };
/* Conseil : dernière leçon (avant n) sur le même thème, critère le moins réussi */
function lastObs(n, sid){
  const th = lessonTheme(n); if (!th) return null;
  for (let k = n - 1; k >= 1; k--) { const t2 = lessonTheme(k); if (t2 && t2.id === th.id) { const ob = obsOf(k, sid); if (ob) return { k, ob, cr: t2.cr }; } }
  return null;
}
function pickAdvice(lo){
  if (!lo) return null;
  let i = 0; lo.ob.forEach((x, j) => { if (x && (!lo.ob[i] || x < lo.ob[i])) i = j; });
  return lo.ob[i] ? { k: lo.k, i, v: lo.ob[i] } : null;
}
function themeAdvice(n, sid){
  const th = lessonTheme(n); if (!th) return null;
  const sent = lesson(n).adv?.[sid];                        // conseil calculé par le prof (reçu par QR)
  let k, i, v;
  if (sent) ({ k, i, v } = sent);
  else { const p = pickAdvice(lastObs(n, sid)); if (!p) return null; ({ k, i, v } = p); }
  const cr = th.cr[i]; if (!cr || !v) return null;
  return v <= 2
    ? { cls:'warn', t:`💡 Rappelle-toi : la dernière fois (L${k}), « ${esc(cr)} » n'était pas assez souvent réussi (<b>${OBS[v].n.toLowerCase()}</b>). Concentre-toi dessus !` }
    : { cls:'good', t:`👍 La dernière fois (L${k}), tes critères étaient réussis souvent ou toujours. Vise « toujours » pour « ${esc(cr)} » !` };
}
const obsChip = v => v ? `<span class="obs-chip" style="background:${OBS[v].c};color:${OBS[v].f}">${OBS[v].n}</span>` : '<span class="muted">—</span>';
/* Bilan : critères observés, regroupés par thème */
function obsBilan(sid){
  const byTh = {};
  for (let n = 1; n <= S.settings.nbLessons; n++) { const th = lessonTheme(n); if (!th) continue;
    (byTh[th.id] = byTh[th.id] || { th, ls: [] }).ls.push({ n, ob: obsOf(n, sid), at: attOf(n, sid) }); }
  const list = Object.values(byTh); if (!list.length) return '';
  return list.map(({ th, ls }) => `<div class="obs-bilan"><h3>${ACT[th.a].ico} ${esc(th.n)}</h3>
    <div class="pj-table-wrap"><table class="pj-table"><tr><th>Critère</th>${ls.map(x => `<th>L${x.n}</th>`).join('')}</tr>
    ${th.cr.map((c, i) => `<tr><td><b>${esc(c)}</b></td>${ls.map(x => `<td class="c">${x.at ? `<span class="tag ${x.at==='abs'?'abs':'inapte'}">${x.at==='abs'?'Abs.':'Inapte'}</span>` : obsChip(x.ob?.[i])}</td>`).join('')}</tr>`).join('')}</table></div></div>`).join('');
}
/* Bloc de la fiche de saisie : à observer pendant les courses, puis Toujours / Souvent / Parfois / Jamais */
function obsBlock(n, sid){
  const th = lessonTheme(n); if (!th || !th.cr.length) return '';
  const a = th.a, nb = nbAtt(n, a), done = vals(perf(n, sid, a)).length >= nb, ob = res(n, sid)?.ob || [];
  if (!done) return `<section class="obs-sec"><h2>👀 ${esc(th.n)} · à observer pendant les ${ACT[a].word}s</h2>
    <div class="obs-todo">${th.cr.map(c => `<span>${esc(c)}</span>`).join('')}</div>
    <div class="muted" style="font-weight:700">Les critères se remplissent après ${a==='s'?'la dernière course':'le dernier tir'}.</div></section>`;
  return `<section class="obs-sec on"><h2>👀 ${esc(th.n)} · ce que l'observateur a vu</h2>
    ${th.cr.map((c, i) => `<div class="obs-row"><div class="obs-c">${esc(c)}</div><div class="obs-btns">${[4,3,2,1].map(v =>
      `<button class="obtn ${ob[i]===v?'on':''}" style="--cc:${OBS[v].c};--cf:${OBS[v].f}" data-action="obs" data-i="${i}" data-v="${v}">${OBS[v].n}</button>`).join('')}</div></div>`).join('')}</section>`;
}
/* Forme + douleurs pendant l'appel (prof) */
function appelWellModal(sid){
  const n = curLesson(), L = lesson(n); L.wb = L.wb || {};
  const cur = L.wb[sid] || {};
  let fb = cur.fb ?? null, sel = [...(cur.dl || [])];
  const m = modal(`<h2>💪 ${esc(nameOf(sid))} · début de leçon</h2><div id="wm-sc"></div>
    <h3 style="margin-top:10px">🩹 Douleurs</h3><div class="pain-wrap"><div id="body-box"></div>
      <div class="pain-side"><div class="btn-row" id="extra-z"></div><p id="pain-list" style="font-weight:800"></p></div></div>
    <div class="btn-row spread" style="margin-top:10px"><button class="btn" data-p="cancel">Annuler</button><button class="btn primary" data-p="ok">Valider</button></div>`, { wide:true });
  const draw = () => {
    m.querySelector('#wm-sc').innerHTML = scale10('État de forme', '💪', fb, 'data-wv="1"');
    m.querySelectorAll('[data-wv]').forEach(b => b.onclick = e => { e.stopPropagation(); fb = fb === +b.dataset.v ? null : +b.dataset.v; draw(); });
    m.querySelector('#body-box').innerHTML = bodySVG(sel);
    m.querySelector('#extra-z').innerHTML = ZONES.filter(q => !q.x).map(q => `<button class="btn ${sel.includes(q.k)?'red':''}" data-z="${q.k}">${q.n}</button>`).join('');
    m.querySelector('#pain-list').textContent = sel.length ? sel.map(zoneName).join(' · ') : 'Aucune douleur';
    m.querySelectorAll('[data-zone],[data-z]').forEach(el => el.onclick = () => { const k = el.dataset.zone || el.dataset.z; sel = sel.includes(k) ? sel.filter(x => x !== k) : [...sel, k]; draw(); });
  };
  draw();
  m.querySelector('[data-p="cancel"]').onclick = () => closeModal();
  m.querySelector('[data-p="ok"]').onclick = () => { if (fb == null && !sel.length) delete L.wb[sid]; else L.wb[sid] = { fb, dl: sel }; save(); closeModal(); render(); };
}
/* Banque de thèmes (Paramètres du cycle) */
function profThemes(full){
  const T = themes(), open = full || UI.thOpen;
  const used = id => Object.values(S.lessons).some(L => L.kind === 'theme' && L.th && L.th.id === id);
  return `<div class="card compact"><div class="row"><h2 class="grow" style="margin:0">📚 Thèmes de leçon <span class="muted">· ${T.length}</span></h2>
      ${full ? '' : `<button class="btn small" data-action="thToggle">${UI.thOpen ? 'Masquer' : 'Afficher / modifier'}</button>`}</div>
    ${open ? `<div class="th-list">${T.map(t => `<div class="th-item">
        <div class="row"><input type="text" class="grow th-name" data-field="thName" data-id="${t.id}" value="${esc(t.n)}" placeholder="Nom du thème">
          <select data-field="thAct" data-id="${t.id}"><option value="s" ${t.a==='s'?'selected':''}>🏃 Course</option><option value="b" ${t.a==='b'?'selected':''}>🏀 Lancer</option></select>
          <button class="btn small red" data-action="thDel" data-id="${t.id}">🗑</button></div>
        <div class="th-cr">${Array.from({length:MAX_CR}, (_, i) => `<input type="text" data-field="thCr" data-id="${t.id}" data-i="${i}" value="${esc(t.cr[i]||'')}" placeholder="Critère ${i+1}${i>=2?' (facultatif)':''}">`).join('')}</div>
        ${used(t.id) ? '<div class="muted" style="font-size:13px;font-weight:700">Utilisé dans ce cycle</div>' : ''}</div>`).join('')}</div>
      <button class="btn green" data-action="thAdd" style="margin-top:10px">＋ Nouveau thème</button>` : `<div class="muted" style="font-weight:700;margin-top:6px">${T.map(t => `${ACT[t.a].ico} ${esc(t.n)}`).join(' · ')}</div>`}</div>`;
}
/* =====================================================================
   Forme, douleurs · projet de l'élève 
   ===================================================================== */
const ZONES = [
  {k:'tete', n:'Tête', x:100, y:12}, {k:'cou', n:'Cou', x:100, y:58},
  {k:'epD', n:'Épaule droite', x:64, y:78}, {k:'epG', n:'Épaule gauche', x:136, y:78},
  {k:'brD', n:'Bras / coude droit', x:43, y:136}, {k:'brG', n:'Bras / coude gauche', x:157, y:136},
  {k:'maD', n:'Poignet / main droite', x:36, y:194}, {k:'maG', n:'Poignet / main gauche', x:164, y:194},
  {k:'ven', n:'Ventre', x:100, y:168}, {k:'han', n:'Hanches / aine', x:100, y:206},
  {k:'cuD', n:'Cuisse droite', x:84, y:258}, {k:'cuG', n:'Cuisse gauche', x:116, y:258},
  {k:'geD', n:'Genou droit', x:85, y:296}, {k:'geG', n:'Genou gauche', x:115, y:296},
  {k:'moD', n:'Mollet / tibia droit', x:85, y:330}, {k:'moG', n:'Mollet / tibia gauche', x:115, y:330},
  {k:'piD', n:'Cheville / pied droit', x:80, y:370}, {k:'piG', n:'Cheville / pied gauche', x:120, y:370},
  {k:'dos', n:'Dos'}, {k:'lom', n:'Bas du dos'}
];
const zoneMask = list => (list||[]).reduce((m, k) => { const i = ZONES.findIndex(z => z.k === k); return i < 0 ? m : (m | (1 << i)) >>> 0; }, 0);
const maskZones = m => ZONES.filter((z, i) => (m >>> i) & 1).map(z => z.k);
const zoneName = k => ZONES.find(z => z.k === k)?.n || k;
const isAdv = () => true;                 // plus de mode « 4321 » : tout est accessible avec le code enseignant
function scaleColor(v){ return ['#D0161B','#E3401B','#F07000','#F59E0B','#FFD000','#C8D93A','#86DC96','#3FB65C','#1E8E3E','#0B4F1C'][Math.max(1,Math.min(10,v))-1]; }
/* Échelles 1 → 10 (du moins bien au mieux). État : inspiré de l'échelle de Borg (ressenti de fatigue / forme). */
const SCALES = {
  forme: [['😵','Épuisé'],['😫','Très fatigué'],['😩','Fatigué'],['😕','Un peu fatigué'],['😐','Moyen'],['🙂','Correct'],['😊','Bien'],['😄','Très bien'],['💪','En pleine forme'],['🤩','Au top']],
  motiv: [['😴','Aucune envie'],['🥱','Très peu'],['😒','Peu'],['😕','Bof'],['😐','Moyenne'],['🙂','Assez'],['😊','Motivé'],['😃','Très motivé'],['🔥','À fond'],['🚀','Ultra motivé']],
};
function scale10(label, ico, val, attrs, kind='forme'){
  const sc = SCALES[kind];
  return `<div class="sc10"><div class="sc10-l">${ico} ${label}${val?` <span class="sc10-sel">${sc[val-1][0]} ${sc[val-1][1]}</span>`:''}</div><div class="sc10-r">${Array.from({length:10},(_,i)=>i+1).map(v =>
    `<button class="${val===v?'on':''}" style="${val===v?`background:${scaleColor(v)};border-color:${scaleColor(v)};color:${v>=5&&v<=7?'#0A1633':'#fff'}`:''}" ${attrs} data-v="${v}" title="${sc[v-1][1]}"><span class="sc10-i">${sc[v-1][0]}</span><span class="sc10-n">${v}</span></button>`).join('')}</div></div>`;
}
function wellBlock(n, sid, when){
  const r = res(n, sid) || {};
  if (when === 'avant') {
    const dl = r.dl || [];
    return `<section class="well-sec"><h2>🌅 Avant la leçon</h2>
      ${scale10('Mon état de forme', '💪', r.fb, `data-action="well" data-f="fb"`)}
      <div class="row" style="margin-top:8px"><button class="btn ${dl.length?'red':''}" data-action="painOpen">🩹 Douleurs : ${dl.length ? esc(dl.map(zoneName).join(', ')) : 'aucune'}</button></div></section>`;
  }
  return `<section class="well-sec"><h2>🌇 Fin de leçon</h2>
    ${scale10('Ma forme en fin de leçon', '😮‍💨', r.fa, `data-action="well" data-f="fa"`)}</section>`;
}
function bodySVG(sel){
  const on = k => sel.includes(k);
  let z = '';
  ZONES.filter(q => q.x).forEach(q => { z += `<g data-zone="${q.k}" class="bz ${on(q.k)?'on':''}"><circle cx="${q.x}" cy="${q.y}" r="${q.k==='tete'?14:13}"/>${on(q.k)?`<text x="${q.x}" y="${q.y+5}" text-anchor="middle" class="ouch">!</text>`:''}</g>`; });
  const skin = '#FFD3A8', line = '#5A3A22';
  return `<svg viewBox="0 0 200 400" class="body-svg">
    <g stroke="${line}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">
      <!-- jambes -->
      <path d="M78 205 L74 300 L76 362 L94 362 L96 300 L99 210 Z" fill="${skin}"/>
      <path d="M122 205 L126 300 L124 362 L106 362 L104 300 L101 210 Z" fill="${skin}"/>
      <!-- baskets -->
      <path d="M70 360 Q70 352 80 352 L96 352 L98 372 Q99 384 86 384 L64 384 Q56 384 58 376 Q60 368 70 368 Z" fill="#F07000"/>
      <path d="M130 360 Q130 352 120 352 L104 352 L102 372 Q101 384 114 384 L136 384 Q144 384 142 376 Q140 368 130 368 Z" fill="#F07000"/>
      <!-- short -->
      <path d="M66 185 L134 185 L138 240 L104 240 L100 212 L96 240 L62 240 Z" fill="#0B2A6B"/>
      <!-- bras -->
      <path d="M64 76 Q46 100 42 140 Q38 168 36 190" fill="none" stroke-width="16" stroke="${line}"/>
      <path d="M64 76 Q46 100 42 140 Q38 168 36 190" fill="none" stroke-width="11" stroke="${skin}"/>
      <path d="M136 76 Q154 100 158 140 Q162 168 164 190" fill="none" stroke-width="16" stroke="${line}"/>
      <path d="M136 76 Q154 100 158 140 Q162 168 164 190" fill="none" stroke-width="11" stroke="${skin}"/>
      <circle cx="36" cy="192" r="9" fill="${skin}"/><circle cx="164" cy="192" r="9" fill="${skin}"/>
      <!-- maillot -->
      <path d="M64 72 Q100 60 136 72 L142 104 L130 108 L134 190 L66 190 L70 108 L58 104 Z" fill="#0A5BD3"/>
      <path d="M86 66 Q100 80 114 66" fill="none"/>
      <text x="100" y="146" text-anchor="middle" font-size="26" font-weight="900" fill="#FFD000" stroke="none">5</text>
      <!-- cou + tête -->
      <rect x="92" y="50" width="16" height="16" fill="${skin}"/>
      <circle cx="100" cy="30" r="26" fill="${skin}"/>
      <path d="M76 22 Q80 2 100 4 Q122 2 126 22 Q114 12 100 16 Q88 10 76 22 Z" fill="#7A4A22"/>
      <circle cx="73" cy="32" r="5" fill="${skin}"/><circle cx="127" cy="32" r="5" fill="${skin}"/>
    </g>
    <circle cx="90" cy="28" r="3.6" fill="#1A1A1A"/><circle cx="110" cy="28" r="3.6" fill="#1A1A1A"/>
    <circle cx="91.3" cy="26.7" r="1.2" fill="#fff"/><circle cx="111.3" cy="26.7" r="1.2" fill="#fff"/>
    <circle cx="84" cy="38" r="4" fill="#FF8C9A" opacity=".55"/><circle cx="116" cy="38" r="4" fill="#FF8C9A" opacity=".55"/>
    <path d="M88 38 Q100 50 112 38 Q100 44 88 38 Z" fill="#B3263A" stroke="#5A3A22" stroke-width="2"/>
    <text x="16" y="70" class="lr">D</text><text x="176" y="70" class="lr">G</text>${z}</svg>`;
}
function painModal(){
  const n = curLesson(), sid = UI.sid;
  let sel = [...(res(n, sid)?.dl || [])];
  const m = modal(`<h2>🩹 Où as-tu mal ?</h2><div class="pain-wrap"><div id="body-box"></div>
      <div class="pain-side"><div class="btn-row" id="extra-z"></div><p id="pain-list" style="font-weight:800"></p></div></div>
    <div class="btn-row spread" style="margin-top:10px"><button class="btn" data-p="none">Aucune douleur</button><button class="btn primary" data-p="ok">Valider</button></div>`, { wide:true });
  const draw = () => {
    m.querySelector('#body-box').innerHTML = bodySVG(sel);
    m.querySelector('#extra-z').innerHTML = ZONES.filter(q => !q.x).map(q => `<button class="btn ${sel.includes(q.k)?'red':''}" data-z="${q.k}">${q.n}</button>`).join('');
    m.querySelector('#pain-list').textContent = sel.length ? sel.map(zoneName).join(' · ') : 'Aucune douleur';
    m.querySelectorAll('[data-zone],[data-z]').forEach(el => el.onclick = () => { const k = el.dataset.zone || el.dataset.z; sel = sel.includes(k) ? sel.filter(x => x !== k) : [...sel, k]; draw(); });
  };
  draw();
  const done = list => { setRes(n, sid, r => { r.dl = list; }); closeModal(); render(); flagSaved(); };
  m.querySelector('[data-p="none"]').onclick = () => done([]);
  m.querySelector('[data-p="ok"]').onclick = () => done(sel);
}


/* ---------- Classe « Test » : données inventées pour essayer l'appli (cycle de 7 leçons, leçon du jour : 6) ---------- */
function makeTestClass(){
  const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const PRENOMS = ['Léa','Hugo','Chloé','Lucas','Inès','Tom','Jade','Nathan','Emma','Louis','Manon','Adam','Zoé','Gabriel','Lina','Raphaël','Camille','Arthur','Rose','Sacha','Mila','Noah','Lou','Maël','Anna','Timéo','Alice','Ethan','Léna','Yanis'];
  const NOMS = ['MARTIN','BERNARD','DUBOIS','THOMAS','ROBERT','RICHARD','PETIT','DURAND','LEROY','MOREAU','SIMON','LAURENT','LEFEBVRE','MICHEL','GARCIA','DAVID','BERTRAND','ROUX','VINCENT','FOURNIER','MOREL','GIRARD','ANDRE','MERCIER','DUPONT','LAMBERT','BONNET','FRANCOIS','MARTINEZ','LEGRAND'];
  const old = Object.values(ROOT.classes).find(c => c.settings.className === 'Classe Test');
  const c = newClassState('Classe Test', old ? old.id : undefined);
  ROOT.classes[c.id] = c; useClass(c.id);
  const st = S.settings;
  Object.assign(st, { nbLessons:7, baseCourses:6, baseTirs:6, timeS:6, plotsS:8, plotsB:8, firstS:15, firstB:4, stepB:2, nbGroups:4, current:6 });
  const prenoms = [...PRENOMS].sort(() => Math.random() - .5).slice(0, 24);
  prenoms.forEach((p, i) => S.students.push({ id:newStudentId(), nom: NOMS[i], prenom:p, grp: 0 }));
  [...S.students].sort(() => Math.random() - .5).forEach((s, i) => s.grp = (i % 4) + 1);
  /* L1 diag · L2 Posture de départ · L3 Premiers appuis · L4 diag intermédiaire · L5 Maintien de la vitesse · L6 thème à choisir · L7 évaluation du projet */
  const plan = { 1:['diag'], 2:['theme','pdep'], 3:['theme','papp'], 4:['inter'], 5:['theme','mvit'], 6:['theme', null], 7:['finale'] };
  for (let n = 1; n <= 7; n++) { const L = lesson(n), [k, th] = plan[n]; L.kind = k; L.title = '';
    if (k === 'theme') L.th = th ? snapTheme(themeById(th) || DEFAULT_THEMES.find(t => t.id === th)) : null;
    L.source = n === 1 || n === 4 ? 'none' : n === 7 ? 'projet' : n < 4 ? 'diag' : 'inter'; }
  const zones = ZONES.map(z => z.k);
  S.students.forEach(s => {
    const lvS = 2 + Math.random() * 3.5, lvB = 2 + Math.random() * 3.5, prog = .15 + Math.random() * .35, moral = R(4, 8), motr = 1.3 + Math.random() * 2.2;
    for (let n = 1; n <= 5; n++) {
      const L = lesson(n), x = Math.random();
      if (x < .05) { L.att[s.id] = 'abs'; continue; }
      if (x < .08) { L.att[s.id] = 'inap'; continue; }
      const lv = (base) => Math.max(0, Math.min(8, Math.round(base + prog * (n - 1) + (Math.random() * 2.4 - 1.2))));
      const fb = Math.max(1, Math.min(10, moral + R(-2, 2)));
      L.wb = L.wb || {}; L.wb[s.id] = { fb, dl: Math.random() < .12 ? [pick(zones)] : [] };
      S.results[n] = S.results[n] || {};
      const r = { c: Array.from({length:6}, () => lv(lvS)), b: Array.from({length:6}, () => lv(lvB)),
        fa: Math.max(1, Math.min(10, fb + R(-3, 1))), ts: now() - (7 - n) * 7 * 864e5, d: 'test' };
      const th = L.kind === 'theme' && L.th;
      if (th) { r.ob = th.cr.map(() => Math.max(1, Math.min(4, Math.round(motr + n * .12 + Math.random() * 1.6 - .8)))); r.oth = th.id; }
      S.results[n][s.id] = r;
    }
  });
  save();
}

const finaleLesson = () => { for (let k = 1; k <= S.settings.nbLessons; k++) if (isFinale(k)) return k; return S.settings.nbLessons; };
function suggest(sid, a){
  if (!isProfRole() && sumOf(sid)?.[a]) return sumOf(sid)[a];        // tablette élève : bilan complet reçu avec la séance
  const F = finaleLesson(), byL = [];
  for (let n = 1; n <= S.settings.nbLessons; n++) { if (n === F) continue; const v = vals(perf(n, sid, a)); if (v.length) byL.push({ n, v }); }
  if (!byL.length) return null;
  const all = byL.flatMap(x => x.v), best = Math.max(...all);
  const last2 = byL.slice(-2).flatMap(x => x.v), moy = avg(last2);
  let ok = 0, tot = 0;
  byL.forEach(x => { const t = targetInfo(x.n, sid, a).value; if (t != null) x.v.forEach(v => { tot++; if (v >= t) ok++; }); });
  const first = avg(byL[0].v), last = avg(byL[byL.length-1].v);
  const prudente = clampT(a, Math.floor(moy)), ambitieuse = clampT(a, Math.max(best, Math.ceil(moy) + 1)), conseillee = clampT(a, Math.round((prudente + ambitieuse) / 2));
  return { best, moy, rate: tot ? ok / tot : null, trend: last - first, prudente, conseillee, ambitieuse, nbL: byL.length };
}
function viewProjetTiles(){
  if (!S.students.length) return `<div class="card strong center">Aucun élève</div>`;
  return `${filterBar()}<div class="tiles">${sortedStudents().filter(passFilter).map(s => { const P = S.projects[s.id];
    return `<button class="tile ${P && P.cibleS != null && P.cibleB != null ? 'done' : ''}" data-action="projetDetail" data-sid="${s.id}">${band(s.id)}
      ${P && P.cibleS != null ? '<span class="check">✓</span>' : ''}<span class="name">${esc(nameOf(s.id))}</span>
      <span class="meta">${P && P.cibleS != null ? `🏃 ${pts(P.cibleS)} · 🏀 ${pts(P.cibleB)}` : 'Projet à faire'}</span></button>`; }).join('')}</div>`;
}
function viewProjetDetail(){
  const sid = UI.sid, s = student(sid); if (!s) return '';
  const N = S.settings.nbLessons, F = finaleLesson(), P = S.projects[sid] || {};
  const D = UI.draft && UI.draft.sid === sid ? UI.draft : (UI.draft = { sid, formeJ: P.formeJ ?? null, cibleS: P.cibleS ?? null, cibleB: P.cibleB ?? null });
  let rows = '';
  const painCount = {}; const fbs = [], fas = [];
  for (let n = 1; n <= N; n++) {
    if (n === F) continue;
    const r = res(n, sid) || {}, at = attOf(n, sid);
    const fb = fbOf(n, sid), dl = dlOf(n, sid);
    const has = vals(r.c).length || vals(r.b).length || fb || r.fa;
    if (!has && !at) continue;
    dl.forEach(k => painCount[k] = (painCount[k] || 0) + 1);
    if (fb) fbs.push(fb); if (r.fa) fas.push(r.fa);
    const cell = a => { const t = targetInfo(n, sid, a).value, v = perf(n, sid, a);
      return `<div class="pj-sc">${t!=null?`<span class="pj-t">🎯${t}</span>`:''}${v.map(x => `<span class="sc ${scoreCls(x, t)}">${x ?? '—'}</span>`).join('')}</div>`; };
    const wv = v => v ? `<span class="wv" style="background:${scaleColor(v)};color:${v>=5&&v<=7?'#0A1633':'#fff'}">${v}</span>` : '<span class="muted">—</span>';
    rows += `<tr><td><b>L${n}</b><div class="ls-title">${esc(lessonTitle(n))}</div>${at==='abs'?'<span class="tag abs">Absent</span>':at==='inap'?'<span class="tag inapte">Inapte</span>':''}</td>
      <td>${cell('s')}</td><td>${cell('b')}</td><td class="c">${wv(fb)}</td><td>${dl.map(zoneName).join(', ') || '—'}</td><td class="c">${wv(r.fa)}</td></tr>`;
  }
  const sum = a => { const g = suggest(sid, a); if (!g) return `<div class="muted">Pas encore de données</div>`;
    return `<div class="pj-sum">Meilleure perf : <b>${pts(g.best)}</b> · Moyenne récente : <b>${fmt(g.moy)}</b> · Cible réussie : <b>${g.rate!=null?Math.round(g.rate*100)+' %':'—'}</b> des tentatives ·
      ${g.trend >= 0.5 ? '📈 en progrès' : g.trend <= -0.5 ? '📉 en baisse' : '➡️ stable'}</div>`; };
  const SM = !isProfRole() ? sumOf(sid) : null;   // tablette élève : bilan complet reçu avec la séance
  if (SM) { fbs.length = 0; fas.length = 0; Object.keys(painCount).forEach(k => delete painCount[k]); rows = '';
    if (SM.fb) fbs.push(SM.fb); if (SM.fa) fas.push(SM.fa); (SM.dl || []).forEach(k => painCount[k] = 1); }
  const pains = Object.entries(painCount).sort((a,b)=>b[1]-a[1]);
  const choose = a => { const g = suggest(sid, a), cur = D[a==='s'?'cibleS':'cibleB'];
    let reco = 'conseillee';
    if (D.formeJ != null && D.formeJ <= 4) reco = 'prudente'; else if (D.formeJ != null && D.formeJ >= 8) reco = 'ambitieuse';
    const opt = (k, lbl) => g ? `<button class="pj-opt ${cur===g[k]?'on':''} ${reco===k?'reco':''}" data-action="pjSet" data-a="${a}" data-v="${g[k]}"><small>${lbl}${reco===k?' · conseil':''}</small><b>${pts(g[k])}</b><small>${esc(ACT[a].unit(g[k]))}</small></button>` : '';
    return `<div class="pj-choice"><h3>${ACT[a].ico} Ma cible ${a==='s'?'en sprint':'au tir'}</h3>
      <div class="pj-opts">${opt('prudente','Prudente')}${opt('conseillee','Conseillée')}${opt('ambitieuse','Ambitieuse')}</div>
      <div class="row" style="margin-top:6px"><div class="stepper"><button data-action="pjStep" data-a="${a}" data-d="-1">−</button><span class="val" style="min-width:170px">${cur!=null?plotShort(a, cur):'—'}</span><button data-action="pjStep" data-a="${a}" data-d="1">+</button></div></div></div>`; };
  return `<div class="entry-name">${band(sid)}<div class="who">${esc(nameOf(sid))}</div><span class="muted" style="font-weight:800">Projet · évaluation finale (L${F})</span>
      <button class="btn" data-action="go" data-view="projet" style="margin-left:auto">← Retour aux élèves</button></div>
    ${!rows && !isProfRole() ? '' : `<div class="card strong compact"><h2>📋 Mon bilan, leçon par leçon</h2>
      <div class="pj-table-wrap"><table class="pj-table"><tr><th>Leçon</th><th>🏃 Sprint</th><th>🏀 Tir</th><th>💪 Forme avant</th><th>🩹 Douleurs</th><th>😮‍💨 Forme après</th></tr>${rows || '<tr><td colspan="6" class="muted">Pas encore de données</td></tr>'}</table></div></div>`}
    ${obsBilan(sid) ? `<div class="card strong compact"><h2>👀 Mes critères observés</h2>${obsBilan(sid)}</div>` : ''}
    <div class="card strong compact"><h2>🔎 En résumé</h2>
      <div><b>🏃 Sprint</b> ${sum('s')}</div><div style="margin-top:6px"><b>🏀 Tir</b> ${sum('b')}</div>
      <div style="margin-top:6px">💪 Forme avant : <b>${fbs.length?fmt(avg(fbs)):'—'}</b>/10 · 😮‍💨 après : <b>${fas.length?fmt(avg(fas)):'—'}</b>/10
        ${pains.length?` · 🩹 Douleurs signalées : ${pains.map(([k,c])=>`${esc(zoneName(k))}${SM ? '' : ` (${c})`}`).join(', ')}`:''}</div></div>
    <div class="card strong compact"><h2>🏁 Aujourd'hui : évaluation finale</h2>
      ${scale10('Mon état de forme aujourd\'hui', '💪', D.formeJ, `data-action="pjWell" data-f="formeJ"`)}</div>
    <div class="card strong compact"><div class="pj-choices">${choose('s')}${choose('b')}</div>
      <label class="field" style="margin-top:10px">Mon projet<textarea id="pj-text" style="min-height:70px">${esc(P.texte||'')}</textarea></label>
      <div class="btn-row" style="margin-top:10px"><button class="btn green" data-action="pjSave">💾 Valider mon projet</button>
      ${P.ts?`<span class="muted">Enregistré le ${new Date(P.ts).toLocaleDateString('fr-FR')}</span>`:''}</div></div>`;
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
    const title = lessonTitle(n) ? `<div class="ls-title">${esc(lessonTitle(n))}</div>` : '';
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
  const N = S.settings.nbLessons, col = groupColor(grpOf(s.id)), cur = curLesson();
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
    ${obsBilan(sid) ? `<div class="card strong"><h2>👀 Mes critères observés</h2>${obsBilan(sid)}</div>` : ''}
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
/* ---------------------------------------------------------------------
   Compétence D4 : cohérence entre l'effort ressenti (forme notée à l'appel − forme en fin de leçon)
   et le résultat (écart à la cible)
   --------------------------------------------------------------------- */
const COMP_LV = [null,
  { n:'Insuffisante', c:'#D0161B', f:'#fff' },
  { n:'Fragile', c:'#F07000', f:'#fff' },
  { n:'Satisfaisante', c:'#86DC96', f:'#0A1633' },
  { n:'Très bonne', c:'#0B4F1C', f:'#fff' }];
const COMP_D = {
  D4: { ico:'❤️', t:'Apprendre à entretenir sa santé par une activité physique régulière, raisonnée et raisonnable',
        s:'Connaître et utiliser des indicateurs objectifs pour caractériser l\'effort physique.' } };
/* lignes : fatigue ressentie (aucune / modérée / forte) ; colonnes : résultat (sous la cible / proche / au-dessus) */
const D4_MAT = [[1,2,3],[2,4,3],[3,4,4]];
const E_TXT = ['aucune fatigue', 'fatigue modérée', 'forte fatigue'], R_TXT = ['sous la cible', 'proche de la cible', 'au-dessus de la cible'];
function compOf(sid){ S.comp = S.comp || {}; return S.comp[sid] || {}; }
function persoRef(n, sid, a){                       // sans cible : moyenne de l'élève sur les autres leçons
  const all = []; for (let k = 1; k <= S.settings.nbLessons; k++) if (k !== n) all.push(...vals(perf(k, sid, a)));
  return all.length ? avg(all) : null;
}
function d4Lesson(n, sid){
  if (attOf(n, sid)) return null;
  const r = res(n, sid) || {}, fb = fbOf(n, sid);
  const ds = [];
  ['s','b'].forEach(a => { const v = vals(perf(n, sid, a)); if (!v.length) return;
    const t = targetInfo(n, sid, a).value, ref = t != null ? t : persoRef(n, sid, a);
    if (ref != null) ds.push(avg(v) - ref); });
  const R = ds.length ? Math.round(avg(ds) * 10) / 10 : null;   // arrondi au dixième (comme affiché)
  const E = fb && r.fa ? fb - r.fa : null;
  if (R == null && E == null && !fb && !r.fa) return null;
  if (R == null || E == null) return { lv:null, E, R, why: E == null ? 'forme incomplète' : 'pas de résultat' };
  const eb = E <= 0 ? 0 : E <= 2 ? 1 : 2, rb = R < -1 ? 0 : R < 1 ? 1 : 2;
  return { lv: D4_MAT[eb][rb], E, R, why: `${E_TXT[eb]} (forme ${fb} → ${r.fa}) · ${R_TXT[rb]} (${R >= 0 ? '+' : ''}${fmt(R)} pt)` };
}
function d4Suggest(sid){
  const w = [0,0,0,0,0], list = [];
  for (let n = 1; n <= S.settings.nbLessons; n++) { const d = d4Lesson(n, sid); if (d && d.lv) list.push(d.lv); }
  if (!list.length) return null;
  list.forEach((lv, i) => w[lv] += 1 + i / list.length);       // les dernières leçons comptent un peu plus
  let best = 1; for (let k = 2; k <= 4; k++) if (w[k] >= w[best]) best = k;
  return best;
}
const compDot = (lv, sug, big) => lv ? `<span class="cdot ${big?'big':''}" style="background:${COMP_LV[lv].c};color:${COMP_LV[lv].f}" title="${COMP_LV[lv].n}"></span>`
  : sug ? `<span class="cdot sug ${big?'big':''}" style="border-color:${COMP_LV[sug].c};background:${COMP_LV[sug].c}55" title="Proposé : ${COMP_LV[sug].n}"></span>`
  : `<span class="cdot none ${big?'big':''}" title="Non évalué"></span>`;
function profComp(){
  if (!S.students.length) return `<div class="card strong center">Aucun élève</div>`;
  return `<div class="card strong compact"><h2>❤️ Compétence D4</h2>${classPicker()}
      <div class="comp-legend"><b>D4</b> « ${esc(COMP_D.D4.t)} »<br><i>« ${esc(COMP_D.D4.s)} »</i></div>
      <div class="comp-legend">${[1,2,3,4].map(k => `${compDot(k)} ${COMP_LV[k].n}`).join(' · ')} · ${compDot(null, 3)} proposé par l'appli · ${compDot(null)} non évalué</div></div>
    ${filterBar()}<div class="tiles">${sortedStudents().filter(passFilter).map(s => { const C = compOf(s.id), sug = d4Suggest(s.id);
      return `<button class="tile ${C.D4 ? 'done' : ''}" data-action="compDetail" data-sid="${s.id}">${band(s.id)}${C.D4 ? '<span class="check">✓</span>' : ''}
        <span class="name">${esc(nameOf(s.id))}</span>
        <span class="comp-row"><span>D4 ${compDot(C.D4, sug)}</span><span class="muted" style="font-size:14px">${C.D4 ? COMP_LV[C.D4].n : sug ? 'proposé : ' + COMP_LV[sug].n : ''}</span></span></button>`; }).join('')}</div>`;
}
function profCompDetail(){
  const sid = UI.sid, s = student(sid); if (!s) return profComp();
  const N = S.settings.nbLessons, C = compOf(sid), sug = d4Suggest(sid);
  const wv = v => v ? `<span class="wv" style="background:${scaleColor(v)};color:${v>=5&&v<=7?'#0A1633':'#fff'}">${v}</span>` : '<span class="muted">—</span>';
  const gap = a => n => { const v = vals(perf(n, sid, a)); if (!v.length) return '<span class="muted">—</span>';
    const t = targetInfo(n, sid, a).value; if (t == null) return `${fmt(avg(v))} <small class="muted">(sans cible)</small>`;
    const d = avg(v) - t; return `<span class="sc ${scoreCls(Math.round(avg(v)), t)}">${d >= 0 ? '+' : ''}${fmt(d)}</span>`; };
  let rows = '';
  for (let n = 1; n <= N; n++) {
    const at = attOf(n, sid), r = res(n, sid) || {}, fb = fbOf(n, sid), dl = dlOf(n, sid);
    const has = vals(r.c).length || vals(r.b).length || fb || r.fa;
    if (!has && !at) continue;
    const d = d4Lesson(n, sid);
    rows += `<tr><td><b>L${n}</b><div class="ls-title">${esc(lessonTitle(n))}</div>${at==='abs'?'<span class="tag abs">Absent</span>':at==='inap'?'<span class="tag inapte">Inapte</span>':''}</td>
      <td class="c">${at ? '' : gap('s')(n)}</td><td class="c">${at ? '' : gap('b')(n)}</td>
      <td class="c">${wv(fb)}</td><td>${dl.length ? esc(dl.map(zoneName).join(', ')) : '—'}</td><td class="c">${wv(r.fa)}</td>
      <td>${d ? `${compDot(d.lv, null, true)} <span class="d4-why">${d.lv ? `<b>${COMP_LV[d.lv].n}</b> · ` : ''}${esc(d.why)}</span>` : ''}</td></tr>`;
  }
  return `<div class="entry-name">${band(sid)}<div class="who">${esc(nameOf(sid))}</div>
      <button class="btn" data-action="profTab" data-tab="comp" style="margin-left:auto">← Retour aux élèves</button></div>
    <div class="card strong compact"><h2>📋 Leçon par leçon</h2>
      <div class="pj-table-wrap"><table class="pj-table"><tr><th>Leçon</th><th>🏃 Écart cible</th><th>🏀 Écart cible</th><th>💪 Forme (appel)</th><th>🩹 Douleurs</th><th>😮‍💨 Fin de leçon</th><th>❤️ D4 · ressenti / résultat</th></tr>
        ${rows || '<tr><td colspan="7" class="muted">Pas encore de données</td></tr>'}</table></div>
      <details class="d4-rule"><summary>Comment l'appli calcule D4</summary>
        <p>Fatigue ressentie = forme notée à l'appel − forme en fin de leçon (0 ou moins : aucune · 1 à 2 : modérée · 3 et plus : forte).<br>
        Résultat = moyenne des écarts à la cible en points, sprint et tir (moins de −1 : sous la cible · de −1 à +1 : proche · +1 et plus : au-dessus). Sans cible, la référence est la moyenne de l'élève sur les autres leçons.</p>
        <table class="simple"><tr><th></th><th>Sous la cible</th><th>Proche</th><th>Au-dessus</th></tr>
          ${D4_MAT.map((row, i) => `<tr><th>${E_TXT[i]}</th>${row.map(v => `<td>${compDot(v)} ${COMP_LV[v].n}</td>`).join('')}</tr>`).join('')}</table></details></div>
    <div class="card strong compact"><h2>❤️ Couleur finale D4 (décision de l'enseignant)</h2>
      <div class="comp-pick"><div class="comp-h"><b>D4</b> « ${esc(COMP_D.D4.t)} »</div><div class="muted comp-s">« ${esc(COMP_D.D4.s)} »</div>
      <div class="comp-aid">Proposition de l'appli : ${sug ? `${compDot(sug)} <b>${COMP_LV[sug].n}</b> (majorité des leçons, les dernières comptent plus)` : '<b>—</b> (pas assez de données)'}</div>
      <div class="comp-btns">${[1,2,3,4].map(v => `<button class="cbtn ${C.D4===v?'on':''} ${sug===v&&!C.D4?'reco':''}" style="--cc:${COMP_LV[v].c};--cf:${COMP_LV[v].f}" data-action="compSet" data-k="D4" data-v="${v}">${COMP_LV[v].n}</button>`).join('')}
        ${C.D4 ? `<button class="btn ghost xs" data-action="compSet" data-k="D4" data-v="0">Effacer</button>` : ''}</div></div></div>`;
}
/* ---------------------------------------------------------------------
   Espace enseignant : menu principal + 4 rubriques
   --------------------------------------------------------------------- */
const PROF_PARENT = { classes:'menu', groupes:'menu', cycle:'menu', lecon:'menu', appel:'menu', lgroupes:'menu', cibles:'menu', export:'menu', comp:'menu', compDetail:'comp' };
function classPicker(){
  const cls = Object.values(ROOT.classes);
  return `<div class="class-chips" style="justify-content:flex-start">${cls.map(c=>`<button class="class-chip ${c.id===S.id?'on':''}" data-action="selClass" data-id="${c.id}">🏫 ${esc(className(c))}</button>`).join('')}</div>`;
}
function subTabs(items){
  return `<div class="tabs">${items.map(([k,l])=>`<button class="tab ${UI.profTab===k?'on':''}" data-action="profTab" data-tab="${k}">${l}</button>`).join('')}</div>`;
}
/* ---------------------------------------------------------------------
   Rôle de la tablette : enseignant (paramétrage, QR de séance, récupération, bilans)
   ou élève (scanner la séance, saisir, envoyer ses saisies)
   --------------------------------------------------------------------- */
const isProfRole = () => ROOT.role === 'prof';
function pinPad(onOk, title='🔒 Code enseignant'){
  let code = '';
  const m = modal(`<h2 class="center">${title}</h2><div class="pin-dots">${'<span></span>'.repeat(4)}</div>
    <div class="pin-pad">${[1,2,3,4,5,6,7,8,9,'⌫',0,'✕'].map(k=>`<button data-k="${k}">${k}</button>`).join('')}</div>
    <p class="center muted" style="font-size:14px">Code par défaut : 0000 (modifiable dans Bilans → Export & sauvegarde)</p>`);
  const dots = m.querySelectorAll('.pin-dots span');
  m.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === '✕') return closeModal();
    if (k === '⌫') code = code.slice(0,-1); else if (code.length < 4) code += k;
    dots.forEach((d,i)=>d.classList.toggle('f', i < code.length));
    if (code.length === 4) {
      if (code === String(ROOT.pin || '0000')) { closeModal(); onOk(); }
      else { toast('Code incorrect'); code=''; dots.forEach(d=>d.classList.remove('f')); }
    }
  });
}
function openProf(){
  if (UI.profUnlocked) { UI.profTab = UI.profTab || 'menu'; return go('prof'); }
  pinPad(() => { delete ROOT.advanced; save(); UI.profUnlocked = true; UI.profTab = 'menu'; go('prof'); });
}
function viewRole(){
  return `<div class="home">
    <img class="home-logo" src="logo-app.png" alt="N'EPS numérique – CA1 Biathlon">
    <div class="home-lesson"><div class="big">Cette tablette est…</div></div>
    <div class="home-grid two">
      <button class="home-btn prof" data-action="setRole" data-r="prof"><span class="ico">👩‍🏫</span>Tablette enseignant<small>Préparer · QR de séance · récupérer · bilans</small></button>
      <button class="home-btn saisie" data-action="setRole" data-r="eleve"><span class="ico">🧒</span>Tablette élève<small>Scanner la séance · saisir · envoyer</small></button>
    </div>
    <p class="muted center" style="font-weight:700">Les données déjà présentes sur la tablette sont conservées.</p></div>`;
}
function viewHomeEleve(){
  const has = S.students.length && ROOT.seance && ROOT.seance.cid === S.id;
  const n = curLesson(), pres = S.students.filter(s => present(n, s.id)).length;
  return `<div class="home">
    <img class="home-logo" src="logo-app.png" alt="N'EPS numérique – CA1 Biathlon">
    ${has ? `<div class="class-chips"><span class="class-chip on">🏫 ${esc(className())}</span></div>
      <div class="home-lesson"><div class="big">Leçon ${n} / ${S.settings.nbLessons}</div>
        <div style="font-size:20px;font-weight:800">${esc(lessonTitle(n) || 'Sans titre')}</div>
        <div class="muted" style="font-weight:700">🏃 ${nbAtt(n,'s')} sprint(s) de ${fmt(S.settings.timeS)} s · 🏀 ${nbAtt(n,'b')} tir(s) · ${pres}/${S.students.length} présent(s)</div>
        <div class="muted" style="font-size:14px">Séance scannée le ${new Date(ROOT.seance.at).toLocaleDateString('fr-FR')} à ${new Date(ROOT.seance.at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div></div>`
      : `<div class="home-lesson"><div class="big">Aucune séance</div><div style="font-weight:800">Scanne le QR de la séance affiché par ton enseignant.</div></div>`}
    <div class="home-grid steps">
      <button class="home-btn scan" data-action="go" data-view="receive"><span class="ico">📷</span>1. Scanner la séance</button>
      <button class="home-btn saisie" data-action="goSaisie" ${has ? '' : 'disabled'}><span class="ico">✍️</span>2. Saisir</button>
      ${has && isFinale(n) ? `<button class="home-btn stats" data-action="go" data-view="projet"><span class="ico">🎯</span>Mon projet</button>` : ''}
      <button class="home-btn send" data-action="go" data-view="send" ${has ? '' : 'disabled'}><span class="ico">📤</span>3. Envoyer mes saisies</button>
    </div>
    <button class="btn small ghost" data-action="switchRole" style="margin-top:8px">⚙️ Enseignant</button></div>`;
}
function viewHomeProfLocked(){
  return `<div class="home">
    <img class="home-logo" src="logo-app.png" alt="N'EPS numérique – CA1 Biathlon">
    <div class="class-chips"><span class="class-chip on">🏫 ${esc(className())}</span></div>
    <div class="home-lesson"><div class="big">Leçon ${curLesson()} / ${S.settings.nbLessons}</div><div style="font-size:20px;font-weight:800">${esc(lessonTitle(curLesson()) || 'Sans titre')}</div></div>
    <div class="home-grid one"><button class="home-btn prof" data-action="openProf"><span class="ico">🔒</span>Espace enseignant</button></div></div>`;
}
/* Espace enseignant : 4 étapes */
const PSECT = {
  prep:   { ico:'🛠', t:'Préparer le cycle', tabs:[['classes','👥 Classe & élèves'],['groupes','🎽 Groupes'],['cycle','⚙️ Paramètres du cycle'],['themes','📚 Thèmes']] },
  jour:   { ico:'📅', t:'Leçon du jour', tabs:[['appel','✅ Appel'],['lgroupes','🎽 Groupes du jour'],['cibles','🎯 Cibles'],['qr','📲 QR de la séance'],['saisieP','✍️ Saisie (dépannage)']] },
  recup:  { ico:'📥', t:'Récupérer les saisies', tabs:[] },
  bilans: { ico:'📊', t:'Bilans', tabs:[['statsP','📊 Statistiques'],['projetP','🎯 Projets'],['comp','❤️ Compétence D4'],['export','📁 Export & sauvegarde']] } };
const PREDIR = { saisieP:'saisie', statsP:'stats', projetP:'projet' };
function sectOf(tab){ if (tab === 'compDetail') return 'bilans'; if (tab === 'recup') return 'recup'; return Object.keys(PSECT).find(k => PSECT[k].tabs.some(t => t[0] === tab)) || null; }
function sectHeader(sec){
  const P = PSECT[sec], N = S.settings.nbLessons, cur = curLesson();
  return `<div class="btn-row" style="margin-bottom:10px"><button class="btn small" data-action="profTab" data-tab="menu">← Menu enseignant</button></div>
    <div class="card strong compact"><h2>${P.ico} ${P.t}</h2>${classPicker()}
      ${sec === 'jour' ? `<h3>Leçon du jour</h3><div class="lesson-picker">${Array.from({length:N},(_,i)=>i+1).map(n=>`<button class="lp ${n===cur?'on':''}" data-action="setCurrent" data-n="${n}">${n}</button>`).join('')}</div>
        <div class="muted" style="font-weight:800;margin-top:4px">${esc(lessonTitle(cur) || 'Sans titre')}</div>` : ''}</div>
    ${P.tabs.length ? subTabs(P.tabs) : ''}`;
}
function viewProf(){
  let t = UI.profTab || 'menu';
  if (t === 'lecon') t = UI.profTab = 'appel';
  if (t === 'menu' || PREDIR[t]) { UI.profTab = 'menu'; return profMenu(); }
  const sec = sectOf(t); if (!sec) { UI.profTab = 'menu'; return profMenu(); }
  let body = '';
  if (t === 'classes') body = profClasses() + profEleves();
  else if (t === 'groupes') body = profGroupes();
  else if (t === 'cycle') body = profCycle();
  else if (t === 'themes') body = profThemes(true);
  else if (t === 'appel') body = profAppel();
  else if (t === 'lgroupes') body = profDayGroups();
  else if (t === 'cibles') body = profCibles();
  else if (t === 'qr') body = profSeanceQR();
  else if (t === 'recup') body = profRecup();
  else if (t === 'comp') body = profComp();
  else if (t === 'compDetail') body = profCompDetail();
  else if (t === 'export') body = profExport() + profTransfert();
  return sectHeader(sec) + body;
}
function profMenu(){
  const n = curLesson(), pres = S.students.filter(s => present(n, s.id)).length;
  const got = S.students.filter(s => { const r = res(n, s.id); return r && (vals(r.c).length || vals(r.b).length); }).length;
  return `<div class="card strong compact center"><b style="font-size:20px">🏫 ${esc(className())}</b> · Leçon ${n}/${S.settings.nbLessons} ${esc(lessonTitle(n) ? '· ' + lessonTitle(n) : '')} · ${pres}/${S.students.length} présent(s) · ${got} saisie(s) reçue(s)</div>
    <div class="pmenu steps">
      <button class="pm-btn" data-action="profTab" data-tab="classes"><span class="step">1</span><span class="ico">🛠</span>Préparer le cycle<small>Classes · élèves · groupes · paramètres · thèmes</small></button>
      <button class="pm-btn" data-action="profTab" data-tab="appel"><span class="step">2</span><span class="ico">📅</span>Leçon du jour<small>Appel · groupes · cibles · 📲 QR de la séance</small></button>
      <button class="pm-btn" data-action="profTab" data-tab="recup"><span class="step">3</span><span class="ico">📥</span>Récupérer les saisies<small>Scanner les QR des tablettes élèves</small></button>
      <button class="pm-btn" data-action="profTab" data-tab="statsP"><span class="step">4</span><span class="ico">📊</span>Bilans<small>Statistiques · projets · D4 · export</small></button>
    </div>
    <div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn small" data-action="testClass">🧪 Classe Test</button></div>`;
}
function profSeanceQR(){
  const n = curLesson(), abs = S.students.filter(s => attOf(n, s.id)).length;
  return `<div class="card strong"><h2>📲 QR de la séance · Leçon ${n}</h2>
      <div class="muted" style="font-weight:700">${esc(lessonTitle(n) || 'Sans titre')} · ${S.students.length} élève(s) · ${abs} absent(s)/inapte(s) · ${nbGroups()} groupe(s)${isFinale(n) ? ' · avec le bilan de chaque élève pour son projet' : ''}</div>
      <div class="advice info">Sur chaque tablette élève : <b>📷 1. Scanner la séance</b>. Faites l'appel et vérifiez les cibles <b>avant</b> d'afficher ce QR.</div>
      <div id="qr-seance" class="center">Préparation…</div></div>`;
}
function profRecup(){
  const n = curLesson();
  const got = S.students.filter(s => { const r = res(n, s.id); return r && (vals(r.c).length || vals(r.b).length); }).length;
  return `<div class="card strong"><h2>📥 Scanner les tablettes élèves</h2>
      <div class="muted" style="font-weight:700">Sur chaque tablette élève : <b>📤 3. Envoyer mes saisies</b>, puis scannez le QR ici. Leçon ${n} : ${got}/${S.students.length} élève(s) avec des saisies.</div>
      <div id="scan-area"></div>
      <div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn primary" data-action="profTab" data-tab="recup">✓ Actualiser le compte</button>
        <label class="btn">📂 Importer un fichier (.json)<input type="file" id="file-sync" accept=".json,application/json" hidden></label></div></div>`;
}
function profTransfert(){
  return `<div class="card"><h2>🔁 Vers une autre tablette enseignant</h2>
      <div class="btn-row"><button class="btn" data-action="showFullQR">🗂 QR Historique</button>
        <button class="btn" data-action="fileFull">📤 Partager en fichier</button></div>
      <div class="muted" style="font-size:14px;font-weight:700">À scanner dans « 📥 Récupérer les saisies » de l'autre tablette enseignant.</div></div>
    <div class="card"><h2>Rôle de cette tablette</h2><button class="btn small" data-action="setRole" data-r="eleve">🧒 Passer en tablette élève</button></div>`;
}
function afterProf(){
  if (UI.profTab === 'groupes' || UI.profTab === 'lgroupes') bindGroups();
  if (UI.profTab === 'qr') (async () => { const area = $('#qr-seance'); const payload = await encodeBin(binSeance(curLesson()));
    if (area && UI.profTab === 'qr' && UI.view === 'prof') showQRSeries(chunkQR(payload, 'S', 260), area, `Séance · ${esc(className())} · leçon ${curLesson()}`); })();
  if (UI.profTab === 'recup') startScan($('#scan-area'), ['R','F'], async p => { await applyPacket(p); return 'continue'; });
}
function profClasses(){
  const cls = Object.values(ROOT.classes);
  return `<div class="card compact"><div class="row">
      <label class="field grow">Nom de la classe<input type="text" data-field="className" value="${esc(S.settings.className)}"></label>
      <label class="field grow">Nouvelle classe<input type="text" id="new-class" placeholder="2nde 4"></label>
      <button class="btn green" data-action="addClass" style="align-self:flex-end">＋ Ajouter</button>
      ${cls.length > 1 ? `<button class="btn red" data-action="delClass" style="align-self:flex-end">🗑 Supprimer « ${esc(className())} »</button>` : ''}</div></div>`;
}
/* Groupes du jour : signale les groupes incomplets (absents / inaptes) et permet de déplacer des élèves pour cette leçon */
function profDayGroups(){
  const n = curLesson(), G = nbGroups(), L = lesson(n);
  if (G < 2) return `<div class="card">La classe fonctionne en 1 seul groupe. <button class="btn small" data-action="profTab" data-tab="groupes">🎽 Créer des groupes</button></div>`;
  const moved = Object.keys(L.grpOv).length;
  const zone = g => {
    const all = sortedStudents().filter(s => grpOf(s.id, n) === g), c = g ? groupColor(g) : null;
    const pres = all.filter(s => present(n, s.id)), off = all.length - pres.length;
    const usual = S.students.filter(s => (s.grp||0) === g).length;
    const warn = g && (off > 0 || pres.length !== usual);
    return `<div class="gzone ${warn?'warn':''}" data-zone="${g}"><h3 data-action="dropSel" data-zone="${g}">${c?`<span class="dot" style="background:${c.c}"></span>`:''}${g ? groupName(g) : 'Sans groupe'}${warn?' <span class="tag mod">⚠ incomplet</span>':''}</h3>
      <div class="zinfo">${pres.length} présent(s)${off?` · ${off} absent(s)/inapte(s)`:''}${g && pres.length !== usual ? ` · habituellement ${usual}` : ''}</div>
      <div class="gitems">${all.map(s => { const a = attOf(n, s.id), mv = L.grpOv[s.id] != null;
        return `<div class="gitem ${UI.sel===s.id?'sel':''} ${a?'off':''} ${mv?'moved':''}" data-gid="${s.id}" style="${c?`border-left:12px solid ${c.c}`:''}">${esc(nameOf(s.id))}${a==='abs'?' <span class="tag abs">Abs.</span>':a==='inap'?' <span class="tag inapte">Inapte</span>':''}${mv?' ↪':''}</div>`; }).join('')}</div></div>`;
  };
  return `<div class="card compact"><div class="row"><b class="grow">Groupes de la leçon ${n}${moved?` · ${moved} élève(s) déplacé(s) ↪`:''}</b>
      ${moved?`<button class="btn small" data-action="resetDayGroups">Groupes habituels</button>`:''}</div></div>
    <div class="groups day">${Array.from({length:G},(_,i)=>zone(i+1)).join('')}${S.students.some(s => grpOf(s.id, n) === 0) ? zone(0) : ''}</div>`;
}
function stepper(action, attrs, val, disp){
  return `<div class="stepper"><button data-action="${action}" ${attrs} data-d="-1">−</button><span class="val">${disp ?? val}</span><button data-action="${action}" ${attrs} data-d="1">+</button></div>`;
}
function rangeField(label, val, attrs, min, max, extra='', step=1){
  return `<div class="rf"><div class="rf-h"><span class="rf-l">${label}</span> <b class="rv">${fmt(val)}</b>${extra}</div>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${val}" ${attrs}></div>`;
}
function plotTable(){
  const s = Array.from({length: maxPlots('s')}, (_,i)=>i+1), b = Array.from({length: maxPlots('b')}, (_,i)=>i+1);
  return `<div class="stats-cols" style="margin-top:10px">
    <table class="simple"><tr><th>🏃 Plot</th><th>Vitesse</th><th>Distance du départ</th></tr>
      ${s.map(k=>`<tr><td><b>${k}</b></td><td>${fmt(spdS(k))} km/h</td><td>${fmt(distS(k))} m</td></tr>`).join('')}</table>
    <table class="simple"><tr><th>🏀 Plot</th><th>Distance de la ligne de lancer</th></tr>
      ${b.map(k=>`<tr><td><b>${k}</b></td><td>${fmt(distB(k))} m</td></tr>`).join('')}</table></div>`;
}
function profCycle(){
  const N = S.settings.nbLessons, cur = curLesson(), st = S.settings;
  let rows = '';
  for (let n = 1; n <= N; n++) {
    const L = lesson(n);
    const attF = a => rangeField(`${ACT[a].ico} ${a==='s'?'Sprints':'Tirs'}`, nbAtt(n, a), `data-field="att" data-n="${n}" data-a="${a}"`, 0, 10,
        isOverride(n, a) ? ` <button class="btn small ghost xs" data-action="attReset" data-n="${n}" data-a="${a}">Réinitialiser</button>` : '');
    rows += `<div class="lrow"><div class="lesson-num ${n===cur?'cur':''}">${n}</div><div class="lrow-main">
      <div class="lrow-top"><div class="kind-box">${kindSelect(n)}${kindOf(n)==='manuel'?`<input type="text" data-field="title" data-n="${n}" value="${esc(L.title)}" placeholder="Titre de la leçon">`:''}</div>${sourceSelect(n)}</div>
      <div class="lrow-att">${attF('s')}${attF('b')}</div></div></div>`;
  }
  return `<div class="card strong compact">
      <div class="cgrid">
        <div class="rf"><div class="rf-h"><span class="rf-l">📅 Nb leçons</span></div>${stepper('nbLessons','',N)}</div>
        ${rangeField(`🏃 Sprints / leçon`, st.baseCourses, 'data-field="set" data-k="baseCourses"', 1, 10)}
        ${rangeField('🏀 Tirs / leçon', st.baseTirs, 'data-field="set" data-k="baseTirs"', 1, 10)}
      </div>
      <h3>🏃 Course <span class="muted">· ${st.plotsS} plots · ${fmt(spdS(1))} → ${fmt(spdS(st.plotsS))} km/h</span></h3>
      <div class="cgrid">
        ${rangeField('1er plot', st.firstS, 'data-field="set" data-k="firstS"', 5, 30, ' km/h', 1)}
        ${rangeField('Temps', st.timeS, 'data-field="set" data-k="timeS"', 2, 15, ' s', 0.5)}
        ${rangeField('Plots = pts max', st.plotsS, 'data-field="set" data-k="plotsS"', 1, 20)}
      </div>
      <h3>🏀 Lancer <span class="muted">· ${st.plotsB} plots · ${fmt(distB(1))} → ${fmt(distB(st.plotsB))} m</span></h3>
      <div class="cgrid">
        ${rangeField('1er plot', st.firstB, 'data-field="set" data-k="firstB"', 1, 15, ' m', 0.5)}
        ${rangeField('Écart', st.stepB, 'data-field="set" data-k="stepB"', 0.5, 5, ' m', 0.5)}
        ${rangeField('Plots = pts max', st.plotsB, 'data-field="set" data-k="plotsB"', 1, 20)}
      </div>
      <details><summary style="font-weight:900;cursor:pointer">📏 Mise en place des plots</summary>${plotTable()}</details></div>
    <div class="card compact"><h2>Leçons</h2><div class="muted" style="font-weight:700;margin-bottom:6px">Nature de la leçon ou thème (thèmes à créer dans l'onglet 📚 Thèmes)</div>${rows}</div>`;
}
function sourceSelect(n, label=''){
  const L = lesson(n), kind = kindOf(n), cur = L.source;
  const count = x => S.students.filter(st => vals(perf(x, st.id, 's')).length || vals(perf(x, st.id, 'b')).length).length;
  const o = (v, t) => `<option value="${v}" ${String(cur)===String(v)?'selected':''}>${t}</option>`;
  let opts = o('prev', n === 1 ? 'Choix manuel des cibles' : `Garder les cibles de la leçon ${n-1}`);
  if (kind === 'diag' || kind === 'inter') opts += o('none', 'Cibles à déterminer');
  if (lastKind('diag', n)) opts += o('diag', `Cibles de l'évaluation diagnostique (L${lastKind('diag', n)})`);
  if (lastKind('inter', n)) opts += o('inter', `Cibles du diagnostic intermédiaire (L${lastKind('inter', n)})`);
  if (kind === 'finale') opts += o('projet', "Projet de l'élève");
  opts += Array.from({length:n-1},(_,i)=>i+1).map(x => o(x, `Cibles = résultats de la leçon ${x} (${count(x)} él.)`)).join('');
  const calc = '';                                  // cible = meilleur plot atteint (identique pour toute la leçon)
  return `<div class="src-sel">${label?`<label class="field grow">${label}`:'<label class="grow">'}<select data-field="source" data-n="${n}">${opts}</select></label>${calc}</div>`;
}
function kindSelect(n){
  const k = kindOf(n), th = lesson(n).th, cur = k === 'theme' ? (th ? 'th:' + th.id : 'theme') : k;
  const o = (v, t) => `<option value="${v}" ${cur===v?'selected':''}>${t}</option>`;
  const T = themes(), orphan = th && !themeById(th.id) ? o('th:' + th.id, `${ACT[th.a].ico} ${esc(th.n)}`) : '';
  return `<select data-field="kind" data-n="${n}" class="kind-sel">${['manuel','diag','inter','finale'].map(v => o(v, KINDS[v])).join('')}
    <optgroup label="Thèmes de leçon">${T.map(t => o('th:' + t.id, `${ACT[t.a].ico} ${esc(t.n)}`)).join('')}${orphan}${o('theme', '❔ Thème à choisir')}</optgroup></select>`;
}
function profCibles(){
  const n = curLesson();
  const list = sortedStudents();
  const block = (sid, a) => {
    const ti = targetInfo(n, sid, a), A_ = ACT[a];
    return `<div class="tg-act"><div class="tg-h">${A_.ico} ${A_.label}</div>
      <div class="row" style="gap:8px;flex-wrap:nowrap"><div class="stepper"><button data-action="tgStep" data-sid="${sid}" data-a="${a}" data-d="-1">−</button>
        <span class="val" style="min-width:74px">${ti.base!=null?pts(ti.base):'—'}</span>
        <button data-action="tgStep" data-sid="${sid}" data-a="${a}" data-d="1">+</button></div>
        ${ti.manual?`<button class="btn ghost xs" style="margin-left:0" data-action="resetTarget" data-sid="${sid}" data-a="${a}">Réinitialiser</button>`:''}</div>
      <div class="muted" style="font-size:14px;font-weight:700">${ti.base!=null?ACT[a].unit(ti.base)+' · ':''}${ti.src}${ti.changed?` · avant ${pts(ti.prev)}`:''}</div>
</div>`;
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
  const nw = S.students.filter(s => (L.wb || {})[s.id]?.fb).length;
  return `<div class="card strong"><h2>Appel · Leçon ${n}</h2><div class="muted" style="font-weight:700">${S.students.length-abs-inap} présent(s) · ${abs} absent(s) · ${inap} inapte(s) · forme notée : ${nw}/${S.students.length-abs}.</div></div>
    <div class="tiles">${sortedStudents().map(s => { const a = attOf(n,s.id);
      const w = (L.wb || {})[s.id] || {}, dl = w.dl || [];
      return `<div class="att-tile ${a==='abs'?'abs':a==='inap'?'inapte':''}">${band(s.id)}<div class="name">${esc(nameOf(s.id))}</div>
        <div class="btn-row"><button class="btn ${a==='abs'?'abs-on':''}" data-action="att" data-sid="${s.id}" data-v="abs">Absent</button>
        <button class="btn ${a==='inap'?'inapte-on':''}" data-action="att" data-sid="${s.id}" data-v="inap">Inapte</button></div>
        ${a === 'abs' ? '' : `<button class="btn small well-btn" data-action="appelWell" data-sid="${s.id}">💪 ${w.fb ? `<span class="wv" style="background:${scaleColor(w.fb)};color:${w.fb>=5&&w.fb<=7?'#0A1633':'#fff'}">${w.fb}</span>` : '—'} · 🩹 ${dl.length ? `<b style="color:#D0161B">${esc(dl.map(zoneName).join(', '))}</b>` : 'aucune'}</button>`}</div>`; }).join('')}</div>`;
}
function profGroupes(){
  const G = nbGroups();
  const zone = (g, label) => {
    const items = sortedStudents().filter(s => (s.grp||0) === g), c = g ? groupColor(g) : null;
    const picker = g ? `<div class="gcolors">${COLORS.map(k => `<button class="gc ${S.settings.groupColors[g-1]===k.k?'on':''}" style="background:${k.c}" data-action="groupColor" data-g="${g}" data-c="${k.k}" aria-label="${k.n}"></button>`).join('')}</div>` : '';
    return `<div class="gzone" data-zone="${g}"><h3 data-action="dropSel" data-zone="${g}">${c?`<span class="dot" style="background:${c.c}"></span>`:''}${label} <span class="muted">(${items.length})</span></h3>${picker}
      <div class="gitems">${items.map(s=>`<div class="gitem ${UI.sel===s.id?'sel':''}" data-gid="${s.id}" style="${c?`border-left:12px solid ${c.c}`:''}">${esc(nameOf(s.id))}</div>`).join('')}</div></div>`;
  };
  return `<div class="card strong"><h2>Groupes · ${esc(className())}</h2>
      <h3>Choisir le nombre de groupes</h3>
      <div class="lesson-picker">${Array.from({length:MAX_GROUPS},(_,i)=>i+1).map(n=>`<button class="lp ${n===G?'on':''}" data-action="setGroups" data-n="${n}">${n}</button>`).join('')}</div>
      ${G > 1 ? `<button class="btn small ghost" data-action="clearGroups" style="margin-top:10px">Tout retirer</button>` : ''}</div>
    ${G > 1 ? `<div class="groups">${zone(0, 'Sans groupe')}${Array.from({length:G},(_,i)=>zone(i+1, groupName(i+1))).join('')}</div>` : ''}`;
}
function moveToGroup(sid, g){
  const s = student(sid); if (!s) return;
  if (UI.profTab === 'lgroupes') { const L = lesson(curLesson()); if ((s.grp||0) === g) delete L.grpOv[sid]; else L.grpOv[sid] = g; }
  else s.grp = g;
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
      if (z) { moveToGroup(d.id, +z.dataset.zone || 0); UI.sel = null; save(); }
      render();
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  });
}
function profPartage(){
  const N = S.settings.nbLessons, cur = curLesson();
  return `<div class="card strong"><h2>📷 Scanner</h2>
      <button class="btn orange" data-action="go" data-view="receive" style="min-height:70px;font-size:22px">📷 Scanner un QR</button>
      <div class="muted" style="font-weight:700;margin-top:6px">Élèves · Leçon · Saisies d'une tablette · Historique</div></div>
    <div class="card strong"><h2>📤 Afficher un QR · ${esc(className())}</h2>
      <div class="btn-row"><button class="btn primary" data-action="showQR" data-kind="N">👥 QR Élèves</button>
        <button class="btn" data-action="showFullQR" data-light="0">🗂 QR Historique</button></div>
      <h3 style="margin-top:14px">QR Leçon</h3>
      <div class="lesson-picker">${Array.from({length:N},(_,i)=>i+1).map(n=>`<button class="lp ${n===cur?'on':''}" data-action="showQR" data-kind="L" data-n="${n}">${n}</button>`).join('')}</div></div>
    <div class="card"><h2>Fichiers</h2><div class="btn-row">
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
      <button class="btn small red" data-action="resetAll">Réinitialiser cette classe</button></div>
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
  const head = ['Nom', 'Prénom', 'Affiché', 'Groupe'];
  for (let n = 1; n <= N; n++) head.push(`L${n} sprint cible`, `L${n} sprint moy.`, `L${n} basket cible`, `L${n} basket moy.`);
  head.push('Projet : cible sprint', 'Projet : cible basket', 'Projet : forme du jour', 'Projet : texte', 'D4 proposé', 'D4 final');
  const syn = [head];
  let maxA = 0; for (let n = 1; n <= N; n++) maxA = Math.max(maxA, nbAtt(n,'s'), nbAtt(n,'b'));
  const det = [['Nom','Prénom','Leçon','Titre','Statut','Épreuve','Cible (points)','Cible (plot)',
    ...Array.from({length:maxA},(_,k)=>`Tentative ${k+1}`), 'Moyenne (points)', 'Meilleur (points)', 'Forme (appel) /10', 'Douleurs (appel)', 'Forme fin de leçon /10', 'Thème', 'Critères observés', 'D4 de la leçon']];
  sortedStudents().forEach(s => {
    const nom = s.nom || '', pre = s.prenom || s.disp || '';
    const row = [nom, pre, nameOf(s.id), nbGroups() > 1 && s.grp ? groupName(s.grp) : ''];
    for (let n = 1; n <= N; n++) {
      const at = attOf(n, s.id);
      ['s','b'].forEach(a => { const v = vals(perf(n, s.id, a));
        row.push(num(targetInfo(n, s.id, a).value), at==='abs' ? 'ABS' : at==='inap' ? 'INAPTE' : (v.length ? r2(avg(v)) : '')); });
    }
    const P = S.projects[s.id] || {};
    const sg = d4Suggest(s.id), fin = compOf(s.id).D4;
    row.push(num(P.cibleS), num(P.cibleB), num(P.formeJ), P.texte || '', sg ? COMP_LV[sg].n : '', fin ? COMP_LV[fin].n : '');
    syn.push(row);
    for (let n = 1; n <= N; n++) {
      const at = attOf(n, s.id);
      ['s','b'].forEach(a => {
        const ti = targetInfo(n, s.id, a), p = perf(n, s.id, a), v = vals(p);
        det.push([nom, pre, n, lessonTitle(n), at==='abs'?'Absent':at==='inap'?'Inapte':'Présent', ACT[a].label,
          num(ti.value), ti.value!=null ? ACT[a].unit(ti.value) : '',
          ...Array.from({length:maxA},(_,k)=> num(p[k])), v.length ? r2(avg(v)) : '', v.length ? Math.max(...v) : '',
          ...(a === 's' ? [num(fbOf(n, s.id)), dlOf(n, s.id).map(zoneName).join(', '), num((res(n, s.id) || {}).fa)] : ['','','']),
          ...(th => th && th.a === a ? [th.n, (ob => ob ? th.cr.map((c, i) => `${c} : ${ob[i] ? OBS[ob[i]].n : '—'}`).join(' ; ') : '')(obsOf(n, s.id))] : ['',''])(lessonTheme(n)),
          a === 's' ? (d => d && d.lv ? `${COMP_LV[d.lv].n} (${d.why})` : '')(d4Lesson(n, s.id)) : '']);
      });
    }
  });
  const wb = XLSX.utils.book_new();
  const w1 = XLSX.utils.aoa_to_sheet(syn); w1['!cols'] = head.map((_,i)=>({wch: i<3?16:13}));
  const w2 = XLSX.utils.aoa_to_sheet(det); w2['!cols'] = det[0].map((_,i)=>({wch: i===3?30:12}));
  XLSX.utils.book_append_sheet(wb, w1, 'Synthèse');
  XLSX.utils.book_append_sheet(wb, w2, 'Détail par leçon');
  {
    const lvN = v => v ? COMP_LV[v].n : '';
    const ch = ['Nom', 'Prénom', 'Groupe'];
    for (let n = 1; n <= N; n++) ch.push(`L${n} D4`, `L${n} D4 détail`);
    ch.push('D4 proposé', 'D4 final');
    const cs = [ch];
    sortedStudents().forEach(s => { const C = compOf(s.id);
      const row = [s.nom || '', s.prenom || s.disp || '', nbGroups() > 1 && s.grp ? groupName(s.grp) : ''];
      for (let n = 1; n <= N; n++) { const d = d4Lesson(n, s.id), at = attOf(n, s.id);
        row.push(at === 'abs' ? 'ABS' : at === 'inap' ? 'INAPTE' : d ? lvN(d.lv) : '', d ? d.why : ''); }
      row.push(lvN(d4Suggest(s.id)), lvN(C.D4)); cs.push(row); });
    const w3 = XLSX.utils.aoa_to_sheet([...cs, [], ['D4', COMP_D.D4.t], ['', COMP_D.D4.s]]); w3['!cols'] = ch.map((h, i) => ({ wch: /détail/.test(h) ? 40 : i < 3 ? 16 : 14 }));
    XLSX.utils.book_append_sheet(wb, w3, 'Compétence D4');
  }
  {
    const th = [];
    for (let n = 1; n <= N; n++) { const t = lessonTheme(n); if (!t) continue;
      const head2 = ['Nom', 'Prénom', 'Groupe', ...t.cr];
      th.push([`L${n} · ${t.n} (${ACT[t.a].ico})`], head2);
      sortedStudents().forEach(s => { const ob = obsOf(n, s.id), at = attOf(n, s.id);
        th.push([s.nom || '', s.prenom || s.disp || '', nbGroups() > 1 && s.grp ? groupName(s.grp) : '', ...t.cr.map((c, i) => at === 'abs' ? 'ABS' : at === 'inap' ? 'INAPTE' : ob && ob[i] ? OBS[ob[i]].n : '')]); });
      th.push([]); }
    if (th.length) { const w4 = XLSX.utils.aoa_to_sheet(th); w4['!cols'] = [{wch:16},{wch:16},{wch:12},{wch:28},{wch:28},{wch:28},{wch:28},{wch:28}]; XLSX.utils.book_append_sheet(wb, w4, 'Critères observés'); }
  }
  const lessons = []; for (let n = 1; n <= N; n++) lessons.push([n, lessonTitle(n), lessonTheme(n) ? lessonTheme(n).cr.join(' · ') : '', nbAtt(n,'s'), nbAtt(n,'b'), hasSource(n) ? `Résultats L${lesson(n).source} (${lesson(n).calc==='avg'?'moyenne':'meilleur'})` : (n===1?'À la main':'Reprise leçon précédente')]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Leçon','Titre / thème','Critères','Sprints','Tirs basket','Cibles de base'], ...lessons]), 'Leçons');
  const plots = [['Plot / points','Sprint : vitesse (km/h)',`Sprint : distance en ${S.settings.timeS} s (m)`,'Basket : distance (m)']];
  for (let k = 1; k <= Math.max(maxPlots('s'), maxPlots('b')); k++)
    plots.push([k, k<=maxPlots('s')?spdS(k):'', k<=maxPlots('s')?Math.round(distS(k)*100)/100:'', k<=maxPlots('b')?distB(k):'']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plots), 'Plots');
  const name = `Biathlon5s_${(S.settings.className||'classe').replace(/[^\wÀ-ÿ-]+/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, name);
  toast('✓ Fichier Excel créé');
}

/* ---------------------------------------------------------------------
   Échanges : paquets, compression, QR codes
   --------------------------------------------------------------------- */
function buildFull(){
  const st = { ...S.settings, current: curLesson() };
  return { k:'full', cid:S.id, from:S.deviceId, at:now(), st:{
    settings: st,
    students: S.students.map(s => ({ id:s.id, disp:nameOf(s.id), grp:s.grp||0 })),
    lessons: S.lessons, results: S.results, projects: S.projects } };
}
function buildMine(){
  const results = {}, projects = {};
  let count = 0;
  Object.entries(S.results).forEach(([n, byS]) => Object.entries(byS).forEach(([sid, r]) => {
    if (r.d === S.deviceId) { (results[n] = results[n] || {})[sid] = r; count++; } }));
  Object.entries(S.projects).forEach(([sid, p]) => { if (p.d === S.deviceId) { projects[sid] = p; count++; } });
  return { pkt: { k:'res', cid:S.id, from:S.deviceId, at:now(), results, projects }, count };
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
/* Classe visée par un QR : même identifiant sur tous les appareils (créée si besoin) */
function targetClass(cid, name, create){
  if (cid && ROOT.classes[cid]) return ROOT.classes[cid];
  if (cid && create) { const c = newClassState(name || 'Classe', cid); ROOT.classes[cid] = c; return c; }
  return S;
}
const hasFullNames = c => c.students.some(s => s.nom);
function mergeInto(c, results, projects){ const prev = S.id; useClass(c.id); const n = mergeData(results, projects); useClass(prev); return n; }
async function applyPacket(p){
  if (!p || !p.k) throw new Error('Données non reconnues');
  if (p.k === 'seance') {
    if (isProfRole()) throw new Error('QR de séance : à scanner sur les tablettes élèves');
    return applySeance(p);
  }
  if (p.k === 'res') {
    const c = targetClass(p.cid, null, false);
    const n = mergeInto(c, p.results, p.projects);
    save(); toast(`✓ ${className(c)} · tablette ${p.from} : ${n} saisie(s) récupérée(s)`, 3500);
    return n;
  }
  if (p.k === 'full') {
    const st = p.st, c = targetClass(p.cid, st.settings.className, true);
    if (hasFullNames(c)) {                                   // appareil enseignant : on récupère seulement les performances
      const n = mergeInto(c, st.results, st.projects); save(); toast(`✓ Historique ${className(c)} : ${n} saisie(s) récupérée(s)`, 3500); return n;
    }
    useClass(c.id);
    S.settings = normClass({ settings:{ ...st.settings } }).settings;
    S.students = st.students.map(s => ({ id:s.id, disp:s.disp, grp:s.grp||0 }));
    S.lessons = st.lessons || {};
    const n = mergeData(st.results, st.projects);
    save(); toast(`✓ Historique ${className()} reçu`, 3000); go('home');
    return n;
  }
  if (p.k === 'names') {
    const c = targetClass(p.cid, p.className, true);
    if (hasFullNames(c) && !(await confirmBox('Remplacer la liste ?', 'Cet appareil contient la liste complète de ' + esc(className(c)) + '.', 'Remplacer', true))) return 'continue';
    useClass(c.id);
    S.students = p.students.map(s => ({ id:s.id, disp:s.disp, grp:s.grp||0 }));
    if (p.className) S.settings.className = p.className;
    if (p.nbGroups) { S.settings.nbGroups = p.nbGroups; S.settings.groupColors = p.groupColors; }
    if (p.pin) ROOT.pin = p.pin;
    save(); toast(`✓ ${className()} : ${S.students.length} élèves reçus`, 3000);
    return 'continue';
  }
  if (p.k === 'lesson') {
    const c = targetClass(p.cid, null, false);
    if (hasFullNames(c)) throw new Error('QR Leçon : à scanner sur les tablettes des élèves');
    const list = c.students;                      // même ordre que le QR « Élèves »
    if (!list.length || listHash(list.map(s => s.id)) !== p.hash) { toast('⚠️ Scannez d\'abord le QR « Élèves »', 4000); throw new Error('Liste des élèves différente'); }
    useClass(c.id);
    S.settings = { ...S.settings, ...p.settings };
    if (p.groupColors) S.settings.groupColors = p.groupColors;
    const L = lesson(p.settings.current);
    L.title = p.title; L.kind = p.kind === 'manuel' ? undefined : p.kind; if (L.kind) L.title = ''; L.nbCourses = p.nbC; L.nbTirs = p.nbT;
    L.th = p.kind === 'theme' ? (p.th || null) : undefined; L.adv = {};
    if (p.adv) list.forEach((s, i) => { if (p.adv[i]) L.adv[s.id] = p.adv[i]; });
    L.fixedS = {}; L.fixedB = {}; L.manual = {}; L.manualB = {}; L.adjust = {}; L.adjustB = {}; L.att = {}; L.grpOv = {};
    list.forEach((s, i) => { const r = p.rows[i]; if (!r) return;
      if (r.tS != null) L.fixedS[s.id] = r.tS; if (r.tB != null) L.fixedB[s.id] = r.tB;
      if (r.aS) L.adjust[s.id] = r.aS; if (r.aB) L.adjustB[s.id] = r.aB; if (r.att) L.att[s.id] = r.att; s.grp = r.grp || 0; });
    ROOT.seance = { cid: S.id, n: p.settings.current, at: now() };
    save(); toast(`✓ ${className()} · leçon ${p.settings.current} reçue`, 3000);
    return 'continue';
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
  pos(){ return i; }, skip(n){ i += n; },
  end(){ return i >= u.length; } }; }
function listHash(ids){ let h = 0x811c9dc5; for (const c of ids.join(',')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
const GIDX = k => { const i = COLORS.findIndex(c => c.k === k); return i < 0 ? 0 : i + 1; };
const GKEY = i => i ? COLORS[i-1]?.k || null : null;
const NUL = 255, nv = v => v == null ? NUL : Math.max(0, Math.min(254, v)), vn = v => v === NUL ? null : v;

/* ---------------------------------------------------------------------
   QR « Séance » (enseignant → tablettes élèves) : élèves + leçon (+ bilan pour le projet de l'évaluation finale)
   Les données ne changent pas : ce QR regroupe simplement les QR « Élèves » et « Leçon ».
   --------------------------------------------------------------------- */
function sumBytes(w, sid){                         // bilan compact pour le projet de l'élève (évaluation finale)
  ['s','b'].forEach(a => { const g = suggest(sid, a);
    if (!g) { w.u8(0); return; }
    w.u8(1); w.u8(g.best); w.u8(Math.round(g.moy * 10)); w.u8(g.rate == null ? 255 : Math.round(g.rate * 100));
    w.u8(Math.max(0, Math.min(255, Math.round(g.trend * 10) + 128))); w.u8(g.prudente); w.u8(g.conseillee); w.u8(g.ambitieuse); w.u8(g.nbL); });
  const F = finaleLesson(), fbs = [], fas = [], pains = new Set();
  for (let n = 1; n <= S.settings.nbLessons; n++) { if (n === F || attOf(n, sid)) continue;
    const fb = fbOf(n, sid), fa = res(n, sid)?.fa; if (fb) fbs.push(fb); if (fa) fas.push(fa); dlOf(n, sid).forEach(k => pains.add(k)); }
  w.u8(fbs.length ? Math.round(avg(fbs) * 10) : 0); w.u8(fas.length ? Math.round(avg(fas) * 10) : 0); w.u32(zoneMask([...pains]));
}
function sumRead(r){
  const o = {};
  ['s','b'].forEach(a => { if (!r.u8()) return;
    const best = r.u8(), moy = r.u8() / 10, rt = r.u8(), trend = (r.u8() - 128) / 10;
    o[a] = { best, moy, rate: rt === 255 ? null : rt / 100, trend, prudente: r.u8(), conseillee: r.u8(), ambitieuse: r.u8(), nbL: r.u8() }; });
  const fb = r.u8(), fa = r.u8(); o.fb = fb ? fb / 10 : null; o.fa = fa ? fa / 10 : null; o.dl = maskZones(r.u32());
  return o;
}
function binSeance(n){
  const cur = n || curLesson(), N = binNames(), L = binLesson(cur), list = sortedStudents(), withSum = isFinale(cur);
  const w = BW(); w.u8('S'.charCodeAt(0)); w.u8(1);
  w.u16(N.length); N.forEach(x => w.u8(x)); w.u16(L.length); L.forEach(x => w.u8(x));
  w.u8(withSum ? 1 : 0);
  if (withSum) list.forEach(s => sumBytes(w, s.id));
  return w.bytes();
}
function seanceDecode(u, r){
  const nN = r.u16(), N = u.slice(r.pos(), r.pos() + nN); r.skip(nN);
  const nL = r.u16(), L = u.slice(r.pos(), r.pos() + nL); r.skip(nL);
  const names = binDecode(N), les = binDecode(L);
  let sums = null;
  if (r.u8()) { sums = []; for (let i = 0; i < names.students.length; i++) sums.push(sumRead(r)); }
  return { k:'seance', names, lesson: les, sums };
}
async function applySeance(p){
  const c = targetClass(p.names.cid, p.names.className, true);
  useClass(c.id);
  S.students = p.names.students.map(s => ({ id:s.id, disp:s.disp, grp:s.grp||0 }));
  if (p.names.className) S.settings.className = p.names.className;
  if (p.names.nbGroups) { S.settings.nbGroups = p.names.nbGroups; S.settings.groupColors = p.names.groupColors; }
  if (p.names.pin) ROOT.pin = p.names.pin;
  save();
  await applyPacket(p.lesson);
  const L = lesson(p.lesson.settings.current);
  L.sum = {};
  if (p.sums) S.students.forEach((s, i) => { if (p.sums[i]) L.sum[s.id] = p.sums[i]; });
  ROOT.seance = { cid: S.id, n: p.lesson.settings.current, at: now() };
  save(); toast(`✓ Séance reçue : ${className()} · leçon ${p.lesson.settings.current}`, 3500);
  UI.filter = null; go('home');
  return 'done';
}
/* bilan reçu (tablette élève) quand l'historique n'est pas sur la tablette */
const sumOf = sid => lesson(finaleLesson()).sum?.[sid] || null;
function binNames(){
  const w = BW(); w.u8('N'.charCodeAt(0)); w.u8(3);
  w.id(S.id); w.str(S.settings.className, 60); w.str(ROOT.pin, 8);
  w.u8(nbGroups()); for (let i = 0; i < nbGroups(); i++) w.u8(GIDX(S.settings.groupColors[i]));
  w.u8(S.students.length);
  sortedStudents().forEach(s => { w.id(s.id); w.u8(s.grp||0); w.str(nameOf(s.id), 40); });
  return w.bytes();
}
function binLesson(n){
  const cur = n || curLesson(), L = lesson(cur), st = S.settings, list = sortedStudents();
  const w = BW(); w.u8('L'.charCodeAt(0)); w.u8(5);
  w.id(S.id);
  w.u32(listHash(list.map(s => s.id)));
  [st.nbLessons, cur, st.baseCourses, st.baseTirs, st.plotsS, st.plotsB, st.ecartS, st.ecartB, nbAtt(cur,'s'), nbAtt(cur,'b')].forEach(v => w.u8(v));
  w.u8(st.firstS); w.u8(Math.round(st.timeS*10)); w.u8(Math.round(st.firstB*2)); w.u8(Math.round(st.stepB*2));
  w.u8(nbGroups()); for (let i = 0; i < nbGroups(); i++) w.u8(GIDX(st.groupColors[i]));
  w.str(lessonTitle(cur), 80); w.u8(KIND_IDX.indexOf(kindOf(cur))); w.u8(list.length);
  list.forEach(s => {
    const aS = +(L.adjust[s.id]||0), aB = +(L.adjustB[s.id]||0), at = attOf(cur, s.id);
    w.u8(nv(baseTarget(cur, s.id, 's'))); w.u8(nv(baseTarget(cur, s.id, 'b')));
    w.u8((aS<0?1:aS>0?2:0) | ((aB<0?1:aB>0?2:0)<<2) | ((at==='abs'?1:at==='inap'?2:0)<<4));
    w.u8(grpOf(s.id, cur));
  });
  const th = lessonTheme(cur);                       // v5 : thème + critères + conseil de la fois précédente
  w.u8(th ? 1 : 0);
  if (th) { w.str(th.id, 8); w.str(th.n, 60); w.u8(th.a === 'b' ? 1 : 0); w.u8(th.cr.length); th.cr.forEach(c => w.str(c, 60));
    list.forEach(s => { const a = pickAdvice(lastObs(cur, s.id)); w.u8(a ? a.i : 255); w.u8(a ? a.v : 0); w.u8(a ? a.k : 0); }); }
  return w.bytes();
}
function binResults(){
  const w = BW(); w.u8('R'.charCodeAt(0)); w.u8(4); w.id(S.deviceId); w.id(S.id);
  const ents = [], projs = [];
  Object.entries(S.results).forEach(([n, byS]) => Object.entries(byS).forEach(([sid, r]) => { if (r.d === S.deviceId) ents.push([+n, sid, r]); }));
  Object.entries(S.projects).forEach(([sid, p]) => { if (p.d === S.deviceId) projs.push([sid, p]); });
  w.u16(ents.length);
  ents.forEach(([n, sid, r]) => { w.id(sid); w.u8(n); w.u32(Math.floor((r.ts||0)/1000));
    const c = r.c||[], b = r.b||[]; w.u8(c.length); c.forEach(v => w.u8(nv(v))); w.u8(b.length); b.forEach(v => w.u8(nv(v)));
    w.u8(nv(r.fb)); w.u8(nv(r.fa)); w.u8(nv(r.mo)); w.u32(zoneMask(r.dl));
    const ob = r.ob || []; w.u8(ob.length); ob.forEach(v => w.u8(nv(v))); });
  w.u8(projs.length);
  projs.forEach(([sid, p]) => { w.id(sid); w.u8(nv(p.cibleS)); w.u8(nv(p.cibleB)); w.u32(Math.floor((p.ts||0)/1000)); w.str(p.texte||'', 600); w.u8(nv(p.formeJ)); w.u8(nv(p.motivJ)); });
  return { bytes: w.bytes(), count: ents.length + projs.length };
}
function binDecode(u){
  const r = BR(u), t = String.fromCharCode(r.u8()), ver = r.u8();
  const colors = n => { const out = [...DEFAULT_SETTINGS.groupColors]; for (let i = 0; i < n; i++) out[i] = GKEY(r.u8()) || out[i]; return out; };
  if (t === 'N') {
    let cid = null, pin = null, nbGroups = 0, groupColors = null;
    if (ver >= 2) cid = r.id();
    const className = r.str();
    if (ver >= 2) { pin = r.str(); nbGroups = r.u8(); groupColors = colors(ver >= 3 ? nbGroups : 4); }
    const n = r.u8(), students = [];
    for (let i = 0; i < n; i++) { const id = r.id(), g = r.u8(), disp = r.str(); students.push({ id, disp, grp: ver >= 2 ? g : 0 }); }
    return { k:'names', cid, className, pin, nbGroups, groupColors, students };
  }
  if (t === 'L') {
    const cid = ver >= 3 ? r.id() : null;
    const hash = r.u32(); const v = []; for (let i = 0; i < 10; i++) v.push(r.u8());
    const bar = ver >= 2 ? { firstS: r.u8(), timeS: r.u8()/10, firstB: r.u8()/2, stepB: r.u8()/2 } : {};
    let grp = {}, groupColors = null;
    if (ver >= 3) { grp.nbGroups = r.u8(); groupColors = colors(ver >= 4 ? grp.nbGroups : 4); }
    const title = r.str(), kind = ver >= 4 ? KIND_IDX[r.u8()] || 'manuel' : 'manuel', n = r.u8(), rows = [];
    for (let i = 0; i < n; i++) { const tS = vn(r.u8()), tB = vn(r.u8()), f = r.u8(), g = r.u8();
      rows.push({ tS, tB, aS: [0,-1,1][f&3], aB: [0,-1,1][(f>>2)&3], att: [null,'abs','inap'][(f>>4)&3], grp: ver >= 3 ? g : 0 }); }
    let th = null, adv = [];
    if (ver >= 5 && r.u8()) { th = { id: r.str(), n: r.str(), a: r.u8() ? 'b' : 's', cr: [] }; const nc = r.u8(); for (let i = 0; i < nc; i++) th.cr.push(r.str());
      for (let i = 0; i < n; i++) { const ai = r.u8(), av = r.u8(), ak = r.u8(); adv.push(ai === 255 ? null : { i: ai, v: av, k: ak }); } }
    const [nbLessons, current, baseCourses, baseTirs, plotsS, plotsB, ecartS, ecartB, nbC, nbT] = v;
    return { k:'lesson', cid, hash, groupColors, settings:{ nbLessons, current, baseCourses, baseTirs, plotsS, plotsB, ecartS, ecartB, ...bar, ...grp }, nbC, nbT, title, kind, rows, th, adv };
  }
  if (t === 'S') return seanceDecode(u, r);
  if (t === 'R') {
    const from = r.id(), cid = ver >= 2 ? r.id() : null, n = r.u16(), results = {}, projects = {};
    for (let i = 0; i < n; i++) { const sid = r.id(), les = r.u8(), ts = r.u32()*1000;
      const nc = r.u8(), c = []; for (let k = 0; k < nc; k++) c.push(vn(r.u8()));
      const nb = r.u8(), b = []; for (let k = 0; k < nb; k++) b.push(vn(r.u8()));
      const e = { c, b, ts, d: from };
      if (ver >= 3) { e.fb = vn(r.u8()); e.fa = vn(r.u8()); e.mo = vn(r.u8()); e.dl = maskZones(r.u32()); }
      if (ver >= 4) { const no = r.u8(); if (no) { e.ob = []; for (let k = 0; k < no; k++) e.ob.push(vn(r.u8())); } }
      (results[les] = results[les] || {})[sid] = e; }
    const np = r.u8();
    for (let i = 0; i < np; i++) { const sid = r.id(), cS = vn(r.u8()), cB = vn(r.u8()), ts = r.u32()*1000, texte = r.str(true);
      projects[sid] = { cibleS:cS, cibleB:cB, texte, ts, d: from };
      if (ver >= 3) { projects[sid].formeJ = vn(r.u8()); projects[sid].motivJ = vn(r.u8()); } }
    return { k:'res', from, cid, results, projects };
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
    R[n][sid] = [r.c||[], r.b||[], Math.floor((r.ts||0)/1000) - T, di(r.d), r.fb ?? null, r.fa ?? null, r.mo ?? null, r.dl || [], r.ob || null]; }); });
  Object.entries(projects||{}).forEach(([sid, p]) => { P[sid] = [p.cibleS ?? null, p.cibleB ?? null, p.texte||'', Math.floor((p.ts||0)/1000) - T, di(p.d), p.formeJ ?? null, p.motivJ ?? null]; });
  return { T, D, R, P };
}
function unpackRP(z){
  const results = {}, projects = {};
  Object.entries(z.R||{}).forEach(([n, byS]) => { results[n] = {}; Object.entries(byS).forEach(([sid, a]) => {
    results[n][sid] = { c:a[0], b:a[1], ts:(z.T + a[2])*1000, d:z.D[a[3]], fb:a[4] ?? null, fa:a[5] ?? null, mo:a[6] ?? null, dl:a[7] || [], ...(a[8] ? { ob:a[8] } : {}) }; }); });
  Object.entries(z.P||{}).forEach(([sid, a]) => { projects[sid] = { cibleS:a[0], cibleB:a[1], texte:a[2], ts:(z.T + a[3])*1000, d:z.D[a[4]], formeJ:a[5] ?? null, motivJ:a[6] ?? null }; });
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
async function zxRead(imgData, hard=true){
  if (!zxReady) return null;
  try { const r = await ZXingWASM.readBarcodes(imgData, { formats:['QRCode'], tryHarder:hard, maxNumberOfSymbols:1 });
    const ok = r.find(x => x.isValid && x.text); return ok ? ok.text : null; } catch(e){ return null; }
}
async function decodeImageSource(src, sw, sh, cv, ctx, frame, all=false){
  const det = await getNativeDetector();
  if (det) { try { const r = await det.detect(src); if (r && r.length) return r.map(x => x.rawValue); } catch(e){} }
  const side = Math.min(sw, sh) * 0.92, sx = (sw - side)/2, sy = (sh - side)/2;
  if (zxReady) {
    // ZXing : cadre central, puis image entière de temps en temps
    const k = Math.min(1, (all ? 1000 : 800) / side), w = Math.round(side*k);
    cv.width = w; cv.height = w; ctx.drawImage(src, sx, sy, side, side, 0, 0, w, w);
    let t = await zxRead(ctx.getImageData(0, 0, w, w), all || frame % 3 !== 1);
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
      <div class="btn-row" style="justify-content:center"><button class="btn" data-cam>🔄 Caméra</button><label class="btn orange">📷 Photo du QR<input type="file" accept="image/*" capture="environment" hidden class="scan-photo"></label></div>
      <p class="center" id="scan-diag" style="font-size:12px;color:var(--grey);margin-top:8px"></p></div>`;
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
      if (okTypes.length && !okTypes.includes(pt.type)) { msg.textContent = okTypes.includes('R') ? 'Ce QR est destiné aux tablettes élèves (📷 Scanner la séance).' : 'Ce QR est destiné à la tablette enseignant (📥 Récupérer les saisies).'; continue; }
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
    msg.innerHTML = '⚠️ Caméra indisponible : utilisez 📷 Photo du QR.'; return;
  }
  const diag = container.querySelector('#scan-diag');
  container.querySelector('[data-cam]').onclick = async () => {
    try { const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      if (cams.length < 2) return toast('Une seule caméra');
      scanCamIdx = (scanCamIdx + 1) % cams.length; scanCamId = cams[scanCamIdx].deviceId;
      startScan(container, expectType, onDone); } catch(e){}
  };
  // Plusieurs réglages essayés dans l'ordre (certains appareils donnent une image noire en haute résolution)
  const attempts = scanCamId
    ? [{ deviceId:{ exact: scanCamId } }]
    : [{ facingMode:'environment' }, { facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } }, true];
  let lastErr = null;
  for (const vc of attempts) {
    try { me.stream = await navigator.mediaDevices.getUserMedia({ video: vc, audio:false }); break; }
    catch(e) { lastErr = e; }
  }
  if (!me.stream) {
    const n = lastErr && lastErr.name;
    msg.innerHTML = n === 'NotAllowedError' ? '⚠️ Caméra refusée : autorisez la caméra pour ce site dans les réglages, ou utilisez 📷 Photo du QR.'
      : '⚠️ Caméra impossible à ouvrir (' + esc(n || 'erreur') + ') : utilisez 📷 Photo du QR.';
    return;
  }
  if (me.stopped) { me.stream.getTracks().forEach(t=>t.stop()); return; }
  const track = me.stream.getVideoTracks()[0];
  try { await track.applyConstraints({ advanced:[{ focusMode:'continuous' }] }); } catch(e){}
  video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.muted = true; video.autoplay = true;
  video.srcObject = me.stream;
  const playIt = () => video.play().catch(()=>{});
  video.onloadedmetadata = playIt; playIt();
  msg.textContent = 'Visez le QR code…';
  const reader = () => nativeDetector ? 'lecteur Android' : zxReady ? 'lecteur ZXing' : 'lecteur jsQR';
  const t0 = Date.now(); let lastDiag = 0, decodes = 0, dark = 0, switched = false;
  const probe = document.createElement('canvas'), pctx = probe.getContext('2d', { willReadFrequently:true }); probe.width = 32; probe.height = 18;
  const tick = async () => {
    if (me.stopped || finished) return;
    const now = Date.now();
    if (video.readyState >= 2 && video.videoWidth) {
      me.frame++;
      // image noire ? (mauvais objectif sur certains appareils) → on passe à une autre caméra
      if (me.frame % 10 === 1) {
        pctx.drawImage(video, 0, 0, 32, 18); const d = pctx.getImageData(0, 0, 32, 18).data; let m = 0;
        for (let i = 0; i < d.length; i += 4) m += d[i] + d[i+1] + d[i+2]; m /= (d.length/4*3);
        dark = m < 6 ? dark + 1 : 0;
        if (dark >= 4 && !switched) { switched = true; toast('Image noire : autre caméra…');
          try { const cams = (await navigator.mediaDevices.enumerateDevices()).filter(x => x.kind === 'videoinput');
            if (cams.length > 1) { const cur = track.getSettings().deviceId; const i = cams.findIndex(c => c.deviceId === cur);
              scanCamIdx = (i + 1) % cams.length; scanCamId = cams[scanCamIdx].deviceId; return startScan(container, expectType, onDone); } } catch(e){}
          msg.textContent = '⚠️ Image noire : touchez 🔄 Caméra ou utilisez 📷 Photo du QR.'; }
      }
      try { const r = await decodeImageSource(video, video.videoWidth, video.videoHeight, cv, ctx, me.frame); decodes++; if (r.length) await handle(r); } catch(e){ console.warn(e); }
    } else if (now - t0 > 4000 && me.frame === 0) {
      msg.textContent = '⚠️ La caméra ne renvoie pas d\'image : touchez 🔄 Caméra ou utilisez 📷 Photo du QR.';
      playIt();
    }
    if (diag && now - lastDiag > 1000) {
      const el = (now - (lastDiag || t0)) / 1000;
      diag.textContent = `Caméra ${video.videoWidth}×${video.videoHeight} · ${Math.round(decodes/el)} analyses/s · ${reader()} · v${APP_VERSION}`;
      lastDiag = now; decodes = 0;
    }
    if (!me.stopped && !finished) me.timer = setTimeout(tick, 60);
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
  return `<div class="card strong center"><b style="font-size:20px">📷 Scanne le QR de la séance affiché par l'enseignant</b></div>
    <div id="scan-area"></div>
    <div class="btn-row" style="justify-content:center;margin-top:12px"><label class="btn">📂 Importer un fichier (.json)<input type="file" id="file-sync" accept=".json,application/json" hidden></label></div>`;
}
function afterReceive(){ startScan($('#scan-area'), ['S','N','L'], async p => { const r = await applyPacket(p); return r === 'continue' ? 'continue' : r; }); }

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
    else if (obj.classes) {
      if (!(await confirmBox('Restaurer la sauvegarde ?', 'Toutes les classes de cet appareil seront remplacées.', 'Restaurer', true))) return;
      const dev = ROOT.deviceId; ROOT = obj; ROOT.deviceId = dev; Object.values(ROOT.classes).forEach(normClass);
      useClass(ROOT.classes[ROOT.active] ? ROOT.active : Object.keys(ROOT.classes)[0]); save(); toast('✓ Sauvegarde restaurée'); go('home');
    }
    else if (obj.settings && obj.students) {                  // sauvegarde d'une ancienne version (une seule classe)
      const c = normClass({ ...obj, id: rnd(4) }); delete c.v; if (!c.settings.className) c.settings.className = 'Classe importée';
      ROOT.classes[c.id] = c; useClass(c.id); save(); toast('✓ Classe importée'); go('home');
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
  profTab: d => { UI.sel = null; UI.profTab = d.tab;
    if (PREDIR[d.tab]) { if (d.tab === 'saisieP') UI.filter = null; return go(PREDIR[d.tab]); }
    UI.view = 'prof'; render(); window.scrollTo(0,0); },
  lockProf: () => { UI.profUnlocked = false; UI.profTab = 'menu'; go('home'); },
  setRole: d => {
    if (d.r === 'prof') return pinPad(() => { ROOT.role = 'prof'; UI.profUnlocked = true; UI.profTab = 'menu'; save(); go('prof'); });
    const doIt = () => { ROOT.role = 'eleve'; UI.profUnlocked = false; save(); go('home'); toast('🧒 Tablette élève'); };
    if (ROOT.role === 'prof') confirmBox('Passer en tablette élève ?', 'Les données restent sur la tablette. Pour revenir : ⚙️ Enseignant + code.', 'Passer en élève').then(ok => ok && doIt()); else doIt(); },
  switchRole: () => pinPad(() => { ROOT.role = 'prof'; UI.profUnlocked = true; UI.profTab = 'menu'; save(); go('prof'); }, '🔒 Code enseignant · passer en tablette enseignant'),
  filter: d => { UI.filter = d.g ? +d.g : null; render(); },
  goSaisie: () => { UI.filter = null; go('saisie'); },
  well: d => { const n = curLesson(), sid = UI.sid, v = +d.v; setRes(n, sid, r => { r[d.f] = r[d.f] === v ? null : v; }); render(); flagSaved(); },
  painOpen: () => painModal(),
  appelWell: d => appelWellModal(d.sid),
  obs: d => { const n = curLesson(), th = lessonTheme(n); if (!th) return; const i = +d.i, v = +d.v;
    setRes(n, UI.sid, r => { const ob = Array.from({length: th.cr.length}, (_, j) => (r.ob || [])[j] ?? null); ob[i] = ob[i] === v ? null : v; r.ob = ob; r.oth = th.id; });
    render(); flagSaved(); },
  thToggle: () => { UI.thOpen = !UI.thOpen; render(); },
  thAdd: () => { const id = rnd(4); themes().push({ id, n:'Nouveau thème', a:'s', cr:[] }); UI.thOpen = true; save(); render(); },
  thDel: async d => { const t = themeById(d.id); if (!t) return;
    if (!(await confirmBox('Supprimer « ' + esc(t.n) + ' » ?', 'Les leçons qui utilisent déjà ce thème le gardent.', 'Supprimer', true))) return;
    ROOT.themes = themes().filter(x => x.id !== d.id); save(); render(); },
  testClass: async () => { const ex = Object.values(ROOT.classes).find(c => c.settings.className === 'Classe Test');
    const ch = await choiceBox('🧪 Classe Test', '24 élèves inventés · 4 groupes · 7 leçons, leçon du jour : 6. L1 diagnostic · L2 Posture de départ · L3 Premiers appuis · L4 diagnostic intermédiaire · L5 Maintien de la vitesse · L6 thème à choisir · L7 évaluation du projet. 6 sprints de 6 s et 6 lancers, 8 points max.',
      ex ? [{label:'Ouvrir', value:'open', cls:'primary'}, {label:'Régénérer', value:'new', cls:'orange'}] : [{label:'Créer', value:'new', cls:'primary'}]);
    if (!ch) return; if (ch === 'new') makeTestClass(); else useClass(ex.id); save(); toast('🧪 Classe Test'); render(); },
  compDetail: d => { UI.sid = d.sid; UI.profTab = 'compDetail'; render(); window.scrollTo(0,0); },
  compSet: d => { S.comp = S.comp || {}; const c = S.comp[UI.sid] = S.comp[UI.sid] || {}, v = +d.v;
    if (!v || c[d.k] === v) delete c[d.k]; else c[d.k] = v; c.ts = now(); save(); render(); },
  projetDetail: d => { UI.draft = null; go('projetDetail', { sid: d.sid }); },
  pjWell: d => { UI.draft[d.f] = UI.draft[d.f] === +d.v ? null : +d.v; render(); },
  pjSet: d => { UI.draft[d.a === 's' ? 'cibleS' : 'cibleB'] = +d.v; render(); },
  pjStep: d => { const k = d.a === 's' ? 'cibleS' : 'cibleB'; const g = suggest(UI.sid, d.a);
    UI.draft[k] = clampT(d.a, (UI.draft[k] ?? g?.conseillee ?? Math.ceil(maxPlots(d.a)/2)) + (UI.draft[k] == null ? 0 : +d.d)); render(); },
  pjSave: () => { const D = UI.draft, sid = UI.sid;
    if (D.cibleS == null || D.cibleB == null) return toast('Choisis tes deux cibles');
    S.projects[sid] = { cibleS: D.cibleS, cibleB: D.cibleB, formeJ: D.formeJ, texte: $('#pj-text').value.trim(), ts: now(), d: S.deviceId };
    save(); toast('✓ Projet enregistré : ce sont tes cibles de l\'évaluation finale', 3500); go('projet'); },
  pickGroup: d => { UI.filter = d.g === 'all' ? 'all' : d.g ? +d.g : null; go('saisie'); },
  selClass: d => { useClass(d.id); UI.filter = null; save(); render(); },
  addClass: () => { const name = ($('#new-class').value || '').trim(); if (!name) return toast('Nom de la classe ?');
    const c = newClassState(name); ROOT.classes[c.id] = c; useClass(c.id); save(); toast('✓ ' + name + ' créée'); render(); },
  delClass: async () => { if (Object.keys(ROOT.classes).length < 2) return;
    if (!(await confirmBox('Supprimer « ' + className() + ' » ?', 'Élèves, leçons et résultats de cette classe seront effacés de cet appareil.', 'Supprimer', true))) return;
    delete ROOT.classes[S.id]; useClass(Object.keys(ROOT.classes)[0]); save(); render(); },
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
  dropSel: d => { if (!UI.sel) return; moveToGroup(UI.sel, +d.zone || 0); save(); UI.sel = null; render(); },
  resetDayGroups: () => { lesson(curLesson()).grpOv = {}; save(); render(); },
  clearGroups: () => { S.students.forEach(s => s.grp = 0); save(); render(); },
  setGroups: d => { S.settings.nbGroups = +d.n; S.students.forEach(s => { if (s.grp > +d.n) s.grp = 0; }); UI.filter = null; save(); render(); },
  groupColor: d => { S.settings.groupColors[+d.g - 1] = d.c; save(); render(); },

  // prof : partage
  showQR: async d => {
    const ln = +(d.n || curLesson());
    const bytes = d.kind === 'N' ? binNames() : binLesson(ln);
    const parts = chunkQR(await encodeBin(bytes), d.kind, 260);
    const m = modal(`<div id="qr-modal"></div><div class="btn-row" style="justify-content:center;margin-top:10px"><button class="btn primary" data-close>Fermer</button></div>`, { wide:true });
    m.querySelector('[data-close]').onclick = closeModal;
    showQRSeries(parts, m.querySelector('#qr-modal'), (d.kind === 'N' ? 'Élèves' : `Leçon ${ln}`) + ' · ' + esc(className()));
  },
  showFullQR: async d => {
    const payload = await encodePacket(buildFull());
    const parts = chunkQR(payload, 'F');
    const m = modal(`<div id="qr-modal"></div><div class="btn-row" style="justify-content:center;margin-top:10px"><button class="btn primary" data-close>Fermer</button></div>`, { wide:true });
    m.querySelector('[data-close]').onclick = closeModal;
    showQRSeries(parts, m.querySelector('#qr-modal'), `Leçon ${curLesson()} → tablettes`);
  },
  scanResults: () => {
    const m = modal(`<h2>Scanner une tablette</h2><div id="scan-modal"></div><div class="btn-row" style="justify-content:center;margin-top:10px"><button class="btn primary" data-close>Terminer</button></div>`, { wide:true });
    m.querySelector('[data-close]').onclick = () => { closeModal(); render(); };
    startScan(m.querySelector('#scan-modal'), null, async p => { await applyPacket(p); return 'continue'; });
  },
  fileFull: () => downloadJSON(buildFull(), `Biathlon5s_lecon${curLesson()}.json`),
  fileMine: () => downloadJSON(buildMine().pkt, `Biathlon5s_saisies_${S.deviceId}.json`),

  // export / réglages
  exportXlsx: () => exportXlsx(),
  backup: () => downloadJSON(ROOT, `Biathlon_sauvegarde_${new Date().toISOString().slice(0,10)}.json`),
  setPin: () => { const v = $('#new-pin').value.trim(); if (!/^\d{4}$/.test(v)) return toast('4 chiffres requis'); ROOT.pin = v; save(); $('#new-pin').value=''; toast('✓ Code modifié'); },
  clearResults: async () => { if (await confirmBox('Effacer tous les résultats ?', 'Performances, tirs et projets seront supprimés (la liste et les leçons restent).', 'Effacer', true)) { S.results = {}; S.projects = {}; save(); render(); } },
  resetAll: async () => { if (await confirmBox('Effacer « ' + className() + ' » ?', 'Élèves, leçons et résultats de cette classe repartent à zéro.', 'Tout effacer', true)) {
    const c = newClassState(className(), S.id); ROOT.classes[S.id] = c; useClass(c.id); save(); go('home'); } },
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
  if (f === 'className') { S.settings.className = t.value.trim() || 'Classe'; save(); render(); }
  if (f === 'title') { lesson(t.dataset.n).title = t.value.trim(); save(); }
  if (f === 'att') { const L = lesson(t.dataset.n), a = t.dataset.a, v = +t.value;
    if (v === +S.settings[ACT[a].base]) delete L[ACT[a].att]; else L[ACT[a].att] = v; save(); render(); }
  if (f === 'set') { S.settings[t.dataset.k] = +t.value; save(); render(); }
  if (f === 'source') { lesson(t.dataset.n).source = /^\d+$/.test(t.value) ? +t.value : t.value; save(); render(); toast('✓ Cibles mises à jour'); }
  if (f === 'kind') { const L = lesson(t.dataset.n), v = t.value;
    if (v.startsWith('th:')) { L.kind = 'theme'; L.th = snapTheme(themeById(v.slice(3))) || L.th; }
    else { L.kind = v; if (v !== 'theme') delete L.th; else L.th = null; }
    if (L.kind === 'theme') L.title = '';
    if (t.value === 'diag' || t.value === 'inter') L.source = 'none'; else if (t.value === 'finale') L.source = 'projet'; else if (['none','projet'].includes(L.source)) L.source = 'prev';
    save(); render(); }
  if (f === 'thName' || f === 'thAct' || f === 'thCr') { const th = themeById(t.dataset.id); if (!th) return;
    if (f === 'thName') th.n = t.value.trim() || 'Thème';
    if (f === 'thAct') th.a = t.value === 'b' ? 'b' : 's';
    if (f === 'thCr') { const cr = Array.from({length:MAX_CR}, (_, i) => th.cr[i] || ''); cr[+t.dataset.i] = t.value.trim(); th.cr = cr.filter(Boolean); }
    refreshThemeSnapshots(th.id); save(); render(); return; }
  if (f === 'calc') { lesson(t.dataset.n).calc = t.value; save(); render(); }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.type === 'range') { const rv = t.closest('.rf, .range-field')?.querySelector('.rv'); if (rv) rv.textContent = fmt(+t.value); }
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

