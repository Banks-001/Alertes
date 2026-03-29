/* ═══════════════════════════════════════════════════════
   RégAlert v2.1 — Logique applicative principale
   app.js — Données 100% via CSV · Firebase · Notifications
═══════════════════════════════════════════════════════ */

'use strict';

// ══════════════════════════════════════════════════════
// COULEURS ENTITÉS (dynamique + palette fixe)
// ══════════════════════════════════════════════════════
const ECOLORS_FIXED = {
  'COMPTA':'#3b5bdb','RISQUE':'#c2255c','CONTRÔLE DE GESTION':'#087f5b',
  'AUDIT':'#e67700','DRC':'#862e9c','CONFORMITE':'#1098ad',
  'TRESORERIE':'#2b8a3e','D.FINANCIERE':'#a61e4d','DJRC':'#364fc7',
  'DRHA':'#5c7cfa','MARKETING':'#f76707','ENGAGEMENTS':'#0c8599'
};
const PALETTE = [
  '#3b5bdb','#c2255c','#087f5b','#e67700','#862e9c','#1098ad',
  '#2b8a3e','#a61e4d','#364fc7','#5c7cfa','#f76707','#0c8599',
  '#6741d9','#2f9e44','#1971c2','#e03131','#5f3dc4','#0b7285'
];
let _entityColorMap = {...ECOLORS_FIXED};
let _paletteIdx = Object.keys(ECOLORS_FIXED).length;
function eC(e) {
  if (!_entityColorMap[e]) { _entityColorMap[e] = PALETTE[_paletteIdx % PALETTE.length]; _paletteIdx++; }
  return _entityColorMap[e];
}
function eCb(e) { return eC(e) + '18'; }

// ══════════════════════════════════════════════════════
// ÉTAT GLOBAL
// ══════════════════════════════════════════════════════
const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
let settings       = { urgentDays: 7, warnDays: 30, showPast: true, soundEnabled: true };
let csvData        = [];  // Données importées via CSV
let customDL       = [];  // Échéances ajoutées manuellement
let ALL            = [];  // Toutes les données combinées
let transmittedSet = new Set();
let notifEmails    = [];
let notifications  = [];
let tblFilter = 'all', sortKey = 'deadline', sortDir = 1, selDL = null;
let currentUser  = null;
let _currentPage = 'dashboard';

// ══════════════════════════════════════════════════════
// FIREBASE — AUTHENTIFICATION
// ══════════════════════════════════════════════════════
window.addEventListener('firebase-ready', () => {
  window._firebaseOnAuthStateChanged(window._firebaseAuth, async (user) => {
    if (user) {
      currentUser = user;
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app-screen').style.display   = '';
      await loadUserData();
      buildData();
      updateKPIs();
      renderDash();
      renderSettings();
      scheduleAlertCheck();
    } else {
      currentUser = null;
      document.getElementById('login-screen').style.display = '';
      document.getElementById('app-screen').style.display   = 'none';
    }
  });
});

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pwd   = document.getElementById('login-password').value;
  const btn   = document.getElementById('btn-login');
  if (!email || !pwd) { showLoginError('Veuillez remplir tous les champs.'); return; }
  btn.textContent = 'Connexion…'; btn.disabled = true;
  try {
    await window._firebaseSignIn(window._firebaseAuth, email, pwd);
  } catch (err) {
    btn.textContent = 'Se connecter'; btn.disabled = false;
    const msgs = {
      'auth/user-not-found':'Aucun compte avec cet email.',
      'auth/wrong-password':'Mot de passe incorrect.',
      'auth/invalid-email':'Adresse email invalide.',
      'auth/too-many-requests':'Trop de tentatives. Réessayez plus tard.',
      'auth/invalid-credential':'Email ou mot de passe incorrect.'
    };
    showLoginError(msgs[err.code] || 'Erreur : ' + err.message);
  }
}
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg; el.style.display = '';
}
async function doLogout() { await window._firebaseSignOut(window._firebaseAuth); }
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') doLogin();
});

// ══════════════════════════════════════════════════════
// FIRESTORE — CHARGEMENT & SAUVEGARDE
// ══════════════════════════════════════════════════════
async function loadUserData() {
  if (!currentUser) return;
  const db = window._firebaseDb, uid = currentUser.uid;
  try {
    const sDoc = await window._firestoreGetDoc(window._firestoreDoc(db, 'users', uid, 'data', 'settings'));
    if (sDoc.exists()) {
      const d = sDoc.data();
      if (d.settings)    settings    = { ...settings, ...d.settings };
      if (d.customDL)    customDL    = d.customDL;
      if (d.notifEmails) notifEmails = d.notifEmails;
      if (d.csvData)     csvData     = d.csvData;
    }
    const tDoc = await window._firestoreGetDoc(window._firestoreDoc(db, 'users', uid, 'data', 'transmitted'));
    if (tDoc.exists() && tDoc.data().ids) transmittedSet = new Set(tDoc.data().ids);
    const nDoc = await window._firestoreGetDoc(window._firestoreDoc(db, 'users', uid, 'data', 'notifications'));
    if (nDoc.exists() && nDoc.data().list) notifications = nDoc.data().list;
  } catch (err) { console.warn('Erreur chargement Firestore:', err); }
}

async function saveToFirestore() {
  if (!currentUser) return;
  try {
    await window._firestoreSetDoc(
      window._firestoreDoc(window._firebaseDb, 'users', currentUser.uid, 'data', 'settings'),
      { settings, customDL, notifEmails, csvData }, { merge: true }
    );
  } catch (err) { console.warn('Erreur sauvegarde:', err); }
}
async function saveTransmitted() {
  if (!currentUser) return;
  try {
    await window._firestoreSetDoc(
      window._firestoreDoc(window._firebaseDb, 'users', currentUser.uid, 'data', 'transmitted'),
      { ids: [...transmittedSet] }
    );
  } catch (err) { console.warn('Erreur save transmitted:', err); }
}
async function saveNotifications() {
  if (!currentUser) return;
  try {
    await window._firestoreSetDoc(
      window._firestoreDoc(window._firebaseDb, 'users', currentUser.uid, 'data', 'notifications'),
      { list: notifications.slice(0, 100) }
    );
  } catch (err) { console.warn('Erreur save notifs:', err); }
}

// ══════════════════════════════════════════════════════
// IMPORT CSV
// ══════════════════════════════════════════════════════
/*
  FORMAT CSV ATTENDU (séparateur ; ou , détecté automatiquement)
  ─────────────────────────────────────────────────────────────
  Nature du document ; Date d'arrêté ; Date limite ; Périodicité ; Entité
  États de synthèse  ; 2025-01-31   ; 2025-02-28  ; Mensuelle   ; COMPTA
  ─────────────────────────────────────────────────────────────
  • Ligne 1 = en-tête (ignorée)
  • Formats date : YYYY-MM-DD | DD/MM/YYYY | DD-MM-YYYY
  • Colonnes obligatoires : Nature du document + Date limite
  • AUTO-TRANSMIS : toute date limite dépassée est marquée ✅ Transmis
*/

function triggerCSVUpload() {
  document.getElementById('csv-file-input').click();
}

function onCSVFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => processCSV(e.target.result, file.name);
  reader.onerror = () => showCsvStatus('error', '❌ Impossible de lire le fichier.');
  reader.readAsText(file, 'UTF-8');
  event.target.value = '';
}

function processCSV(text, filename) {
  showCsvStatus('loading', '⏳ Analyse du fichier en cours…');

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    showCsvStatus('error', '❌ Fichier vide ou sans données.');
    return;
  }

  // Détecter séparateur
  const sep = (lines[0].split(';').length >= lines[0].split(',').length) ? ';' : ',';

  // Normaliser les en-têtes (sans accents, minuscules)
  function stripAccents(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  const headers = lines[0].split(sep).map(h => stripAccents(h.trim().toLowerCase()));

  function colIdx(synonyms) {
    for (const s of synonyms) {
      const idx = headers.findIndex(h => h.includes(s));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  const iTitle    = colIdx(['nature','document','titre','title','libelle','nom du doc','rapport']);
  const iArrete   = colIdx(['arrete','arrete','date arr','date_arr','date d arr','periode arrete','arr']);
  const iDeadline = colIdx(['deadline','limite','echeance','date_l','date limit','date_echeance','dl','fin']);
  const iPeriode  = colIdx(['period','periodi','frequen','regularite','recurrence']);
  const iEntity   = colIdx(['entite','entit','entity','departement','service','direction','dept','pole','pôle']);

  if (iTitle === -1) {
    showCsvStatus('error', '❌ Colonne "Nature du document" introuvable. Vérifiez l\'en-tête de votre CSV.');
    return;
  }
  if (iDeadline === -1) {
    showCsvStatus('error', '❌ Colonne "Date limite" introuvable. Vérifiez l\'en-tête de votre CSV.');
    return;
  }

  const parsed          = [];
  const skipped         = [];
  const autoTransmitted = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCSVLine(lines[i], sep);

    const t  = (cols[iTitle]    || '').trim();
    const a  = iArrete   >= 0 ? normalizeDate(cols[iArrete]   || '') : '';
    const dl = normalizeDate(cols[iDeadline] || '');
    const p  = iPeriode  >= 0 ? (cols[iPeriode]  || '').trim() || 'Non défini' : 'Non défini';
    const e  = iEntity   >= 0 ? (cols[iEntity]   || '').trim().toUpperCase() || 'AUTRE' : 'AUTRE';

    if (!t) { skipped.push('Ligne ' + (i + 1) + ' : titre manquant'); continue; }
    if (!dl || !pDate(dl)) { skipped.push('Ligne ' + (i + 1) + ' : date limite invalide ("' + (cols[iDeadline] || '') + '")'); continue; }

    parsed.push({ t, a: a || '—', dl, p, e });

    // Auto-détection : date passée → transmis
    const dlDate = pDate(dl);
    if (dlDate && dlDate < TODAY) {
      transmittedSet.add(t + '|' + dl);
      autoTransmitted.push(t);
    }
  }

  if (parsed.length === 0) {
    showCsvStatus('error', '❌ Aucune ligne valide. Colonnes détectées : ' + headers.join(' | '));
    return;
  }

  // REMPLACER les données CSV
  csvData = parsed;
  buildData();
  updateKPIs();
  renderCurrentPage();
  renderCsvDataTable();
  saveToFirestore();
  saveTransmitted();

  const urgCount  = parsed.filter(d => { const x=dUntil(pDate(d.dl)); return x!==null && x>=0 && x<=settings.urgentDays; }).length;
  const warnCount = parsed.filter(d => { const x=dUntil(pDate(d.dl)); return x!==null && x>settings.urgentDays && x<=settings.warnDays; }).length;

  let msg = `✅ <strong>${parsed.length} document${parsed.length>1?'s':''}</strong> importé${parsed.length>1?'s':''} depuis <em>${filename}</em>`;
  if (autoTransmitted.length > 0)
    msg += `<br>🕐 <strong>${autoTransmitted.length}</strong> document${autoTransmitted.length>1?'s':''} à date dépassée → marqué${autoTransmitted.length>1?'s':''} automatiquement <span class="transmitted-badge" style="font-size:11px">✅ Transmis</span>`;
  if (urgCount > 0)
    msg += `<br>🔴 <strong>${urgCount}</strong> document${urgCount>1?'s':''} en <strong>alerte urgente</strong> (≤ ${settings.urgentDays} jours)`;
  if (warnCount > 0)
    msg += `<br>🟡 <strong>${warnCount}</strong> document${warnCount>1?'s':''} <strong>proche${warnCount>1?'s':''}</strong> (≤ ${settings.warnDays} jours)`;
  if (skipped.length > 0)
    msg += `<br>⚠️ <strong>${skipped.length}</strong> ligne${skipped.length>1?'s':''} ignorée${skipped.length>1?'s':''} — <span style="font-size:11px;color:var(--text3)">${skipped.slice(0,3).join(' · ')}${skipped.length>3?'…':''}</span>`;

  showCsvStatus('success', msg);
  showToast('✅', parsed.length + ' documents importés avec succès');
  if (urgCount > 0) playNotifSound();
}

// Parser CSV ligne (gère les guillemets)
function parseCSVLine(line, sep) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; }
    else if (line[i] === sep && !inQ) { result.push(cur.trim()); cur = ''; }
    else cur += line[i];
  }
  result.push(cur.trim());
  return result;
}

// Normaliser date → YYYY-MM-DD
function normalizeDate(s) {
  if (!s) return '';
  s = s.trim().replace(/"/g, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY ou DD-MM-YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) return m1[3] + '-' + m1[2].padStart(2,'0') + '-' + m1[1].padStart(2,'0');
  // YYYY/MM/DD
  const m2 = s.match(/^(\d{4})[\/](\d{1,2})[\/](\d{1,2})$/);
  if (m2) return m2[1] + '-' + m2[2].padStart(2,'0') + '-' + m2[3].padStart(2,'0');
  return s;
}

function showCsvStatus(type, html) {
  const el = document.getElementById('csv-status');
  if (!el) return;
  el.style.display = '';
  el.className = 'csv-status csv-status-' + type;
  el.innerHTML = html;
}

function renderCsvDataTable() {
  const wrap  = document.getElementById('csv-data-wrap');
  const empty = document.getElementById('csv-data-empty');
  const count = document.getElementById('csv-data-count');
  const stats = document.getElementById('csv-mini-stats');
  const tbody = document.getElementById('csv-data-tbody');
  if (!wrap) return;

  if (csvData.length === 0) {
    wrap.style.display  = 'none';
    empty.style.display = '';
    if (count) count.textContent = '';
    if (stats) stats.innerHTML   = '';
    return;
  }

  wrap.style.display  = '';
  empty.style.display = 'none';
  if (count) count.textContent = csvData.length + ' document' + (csvData.length > 1 ? 's' : '') + ' importé' + (csvData.length > 1 ? 's' : '');

  const urgCount  = csvData.filter(d => { const x=dUntil(pDate(d.dl)); return x!==null && x>=0 && x<=settings.urgentDays; }).length;
  const warnCount = csvData.filter(d => { const x=dUntil(pDate(d.dl)); return x!==null && x>settings.urgentDays && x<=settings.warnDays; }).length;
  const pastCount = csvData.filter(d => { const x=dUntil(pDate(d.dl)); return x!==null && x<0; }).length;
  const okCount   = csvData.filter(d => { const x=dUntil(pDate(d.dl)); return x!==null && x>settings.warnDays; }).length;

  if (stats) stats.innerHTML = [
    { label:'Total',   val:csvData.length, col:'var(--navy)'   },
    { label:'🔴 Urgents',  val:urgCount,   col:'var(--red)'    },
    { label:'🟡 Proches',  val:warnCount,  col:'var(--orange)' },
    { label:'🟢 À venir',  val:okCount,    col:'var(--green)'  },
    { label:'⚫ Passés (auto-transmis)', val:pastCount, col:'var(--gray)' },
  ].map(s => `<div class="csv-stat-pill" style="border-left:3px solid ${s.col}">
    <span class="csv-stat-val" style="color:${s.col}">${s.val}</span>
    <span class="csv-stat-lbl">${s.label}</span>
  </div>`).join('');

  tbody.innerHTML = csvData.slice(0, 50).map(d => {
    const key  = d.t + '|' + d.dl;
    const dlD  = pDate(d.dl);
    const days = dUntil(dlD);
    const st   = getSt(days);
    const isTrans = transmittedSet.has(key);
    return `<tr style="${isTrans?'opacity:0.55':''}">
      <td><span class="status-dot ${st}"></span>${isTrans?' <span style="font-size:10px;color:var(--green)">✅</span>':''}</td>
      <td class="td-title">${d.t}</td>
      <td><span class="entity-pill" style="color:${eC(d.e)};background:${eCb(d.e)}">${d.e}</span></td>
      <td style="font-size:12px;color:var(--text3)">${d.p}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${fmtS(d.a)}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600">${fmtS(d.dl)}</td>
      <td><span class="badge ${st}">${dLabel(days,st)}</span></td>
    </tr>`;
  }).join('') + (csvData.length > 50 ? `<tr><td colspan="7" style="text-align:center;color:var(--text3);font-size:12px;padding:12px">… et ${csvData.length - 50} autres documents</td></tr>` : '');
}

async function clearCsvData() {
  if (!confirm('Supprimer toutes les données importées via CSV ?\nLes échéances ajoutées manuellement seront conservées.')) return;
  csvData = [];
  // Ne garder que les transmis des docs manuels
  transmittedSet = new Set([...transmittedSet].filter(k => customDL.some(d => (d.t+'|'+d.dl) === k)));
  buildData(); updateKPIs(); renderCurrentPage(); renderCsvDataTable();
  await saveToFirestore(); await saveTransmitted();
  showToast('🗑️', 'Données CSV supprimées');
}

// Télécharger un modèle CSV vide
function downloadCSVTemplate() {
  const template = `Nature du document;Date d'arrêté;Date limite;Périodicité;Entité
États de synthèse PCB révisé;2025-01-31;2025-02-28;Mensuelle;COMPTA
Rapport trimestriel de gestion;2025-03-31;2025-04-30;Trimestrielle;CONTRÔLE DE GESTION
Rapport semestriel contrôle interne;2025-06-30;2025-08-31;Semestrielle;AUDIT`;
  const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'modele_regalert.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('📥', 'Modèle CSV téléchargé');
}

// ══════════════════════════════════════════════════════
// DONNÉES — CONSTRUCTION
// ══════════════════════════════════════════════════════
function pDate(s) {
  if (!s || s === 'Quotidien' || s === 'Hebdomadaire' || s === '—') return null;
  const d = new Date(s); d.setHours(0,0,0,0);
  return isNaN(d) ? null : d;
}
function dUntil(d)    { return d ? Math.round((d - TODAY) / 86400000) : null; }
function fmtD(s)      { const d=pDate(s); if(!d)return s||'—'; return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'}); }
function fmtS(s)      { const d=pDate(s); if(!d)return s||'—'; return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'}); }
function getSt(days)  { if(days===null)return'ok'; if(days<0)return'past'; if(days<=settings.urgentDays)return'urgent'; if(days<=settings.warnDays)return'warn'; return'ok'; }
function dLabel(days,st) { if(days===null)return'Récurrent'; if(days<0)return Math.abs(days)+' j de retard'; if(days===0)return"Aujourd'hui !"; return'Dans '+days+' jour'+(days>1?'s':''); }

function buildData() {
  const raw = [...csvData, ...customDL];
  ALL = raw.map((d, i) => {
    const dlD        = pDate(d.dl);
    const days       = dUntil(dlD);
    const key        = d.t + '|' + d.dl;
    const transmitted = transmittedSet.has(key);
    // Un document transmis est toujours affiché comme "past" (traité)
    // Il sort ainsi automatiquement des cases Urgents et Proches
    const st = transmitted ? 'past' : getSt(days);
    return { id:i, key, title:d.t, arrete:d.a||'—', deadline:d.dl, period:d.p, entity:d.e, dlD, days, st, custom:i>=csvData.length, transmitted };
  }).sort((a,b) => { if(a.dlD&&b.dlD)return a.dlD-b.dlD; if(a.dlD)return-1; if(b.dlD)return 1; return 0; });
}

// ══════════════════════════════════════════════════════
// BOUTON TRANSMIS
// ══════════════════════════════════════════════════════
async function markTransmittedById(docKey) {
  transmittedSet.add(docKey);
  buildData(); updateKPIs(); renderCurrentPage();
  await saveTransmitted();
  notifications = notifications.filter(n => n.docKey !== docKey);
  updateBellBadge(); await saveNotifications();
  showToast('✅', 'Document marqué comme transmis');
}
function markTransmitted() {
  if (!selDL) return;
  markTransmittedById(selDL.key);
  document.getElementById('dm-transmitted-status').style.display = '';
  document.getElementById('dm-btn-transmitted').style.display    = 'none';
}
function transmitBtn(d, small=false) {
  if (d.transmitted) return `<span class="transmitted-badge">✅ Transmis</span>`;
  const escapedKey = d.key.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  return `<button class="btn-transmit${small?' btn-transmit-sm':''}" onclick="event.stopPropagation();markTransmittedById('${escapedKey}')" title="Marquer comme transmis">✅ Transmis</button>`;
}

// ══════════════════════════════════════════════════════
// ALERTES & NOTIFICATIONS
// ══════════════════════════════════════════════════════
function playNotifSound() {
  if (!settings.soundEnabled) return;
  try {
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.connect(gain);gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880,ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440,ctx.currentTime+0.3);
    gain.gain.setValueAtTime(0.3,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.5);
    osc.start(ctx.currentTime);osc.stop(ctx.currentTime+0.5);
  } catch(e) {}
}
function scheduleAlertCheck() {
  checkAndTriggerAlerts();
  setInterval(() => { const n=new Date(); if(n.getUTCHours()===7&&n.getUTCMinutes()<5)checkAndTriggerAlerts(); }, 5*60*1000);
}
function checkAndTriggerAlerts() {
  const urgentDocs = ALL.filter(d => !d.transmitted && d.days!==null && d.days>=0 && d.days<=7);
  urgentDocs.forEach(d => {
    const notifKey = d.key+'|'+new Date().toDateString();
    if (!notifications.some(n => n.key===notifKey)) addInAppNotif(d, notifKey);
  });
  if (urgentDocs.length > 0) { playNotifSound(); sendBrowserPushNotif(urgentDocs); sendEmailAlerts(urgentDocs); }
}
function addInAppNotif(doc, key) {
  notifications.unshift({key,docKey:doc.key,docId:doc.id,title:doc.title,entity:doc.entity,days:doc.days,deadline:doc.deadline,time:new Date().toISOString(),read:false});
  updateBellBadge(); saveNotifications();
}
function updateBellBadge() {
  const unread=notifications.filter(n=>!n.read).length;
  const badge=document.getElementById('notif-badge'),btn=document.getElementById('notif-bell-btn');
  if(!badge)return;
  if(unread>0){badge.textContent=unread>99?'99+':unread;badge.style.display='';btn.classList.add('has-notif');}
  else{badge.style.display='none';btn.classList.remove('has-notif');}
}
function toggleNotifPanel() {
  const panel=document.getElementById('notif-panel');
  const isOpen=panel.style.display!=='none';
  panel.style.display=isOpen?'none':'';
  if(!isOpen){renderNotifPanel();notifications.forEach(n=>n.read=true);updateBellBadge();saveNotifications();}
}
function renderNotifPanel() {
  const list=document.getElementById('notif-list');
  if(notifications.length===0){list.innerHTML='<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">Aucune notification</div>';return;}
  list.innerHTML=notifications.slice(0,20).map(n=>{
    const isTrans=transmittedSet.has(n.docKey);
    const daysLabel=n.days===0?"Aujourd'hui !":n.days===1?'Demain':`Dans ${n.days} j`;
    const timeStr=new Date(n.time).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    const escapedKey=n.docKey.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return`<div class="notif-item ${isTrans?'notif-transmitted':''}" onclick="openDetail(${n.docId});toggleNotifPanel()">
      <div class="notif-item-icon">${isTrans?'✅':n.days===0?'🚨':'⚠️'}</div>
      <div class="notif-item-body">
        <div class="notif-item-title">${n.title}</div>
        <div class="notif-item-meta">${n.entity} · ${daysLabel} · ${fmtS(n.deadline)}</div>
        <div class="notif-item-time">${timeStr}</div>
        ${!isTrans?`<button class="notif-transmit-btn" onclick="event.stopPropagation();markTransmittedById('${escapedKey}')">✅ Marquer transmis</button>`:'<span class="notif-done-tag">Transmis</span>'}
      </div>
    </div>`;
  }).join('');
}
async function clearAllNotifs(){notifications=[];updateBellBadge();renderNotifPanel();await saveNotifications();}
function sendBrowserPushNotif(docs){
  if(Notification.permission!=='granted')return;
  const body=docs.length===1?`${docs[0].title} — ${dLabel(docs[0].days,docs[0].st)}`:`${docs.length} échéances urgentes`;
  new Notification('🔔 RégAlert — Échéances urgentes',{body,icon:'assets/icon-192.png'});
}
async function requestPushPermission(btn){
  if(!('Notification'in window)){showToast('⚠️','Notifications non supportées');return;}
  const perm=await Notification.requestPermission();
  if(perm==='granted'){btn.textContent='Activé ✓';btn.className='toggle-opt on';showToast('✅','Notifications push activées');}
  else showToast('⚠️','Permission refusée');
}
// ══════════════════════════════════════════════════════
// ENVOI EMAIL — stub (sera remplacé par Cloud Functions)
// ══════════════════════════════════════════════════════
// Les emails seront envoyés via Firebase Cloud Functions
// une fois le plan Blaze activé. En attendant, les alertes
// sont visibles dans la cloche de notification.
function sendEmailAlerts(docs) {
  if (notifEmails.length === 0) return;
  // Cloud Functions prendra le relais ici
  console.log('[RégAlert] Destinataires configurés:', notifEmails.join(', '));
  console.log('[RégAlert] Documents à alerter:', docs.map(d => d.title).join(', '));
}

// ══════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════
function goPage(id,btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.main-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  btn.classList.add('active');_currentPage=id;renderPage(id);
  document.getElementById('notif-panel').style.display='none';
}
function renderCurrentPage(){renderPage(_currentPage);}
function renderPage(id){
  const map={dashboard:'renderDash',urgents:'renderUrgents',proches:'renderProches',tous:'renderTable',calendrier:'renderTimeline',entites:'renderEntities',analyse:'renderAnalyse',parametres:'renderSettings'};
  if(map[id])window[map[id]]();
}

// ══════════════════════════════════════════════════════
// KPIs
// ══════════════════════════════════════════════════════
function updateKPIs(){
  const urg=ALL.filter(d=>d.st==='urgent').length,wrn=ALL.filter(d=>d.st==='warn').length,
        ok=ALL.filter(d=>d.st==='ok').length,pst=ALL.filter(d=>d.st==='past').length;
  document.getElementById('kpi-urgent').textContent=urg;
  document.getElementById('kpi-warn').textContent=wrn;
  document.getElementById('kpi-ok').textContent=ok;
  document.getElementById('kpi-past').textContent=pst;
  document.getElementById('kpi-total').textContent=ALL.length;
  document.getElementById('tb-dash').textContent=urg>0?urg+' urgent'+(urg>1?'s':''):'OK';
  document.getElementById('tb-urg').textContent=urg;
  document.getElementById('tb-warn').textContent=wrn;
  document.getElementById('tb-all').textContent=ALL.length;
  const zone=document.getElementById('alert-zone');
  let html='';
  if(ALL.length===0){
    zone.innerHTML=`<div class="alert alert-info"><div class="alert-ico">📂</div><div class="alert-body"><h4>Aucune donnée — Importez votre fichier CSV</h4><p>Rendez-vous dans <strong>⚙️ Paramètres</strong> → <strong>📂 Import CSV</strong> pour charger vos documents réglementaires.</p></div></div>`;
    return;
  }
  if(urg>0){const names=ALL.filter(d=>d.st==='urgent'&&!d.transmitted).slice(0,3).map(d=>'<strong>'+d.title+'</strong> → '+fmtS(d.deadline)+' ('+(d.days===0?"aujourd'hui":d.days+' j')+')').join('<br>');html+=`<div class="alert alert-urgent"><div class="alert-ico">🚨</div><div class="alert-body"><h4>${urg} échéance${urg>1?'s':''} URGENTE${urg>1?'S':''}</h4><p>${names}${urg>3?'<br>+ '+(urg-3)+' autre(s)…':''}</p></div></div>`;}
  if(wrn>0){const names=ALL.filter(d=>d.st==='warn'&&!d.transmitted).slice(0,2).map(d=>'<strong>'+d.title+'</strong> → '+fmtS(d.deadline)+' ('+d.days+' j)').join('<br>');html+=`<div class="alert alert-warn"><div class="alert-ico">⚠️</div><div class="alert-body"><h4>${wrn} échéance${wrn>1?'s':''} proche${wrn>1?'s':''}</h4><p>${names}${wrn>2?'<br>+ '+(wrn-2)+' autre(s)…':''}</p></div></div>`;}
  zone.innerHTML=html;
}

// ══════════════════════════════════════════════════════
// CARTES
// ══════════════════════════════════════════════════════
function makeCard(d){
  const dl=dLabel(d.days,d.st);
  return`<div class="deadline-card${d.transmitted?' card-transmitted':''}" onclick="openDetail(${d.id})">
    <div class="card-top-bar ${d.st}"></div>
    <div class="card-body">
      <div class="card-entity-row">
        <span class="entity-pill" style="color:${eC(d.entity)};background:${eCb(d.entity)}">${d.entity}</span>
        <span class="period-pill">${d.period}</span>
        ${d.transmitted?'<span class="card-transmitted-tag">✅ Transmis</span>':''}
      </div>
      <div class="card-title">${d.title}</div>
      <div class="card-dates">
        <div class="date-block"><div class="date-lbl">Date d'arrêté</div><div class="date-val">${fmtS(d.arrete)}</div></div>
        <div class="date-block"><div class="date-lbl">Date limite</div><div class="date-val">${fmtS(d.deadline)}</div></div>
      </div>
      <div class="card-footer-bar">
        <div class="countdown ${d.st}">${d.st==='urgent'?'🔴':d.st==='warn'?'🟡':d.st==='ok'?'🟢':'⚫'} ${dl}</div>
        ${transmitBtn(d)}
      </div>
    </div>
  </div>`;
}
function emptyState(msg=''){
  return`<div class="empty" style="grid-column:1/-1"><div class="e-ico">📂</div><h3>Aucune donnée importée</h3><p>${msg||'Importez un fichier CSV depuis <strong>⚙️ Paramètres</strong>.'}</p></div>`;
}
function renderDash(){
  updateKPIs();
  const up=ALL.filter(d=>d.days!==null&&d.days>=0&&d.days<=30);
  const el=document.getElementById('dash-cards');
  if(ALL.length===0){el.innerHTML=emptyState();return;}
  el.innerHTML=up.length===0?'<div class="empty" style="grid-column:1/-1"><div class="e-ico">🎉</div><h3>Aucune échéance dans les 30 prochains jours</h3></div>':up.map(makeCard).join('');
}
function renderUrgents(){
  const data=ALL.filter(d=>d.st==='urgent');
  const el=document.getElementById('urgent-cards'),emp=document.getElementById('urgent-empty');
  if(data.length===0){el.innerHTML=ALL.length===0?emptyState():'';emp.style.display=ALL.length===0?'none':'';}
  else{emp.style.display='none';el.innerHTML=data.map(makeCard).join('');}
}
function renderProches(){
  const data=ALL.filter(d=>d.st==='warn');
  const el=document.getElementById('proches-cards'),emp=document.getElementById('proches-empty');
  if(data.length===0){el.innerHTML=ALL.length===0?emptyState():'';emp.style.display=ALL.length===0?'none':'';}
  else{emp.style.display='none';el.innerHTML=data.map(makeCard).join('');}
}

// ══════════════════════════════════════════════════════
// TABLEAU
// ══════════════════════════════════════════════════════
function renderTable(){
  const q=(document.getElementById('tbl-search')?.value||'').toLowerCase();
  const stMap={urgent:0,warn:1,ok:2,past:3};
  let data=ALL.filter(d=>{
    const matchQ=!q||d.title.toLowerCase().includes(q)||d.entity.toLowerCase().includes(q);
    const matchF=tblFilter==='all'?true:tblFilter==='transmitted'?d.transmitted:d.st===tblFilter;
    return matchQ&&matchF;
  });
  data.sort((a,b)=>{
    let va,vb;
    if(sortKey==='status'){va=stMap[a.st]??9;vb=stMap[b.st]??9;}
    else if(sortKey==='title'){va=a.title;vb=b.title;}
    else if(sortKey==='entity'){va=a.entity;vb=b.entity;}
    else if(sortKey==='period'){va=a.period;vb=b.period;}
    else if(sortKey==='arrete'){va=a.arrete;vb=b.arrete;}
    else if(sortKey==='deadline'){va=a.dlD||new Date(0);vb=b.dlD||new Date(0);}
    else if(sortKey==='days'){va=a.days??9999;vb=b.days??9999;}
    else return 0;
    return(typeof va==='string'?va.localeCompare(vb):va-vb)*sortDir;
  });
  document.getElementById('tbl-count').textContent=data.length+' document'+(data.length>1?'s':'');
  document.getElementById('tbl-body').innerHTML=ALL.length===0
    ?`<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text3)">📂 Aucune donnée — Importez un CSV dans <strong>Paramètres</strong></td></tr>`
    :data.map(d=>`<tr onclick="openDetail(${d.id})" style="cursor:pointer${d.transmitted?';opacity:0.65':''}">
        <td><span class="status-dot ${d.st}"></span>${d.transmitted?' <span style="font-size:10px;color:var(--green)">✅</span>':''}</td>
        <td class="td-title">${d.title}</td>
        <td><span class="entity-pill" style="color:${eC(d.entity)};background:${eCb(d.entity)}">${d.entity}</span></td>
        <td style="font-size:12px;color:var(--text3)">${d.period}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${fmtS(d.arrete)}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600">${fmtS(d.deadline)}</td>
        <td><span class="badge ${d.st}">${dLabel(d.days,d.st)}</span></td>
        <td onclick="event.stopPropagation()">${transmitBtn(d,true)}</td>
      </tr>`).join('');
}
function setTableFilter(f,btn){tblFilter=f;document.querySelectorAll('.filter-chip').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderTable();}
function sortTable(key){if(sortKey===key)sortDir*=-1;else{sortKey=key;sortDir=1;}renderTable();}

// ══════════════════════════════════════════════════════
// CALENDRIER
// ══════════════════════════════════════════════════════
function renderTimeline(){
  const MOIS=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const months={};
  ALL.filter(d=>d.dlD).forEach(d=>{const k=d.dlD.getFullYear()+'-'+String(d.dlD.getMonth()).padStart(2,'0');if(!months[k])months[k]=[];months[k].push(d);});
  document.getElementById('timeline-wrap').innerHTML=ALL.length===0
    ?'<div class="empty"><div class="e-ico">📂</div><h3>Aucune donnée importée</h3><p>Importez un CSV dans Paramètres.</p></div>'
    :Object.keys(months).sort().map(k=>{
      const[y,m]=k.split('-');const items=months[k].sort((a,b)=>a.dlD-b.dlD);
      return`<div class="timeline-month"><div class="timeline-month-header">${MOIS[parseInt(m)]} ${y} <span style="font-size:12px;opacity:0.7">(${items.length})</span></div>
      <table class="data-table"><thead><tr><th>Statut</th><th>Document</th><th>Entité</th><th>Date limite</th><th>Délai</th><th>Action</th></tr></thead><tbody>
      ${items.map(d=>`<tr onclick="openDetail(${d.id})" style="cursor:pointer${d.transmitted?';opacity:0.65':''}">
        <td><span class="status-dot ${d.st}"></span></td><td class="td-title">${d.title}</td>
        <td><span class="entity-pill" style="color:${eC(d.entity)};background:${eCb(d.entity)}">${d.entity}</span></td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${fmtS(d.deadline)}</td>
        <td><span class="badge ${d.st}">${dLabel(d.days,d.st)}</span></td>
        <td onclick="event.stopPropagation()">${transmitBtn(d,true)}</td>
      </tr>`).join('')}</tbody></table></div>`;
    }).join('');
}

// ══════════════════════════════════════════════════════
// ENTITÉS
// ══════════════════════════════════════════════════════
function renderEntities(){
  if(ALL.length===0){document.getElementById('entity-grid').innerHTML='<div class="empty" style="grid-column:1/-1"><div class="e-ico">📂</div><h3>Aucune donnée importée</h3></div>';return;}
  const ents={};
  ALL.forEach(d=>{if(!ents[d.entity])ents[d.entity]={urgent:0,warn:0,ok:0,past:0,items:[]};ents[d.entity][d.st]++;ents[d.entity].items.push(d);});
  document.getElementById('entity-grid').innerHTML=Object.entries(ents).sort((a,b)=>(b[1].urgent*10+b[1].warn)-(a[1].urgent*10+a[1].warn)).map(([en,data])=>{
    const nxt=data.items.filter(d=>d.days!==null&&d.days>=0&&!d.transmitted).sort((a,b)=>a.days-b.days)[0];
    const tot=data.items.length,done=data.past,pct=tot>0?Math.round(done/tot*100):0;
    return`<div class="entity-card" onclick="showEntityDetail('${en.replace(/'/g,"\\'")}')">
      <div class="entity-card-head"><div class="entity-card-name"><span class="entity-color-dot" style="background:${eC(en)}"></span>${en}</div>
      <div class="entity-card-counts">${data.urgent?`<span class="badge urgent">${data.urgent} urgent${data.urgent>1?'s':''}</span>`:''}${data.warn?`<span class="badge warn">${data.warn} proche${data.warn>1?'s':''}</span>`:''}${data.ok?`<span class="badge ok">${data.ok} à venir</span>`:''}</div></div>
      <div class="entity-card-body"><div class="entity-next">${nxt?`Prochaine : <strong>${nxt.title}</strong> — ${fmtS(nxt.deadline)} (${nxt.days} j)`:'Aucune échéance à venir'}</div>
      <div style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace">${tot} échéances · ${done} passées (${pct}%)</div>
      <div class="entity-progress"><div class="entity-progress-fill" style="width:${pct}%;background:${eC(en)}"></div></div></div></div>`;
  }).join('');
}
function showEntityDetail(en){
  const items=ALL.filter(d=>d.entity===en).sort((a,b)=>a.dlD&&b.dlD?a.dlD-b.dlD:0);
  const sec=document.getElementById('entity-detail-section');sec.style.display='';
  document.getElementById('entity-detail-header').innerHTML='Toutes les échéances — '+en+' ('+items.length+' total)';
  document.getElementById('entity-detail-body').innerHTML=items.map(d=>`<tr onclick="openDetail(${d.id})" style="cursor:pointer${d.transmitted?';opacity:0.65':''}">
    <td><span class="status-dot ${d.st}"></span>${d.transmitted?' <span style="font-size:10px;color:var(--green)">✅</span>':''}</td>
    <td class="td-title">${d.title}</td><td style="font-size:12px;color:var(--text3)">${d.period}</td>
    <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${fmtS(d.arrete)}</td>
    <td style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600">${fmtS(d.deadline)}</td>
    <td><span class="badge ${d.st}">${dLabel(d.days,d.st)}</span></td>
    <td onclick="event.stopPropagation()">${transmitBtn(d,true)}</td>
  </tr>`).join('');
  sec.scrollIntoView({behavior:'smooth',block:'start'});
}

// ══════════════════════════════════════════════════════
// ANALYSE
// ══════════════════════════════════════════════════════
function renderAnalyse(){
  const group=document.getElementById('an-group')?.value||'periode';
  const filterEnt=document.getElementById('an-entity')?.value||'';
  const filterYear=document.getElementById('an-year')?.value||'';
  const filterPer=document.getElementById('an-period')?.value||'';
  let data=ALL.filter(d=>{const dlYear=d.dlD?d.dlD.getFullYear().toString():'';return(!filterEnt||d.entity===filterEnt)&&(!filterYear||dlYear===filterYear)&&(!filterPer||d.period===filterPer);});
  const urg=data.filter(d=>d.st==='urgent').length,wrn=data.filter(d=>d.st==='warn').length,ok=data.filter(d=>d.st==='ok').length,pst=data.filter(d=>d.st==='past').length;
  document.getElementById('an-summary-strip').innerHTML=[{label:'Total filtré',val:data.length,col:'var(--navy)'},{label:'Urgents',val:urg,col:'var(--red)'},{label:'Proches',val:wrn,col:'var(--orange)'},{label:'À venir',val:ok,col:'var(--green)'},{label:'Passés',val:pst,col:'var(--gray)'}].map(s=>`<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:18px 20px;box-shadow:var(--shadow)"><div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text3);font-family:'JetBrains Mono',monospace;margin-bottom:8px">${s.label}</div><div style="font-size:36px;font-weight:800;color:${s.col};line-height:1;letter-spacing:-2px">${s.val}</div></div>`).join('');
  const MONTHS_FR=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  function getKey(d){if(group==='entite')return d.entity;if(group==='annee')return d.dlD?d.dlD.getFullYear().toString():'Sans date';if(group==='mois')return d.dlD?MONTHS_FR[d.dlD.getMonth()]+' '+d.dlD.getFullYear():'Sans date';if(group==='statut'){const labels={urgent:'🔴 Urgents',warn:'🟡 Proches',ok:'🟢 À venir',past:'⚫ Passés'};return labels[d.st]||d.st;}return d.period;}
  const groups={};data.forEach(d=>{const k=getKey(d);if(!groups[k])groups[k]=[];groups[k].push(d);});
  const sortedKeys=Object.keys(groups).sort((a,b)=>{if(group==='annee')return parseInt(a)-parseInt(b);if(group==='mois'){const[ma,ya]=a.split(' ');const[mb,yb]=b.split(' ');const yi=parseInt(ya)-parseInt(yb);if(yi!==0)return yi;return MONTHS_FR.indexOf(ma)-MONTHS_FR.indexOf(mb);}if(group==='statut'){const o={'🔴 Urgents':0,'🟡 Proches':1,'🟢 À venir':2,'⚫ Passés':3};return(o[a]??9)-(o[b]??9);}return groups[b].length-groups[a].length;});
  const maxCount=Math.max(...sortedKeys.map(k=>groups[k].length),1);
  const titleMap={periode:'Répartition par périodicité',entite:'Répartition par entité',annee:'Répartition par année',mois:'Répartition par mois',statut:'Répartition par statut'};
  document.getElementById('an-chart-title').textContent=titleMap[group]||'Répartition';
  document.getElementById('an-chart').innerHTML=sortedKeys.map(k=>{const cnt=groups[k].length,pct=Math.round(cnt/maxCount*100);const col=group==='entite'?eC(k):group==='statut'?(k.includes('🔴')?'var(--red)':k.includes('🟡')?'var(--orange)':k.includes('🟢')?'var(--green)':'var(--gray)'):'var(--navy)';const urg2=groups[k].filter(d=>d.st==='urgent').length,wrn2=groups[k].filter(d=>d.st==='warn').length;return`<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px"><div style="width:160px;flex-shrink:0;font-size:12px;font-weight:600;color:var(--text);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${k}">${k}</div><div style="flex:1;height:32px;background:var(--gray-lt);border-radius:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${col};border-radius:6px;transition:width 0.5s;opacity:0.85;display:flex;align-items:center;padding-left:10px">${urg2>0?`<span style="font-size:10px;font-weight:700;color:white;background:rgba(217,48,37,0.85);padding:1px 6px;border-radius:3px;margin-right:4px">${urg2} URG</span>`:''}${wrn2>0?`<span style="font-size:10px;font-weight:700;color:white;background:rgba(224,123,42,0.85);padding:1px 6px;border-radius:3px">${wrn2} PROCHE</span>`:''}</div></div><div style="width:50px;flex-shrink:0;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:${col}">${cnt}</div></div>`;}).join('');
  document.getElementById('an-groups-container').innerHTML=sortedKeys.map(k=>{const items=groups[k].sort((a,b)=>a.dlD&&b.dlD?a.dlD-b.dlD:0);const urg2=items.filter(d=>d.st==='urgent').length,wrn2=items.filter(d=>d.st==='warn').length;const headColor=group==='entite'?eC(k):group==='statut'?(k.includes('🔴')?'var(--red)':k.includes('🟡')?'var(--orange)':k.includes('🟢')?'var(--green)':'var(--gray)'):'var(--navy)';return`<div style="background:var(--white);border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:var(--shadow);margin-bottom:20px"><div style="background:${headColor};padding:16px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px"><div style="display:flex;align-items:center;gap:12px"><div style="font-size:16px;font-weight:800;color:white">${k}</div><div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:rgba(255,255,255,0.7)">${items.length} document${items.length>1?'s':''}</div></div><div style="display:flex;gap:8px">${urg2>0?`<span style="background:rgba(255,255,255,0.2);color:white;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">🔴 ${urg2} urgent${urg2>1?'s':''}</span>`:''}${wrn2>0?`<span style="background:rgba(255,255,255,0.2);color:white;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">🟡 ${wrn2} proche${wrn2>1?'s':''}</span>`:''}</div></div><table class="data-table"><thead><tr><th>Statut</th><th>Nature du document</th>${group!=='entite'?'<th>Entité</th>':''}${group!=='periode'?'<th>Périodicité</th>':''}${group!=='annee'&&group!=='mois'?'<th>Date d\'arrêté</th>':''}<th>Date limite</th><th>Délai restant</th><th>Action</th></tr></thead><tbody>${items.map(d=>`<tr onclick="openDetail(${d.id})" style="cursor:pointer${d.transmitted?';opacity:0.65':''}"><td><span class="status-dot ${d.st}"></span></td><td class="td-title">${d.title}</td>${group!=='entite'?`<td><span class="entity-pill" style="color:${eC(d.entity)};background:${eCb(d.entity)}">${d.entity}</span></td>`:''}${group!=='periode'?`<td style="font-size:12px;color:var(--text3)">${d.period}</td>`:''}${group!=='annee'&&group!=='mois'?`<td style="font-family:'JetBrains Mono',monospace;font-size:12px">${fmtS(d.arrete)}</td>`:''}<td style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600">${fmtS(d.deadline)}</td><td><span class="badge ${d.st}">${dLabel(d.days,d.st)}</span></td><td onclick="event.stopPropagation()">${transmitBtn(d,true)}</td></tr>`).join('')}</tbody></table></div>`;}).join('');
}

// ══════════════════════════════════════════════════════
// PARAMÈTRES
// ══════════════════════════════════════════════════════
function renderSettings(){
  document.getElementById('s-urgent').value=settings.urgentDays;
  document.getElementById('s-warn').value=settings.warnDays;
  const btn=document.getElementById('s-show-past');btn.textContent=settings.showPast?'Oui':'Non';btn.className='toggle-opt '+(settings.showPast?'on':'off');
  const snd=document.getElementById('s-sound');snd.textContent=settings.soundEnabled?'Oui':'Non';snd.className='toggle-opt '+(settings.soundEnabled?'on':'off');
  renderCustomList();renderEmailList();renderCsvDataTable();
}
function saveSettings(){settings.urgentDays=parseInt(document.getElementById('s-urgent').value)||7;settings.warnDays=parseInt(document.getElementById('s-warn').value)||30;saveToFirestore();buildData();updateKPIs();showToast('✓','Paramètres sauvegardés');}
function togglePast(btn){settings.showPast=!settings.showPast;btn.textContent=settings.showPast?'Oui':'Non';btn.className='toggle-opt '+(settings.showPast?'on':'off');saveSettings();}
function toggleSound(btn){settings.soundEnabled=!settings.soundEnabled;btn.textContent=settings.soundEnabled?'Oui':'Non';btn.className='toggle-opt '+(settings.soundEnabled?'on':'off');saveToFirestore();if(settings.soundEnabled)playNotifSound();}
function addNotifEmail(){const input=document.getElementById('new-email-input');const email=input.value.trim();if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){showToast('⚠️','Email invalide');return;}if(notifEmails.includes(email)){showToast('⚠️','Email déjà dans la liste');return;}notifEmails.push(email);input.value='';renderEmailList();saveToFirestore();showToast('✅','Email ajouté : '+email);}
function removeNotifEmail(idx){notifEmails.splice(idx,1);renderEmailList();saveToFirestore();}
function renderEmailList(){const el=document.getElementById('email-list');if(!el)return;el.innerHTML=notifEmails.length===0?'<div style="font-size:12px;color:var(--text3);padding:8px 0">Aucun email configuré.</div>':notifEmails.map((em,i)=>`<div class="email-tag"><span>📧 ${em}</span><button onclick="removeNotifEmail(${i})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;padding:0 2px">✕</button></div>`).join('');}
function renderCustomList(){const tbody=document.getElementById('custom-tbody'),emp=document.getElementById('custom-empty');if(customDL.length===0){tbody.innerHTML='';emp.style.display='';return;}emp.style.display='none';tbody.innerHTML=customDL.map((d,i)=>`<tr><td class="td-title">${d.t}</td><td><span class="entity-pill" style="color:${eC(d.e)};background:${eCb(d.e)}">${d.e}</span></td><td style="font-family:'JetBrains Mono',monospace;font-size:12px">${fmtS(d.dl)}</td><td style="font-size:12px;color:var(--text3)">${d.p}</td><td><button class="btn-delete" onclick="delCustom(${i})">Supprimer</button></td></tr>`).join('');}
function delCustom(i){customDL.splice(i,1);saveToFirestore();buildData();updateKPIs();renderCustomList();showToast('🗑️','Échéance supprimée');}

// ══════════════════════════════════════════════════════
// MODALES
// ══════════════════════════════════════════════════════
function openAddModal(){document.getElementById('add-overlay').classList.add('open');}
function addFromModal(){const t=document.getElementById('am-title').value.trim(),dl=document.getElementById('am-deadline').value;if(!t||!dl){showToast('⚠️','Titre et date limite requis');return;}customDL.push({t,a:document.getElementById('am-arrete').value||'—',dl,p:document.getElementById('am-period').value,e:document.getElementById('am-entity').value});saveToFirestore();buildData();updateKPIs();closeOverlay('add-overlay');document.getElementById('am-title').value=document.getElementById('am-arrete').value=document.getElementById('am-deadline').value='';showToast('✓','"'+t+'" ajouté');}
function addFromForm(){const t=document.getElementById('f-title').value.trim(),dl=document.getElementById('f-deadline').value;if(!t||!dl){showToast('⚠️','Titre et date limite requis');return;}customDL.push({t,a:document.getElementById('f-arrete').value||'—',dl,p:document.getElementById('f-period').value,e:document.getElementById('f-entity').value});saveToFirestore();buildData();updateKPIs();renderCustomList();document.getElementById('f-title').value=document.getElementById('f-arrete').value=document.getElementById('f-deadline').value='';showToast('✓','"'+t+'" ajouté');}
function openDetail(id){
  const d=ALL.find(x=>x.id===id);if(!d)return;selDL=d;
  document.getElementById('dm-title').textContent=d.title;document.getElementById('dm-entity').textContent=d.entity+' · '+d.period;
  document.getElementById('dm-arrete').textContent=fmtD(d.arrete);document.getElementById('dm-deadline').textContent=fmtD(d.deadline);
  document.getElementById('dm-period').textContent=d.period;document.getElementById('dm-ent').textContent=d.entity;
  const dEl=document.getElementById('dm-days'),lEl=document.getElementById('dm-days-lbl');
  if(d.days===null){dEl.textContent='∞';dEl.className='modal-days-num ok';lEl.textContent='RÉCURRENT';}
  else if(d.days<0){dEl.textContent=Math.abs(d.days);dEl.className='modal-days-num past';lEl.textContent='JOUR'+(Math.abs(d.days)>1?'S':'')+' DE RETARD';}
  else if(d.days===0){dEl.textContent='!';dEl.className='modal-days-num urgent';lEl.textContent="ÉCHÉANCE AUJOURD'HUI";}
  else{dEl.textContent=d.days;dEl.className='modal-days-num '+d.st;lEl.textContent='JOUR'+(d.days>1?'S':'')+' RESTANT'+(d.days>1?'S':'');}
  document.getElementById('dm-transmitted-status').style.display=d.transmitted?'':'none';
  document.getElementById('dm-btn-transmitted').style.display=d.transmitted?'none':'';
  document.getElementById('detail-overlay').classList.add('open');
}
function copyReminderText(){if(!selDL)return;const d=selDL;const txt='RAPPEL RÉGLEMENTAIRE BCEAO\n'+'─'.repeat(45)+'\nDocument   : '+d.title+'\nEntité     : '+d.entity+'\nPériodicité: '+d.period+'\nArrêté au  : '+fmtD(d.arrete)+'\nDate limite: '+fmtD(d.deadline)+'\nSituation  : '+dLabel(d.days,d.st).toUpperCase()+'\n'+'─'.repeat(45)+'\nGénéré par RégAlert — '+new Date().toLocaleDateString('fr-FR');navigator.clipboard.writeText(txt).then(()=>showToast('📋','Rappel copié !'));}
function closeOverlay(id){document.getElementById(id).classList.remove('open');}
function closeIfOuter(e,id){if(e.target.id===id)closeOverlay(id);}
document.addEventListener('click',e=>{const panel=document.getElementById('notif-panel'),bell=document.getElementById('notif-bell-btn');if(panel&&bell&&!panel.contains(e.target)&&!bell.contains(e.target))panel.style.display='none';});

// ══════════════════════════════════════════════════════
// TOAST & HORLOGE
// ══════════════════════════════════════════════════════
let toastTm;
function showToast(ico,msg){document.getElementById('toast-ico').textContent=ico;document.getElementById('toast-msg').textContent=msg;const t=document.getElementById('toast');t.classList.add('show');clearTimeout(toastTm);toastTm=setTimeout(()=>t.classList.remove('show'),3200);}
function updateClock(){const n=new Date(),el=document.getElementById('live-clock');if(el)el.textContent=n.toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})+' · '+n.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});}
updateClock();setInterval(updateClock,15000);
