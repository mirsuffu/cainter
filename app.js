// ============================================================
// CONSTANTS & STATE
// ============================================================
const getStorageKey = () => currentUser ? `jgsuffu_inter_data_${currentUser.uid}` : 'jgsuffu_inter_data';
const SUBJECTS = ['advacc', 'law', 'taxation', 'costing', 'audit', 'fmsm'];
const SUBJECT_LABELS = { advacc: 'Adv. Accounting', law: 'Corporate & Other Laws', taxation: 'Taxation', costing: 'Cost & MA', audit: 'Auditing & Ethics', fmsm: 'FM & SM' };
const MOBILE_SUBJECT_LABELS = { advacc: 'Accounts', law: 'Law', taxation: 'Tax', costing: 'Costing', audit: 'Audit', fmsm: 'FM & SM' };

function getSubjectLabel(id) {
  if (isMobile()) return MOBILE_SUBJECT_LABELS[id] || id;
  return SUBJECT_LABELS[id] || id;
}

function triggerHaptic(duration = 40) {
  if (navigator.vibrate) {
    try { navigator.vibrate(duration); } catch(e) {}
  }
}
const SUBJECT_COLORS = { advacc: '#7B8CDE', law: '#56C596', taxation: '#F4A261', costing: '#E07BAC', audit: '#60B4D8', fmsm: '#A78BFA' };
const EDITOR_PASSWORD = 'JG. SUFFU@2005';
const SCHED_KEYS = ['allDaysExceptSundays', 'sundays'];

let data = {};
let editorUnlocked = false;
let pendingImportFile = null;
let testConfidenceVal = 3;
let currentSection = 'planner';
// Tracks which subject accordions are open by subject id
let openSubjects = new Set();

// ============================================================
// DATA
// ============================================================
function defaultData() {
  // Inline date calc — toDateStr not yet defined at this point
  const now   = new Date();
  const pad   = n => String(n).padStart(2,'0');
  const today = now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  // Exam date: hardcoded to Sept 2026 attempt
  const examD = '2026-09-01';
  return {
    settings: { examDate: examD, plannerStartDate: today, theme: (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark', userName:'' },
    subjects: SUBJECTS.map(id => ({ id, name:SUBJECT_LABELS[id], chapters:[] })),
    planner: [],
    tests: [],
    reminders: [],
    schedules: { allDaysExceptSundays:{slots:[]}, sundays:{slots:[]} }
  };
}


// ============================================================
// FEEDBACK SOUND  (soft mechanical click)
// ============================================================
var _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  return _audioCtx;
}
function playClick(type) {
  // Haptic feedback (mobile, where supported)
  try { if (navigator.vibrate) navigator.vibrate(type==='tick'?8:type==='nav'?4:5); } catch(e){}
  var ctx = getAudioCtx(); if (!ctx) return;
  try {
    var now = ctx.currentTime;
    // Gentle sine-based soft click — not harsh
    function softTone(freq, freq2, dur, vol) {
      var osc = ctx.createOscillator();
      var g   = ctx.createGain();
      var lp  = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2200;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq2, now + dur * 0.6);
      osc.connect(lp); lp.connect(g); g.connect(ctx.destination);
      // Gentle attack + quick decay
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(vol, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.start(now); osc.stop(now + dur);
    }
    if (type === 'tick') {
      // Satisfying soft "thock" — like a good keyboard key
      softTone(420, 180, 0.09, 0.055);
      // Second harmonic for body
      softTone(840, 360, 0.06, 0.025);
    } else if (type === 'star') {
      // Bright but gentle pip
      softTone(680, 480, 0.07, 0.04);
    } else if (type === 'nav') {
      // Subtle low tap
      softTone(300, 200, 0.08, 0.03);
    } else {
      // Generic button — very soft click
      softTone(500, 280, 0.07, 0.038);
    }
  } catch(e) {}
}

// ============================================================
// PLANNER SCROLL DATE INDICATOR
// ============================================================
function initPlannerScrollIndicator() {
  var wrap  = document.getElementById('planner-table-wrap');
  var thumb = document.getElementById('planner-scroll-thumb');
  var label = document.getElementById('planner-scroll-label');
  if (!wrap || !thumb || !label) return;
  var hideTimer;
  function updateThumb() {
    var scrollTop    = wrap.scrollTop;
    var scrollHeight = wrap.scrollHeight - wrap.clientHeight;
    if (scrollHeight <= 0) return;
    var pct = scrollTop / scrollHeight;
    var trackH = wrap.clientHeight;
    var thumbH = Math.max(30, trackH * (wrap.clientHeight / wrap.scrollHeight));
    thumb.style.height = thumbH + 'px';
    thumb.style.top    = (pct * (trackH - thumbH)) + 'px';
    // Find which date row is near top of viewport
    var rows = wrap.querySelectorAll('tr[data-date],div[data-date]');
    var closest = null, closestDist = Infinity;
    rows.forEach(function(r) {
      var top = r.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
      if (top >= 0 && top < closestDist) { closestDist = top; closest = r; }
    });
    if (closest) {
      var d = closest.dataset.date;
      if (d) {
        var parts = d.split('-');
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        label.textContent = parseInt(parts[2]) + ' ' + months[parseInt(parts[1])-1];
        var labelTop = parseFloat(thumb.style.top) + thumbH/2 - 10;
        label.style.top = Math.max(0, labelTop) + 'px';
      }
    }
    thumb.classList.add('visible');
    label.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function() {
      thumb.classList.remove('visible');
      label.classList.remove('visible');
    }, 1500);
  }
  wrap.addEventListener('scroll', updateThumb, { passive: true });
}
// ============================================================
// DATA
// ============================================================
async function loadData() {
  // 1. Always load from localStorage first (instant, works offline)
  try {
    const raw = localStorage.getItem(getStorageKey());
    data = raw ? JSON.parse(raw) : defaultData();
    normalizeData();
  } catch(e) { data = defaultData(); }

  // 2. Try to sync from Firestore if user is logged in
  if (window._fbDb && window._doc && window._getDoc && currentUser) {
    try {
      setConnStatus('syncing');
      const ref  = window._doc(window._fbDb, 'users', currentUser.uid, 'data', 'appdata');
      const snap = await window._getDoc(ref);
      if (snap.exists()) {
        const cloud = snap.data().appdata;
        if (cloud) {
          data = JSON.parse(cloud);
          normalizeData();
          localStorage.setItem(getStorageKey(), JSON.stringify(data)); // cache locally
        }
      }
      setConnStatus('online');
    } catch(e) {
      setConnStatus(navigator.onLine ? 'online' : 'offline');
    }
  }
}

function normalizeData() {
  const def = defaultData();
  if (!data.settings) data.settings = def.settings;
  // Guard individual settings fields so a partial object still works
  if (!data.settings.plannerStartDate) data.settings.plannerStartDate = def.settings.plannerStartDate;
  if (!data.settings.examDate)         data.settings.examDate         = def.settings.examDate;
  if (!data.settings.theme)            data.settings.theme            = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  if (data.settings.userName === undefined) data.settings.userName = '';
  // Auto-fix swapped dates (start >= exam → reset to sane defaults)
  if (data.settings.plannerStartDate >= data.settings.examDate) {
    data.settings.plannerStartDate = def.settings.plannerStartDate;
    data.settings.examDate         = def.settings.examDate;
  }
  // Auto-fix past exam date (exam already passed → reset)
  if (data.settings.examDate < toDateStrSimple(new Date())) {
    data.settings.examDate = def.settings.examDate;
  }
  if (!data.subjects) data.subjects = def.subjects;
  if (!data.planner)  data.planner  = [];
  if (!data.tests)    data.tests    = [];
  if (!data.reminders) data.reminders = [];
  if (!data.schedules) data.schedules = def.schedules;
  SCHED_KEYS.forEach(k => { if (!data.schedules[k]) data.schedules[k] = {slots:[]}; });
}

var _saveTimer = null;
function saveData() {
  // Instant localStorage write
  localStorage.setItem(getStorageKey(), JSON.stringify(data));
  // Debounced Firestore write (800ms)
  if (window._fbDb && window._doc && window._setDoc && currentUser) {
    setConnStatus('syncing');
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      try {
        const ref = window._doc(window._fbDb, 'users', currentUser.uid, 'data', 'appdata');
        await window._setDoc(ref, { appdata: JSON.stringify(data) }, { merge: true });
        setConnStatus('online');
      } catch(e) {
        setConnStatus(navigator.onLine ? 'online' : 'offline');
      }
    }, 800);
  }
}

// DATE UTILS
// ============================================================
function toDateStrSimple(d) { var y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),dy=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+dy; }
function toDateStr(d) { return d.toISOString().split('T')[0]; }
function parseDate(s) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function formatDateShort(s) { return parseDate(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}); }
function getDayName(s) { return parseDate(s).toLocaleDateString('en-IN',{weekday:'long'}); }
function getDayNameShort(s) { return parseDate(s).toLocaleDateString('en-IN',{weekday:'short'}); }
function getDaysBetween(a,b) { const r=[],s=parseDate(a),e=parseDate(b),c=new Date(s); while(c<=e){r.push(toDateStr(c));c.setDate(c.getDate()+1);} return r; }
function daysUntil(s) { const t=new Date();t.setHours(0,0,0,0); return Math.ceil((parseDate(s)-t)/86400000); }
function isSunday(s) { return parseDate(s).getDay()===0; }
function getTodayStr() { return toDateStr(new Date()); }

// ============================================================
// PLANNER UTILS
// ============================================================
function getOrCreatePlannerRow(date) {
  let row = data.planner.find(r=>r.date===date);
  if (!row) { row={date,ticks:{advacc:false,law:false,taxation:false,costing:false,audit:false,fmsm:false},plans:{advacc:'',law:'',taxation:'',costing:'',audit:'',fmsm:''}}; data.planner.push(row); }
  if (!row.plans) row.plans={advacc:'',law:'',taxation:'',costing:'',audit:'',fmsm:''};
  return row;
}
function getAllPlannerDates() {
  const {plannerStartDate,examDate}=data.settings;
  if (!plannerStartDate||!examDate) return [];
  return getDaysBetween(plannerStartDate,examDate);
}

// ============================================================
// THEME
// ============================================================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme',theme);
  const track=document.getElementById('theme-track'), txt=document.getElementById('theme-toggle-text');
  if(track && txt) {
    if(theme==='dark'){track.classList.remove('on');txt.textContent='Dark Mode';}
    else{track.classList.add('on');txt.textContent='Light Mode';}
  }
  data.settings.theme=theme;
}
function toggleTheme() { const t=data.settings.theme==='dark'?'light':'dark'; applyTheme(t); saveData(); }

// ============================================================
// EDITOR MODE
// ============================================================
function setEditorMode(unlocked) {
  editorUnlocked=unlocked;
  const badge=document.getElementById('editor-badge');
  if(unlocked){ badge.className='unlocked'; badge.textContent='🔓 UNLOCKED'; document.body.classList.remove('editor-locked'); showToast('Editor Mode Unlocked ✓','success'); }
  else { badge.className='locked'; badge.textContent='🔒 LOCKED'; document.body.classList.add('editor-locked'); showToast('Editor Mode Locked 🔒','info'); }
  renderSettings();
  renderSchedule(); renderSubjectsInternal();
}
function handleEditorToggle() { editorUnlocked?setEditorMode(false):openEditorModal(); }
function openEditorModal() {
  document.getElementById('editor-modal').classList.add('show');
  document.getElementById('editor-pw-input').value='';
  document.getElementById('editor-pw-error').textContent='';
  setTimeout(()=>document.getElementById('editor-pw-input').focus(),50);
}
function closeEditorModal() { document.getElementById('editor-modal').classList.remove('show'); }
function confirmEditorPassword() {
  const pw=document.getElementById('editor-pw-input').value;
  if(pw===EDITOR_PASSWORD){closeEditorModal();setEditorMode(true);}
  else {
    const inp=document.getElementById('editor-pw-input');
    document.getElementById('editor-pw-error').textContent='Nice try. Wrong password though 🙃';
    inp.classList.add('shake'); setTimeout(()=>inp.classList.remove('shake'),400);
  }
}

// ============================================================
// TOP BAR
// ============================================================
function updateTopBar() {
  const days=daysUntil(data.settings.examDate), el=document.getElementById('days-remaining');
  if(days>0) el.textContent=days+' Days Remaining';
  else if(days===0) el.textContent='Exam Day Today! You\'ve got this 💪';
  else el.textContent='Exam\'s done! Results await 🤞';
  el.style.color=days<=30?'var(--danger)':days<=90?'var(--warning)':'var(--text)';
  document.getElementById('topbar-date').textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  (function(){var un=data.settings&&data.settings.userName,bl=document.getElementById('topbar-brand-name');if(bl)bl.textContent=un||'JG. SUFFU';})();
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg,type='info') {
  const el=document.createElement('div'); el.className='toast'; el.textContent=msg;
  el.style.borderLeftColor=type==='success'?'var(--success)':type==='error'?'var(--danger)':'var(--accent)';
  el.style.borderLeftWidth='3px';
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>{ el.style.animation='toastOut 0.3s ease forwards'; setTimeout(()=>el.remove(),300); },2500);
}

// ============================================================
// NAVIGATION
// ============================================================
function switchSection(id) {
  currentSection=id;
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById(id+'-section').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.section===id));
  document.querySelectorAll('.mobile-tab').forEach(t=>t.classList.toggle('active',t.dataset.section===id));
  if(id==='metrics') renderMetrics();
  if(id==='test') renderTestTable();
  if(id==='reminders') renderReminders();
}

let plannerScrolledToToday = false;
function scrollToToday() {
  var today = getTodayStr();
  var el = document.querySelector('[data-date="' + today + '"]');
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  else showToast('Today is not in planner range 🤔', 'info');
}

// ============================================================
// PLANNER RENDER
// ============================================================
function isMobile() { return window.innerWidth <= 768; }

function renderPlanner() {
  // scroll indicator re-init after render
  setTimeout(initPlannerScrollIndicator, 100);
  const mobile = isMobile();
  const tbody  = document.getElementById('planner-tbody');
  const cards  = document.getElementById('planner-cards');
  const table  = document.getElementById('planner-table');

  // JS owns display — not CSS
  table.style.display = mobile ? 'none' : '';
  cards.style.display = mobile ? 'flex' : 'none';

  tbody.innerHTML = '';
  cards.innerHTML = '';

  const dates   = getAllPlannerDates(), today = getTodayStr();
  const emptyMsg = "Nothing here yet! Set your dates in Settings and let&#39;s get to work &#128197;";

  if (dates.length === 0) {
    if (mobile) {
      cards.innerHTML = '<div id="planner-cards-empty">' + emptyMsg + '</div>';
    } else {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text2);">' + emptyMsg + '</td></tr>';
    }
    return;
  }

  dates.forEach(date => {
    const row     = getOrCreatePlannerRow(date);
    const isSun   = isSunday(date);
    const isToday = date === today;

    if (mobile) {
      // CARD layout
      const card = document.createElement('div');
      card.dataset.date = date; card.className = 'pcard' + (isSun ? ' is-sunday' : '') + (isToday ? ' is-today' : '');

      const hdr = document.createElement('div');
      hdr.className = 'pcard-header';
      const left = document.createElement('div');
      left.style.cssText = 'display:flex;align-items:center;gap:8px;';
      const ds = document.createElement('span'); ds.className = 'pcard-date'; ds.textContent = formatDateShort(date);
      const dy = document.createElement('span'); dy.className = 'pcard-day';  dy.textContent = getDayNameShort(date);
      left.append(ds, dy);

      const bulk = document.createElement('button');
      bulk.className = 'pcard-bulk'; bulk.textContent = 'All ✓';
      bulk.addEventListener('click', () => {
        const allT = SUBJECTS.every(s => row.ticks[s]);
        SUBJECTS.forEach(s => { row.ticks[s] = !allT; });
        saveData(); renderPlanner();
        if (currentSection === 'metrics') renderMetrics();
      });
      hdr.append(left, bulk);
      card.appendChild(hdr);

      SUBJECTS.forEach(subj => {
        const wrap = document.createElement('div');
        wrap.className = 'pcard-subj-row';

        const lbl = document.createElement('span');
        lbl.className = 'pcard-subj-label';
        lbl.textContent = getSubjectLabel(subj);

        const inp = document.createElement('input');
        inp.type = 'text'; inp.className = 'pcard-plan-input';
        inp.value = row.plans[subj] || ''; inp.placeholder = 'Plan…';
        inp.addEventListener('change', () => { row.plans[subj] = inp.value; saveData(); });
        inp.addEventListener('blur',   () => { row.plans[subj] = inp.value; saveData(); });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { row.plans[subj] = inp.value; saveData(); inp.blur(); }
        });

        const tick = document.createElement('button');
        tick.className = 'pcard-tick' + (row.ticks[subj] ? ' ticked' : '');
        tick.textContent = row.ticks[subj] ? '✓' : '';
        tick.addEventListener('click', () => { playClick('tick');
          row.ticks[subj] = !row.ticks[subj]; saveData();
          tick.className = 'pcard-tick' + (row.ticks[subj] ? ' ticked' : '');
          tick.textContent = row.ticks[subj] ? '✓' : '';
          if (currentSection === 'metrics') renderMetrics();
        });

        wrap.append(lbl, inp, tick);
        card.appendChild(wrap);
      });

      cards.appendChild(card);

    } else {
      // TABLE layout (desktop — unchanged)
      const tr = document.createElement('tr');
      tr.dataset.date = date; tr.className = 'planner-row' + (isSun ? ' is-sunday' : '') + (isToday ? ' is-today' : '');

      const dtd   = document.createElement('td'); dtd.className  = 'date-cell'; dtd.textContent  = formatDateShort(date);   tr.appendChild(dtd);
      const daytd = document.createElement('td'); daytd.className = 'day-cell'; daytd.textContent = getDayNameShort(date); tr.appendChild(daytd);

      SUBJECTS.forEach(subj => {
        const td   = document.createElement('td');
        const cell = document.createElement('div'); cell.className = 'subj-cell';

        const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'plan-input';
        inp.value = row.plans[subj] || ''; inp.placeholder = 'Plan…';
        inp.addEventListener('change', () => { row.plans[subj] = inp.value; saveData(); });
        inp.addEventListener('blur',   () => { row.plans[subj] = inp.value; saveData(); });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { row.plans[subj] = inp.value; saveData(); inp.blur(); }
        });

        const btn = document.createElement('button');
        btn.className = 'tick-btn' + (row.ticks[subj] ? ' ticked' : '');
        btn.textContent = row.ticks[subj] ? '✓' : '';
        btn.title = (row.ticks[subj] ? 'Untick' : 'Tick') + ' ' + SUBJECT_LABELS[subj];
        btn.addEventListener('click', () => {
          triggerHaptic(40);
          row.ticks[subj] = !row.ticks[subj]; saveData();
          btn.className = 'tick-btn' + (row.ticks[subj] ? ' ticked' : '');
          btn.textContent = row.ticks[subj] ? '✓' : '';
          if (currentSection === 'metrics') renderMetrics();
        });
        cell.append(inp, btn); td.appendChild(cell); tr.appendChild(td);
      });

      const atd  = document.createElement('td');
      const abtn = document.createElement('button'); abtn.className = 'bulk-btn'; abtn.textContent = 'All ✓';
      abtn.addEventListener('click', () => {
        triggerHaptic(60);
        const allT = SUBJECTS.every(s => row.ticks[s]);
        SUBJECTS.forEach(s => { row.ticks[s] = !allT; }); saveData(); renderPlanner();
        if (currentSection === 'metrics') renderMetrics();
      });
      atd.appendChild(abtn); tr.appendChild(atd);
      tbody.appendChild(tr);
    }
  });

  // Auto-scroll to today on first load
  if (!plannerScrolledToToday) {
    const todayEl = mobile
      ? cards.querySelector('.pcard.is-today')
      : tbody.querySelector('.is-today');
    if (todayEl) {
      setTimeout(() => todayEl.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
      plannerScrolledToToday = true;
    }
  }
}

// ============================================================
// TEST SECTION
// ============================================================
let testEditId = null;
let testEditConfidenceVal = 3;

function renderTestTable() {
  var mobile=isMobile();
  var table=document.getElementById('test-table');
  var cards=document.getElementById('test-cards');
  var tbody=document.getElementById('test-tbody');
  table.style.display=mobile?'none':'';
  cards.style.display=mobile?'flex':'none';
  tbody.innerHTML=''; cards.innerHTML='';
  var empty='No test records yet. Hit + Add Test to log one.';
  if(!data.tests||data.tests.length===0){
    if(mobile)cards.innerHTML='<div id="test-cards-empty">'+empty+'</div>';
    else tbody.innerHTML='<tr><td colspan="8" class="empty-test">'+empty+'</td></tr>';
    return;
  }
  
  // Apply Filters
  const fSubj = document.getElementById('test-filter-subj').value;
  const fType = document.getElementById('test-filter-type').value;
  let filteredTests = data.tests.filter(t => {
    let matchSubj = (fSubj === 'ALL') || (t.subject === fSubj);
    let matchType = (fType === 'ALL') || (t.type === fType);
    return matchSubj && matchType;
  });

  if (filteredTests.length === 0) {
    var noMatch = 'No tests match these filters. Try clearing them.';
    if(mobile)cards.innerHTML='<div id="test-cards-empty">'+noMatch+'</div>';
    else tbody.innerHTML='<tr><td colspan="8" class="empty-test">'+noMatch+'</td></tr>';
    return;
  }

  var sorted=[].concat(filteredTests).sort(function(a,b){return b.date.localeCompare(a.date);});
  const getBadgeHtml = v => {
    const lbl = getRatingLabel(v);
    return `<span class="rating-badge ${lbl}">${lbl.toUpperCase()}</span>`;
  };
  if(mobile){
    sorted.forEach(function(t){
      var subjLabel=t.subject==='all'?'All Subjects':(getSubjectLabel(t.subject));
      var badgeHtml=getBadgeHtml(t.confidence||3);
      var card=document.createElement('div'); card.className='tcard';
      var r1=document.createElement('div'); r1.className='tcard-row1';
      var de=document.createElement('span'); de.className='tcard-date'; de.textContent=formatDateShort(t.date);
      var se=document.createElement('span'); se.className='tcard-subj'; se.textContent=subjLabel;
      var bg=document.createElement('span'); bg.className='test-type-badge test-type-'+t.type; bg.textContent=t.type;
      r1.append(de,se,bg); card.appendChild(r1);
      var r2=document.createElement('div'); r2.className='tcard-row2';
      var co=document.createElement('span'); co.className='tcard-coverage'; co.textContent=t.coverage||'—';
      var sc=document.createElement('span'); sc.className='tcard-score'; sc.textContent=t.score?'🎯 '+t.score:'';
      var st=document.createElement('span'); st.className='tcard-stars'; st.innerHTML=badgeHtml;
      r2.append(co,sc,st); card.appendChild(r2);
      if(t.comment){var cm=document.createElement('div');cm.className='tcard-comment';cm.textContent=t.comment;card.appendChild(cm);}
      var acts=document.createElement('div'); acts.className='tcard-actions';
      var eb=document.createElement('button'); eb.className='tcard-edit'; eb.textContent='✎ Edit';
      var db=document.createElement('button'); db.className='tcard-del';  db.textContent='✕ Delete';
      (function(id){eb.addEventListener('click',function(){openTestEditModal(id);});
       db.addEventListener('click',function(){data.tests=data.tests.filter(function(x){return x.id!==id;});saveData();renderTestTable();});
      })(t.id);
      acts.append(eb,db); card.appendChild(acts);
      cards.appendChild(card);
    });
  } else {
    sorted.forEach(function(t){
      var tr=document.createElement('tr'); tr.className='test-row';
      var badgeHtml=getBadgeHtml(t.confidence||3);
      var subjLabel=t.subject==='all'?'All Subjects':(SUBJECT_LABELS[t.subject]||t.subject);
      tr.innerHTML='<td style="font-family:var(--mono);font-size:12px;">'+formatDateShort(t.date)+'</td>'
        +'<td style="font-weight:600;">'+subjLabel+'</td>'
        +'<td style="font-size:12px;color:var(--text2);">'+( t.coverage||'—')+'</td>'
        +'<td><span class="test-type-badge test-type-'+t.type+'">'+t.type+'</span></td>'
        +'<td class="score-cell">'+(t.score||'—')+'</td>'
        +'<td>'+badgeHtml+'</td>'
        +'<td class="comment-cell" title="'+(t.comment||'').replace(/"/g,'&quot;')+'">'+(t.comment||'—')+'</td>'
        +'<td style="display:flex;gap:6px;align-items:center;">'
        +'<span class="test-edit-btn" data-id="'+t.id+'" title="Edit" style="color:var(--accent);opacity:0;cursor:pointer;font-size:13px;">✎</span>'
        +'<span class="test-del" data-id="'+t.id+'" title="Delete">✕</span></td>';
      (function(id){
        tr.querySelector('.test-del').addEventListener('click',function(){data.tests=data.tests.filter(function(x){return x.id!==id;});saveData();renderTestTable();});
        tr.querySelector('.test-edit-btn').addEventListener('click',function(){openTestEditModal(id);});
      })(t.id);
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.test-row').forEach(function(row){
      row.addEventListener('mouseenter',function(){row.querySelectorAll('.test-edit-btn,.test-del').forEach(function(b){b.style.opacity='1';});});
      row.addEventListener('mouseleave',function(){row.querySelectorAll('.test-edit-btn,.test-del').forEach(function(b){b.style.opacity='0';});});
    });
  }
}

function openTestEditModal(id) {
  const t = data.tests.find(x=>x.id===id);
  if(!t) return;
  testEditId = id;
  testEditConfidenceVal = t.confidence || 3;
  document.getElementById('te-date').value = t.date;
  document.getElementById('te-subject').value = t.subject;
  document.getElementById('te-coverage').value = t.coverage||'';
  document.getElementById('te-type').value = t.type;
  document.getElementById('te-score').value = t.score||'';
  document.getElementById('te-comment').value = t.comment||'';
  updateTestEditStars(testEditConfidenceVal);
  document.getElementById('test-edit-modal').classList.add('show');
}
function closeTestEditModal() { document.getElementById('test-edit-modal').classList.remove('show'); testEditId=null; }
function updateTestEditStars(val) {
  testEditConfidenceVal=val;
  const current = getRatingLabel(val);
  document.querySelectorAll('#te-confidence-stars .rating-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.id === current);
  });
}
function saveTestEdit() {
  if(!testEditId) return;
  const t = data.tests.find(x=>x.id===testEditId);
  if(!t) return;
  t.date = document.getElementById('te-date').value;
  t.subject = document.getElementById('te-subject').value;
  t.coverage = document.getElementById('te-coverage').value.trim();
  t.type = document.getElementById('te-type').value;
  t.score = document.getElementById('te-score').value.trim();
  t.confidence = testEditConfidenceVal;
  t.comment = document.getElementById('te-comment').value.trim();
  saveData(); closeTestEditModal(); renderTestTable();
  showToast('Updated! Glow-up applied ✨','success');
}

function openTestModal() {
  testConfidenceVal=3;
  document.getElementById('tf-date').value=getTodayStr();
  document.getElementById('tf-subject').value='advacc';
  document.getElementById('tf-coverage').value='';
  document.getElementById('tf-type').value='RTP';
  document.getElementById('tf-score').value='';
  document.getElementById('tf-comment').value='';
  updateTestStars(3);
  document.getElementById('test-modal').classList.add('show');
}
function closeTestModal() { document.getElementById('test-modal').classList.remove('show'); }
function updateTestStars(val) {
  testConfidenceVal=val;
  const current = getRatingLabel(val);
  document.querySelectorAll('#tf-confidence-stars .rating-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.id === current);
  });
}
function saveTestRecord() {
  const date=document.getElementById('tf-date').value;
  if(!date){ showToast('When did this exam happen? Pick a date 📆','error'); return; }
  data.tests.push({
    id:'t'+Date.now(),
    date,
    subject:document.getElementById('tf-subject').value,
    coverage:document.getElementById('tf-coverage').value.trim(),
    type:document.getElementById('tf-type').value,
    score:document.getElementById('tf-score').value.trim(),
    confidence:testConfidenceVal,
    comment:document.getElementById('tf-comment').value.trim()
  });
  saveData(); closeTestModal(); renderTestTable();
  showToast('Test logged! Every attempt counts 📝','success');
}

// ============================================================
// SCHEDULE
// ============================================================
function renderSchedule() {
  SCHED_KEYS.forEach((key,i)=>{
    const body=document.getElementById('sched-body-'+i); body.innerHTML='';
    const slots=data.schedules[key].slots;
    if(slots.length===0&&!editorUnlocked){ body.innerHTML='<div class="empty-schedule">No slots added yet.</div>'; }
    else {
      slots.forEach((slot,si)=>{
        const row=document.createElement('div'); row.className='slot-row';
        if(editorUnlocked){
          const st=document.createElement('input'); st.type='time'; st.className='slot-time-input'; st.value=slot.start||'';
          st.addEventListener('change',()=>{ slot.start=st.value; saveData(); rescheduleAllNotifications(); });
          const et=document.createElement('input'); et.type='time'; et.className='slot-time-input'; et.value=slot.end||'';
          et.addEventListener('change',()=>{ slot.end=et.value; saveData(); });
          
          const nbtn=document.createElement('span'); nbtn.className='slot-notify-btn' + (slot.notify ? ' active' : '');
          nbtn.textContent = '🔔'; nbtn.title = 'Notify 10m before';
          nbtn.addEventListener('click', () => {
            slot.notify = !slot.notify;
            nbtn.classList.toggle('active', slot.notify);
            saveData();
            rescheduleAllNotifications();
            showToast(slot.notify ? 'Suffu will nudge you 10 mins early! 😉' : 'Notification off.', 'info');
          });

          const lb=document.createElement('input'); lb.type='text'; lb.className='slot-label-input'; lb.value=slot.label||''; lb.placeholder='Subject / Activity';
          lb.addEventListener('change',()=>{ slot.label=lb.value; saveData(); });
          lb.addEventListener('keydown', e => { if(e.key==='Enter'){ slot.label=lb.value; saveData(); lb.blur(); } });
          const del=document.createElement('span'); del.className='slot-del'; del.textContent='✕';
          del.addEventListener('click',()=>{ data.schedules[key].slots.splice(si,1); saveData(); renderSchedule(); rescheduleAllNotifications(); });
          row.append(st,et,nbtn,lb,del);
        } else {
          const t=document.createElement('span'); t.className='slot-time'; t.textContent=(slot.start||'--:--')+' – '+(slot.end||'--:--');
          const l=document.createElement('span'); l.className='slot-label'; l.textContent=slot.label||'—';
          row.append(t,l);
          if(slot.notify) {
            const nb = document.createElement('span'); nb.textContent = '🔔'; nb.style.fontSize = '12px'; nb.style.opacity = '0.6';
            row.appendChild(nb);
          }
        }
        body.appendChild(row);
      });
    }
    if(editorUnlocked){
      const ab=document.createElement('button'); ab.className='add-slot-btn'; ab.textContent='+ Add Slot';
      ab.addEventListener('click',()=>{ data.schedules[key].slots.push({start:'',end:'',label:''}); saveData(); renderSchedule(); });
      body.appendChild(ab);
    }
  });
}

// ============================================================
// SUBJECTS — open-state preserved to fix collapse bug
// ============================================================
function getPriorityFlag(d,c) {
  if(d>=4&&c<=2) return '<span style="color:var(--danger)" title="High Priority">⚑</span>';
  if(d>=3&&c<=2) return '<span style="color:var(--warning)" title="Medium Priority">⚑</span>';
  return '';
}

function getRatingLabel(val) {
  if (val <= 2) return 'low';
  if (val <= 4) return 'med';
  return 'hard';
}

function makeRatingGroup(container, initVal, onChangeFn) {
  container.innerHTML = '';
  const current = getRatingLabel(initVal);
  const levels = [
    { id: 'low', val: 1, label: 'Low' },
    { id: 'med', val: 3, label: 'Med' },
    { id: 'hard', val: 5, label: 'Hard' }
  ];
  const group = document.createElement('div');
  group.className = 'rating-group-mini';
  levels.forEach(lvl => {
    const btn = document.createElement('div');
    btn.className = 'rating-mini-btn ' + lvl.id + (current === lvl.id ? ' active' : '');
    btn.textContent = lvl.label;
    btn.addEventListener('click', () => {
      group.querySelectorAll('.rating-mini-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      playClick('star');
      onChangeFn(lvl.val);
    });
    group.appendChild(btn);
  });
  container.appendChild(group);
}

function renderSubjectsInternal() {
  var body=document.getElementById('subjects-body'); body.innerHTML='';
  var mobile=isMobile();
  data.subjects.forEach(function(subj){
    var isOpen=openSubjects.has(subj.id);
    var block=document.createElement('div');
    block.className='subject-block glass-card'+(isOpen?' open':'');
    block.dataset.subjid=subj.id;
    var avgConf=subj.chapters.length?(subj.chapters.reduce(function(a,c){return a+c.confidence;},0)/subj.chapters.length).toFixed(1):'—';
    var flags=subj.chapters.filter(function(c){return c.difficulty>=3&&c.confidence<=2;}).length;
    var header=document.createElement('div'); header.className='subject-header';
    header.innerHTML='<span class="subject-name">'+subj.name+'</span>'
      +'<div class="subject-meta"><span>📖 '+subj.chapters.length+' chapters</span>'
      +'<span>⭐ Avg Conf: '+avgConf+'</span>'
      +(flags?'<span style="color:var(--warning)">⚑ '+flags+' flagged</span>':'')+'</div>'
      +'<span class="subject-chevron">▶</span>';
    header.addEventListener('click',function(){var n=block.classList.toggle('open');if(n)openSubjects.add(subj.id);else openSubjects.delete(subj.id);});
    var bodyEl=document.createElement('div'); bodyEl.className='subject-body';
    var chapterList=document.createElement('div'); chapterList.className='chapter-list';
    if(subj.chapters.length===0&&!editorUnlocked){chapterList.innerHTML='<div class="empty-chapters">No chapters yet. Unlock Editor Mode to add chapters.</div>';}
    subj.chapters.forEach(function(ch,ci){
      var row=document.createElement('div'); row.className='chapter-row';
      // name/input
      if(editorUnlocked){
        var inp=document.createElement('input'); inp.type='text'; inp.className='chapter-name-input'; inp.value=ch.name;
        inp.addEventListener('change',function(){ch.name=inp.value;saveData();});
        inp.addEventListener('keydown',function(e){if(e.key==='Enter'){ch.name=inp.value;saveData();inp.blur();}});
        row.appendChild(inp);
      } else {
        var nm=document.createElement('span'); nm.className='chapter-name'; nm.textContent=ch.name; row.appendChild(nm);
      }
      var flag=document.createElement('span'); flag.className='priority-flag'; flag.innerHTML=getPriorityFlag(ch.difficulty,ch.confidence);
      var dl=document.createElement('span'); dl.className='rating-label'; dl.textContent='Difficulty';
      var ds=document.createElement('span'); ds.className='rating-container';
      (function(ch,flag){makeRatingGroup(ds,ch.difficulty,function(v){ch.difficulty=v;saveData();flag.innerHTML=getPriorityFlag(ch.difficulty,ch.confidence);refreshSubjectMeta(subj,header);});})(ch,flag);
      var cl=document.createElement('span'); cl.className='rating-label'; cl.textContent='Confidence';
      var cs=document.createElement('span'); cs.className='rating-container';
      (function(ch,flag){makeRatingGroup(cs,ch.confidence,function(v){ch.confidence=v;saveData();flag.innerHTML=getPriorityFlag(ch.difficulty,ch.confidence);refreshSubjectMeta(subj,header);});})(ch,flag);
      if(mobile){
        var rrow=document.createElement('div'); rrow.className='chapter-ratings-mobile';
        rrow.append(dl,ds,cl,cs,flag);
        if(editorUnlocked){
          var del=document.createElement('span'); del.className='chapter-del'; del.textContent='✕'; del.title='Delete';
          (function(ci){del.addEventListener('click',function(){subj.chapters.splice(ci,1);saveData();renderSubjectsInternal();});})(ci);
          var up=document.createElement('span'); up.className='chapter-move'; up.textContent='▲'; up.style.cssText='cursor:pointer;font-size:10px;color:var(--text2);padding:0 2px;';
          (function(ci){up.addEventListener('click',function(){if(ci>0){var t=subj.chapters[ci-1];subj.chapters[ci-1]=subj.chapters[ci];subj.chapters[ci]=t;saveData();renderSubjectsInternal();}});})(ci);
          var dn=document.createElement('span'); dn.className='chapter-move'; dn.textContent='▼'; dn.style.cssText='cursor:pointer;font-size:10px;color:var(--text2);padding:0 2px;';
          (function(ci){dn.addEventListener('click',function(){if(ci<subj.chapters.length-1){var t=subj.chapters[ci+1];subj.chapters[ci+1]=subj.chapters[ci];subj.chapters[ci]=t;saveData();renderSubjectsInternal();}});})(ci);
          rrow.append(up,dn,del);
        }
        row.appendChild(rrow);
      } else {
        cl.style.marginLeft='10px';
        row.append(flag,dl,ds,cl,cs);
        if(editorUnlocked){
          var del=document.createElement('span'); del.className='chapter-del'; del.textContent='✕'; del.title='Delete';
          (function(ci){del.addEventListener('click',function(){subj.chapters.splice(ci,1);saveData();renderSubjectsInternal();});})(ci);
          var up=document.createElement('span'); up.className='chapter-move'; up.textContent='▲'; up.style.cssText='cursor:pointer;font-size:10px;color:var(--text2);padding:0 2px;';
          (function(ci){up.addEventListener('click',function(){if(ci>0){var t=subj.chapters[ci-1];subj.chapters[ci-1]=subj.chapters[ci];subj.chapters[ci]=t;saveData();renderSubjectsInternal();}});})(ci);
          var dn=document.createElement('span'); dn.className='chapter-move'; dn.textContent='▼'; dn.style.cssText='cursor:pointer;font-size:10px;color:var(--text2);padding:0 2px;';
          (function(ci){dn.addEventListener('click',function(){if(ci<subj.chapters.length-1){var t=subj.chapters[ci+1];subj.chapters[ci+1]=subj.chapters[ci];subj.chapters[ci]=t;saveData();renderSubjectsInternal();}});})(ci);
          row.append(up,dn,del);
        }
      }
      chapterList.appendChild(row);
    });
    bodyEl.appendChild(chapterList);
    if(editorUnlocked){
      var ab=document.createElement('button'); ab.className='subject-add-btn'; ab.textContent='+ Add Chapter';
      (function(subj){ab.addEventListener('click',function(){openSubjects.add(subj.id);subj.chapters.push({id:'ch'+Date.now(),name:'New Chapter',difficulty:3,confidence:3});saveData();renderSubjectsInternal();});})(subj);
      bodyEl.appendChild(ab);
    }
    block.append(header,bodyEl); body.appendChild(block);
  });
}

// FIX: Removed duplicate renderSubjectsInternal that lacked mobile handling and overwrote the correct one.


function refreshSubjectMeta(subj, header) {
  const avgConf=subj.chapters.length?(subj.chapters.reduce((a,c)=>a+c.confidence,0)/subj.chapters.length).toFixed(1):'—';
  const flags=subj.chapters.filter(c=>c.difficulty>=3&&c.confidence<=2).length;
  const meta=header.querySelector('.subject-meta');
  if(meta) meta.innerHTML=`<span>📖 ${subj.chapters.length} chapters</span><span>⭐ Avg Conf: ${avgConf}</span>${flags?`<span style="color:var(--warning)">⚑ ${flags} flagged</span>`:''}`;
}

// ============================================================
// METRICS
// ============================================================
function renderMetrics() {
  const today=getTodayStr();
  const datesUpToday=getAllPlannerDates().filter(d=>d<=today);
  const total=datesUpToday.length*4; let totalTicked=0;
  const st={}; SUBJECTS.forEach(s=>{st[s]=0;});
  datesUpToday.forEach(date=>{ const row=data.planner.find(r=>r.date===date); SUBJECTS.forEach(s=>{ if(row&&row.ticks[s]){st[s]++;totalTicked++;} }); });

  const pct=total>0?Math.round((totalTicked/total)*100):0;
  document.getElementById('donut-pct').textContent=pct+'%';
  document.getElementById('donut-ticks').textContent=total>0?(totalTicked+' / '+total+' ticks'):'No data yet — go tick something! 🎯';
  drawDonut(pct);

  const barsEl=document.getElementById('subj-bars'); barsEl.innerHTML='';
  const hasChapters=data.subjects.some(s=>s.chapters.length>0);
  if(!hasChapters){
    barsEl.innerHTML='<div class="empty-nudge"><span class="empty-icon">📚</span>Add chapters in <strong>Subjects</strong> to track per-subject progress.</div>';
  } else {
    SUBJECTS.forEach(s=>{ const p=datesUpToday.length>0?Math.round((st[s]/datesUpToday.length)*100):0; barsEl.innerHTML+=`<div class="subj-bar-row"><span class="subj-bar-label">${getSubjectLabel(s)}</span><div class="subj-bar-track"><div class="subj-bar-fill" style="width:${p}%;background:${SUBJECT_COLORS[s]};"></div></div><span class="subj-bar-pct">${p}%</span></div>`; });
  }

  const confGrid=document.getElementById('conf-grid'); confGrid.innerHTML='';
  data.subjects.forEach(subj=>{
    const ac=subj.chapters.length?subj.chapters.reduce((a,c)=>a+c.confidence,0)/subj.chapters.length:0;
    const ad=subj.chapters.length?subj.chapters.reduce((a,c)=>a+c.difficulty,0)/subj.chapters.length:0;
    const fl=subj.chapters.filter(c=>c.difficulty>=3&&c.confidence<=2).length;
    const badge = v => {
      const lbl = getRatingLabel(v);
      return `<span class="rating-badge ${lbl}">${lbl.toUpperCase()}</span>`;
    };
    confGrid.innerHTML+=`<div class="conf-item"><div class="conf-item-name">${subj.name}</div><div class="conf-item-body"><div class="conf-mini-row"><span class="conf-mini-label">Confidence</span><span class="conf-mini-stars">${badge(ac)}</span></div><div class="conf-mini-row"><span class="conf-mini-label">Difficulty</span><span class="conf-mini-stars">${badge(ad)}</span></div>${fl?`<div class="flag-count">⚑ ${fl} flagged</div>`:''}</div></div>`;
  });

  // Score Trend Chart
  const scoreCanvas = document.getElementById('score-trend-canvas');
  if (scoreCanvas && scoreCanvas.parentElement) {
    // Make canvas responsive to its wrapper
    const rect = scoreCanvas.parentElement.getBoundingClientRect();
    scoreCanvas.width = rect.width;
    scoreCanvas.height = rect.height;
    const ctx = scoreCanvas.getContext('2d');
    ctx.clearRect(0, 0, scoreCanvas.width, scoreCanvas.height);

    // Extract numerical scores from chronologically sorted tests
    const scoredTests = [].concat(data.tests || [])
      .sort((a,b) => a.date.localeCompare(b.date))
      .filter(t => t.score && !isNaN(parseFloat(t.score)))
      .map(t => parseFloat(t.score));

    if (scoredTests.length > 0) {
      const pad = 20;
      const w = scoreCanvas.width - pad * 2;
      const h = scoreCanvas.height - pad * 2;
      const maxScore = Math.max(100, ...scoredTests);
      
      // Draw grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for(let i=0; i<=4; i++) {
        let y = pad + (h / 4) * i;
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + w, y);
      }
      ctx.stroke();

      // Plot line
      ctx.beginPath();
      ctx.strokeStyle = '#7c6fcd';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      
      const stepX = scoredTests.length > 1 ? w / (scoredTests.length - 1) : w;
      
      scoredTests.forEach((score, i) => {
        let px = pad + i * stepX;
        let py = pad + h - (score / maxScore) * h;
        if (i===0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Draw points
      ctx.fillStyle = '#0d0d12';
      ctx.strokeStyle = '#7c6fcd';
      ctx.lineWidth = 2;
      scoredTests.forEach((score, i) => {
        let px = pad + i * stepX;
        let py = pad + h - (score / maxScore) * h;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
      });
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = '12px "DM Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No scores logged yet.', scoreCanvas.width/2, scoreCanvas.height/2);
    }
  }

  const {current,longest}=calcStreak();
  document.getElementById('streak-num').textContent=current;
  document.getElementById('streak-longest').textContent=longest;

  const daysLeft=daysUntil(data.settings.examDate);
  const tc=data.subjects.reduce((a,s)=>a+s.chapters.length,0);
  const fl=data.subjects.reduce((a,s)=>a+s.chapters.filter(c=>c.difficulty>=3&&c.confidence<=2).length,0);
  document.getElementById('days-stats').innerHTML=`<div class="stat-pill"><div class="stat-pill-num accent">${Math.max(0,daysLeft)}</div><div class="stat-pill-label">Days Left</div></div><div class="stat-pill"><div class="stat-pill-num">${tc}</div><div class="stat-pill-label">Total Chapters</div></div><div class="stat-pill"><div class="stat-pill-num success">${tc-fl}</div><div class="stat-pill-label">Clear Chapters</div></div><div class="stat-pill"><div class="stat-pill-num danger">${fl}</div><div class="stat-pill-label">Flagged</div></div>`;

}

function calcStreak() {
  const today=getTodayStr();
  const dates=getAllPlannerDates().filter(d=>d<=today).reverse();
  let cs=0,longest=0,temp=0,foundBreak=false;
  for(const d of dates){
    const row=data.planner.find(r=>r.date===d);
    // Only count day if at least one subject was ticked
    const has=row&&SUBJECTS.filter(s=>row.ticks[s]).length>0;
    if(has){
      temp++;
      if(temp>longest)longest=temp;
      if(!foundBreak)cs=temp;
    } else {
      foundBreak=true;
      if(cs===0)cs=0; // gap found, current streak stops
      temp=0;
    }
  }
  return{current:cs,longest};
}

function drawDonut(pct) {
  const canvas=document.getElementById('donut-canvas'), ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,100,100);
  ctx.beginPath(); ctx.arc(50,50,38,0,Math.PI*2);
  ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--surface-el').trim();
  ctx.lineWidth=13; ctx.stroke();
  if(pct>0){
    const a=(pct/100)*Math.PI*2;
    ctx.beginPath(); ctx.arc(50,50,38,-Math.PI/2,-Math.PI/2+a);
    ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    ctx.lineWidth=13; ctx.lineCap='round'; ctx.stroke();
  }
}

// ============================================================
// SETTINGS
// ============================================================
function renderSettings() {
  document.getElementById('setting-exam-date').value=data.settings.examDate||'';
  document.getElementById('setting-start-date').value=data.settings.plannerStartDate||'';
  (function(){var nf=document.getElementById('setting-user-name');if(nf)nf.value=data.settings.userName||'';})();
  
  const isLight=data.settings.theme==='light';
  document.getElementById('theme-track').classList.toggle('on',isLight);
  document.getElementById('theme-toggle-text').textContent=isLight?'Light Mode':'Dark Mode';
  
  // Fullscreen toggle
  const fsOn = !!data.settings.alwaysFullscreen;
  document.getElementById('fullscreen-track').classList.toggle('on', fsOn);
  document.getElementById('fullscreen-toggle-text').textContent = fsOn ? 'On' : 'Off';

  // Editor toggle
  const etrack = document.getElementById('editor-track');
  const etext = document.getElementById('editor-toggle-text');
  if(etrack && etext) {
    etrack.classList.toggle('on', editorUnlocked);
    etext.textContent = editorUnlocked ? 'Unlocked' : 'Locked';
  }
}
function saveSettings() {
  if(!editorUnlocked) return;
  const ed=document.getElementById('setting-exam-date').value;
  const sd=document.getElementById('setting-start-date').value;
  if(!ed||!sd){ showToast('Both dates please — can\'t build a planner from thin air 📅','error'); return; }
  if(sd>=ed){ showToast('Bro, you can\'t study after the exam 💀 Fix those dates.','error'); return; }
  data.settings.examDate=ed;
  data.settings.plannerStartDate=sd;
  saveData();
  updateTopBar();
  plannerScrolledToToday = false;
  renderPlanner();
  showToast('Done! Settings locked in 🔧','success');
}

// ============================================================
// IMPORT / EXPORT
// ============================================================
function exportData() {
  const today=toDateStr(new Date());
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='jgsuffu-backup-'+today+'.json'; a.click();
  URL.revokeObjectURL(url); showToast('Backed up! Smart move 💾','success');
}
function handleImportFile(e) {
  const file=e.target.files[0]; if(!file) return;
  pendingImportFile=file; document.getElementById('import-modal').classList.add('show'); e.target.value='';
}
function confirmImport() {
  if(!pendingImportFile) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{ data=JSON.parse(e.target.result); if(!data.tests)data.tests=[]; saveData(); renderAll(); showToast('Data imported! Welcome back to the grind 💪','success'); }
    catch{ showToast('That file is cooked 🤌 Not valid JSON.','error'); }
    pendingImportFile=null; document.getElementById('import-modal').classList.remove('show');
  };
  reader.readAsText(pendingImportFile);
}

// ============================================================
// FULL RENDER
// ============================================================
function renderAll() {
  applyTheme(data.settings.theme||'dark');
  updateTopBar(); renderPlanner(); renderSchedule();
  renderSubjectsInternal(); renderSettings(); renderTestTable();
  if(currentSection==='metrics') renderMetrics();
}

// ============================================================
// CLEAR DATA — multi-step flow
// ============================================================
let clearScope = 'user';

function openClearModal() {
  showClearStep(1);
  document.getElementById('scope-user').checked = true;
  document.getElementById('clear-confirm-text').value = '';
  document.getElementById('clear-step2-error').textContent = '';
  document.getElementById('clear-editor-pw').value = '';
  document.getElementById('clear-step3b-error').textContent = '';
  document.getElementById('clear-modal').classList.add('show');
}
function closeClearModal() { document.getElementById('clear-modal').classList.remove('show'); }

function showClearStep(n) {
  ['clear-step-1','clear-step-2','clear-step-3a','clear-step-3b'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  const map = {1:'clear-step-1', 2:'clear-step-2', '3a':'clear-step-3a', '3b':'clear-step-3b'};
  document.getElementById(map[n]).style.display = '';
}

function doClearUserData() {
  data.planner = [];
  data.tests = [];
  data.subjects.forEach(subj => subj.chapters.forEach(ch => { ch.difficulty = 3; ch.confidence = 3; }));
  saveData(); openSubjects.clear(); renderAll();
  if (currentUser) {
    localStorage.removeItem('jgsuffu_launched_' + currentUser.uid);
    localStorage.removeItem('jgsuffu_daily_seen_' + currentUser.uid);
  }
  showToast('Poof! User data gone. Fresh slate 🧹','info');
}
function doClearAllData() {
  data = defaultData();
  saveData(); openSubjects.clear(); editorUnlocked = false;
  document.body.classList.add('editor-locked');
  document.getElementById('editor-badge').className = 'locked';
  document.getElementById('editor-badge').textContent = '🔒 LOCKED';
  document.getElementById('editor-toggle-btn').textContent = '🔒';
  // Reset first-launch flags so name + welcome re-appear on next login
  if (currentUser) {
    localStorage.removeItem('jgsuffu_launched_' + currentUser.uid);
    localStorage.removeItem('jgsuffu_daily_seen_' + currentUser.uid);
  }
  renderAll();
  showToast('Everything wiped. Time to rebuild, king 👑','info');
}

function setupClearDataEvents() {
  document.getElementById('clear-data-btn').addEventListener('click', openClearModal);
  document.getElementById('clear-modal').addEventListener('click', e => { if(e.target===document.getElementById('clear-modal')) closeClearModal(); });
  document.getElementById('clear-cancel-1').addEventListener('click', closeClearModal);

  // Export then go to step 2
  document.getElementById('clear-export-then-next').addEventListener('click', () => {
    exportData();
    setTimeout(() => {
      clearScope = document.querySelector('input[name="clear-scope"]:checked').value;
      setStep2Sub();
      document.getElementById('clear-confirm-text').value = '';
      document.getElementById('clear-step2-error').textContent = '';
      showClearStep(2);
      setTimeout(() => document.getElementById('clear-confirm-text').focus(), 80);
    }, 400);
  });

  // Skip export, go to step 2
  document.getElementById('clear-next-1').addEventListener('click', () => {
    clearScope = document.querySelector('input[name="clear-scope"]:checked').value;
    setStep2Sub();
    document.getElementById('clear-confirm-text').value = '';
    document.getElementById('clear-step2-error').textContent = '';
    showClearStep(2);
    setTimeout(() => document.getElementById('clear-confirm-text').focus(), 80);
  });

  document.getElementById('clear-back-2').addEventListener('click', () => showClearStep(1));

  // Step 2 confirm
  document.getElementById('clear-next-2').addEventListener('click', advanceClearStep2);
  document.getElementById('clear-confirm-text').addEventListener('keydown', e => { if(e.key==='Enter') advanceClearStep2(); });

  // Step 3A
  document.getElementById('clear-cancel-3a').addEventListener('click', closeClearModal);
  document.getElementById('clear-confirm-3a').addEventListener('click', () => { closeClearModal(); doClearUserData(); });

  // Step 3B
  document.getElementById('clear-cancel-3b').addEventListener('click', closeClearModal);
  document.getElementById('clear-confirm-3b').addEventListener('click', advanceClearStep3b);
  document.getElementById('clear-editor-pw').addEventListener('keydown', e => { if(e.key==='Enter') advanceClearStep3b(); });
}

function setStep2Sub() {
  document.getElementById('clear-step2-sub').innerHTML = clearScope === 'both'
    ? 'You are about to erase <strong>ALL data</strong> including subjects, chapters, schedules &amp; settings. Type <strong style="color:var(--danger)">DELETE</strong> to proceed.'
    : 'You are about to erase your planner, test records &amp; chapter ratings. Type <strong style="color:var(--danger)">DELETE</strong> to proceed.';
}

function advanceClearStep2() {
  const val = document.getElementById('clear-confirm-text').value.trim().toUpperCase();
  if (val !== 'DELETE') {
    document.getElementById('clear-step2-error').textContent = 'It\'s DELETE in caps, genius. Focus. 🔡';
    const inp = document.getElementById('clear-confirm-text');
    inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 400);
    return;
  }
  document.getElementById('clear-step2-error').textContent = '';
  if (clearScope === 'user') { showClearStep('3a'); }
  else {
    document.getElementById('clear-editor-pw').value = '';
    document.getElementById('clear-step3b-error').textContent = '';
    showClearStep('3b');
    setTimeout(() => document.getElementById('clear-editor-pw').focus(), 80);
  }
}

function advanceClearStep3b() {
  const pw = document.getElementById('clear-editor-pw').value;
  if (pw !== EDITOR_PASSWORD) {
    document.getElementById('clear-step3b-error').textContent = 'That\'s not the password, smarty 🔐';
    const inp = document.getElementById('clear-editor-pw');
    inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 400);
    return;
  }
  closeClearModal(); doClearAllData();
}

// ============================================================
// REMINDERS
// ============================================================
let notificationTimers = {};

function renderReminders() {
  const list = document.getElementById('reminders-list-wrap');
  if(!list) return;
  list.innerHTML = '';
  
  const catFilter = document.getElementById('rf-category').value;
  const statFilter = document.getElementById('rf-status').value;
  
  let reminders = [].concat(data.reminders || []).sort((a,b) => a.datetime.localeCompare(b.datetime));
  
  if(catFilter !== 'all') reminders = reminders.filter(r => r.category === catFilter);
  if(statFilter === 'pending') reminders = reminders.filter(r => !r.done);
  if(statFilter === 'done') reminders = reminders.filter(r => r.done);
  
  if(reminders.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text2); font-size:14px;">No reminders found. Add one to stay on track! 🚀</div>';
    return;
  }
  
  reminders.forEach(r => {
    const card = document.createElement('div');
    card.className = 'rcard glass-card' + (r.done ? ' done' : '');
    
    const dt = new Date(r.datetime);
    const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    
    card.innerHTML = `
      <div class="rcard-check" onclick="toggleReminderDone('${r.id}')">✓</div>
      <div class="rcard-body">
        <div class="rcard-title">${r.title}</div>
        <div class="rcard-meta">
          <span class="rcard-time">⏰ ${dateStr}, ${timeStr}</span>
          <span class="rcard-category ${r.category.toLowerCase()}">${r.category}</span>
          ${r.subject ? `<span class="rcard-subject">📚 ${SUBJECT_LABELS[r.subject] || r.subject}</span>` : ''}
        </div>
      </div>
      <div class="rcard-del" onclick="deleteReminder('${r.id}')">🗑</div>
    `;
    list.appendChild(card);
  });
}

function openReminderModal() {
  const modal = document.getElementById('reminder-modal');
  modal.classList.add('show');
  
  // Reset fields
  document.getElementById('rm-title').value = '';
  document.getElementById('rm-datetime').value = '';
  document.getElementById('rm-category').value = 'Study';
  
  // Populate subject dropdown
  const subSelect = document.getElementById('rm-subject');
  subSelect.innerHTML = '<option value="">None</option>';
  SUBJECTS.forEach(id => {
    subSelect.innerHTML += `<option value="${id}">${SUBJECT_LABELS[id]}</option>`;
  });
  
  updateReminderSubjectVisibility();
}

function closeReminderModal() {
  document.getElementById('reminder-modal').classList.remove('show');
}

function updateReminderSubjectVisibility() {
  const isStudy = document.getElementById('rm-category').value === 'Study';
  document.getElementById('rm-subject-field').style.display = isStudy ? 'block' : 'none';
}

function saveReminder() {
  const title = document.getElementById('rm-title').value.trim();
  const datetime = document.getElementById('rm-datetime').value;
  const category = document.getElementById('rm-category').value;
  const subject = category === 'Study' ? document.getElementById('rm-subject').value : '';
  
  if(!title || !datetime) {
    showToast('Please enter title and date/time! ⏰', 'warning');
    return;
  }
  
  const id = 'rem_' + Date.now();
  const reminder = { id, title, datetime, category, subject, done: false, notified: false };
  
  data.reminders.push(reminder);
  saveData();
  closeReminderModal();
  renderReminders();
  scheduleNotification(reminder);
  showToast('Reminder set! I\'ll keep you posted 🔔', 'success');
}

function toggleReminderDone(id) {
  const r = data.reminders.find(rem => rem.id === id);
  if(r) {
    r.done = !r.done;
    if(r.done && notificationTimers[id]) {
      clearTimeout(notificationTimers[id]);
      delete notificationTimers[id];
    }
    saveData();
    renderReminders();
    playClick('tick');
  }
}

function deleteReminder(id) {
  data.reminders = data.reminders.filter(rem => rem.id !== id);
  if(notificationTimers[id]) {
    clearTimeout(notificationTimers[id]);
    delete notificationTimers[id];
  }
  saveData();
  renderReminders();
  showToast('Reminder deleted.', 'info');
}

// ============================================================
// NOTIFICATIONS
// ============================================================
// ============================================================
// NOTIFICATIONS
// ============================================================
async function initNotifications() {
  if (!('Notification' in window)) return;
  
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch(e) { console.warn('SW registration failed', e); }
  }

  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  
  rescheduleAllNotifications();
}

// Global timer for midnight refresh
let midnightTimer = null;

function rescheduleAllNotifications() {
  Object.keys(notificationTimers).forEach(id => clearTimeout(notificationTimers[id]));
  notificationTimers = {};
  
  const now = Date.now();
  const today = new Date();
  
  // 1. Reminders
  data.reminders.forEach(r => {
    if(!r.done && !r.notified) {
      const target = new Date(r.datetime).getTime();
      if(target > now) {
        scheduleNotification(r);
      }
    }
  });

  // 2. Schedule Slots (Today + Tomorrow lookahead)
  const scheduleLookahead = (dateObj, isTomorrow = false) => {
    const isSun = dateObj.getDay() === 0;
    const key = isSun ? 'sundays' : 'allDaysExceptSundays';
    const slots = data.schedules[key]?.slots || [];
    const datePrefix = toDateStrSimple(dateObj);
    
    slots.forEach((s, idx) => {
      if(s.notify && s.start) {
        const [h, m] = s.start.split(':').map(Number);
        const target = new Date(dateObj);
        target.setHours(h, m, 0, 0);
        const notifyTime = target.getTime() - (10 * 60 * 1000); // 10 mins early
        
        if(notifyTime > now) {
          const id = `slot_${key}_${idx}_${isTomorrow ? 'next' : 'curr'}`;
          notificationTimers[id] = setTimeout(() => {
            fireSlotNotification(s);
            delete notificationTimers[id];
          }, notifyTime - now);
        }
      }
    });
  };

  scheduleLookahead(today);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  scheduleLookahead(tomorrow, true);

  // 3. Midnight Refresh Timer
  if (midnightTimer) clearTimeout(midnightTimer);
  const nextMidnight = new Date(today);
  nextMidnight.setHours(24, 0, 1, 0); // 1 second past midnight
  midnightTimer = setTimeout(() => {
    rescheduleAllNotifications();
  }, nextMidnight.getTime() - now);
}

async function showSuffuNotification(title, bodyText) {
  const options = {
    body: bodyText,
    icon: 'logo.png',
    badge: 'logo.png',
    vibrate: [200, 100, 200],
    tag: 'suffu-notif-' + Date.now(),
    data: { url: window.location.href }
  };

  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Suffu Says... ' + title, options);
  } else {
    new Notification('Suffu Says... ' + title, options);
  }
}

function fireSlotNotification(slot) {
  const bodies = [
    `Time to grind! "${slot.label}" starts in 10 mins. I'm watching... don't slack off! 😉`,
    `Hey Dear! "${slot.label}" is calling. 10 mins to go. Excellence is expected! ✨`,
    `Focus up: "${slot.label}" starts soon. Put that phone down and get to work! 🧠`
  ];
  const randBody = bodies[Math.floor(Math.random() * bodies.length)];
  showSuffuNotification('Time to Grind! 🔔', randBody);
}

function scheduleNotification(r) {
  const target = new Date(r.datetime).getTime();
  const delay = target - Date.now();
  if(delay <= 0) return;
  
  notificationTimers[r.id] = setTimeout(() => {
    fireNotification(r);
    delete notificationTimers[r.id];
  }, delay);
}

function fireNotification(r) {
  const titles = ['Reminder! 🔔', 'Don\'t forget! 📌', 'Excellence awaits! 🚀'];
  const randTitle = titles[Math.floor(Math.random() * titles.length)];
  const body = `${r.title}. I expect excellence, nothing less. ✨ ` + (r.subject ? `[${getSubjectLabel(r.subject)}]` : '');
  
  showSuffuNotification(randTitle, body);
  
  const rem = data.reminders.find(rm => rm.id === r.id);
  if(rem) {
    rem.notified = true;
    saveData();
    if(currentSection === 'reminders') renderReminders();
  }
}
// ============================================================
// CONNECTION STATUS INDICATOR
// States: 'online' | 'offline' | 'syncing'
// 'syncing' will be driven by Firebase writes once integrated
// ============================================================
function setConnStatus(state) {
  const el = document.getElementById('conn-status');
  const lbl = document.getElementById('conn-label');
  if (!el) return;
  el.className = state;
  if (state === 'online')  lbl.textContent = 'Online';
  if (state === 'offline') lbl.textContent = 'Offline';
  if (state === 'syncing') lbl.textContent = 'Syncing…';
}

async function checkAppUpdate() {
  if (!('serviceWorker' in navigator)) {
    showToast("Suffu's magic doesn't work on this ancient browser... No PWA for you! 👴", "error");
    return;
  }
  
  showToast("Suffu is scanning the horizon for updates... 📡", "info");
  
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.update();
      // If there's a waiting or installing sw, it means an update was found
      // Note: In some browsers reg.update() might take a moment to reflect in these properties
      // However, for most modern browsers, if byte-diff exists, it populates quickly.
      if (reg.waiting || reg.installing) {
        showToast("Suffu found a fresh update! Applying the glow-up now... Stay tuned! ✨", "success");
        setTimeout(() => window.location.reload(), 2000);
      } else {
        showToast("Suffu checked everywhere... you're already on the peak. No updates needed! 😎", "info");
      }
    } else {
      showToast("No tracker found to update! Are you even real? 👤", "warning");
    }
  } catch (e) {
    showToast("Suffu's radar is acting up... try again later! ⛈️", "error");
  }
}

function initConnStatus() {
  setConnStatus(navigator.onLine ? 'online' : 'offline');
  window.addEventListener('online',  () => setConnStatus('online'));
  window.addEventListener('offline', () => setConnStatus('offline'));
  // Firebase integration point:
  // Call setConnStatus('syncing') before Firestore write
  // Call setConnStatus('online')  after write resolves
  // Call setConnStatus('offline') on write failure
}

function toggleFullscreen() {
  const btn = document.getElementById('fullscreen-btn');
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(()=>{});
    btn.textContent = '✕'; btn.title = 'Exit Fullscreen';
  } else {
    document.exitFullscreen().catch(()=>{});
    btn.textContent = '⛶'; btn.title = 'Toggle Fullscreen';
  }
}
document.addEventListener('fullscreenchange', () => {
  const btn = document.getElementById('fullscreen-btn');
  if (!document.fullscreenElement) { btn.textContent = '⛶'; btn.title = 'Toggle Fullscreen'; }
  else { btn.textContent = '✕'; btn.title = 'Exit Fullscreen'; }
});

// ============================================================
// RIGHT-CLICK DISABLE
// ============================================================
function setupRightClickDisable() {
  document.addEventListener('contextmenu', e => e.preventDefault());
}

// ============================================================
// WELCOME & DAILY MODAL
// ============================================================
let welcomeAutoTimer = null;
let welcomeCountdownInterval = null;

const FIRST_LAUNCH_TITLE = "Welcome to Suffu's World \ud83d\udc4b";
const FIRST_LAUNCH_BODY = [
  "This is your personal CA Intermediate study companion \u2014 built around your schedule, your subjects, and your pace.\n\n",
  "Here's what you can do here:\n",
  "  \ud83d\udcc5  Planner \u2014 Plan and tick off what you finish\n",
  "  \ud83d\udcdd  Test \u2014 Track every test you appear in with score and confidence\n",
  "  \ud83d\udd50  Schedule \u2014 Set and see your timetable for different day types\n",
  "  \ud83d\udcda  Subjects \u2014 Add chapters, rate difficulty and confidence\n",
  "  \ud83d\udcca  Metrics \u2014 Watch your progress build over time\n\n",
  "\ud83d\udd12 Most editing is behind Editor Mode \u2014 password-locked so you never cross Suffu's Mind [Ahh, Who can cross Suffu \ud83d\ude0f].\n\n",
  "May/November 2026 is the target. Every day counts.\n\n",
  "Not to mention, but someone genuinely wants your success.\n",
  "\u2014 JG. SUFFU"
].join('');

function getDailyBody() {
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const dayName = now.toLocaleDateString('en-IN', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const days = daysUntil(data.settings.examDate);
  const daysText = days > 0 ? `${days} days` : days === 0 ? 'Exam Day Today 🎓' : 'Exam has passed';
  return `${greeting}, Dear. 🌤️\n\nToday is ${dayName}, ${dateStr}.\nYou have ${daysText} left until the exam.\n\nMake today count. Open your Planner, see what's on the table today, get to work.`;
}

function typewriterEffect(text, el, speed, onDone) {
  el.textContent = '';
  let i = 0;
  function tick() {
    if (i < text.length) {
      el.textContent += text[i++];
      setTimeout(tick, speed);
    } else {
      if (onDone) onDone();
    }
  }
  tick();
}

function startWelcomeCountdown(seconds) {
  const timerEl = document.getElementById('welcome-timer');
  let remaining = seconds;
  timerEl.textContent = `Auto-closing in ${remaining}s`;
  welcomeCountdownInterval = setInterval(() => {
    remaining--;
    timerEl.textContent = remaining > 0 ? `Auto-closing in ${remaining}s` : '';
    if (remaining <= 0) clearInterval(welcomeCountdownInterval);
  }, 1000);
  welcomeAutoTimer = setTimeout(() => closeWelcome(), seconds * 1000);
}

function closeWelcome() {
  clearTimeout(welcomeAutoTimer);
  clearInterval(welcomeCountdownInterval);
  document.getElementById('welcome-overlay').classList.remove('show');
}

function showWelcomeModal(title, bodyText, typeSpeed) {
  document.getElementById('welcome-title').textContent = title;
  document.getElementById('welcome-body').textContent = '';
  document.getElementById('welcome-timer').textContent = '';
  document.getElementById('welcome-overlay').classList.add('show');

  typewriterEffect(bodyText, document.getElementById('welcome-body'), typeSpeed, () => {
    // Start 2-minute auto-close countdown after typing finishes
    startWelcomeCountdown(120);
  });
}

function showNamePrompt(){
  var modal=document.getElementById('name-modal'); if(!modal)return;
  modal.classList.add('show');
  setTimeout(function(){var i=document.getElementById('name-input');if(i)i.focus();},300);
  function doSave(){
    var n=(document.getElementById('name-input').value||'').trim();
    data.settings.userName=n; saveData(); updateTopBar();
    modal.classList.remove('show');
    setTimeout(checkAndShowWelcome,350);
  }
  document.getElementById('name-save-btn').onclick=doSave;
  document.getElementById('name-input').onkeydown=function(e){if(e.key==='Enter')doSave();};
}

function checkAndShowWelcome() {
  if (!currentUser) return;
  const launchKey = 'jgsuffu_launched_' + currentUser.uid;
  const seenKey = 'jgsuffu_daily_seen_' + currentUser.uid;
  
  const hasLaunched = localStorage.getItem(launchKey);
  const lastSeen = localStorage.getItem(seenKey);
  const today = getTodayStr();

  if (!hasLaunched) {
    // First ever launch
    localStorage.setItem(launchKey, '1');
    localStorage.setItem(seenKey, today);
    if(!data.settings.userName){showNamePrompt();return;}
    showWelcomeModal(FIRST_LAUNCH_TITLE, FIRST_LAUNCH_BODY, 22);
  } else if (lastSeen !== today) {
    // First open today
    localStorage.setItem(seenKey, today);
    showWelcomeModal('👋 Hey, Dear!', getDailyBody(), 28);
  }
}

// ============================================================
// WEEKLY BACKUP NUDGE
// ============================================================
function checkWeeklyBackupNudge() {
  const last = localStorage.getItem('jgsuffu_last_backup_nudge');
  const today = getTodayStr();
  if(!last) { localStorage.setItem('jgsuffu_last_backup_nudge', today); return; }
  const daysSince = Math.floor((parseDate(today) - parseDate(last)) / 86400000);
  if(daysSince >= 7) {
    localStorage.setItem('jgsuffu_last_backup_nudge', today);
    setTimeout(()=>showToast('💾 A week gone by — maybe back up your data? Just saying 👀','info'), 3000);
  }
}

// ============================================================
// MOBILE TAB BAR
// ============================================================
function setupMobileTabs() {
  const bar = document.getElementById('mobile-tabs');
  // Show on mobile via JS as well (CSS handles hide/show but we wire events)
  if(window.innerWidth <= 768) bar.style.display = 'flex';
  window.addEventListener('resize', ()=>{ bar.style.display = window.innerWidth<=768?'flex':'none'; });
  bar.querySelectorAll('.mobile-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      switchSection(tab.dataset.section);
      bar.querySelectorAll('.mobile-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
}

// switchSection is the canonical function - mobile tabs sync handled inside it

// ============================================================
// EVENTS
// ============================================================
function setupEvents() {
  document.querySelectorAll('.nav-item').forEach(item=>item.addEventListener('click',()=>switchSection(item.dataset.section)));
  document.getElementById('theme-toggle-label').addEventListener('click',toggleTheme);
  document.getElementById('fullscreen-btn').addEventListener('click',toggleFullscreen);
  // Always Fullscreen toggle in settings
  document.getElementById('fullscreen-toggle-label').addEventListener('click', () => {
    data.settings.alwaysFullscreen = !data.settings.alwaysFullscreen;
    saveData();
    renderSettings();
    if (data.settings.alwaysFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(()=>{});
    } else if (!data.settings.alwaysFullscreen && document.fullscreenElement) {
      document.exitFullscreen().catch(()=>{});
    }
    showToast(data.settings.alwaysFullscreen ? 'Fullscreen on every load 🖥️' : 'Fullscreen preference off', 'info');
  });
  document.getElementById('editor-toggle-label').addEventListener('click', handleEditorToggle);
  document.getElementById('editor-cancel-btn').addEventListener('click',closeEditorModal);
  document.getElementById('editor-confirm-btn').addEventListener('click',confirmEditorPassword);
  document.getElementById('editor-pw-input').addEventListener('keydown',e=>{if(e.key==='Enter')confirmEditorPassword();if(e.key==='Escape')closeEditorModal();});
  document.getElementById('editor-modal').addEventListener('click',e=>{if(e.target===document.getElementById('editor-modal'))closeEditorModal();});
  document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.key==='E'){e.preventDefault();handleEditorToggle();}});
  document.getElementById('save-settings-btn').addEventListener('click',saveSettings);
  document.getElementById('scroll-today-btn').addEventListener('click', scrollToToday);
  // Feedback sound on all .btn clicks
  document.addEventListener('click', function(e) {
    if (e.target.matches('.btn,.icon-btn,.login-btn,.mtm-item,.pcard-bulk')) playClick('btn');
  }, true);

  // Save name from settings
  (function(){
    var snb=document.getElementById('save-name-btn'),sni=document.getElementById('setting-user-name');
    if(snb)snb.addEventListener('click',function(){
      var n=(sni?sni.value:'').trim(); data.settings.userName=n; saveData(); updateTopBar();
      showToast(n?'Hey '+n+'! Name updated 👋':'Name cleared.','success');
    });
    if(sni)sni.addEventListener('keydown',function(e){if(e.key==='Enter'&&snb)snb.click();});
  })();
  document.getElementById('check-update-btn').addEventListener('click', checkAppUpdate);
  // Legacy hamburger menu removed
  document.getElementById('export-btn').addEventListener('click',exportData);
  document.getElementById('import-input').addEventListener('change',handleImportFile);
  
  // Reminders
  document.getElementById('add-reminder-btn').addEventListener('click', openReminderModal);
  document.getElementById('reminder-cancel-btn').addEventListener('click', closeReminderModal);
  document.getElementById('reminder-save-btn').addEventListener('click', saveReminder);
  document.getElementById('rm-category').addEventListener('change', updateReminderSubjectVisibility);
  document.getElementById('rf-category').addEventListener('change', renderReminders);
  document.getElementById('rf-status').addEventListener('change', renderReminders);
  document.getElementById('reminder-modal').addEventListener('click', e => { if(e.target === document.getElementById('reminder-modal')) closeReminderModal(); });

  document.getElementById('import-cancel-btn').addEventListener('click',()=>{pendingImportFile=null;document.getElementById('import-modal').classList.remove('show');});
  document.getElementById('import-confirm-btn').addEventListener('click',confirmImport);
  document.getElementById('import-modal').addEventListener('click',e=>{if(e.target===document.getElementById('import-modal')){pendingImportFile=null;document.getElementById('import-modal').classList.remove('show');}});
  // Test modal — Enter on text fields triggers save
  ['tf-coverage','tf-score'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if(e.key==='Enter') saveTestRecord(); });
  });
  // Test modal
  document.getElementById('add-test-btn').addEventListener('click',openTestModal);
  document.getElementById('test-cancel-btn').addEventListener('click',closeTestModal);
  document.getElementById('test-save-btn').addEventListener('click',saveTestRecord);
  document.getElementById('test-modal').addEventListener('click',e=>{if(e.target===document.getElementById('test-modal'))closeTestModal();});
  document.querySelectorAll('#tf-confidence-stars .rating-btn').forEach(btn=>{
    btn.addEventListener('click',()=> {
      playClick('star');
      updateTestStars(parseInt(btn.dataset.val));
    });
  });
  // Test edit modal
  document.getElementById('test-edit-cancel-btn').addEventListener('click',closeTestEditModal);
  document.getElementById('test-edit-save-btn').addEventListener('click',saveTestEdit);
  document.getElementById('test-edit-modal').addEventListener('click',e=>{if(e.target===document.getElementById('test-edit-modal'))closeTestEditModal();});
  document.querySelectorAll('#te-confidence-stars .rating-btn').forEach(btn=>{
    btn.addEventListener('click',()=> {
      playClick('star');
      updateTestEditStars(parseInt(btn.dataset.val));
    });
  });
  ['te-coverage','te-score'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if(e.key==='Enter') saveTestEdit(); });
  });
  // Welcome dive-in button
  document.getElementById('welcome-dive-btn').addEventListener('click', closeWelcome);
  // Re-draw donut on theme change
  new MutationObserver(()=>{ if(currentSection==='metrics') setTimeout(renderMetrics,50); }).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
}

// ============================================================
// LOGIN / LOGOUT
// ============================================================
let currentUser = null;

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').style.display = 'none';
  setTimeout(() => document.getElementById('login-email').focus(), 120);
}

function hideLoginScreen() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').style.display = '';
}

function showLoginError(msg) {
  document.getElementById('login-error').textContent = msg;
  const inp = document.getElementById('login-password');
  inp.classList.add('shake');
  setTimeout(() => inp.classList.remove('shake'), 400);
}

var loginAttempts = 0;
function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  document.getElementById('login-error').textContent = '';
  if (!email || !password) { showLoginError('Bhai, fields are empty. Try harder. 😐'); return; }

  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'Signing in...';

  window._signInWithEmailAndPassword(window._fbAuth, email, password)
    .then(cred => {
      loginAttempts = 0;
      document.getElementById('login-help').style.display = 'none';
      btn.disabled = false; btn.textContent = 'Sign In';
      // onAuthStateChanged will fire and handle the rest
    })
    .catch(err => {
      btn.disabled = false; btn.textContent = 'Sign In';
      loginAttempts++;
      const msg = (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential')
        ? 'Nah nah, you can\'t bypass Suffu 😉'
        : 'Login error: ' + (err.message || err.code);
      showLoginError(msg);
      if (loginAttempts >= 2) document.getElementById('login-help').style.display = 'block';
    });
}

function openLogoutModal()  { document.getElementById('logout-modal').classList.add('show'); }
function closeLogoutModal() { document.getElementById('logout-modal').classList.remove('show'); }

function confirmLogout() {
  window._signOut(window._fbAuth).catch(() => {});
  currentUser = null;
  closeLogoutModal();
  document.getElementById('login-email').value    = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = '';
  showLoginScreen();
}

function setupLoginEvents() {
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('login-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-password').focus();
  });
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('logout-btn').addEventListener('click', openLogoutModal);
  document.getElementById('logout-cancel-btn').addEventListener('click', closeLogoutModal);
  document.getElementById('logout-confirm-btn').addEventListener('click', confirmLogout);
  document.getElementById('logout-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('logout-modal')) closeLogoutModal();
  });
}

// ============================================================
// INIT
// ============================================================
function init() {
  setupEvents();
  setupClearDataEvents();
  setupRightClickDisable();
  setupMobileTabs();
  setupLoginEvents();
  initConnStatus();

  // Initialize Test Filters
  const testSubjFilter = document.getElementById('test-filter-subj');
  const testTypeFilter = document.getElementById('test-filter-type');
  if (testSubjFilter) {
    Object.keys(SUBJECT_LABELS).forEach(k => {
      let opt = document.createElement('option');
      opt.value = k; opt.textContent = SUBJECT_LABELS[k];
      testSubjFilter.appendChild(opt);
    });
    testSubjFilter.addEventListener('change', () => { triggerHaptic(30); renderTestTable(); });
    testTypeFilter.addEventListener('change', () => { triggerHaptic(30); renderTestTable(); });
  }

  // Re-render on viewport breakpoint cross (orientation change etc.)
  let _lastMobile = window.innerWidth <= 768;
  window.addEventListener('resize', () => {
    if (!currentUser) return; // never render if not authenticated
    const nowMobile = window.innerWidth <= 768;
    if (nowMobile !== _lastMobile) {
      _lastMobile = nowMobile;
      if (currentSection === 'planner')   renderPlanner();
      if (currentSection === 'test')      renderTestTable();
      if (currentSection === 'subjects')  renderSubjectsInternal();
    }
  });

}
// init() is called by the Firebase module script after SDK is ready

// ============================================================
// ZOOM BLOCKING (Ctrl+Wheel / Ctrl+Plus / Gestures)
// ============================================================
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
  }
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && (e.key === '+' || e.key === '=' || e.key === '-')) {
    e.preventDefault();
  }
});

document.addEventListener('gesturestart', (e) => {
  e.preventDefault();
});
