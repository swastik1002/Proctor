import { state, html, put, $, $$, api, bus, icon, raw, esc, bind, toast, fail, errMsg, initials, formModal, field, modal, badge } from './core.js';

const root = $('#root');
const STAFF_NAV = [['dashboard', 'Dashboard', 'dashboard'], ['classrooms', 'Classrooms', 'school'], ['students', 'Students', 'users'], ['questions', 'Question Bank', 'help'], ['exams', 'Exams', 'file'], ['live', 'Live Exams', 'radio'], ['results', 'Results', 'chart'], ['reports', 'Reports', 'pie'], ['notifications', 'Notifications', 'bell'], ['logs', 'Activity Logs', 'log'], ['settings', 'Settings', 'settings']];
const STUDENT_NAV = [['dashboard', 'Dashboard', 'dashboard'], ['classrooms', 'My Classrooms', 'school'], ['upcoming', 'Upcoming Exams', 'clock'], ['active', 'Active Exams', 'radio'], ['results', 'Results', 'chart'], ['history', 'Exam History', 'history'], ['profile', 'Profile', 'user'], ['notifications', 'Notifications', 'bell']];

let cleanups = [];
let ws = null, wsRetry = 0, wsTimer = null;
let unread = 0, activeCount = 0;

/* ---------------- boot ---------------- */
async function boot() {
  bus.on('unauth', () => { if (state.user) { state.user = null; state.csrf = null; closeWS(); renderLogin('Your session ended. Please sign in again.'); } });
  try { const me = await api('GET', '/auth/me', undefined, { noAuthRedirect: true }); state.user = me.user; state.csrf = me.csrf; startApp(); }
  catch { renderLogin(); }
}

/* ---------------- login ---------------- */
function renderLogin(note) {
  cleanup(); closeWS();
  put(root, html`<div class="login">
    <section class="login-art" aria-hidden="false">
      <div class="brand"><span class="brand-mark"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg></span><div>Proctor<small>Classrooms &amp; Exams</small></div></div>
      <div><h2>Run every exam like you're in the room.</h2>
        <ul><li>${icon('radio')} Live monitoring with real-time controls</li><li>${icon('refresh')} Restart, pause and extend without losing a single answer</li><li>${icon('shield')} Server-timed exams and a full audit trail</li></ul></div>
      <p class="small" style="color:var(--chalk-dim)">Riverside Public School · Demo environment</p>
    </section>
    <section class="login-form"><div class="login-card stack">
      <div><h1>Sign in</h1><p class="muted" style="margin-top:6px">Use your school account to continue.</p></div>
      ${note ? html`<div class="notice warn" role="alert">${icon('info')}<span>${note}</span></div>` : ''}
      <form id="login" class="stack" novalidate>
        ${field('Email', html`<input class="input" name="email" type="email" autocomplete="username" autofocus required placeholder="you@school.edu">`)}
        ${field('Password', html`<input class="input" name="password" type="password" autocomplete="current-password" required placeholder="Your password">`)}
        <div class="err" id="login-err" role="alert" style="color:var(--pen);font-weight:500;min-height:1.2em"></div>
        <button class="btn btn-primary btn-block" type="submit">Sign in</button>
      </form>
      <div class="stack-sm"><span class="lbl">Try a demo account</span>
        <div class="demo-row">
          <button class="demo-btn" data-e="admin@school.edu" data-p="Admin@123"><b>Admin</b><span>Full access</span></button>
          <button class="demo-btn" data-e="priya.nair@school.edu" data-p="Teacher@123"><b>Teacher</b><span>Live exam</span></button>
          <button class="demo-btn" data-e="aarav.sharma@student.school.edu" data-p="Student@123"><b>Student</b><span>Take the exam</span></button>
        </div></div>
      <div class="row between"><span class="small muted">Demo data is reset when the database is deleted.</span><button class="btn btn-ghost btn-sm" id="th" aria-label="Toggle theme">${icon('moon')}</button></div>
    </div></section></div>`);
  const form = $('#login');
  $$('.demo-btn').forEach((b) => (b.onclick = () => { form.email.value = b.dataset.e; form.password.value = b.dataset.p; form.password.focus(); }));
  $('#th').onclick = toggleTheme;
  form.onsubmit = async (e) => {
    e.preventDefault(); const btn = form.querySelector('[type=submit]'); $('#login-err').textContent = '';
    if (!form.email.value || !form.password.value) { $('#login-err').textContent = 'Enter your email and password.'; return; }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    try { const r = await api('POST', '/auth/login', { email: form.email.value, password: form.password.value }, { noAuthRedirect: true }); state.user = r.user; state.csrf = r.csrf; location.hash = '#/dashboard'; startApp(); }
    catch (err) { $('#login-err').textContent = errMsg(err); btn.disabled = false; btn.textContent = 'Sign in'; }
  };
}

function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t; try { localStorage.setItem('proctor:theme', t); } catch { /* ignore */ }
  $$('[data-theme-ic]').forEach((el) => (el.innerHTML = icon(t === 'dark' ? 'sun' : 'moon').__raw));
}

/* ---------------- shell ---------------- */
function startApp() {
  connectWS();
  window.onhashchange = route;
  window.onbeforeunload = null;
  if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/dashboard';
  route();
  refreshBadges();
}
const isStudent = () => state.user?.role === 'student';
const navItems = () => (isStudent() ? STUDENT_NAV : STAFF_NAV);

function renderShell() {
  const u = state.user;
  put(root, html`<div class="app">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <div class="brand"><span class="brand-mark"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg></span><div>Proctor<small>${u.role === 'admin' ? 'Administrator' : u.role === 'teacher' ? 'Teacher portal' : 'Student portal'}</small></div></div>
      <div class="nav-sep"></div>
      <nav class="nav" id="nav">${navItems().map(([k, l, ic]) => html`<a href="#/${k}" data-k="${k}">${icon(ic)}<span>${l}</span>${k === 'notifications' ? html`<span class="count" id="nb-unread" hidden></span>` : ''}${(k === 'live' && !isStudent()) || (k === 'active' && isStudent()) ? html`<span class="count" id="nb-live" hidden></span>` : ''}</a>`)}</nav>
      <div class="sidebar-foot"><div class="row"><span class="avatar" style="background:rgba(255,255,255,.12);color:#fff">${initials(u.name)}</span><div class="grow"><div style="color:#fff;font-weight:600" class="truncate">${u.name}</div><div class="truncate">${u.email}</div></div></div></div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <div class="main">
      <header class="topbar">
        <button class="iconbtn menu-btn" id="menu" aria-label="Open menu">${icon('menu')}</button>
        <div class="crumb" id="crumb"></div><div class="grow"></div>
        <span id="ws-state" class="small muted" title="Real-time connection"></span>
        <button class="iconbtn" id="theme" aria-label="Toggle light or dark theme"><span data-theme-ic>${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</span></button>
        <a class="iconbtn" href="#/notifications" aria-label="Notifications">${icon('bell')}<span class="dot" id="bell-dot" hidden></span></a>
        <div class="relative"><button class="userchip" id="uchip" aria-haspopup="menu"><span class="avatar">${initials(u.name)}</span><span class="uname small" style="font-weight:600">${u.name.split(' ')[0]}</span>${icon('down')}</button></div>
      </header>
      <main class="view" id="view" tabindex="-1"></main>
    </div></div>`);
  $('#menu').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('open'); };
  $('#scrim').onclick = closeNav; $('#theme').onclick = toggleTheme;
  $('#uchip').onclick = (e) => {
    document.querySelectorAll('.pop.floating').forEach((x) => x.remove());
    const pop = document.createElement('div'); pop.className = 'pop floating';
    pop.innerHTML = `<div style="padding:8px 10px"><b>${esc(u.name)}</b><div class="small muted">${esc(u.email)} · ${esc(u.role)}</div></div><hr><a href="#/${isStudent() ? 'profile' : 'settings'}">${icon('settings').__raw} ${isStudent() ? 'Profile' : 'Settings'}</a><button data-out>${icon('logout').__raw} Sign out</button>`;
    e.currentTarget.parentElement.appendChild(pop);
    const off = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', off); } };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
    pop.querySelector('[data-out]').onclick = logout; pop.querySelector('a').onclick = () => pop.remove();
  };
  updateBadges();
}
const closeNav = () => { $('#sidebar')?.classList.remove('open'); $('#scrim')?.classList.remove('open'); };
async function logout() { try { await api('POST', '/auth/logout'); } catch { /* ignore */ } state.user = null; state.csrf = null; closeWS(); location.hash = ''; renderLogin(); }

function updateBadges() {
  const a = $('#nb-unread'); if (a) { a.hidden = !unread; a.textContent = unread > 99 ? '99+' : unread; }
  const d = $('#bell-dot'); if (d) { d.hidden = !unread; d.textContent = unread > 9 ? '9+' : unread; }
  const l = $('#nb-live'); if (l) { l.hidden = !activeCount; l.textContent = activeCount; }
}
async function refreshBadges() {
  try {
    const n = await api('GET', '/notifications?size=1'); unread = n.unread;
    const e = isStudent() ? await api('GET', '/student/exams?scope=active') : await api('GET', '/exams?status=live,paused&size=1');
    activeCount = isStudent() ? e.items.length : e.total;
  } catch { /* ignore */ }
  updateBadges();
}

/* ---------------- router ---------------- */
function cleanup() { cleanups.forEach((f) => { try { f(); } catch { /* ignore */ } }); cleanups = []; }
const PAGES = {
  staff: { dashboard: ['pages-a', 'dashboard'], classrooms: ['pages-a', 'classrooms'], students: ['pages-a', 'students'], questions: ['pages-b', 'questions'], exams: ['pages-b', 'exams'], live: ['pages-c', 'live'], results: ['pages-c', 'results'], attempt: ['pages-c', 'attempt'], reports: ['pages-c', 'reports'], notifications: ['pages-c', 'notifications'], logs: ['pages-c', 'logs'], settings: ['pages-c', 'settings'] },
  student: { dashboard: ['student', 'dashboard'], classrooms: ['student', 'classrooms'], upcoming: ['student', 'upcoming'], active: ['student', 'active'], results: ['student', 'results'], result: ['student', 'result'], history: ['student', 'history'], profile: ['student', 'profile'], notifications: ['pages-c', 'notifications'] },
};
let routeSeq = 0;
async function route() {
  if (!state.user) return;
  cleanup(); closeNav();
  const [path, query] = location.hash.slice(2).split('?');
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  const q = Object.fromEntries(new URLSearchParams(query || ''));
  const seq = ++routeSeq;
  if (seg[0] === 'take' && isStudent()) { // distraction-free exam screen, no shell
    const mod = await import('./exam-taker.js'); if (seq !== routeSeq) return;
    put(root, html`<div id="exam-root"></div>`);
    mod.takeExam({ el: $('#exam-root'), id: seg[1], onLeave: (f) => cleanups.push(f), go: (h) => (location.hash = h) }); return;
  }
  if (!$('#view')) renderShell();
  const table = PAGES[isStudent() ? 'student' : 'staff'];
  const key = table[seg[0]] ? seg[0] : 'dashboard';
  if (!table[seg[0]]) { location.hash = '#/dashboard'; return; }
  $$('#nav a').forEach((a) => { if (a.dataset.k === key || (key === 'attempt' && a.dataset.k === 'results') || (key === 'result' && a.dataset.k === 'results')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const label = navItems().find(([k]) => k === key || (key === 'attempt' && k === 'results') || (key === 'result' && k === 'results'));
  $('#crumb').textContent = label ? label[1] : '';
  const view = $('#view'); view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
  put(view, html`<div class="stack"><div class="skel" style="height:34px;width:240px"></div><div class="skel" style="height:120px"></div><div class="skel" style="height:260px"></div></div>`);
  document.title = `${label ? label[1] + ' · ' : ''}Proctor`;
  try {
    const [file, fn] = table[key];
    const mod = await import(`./${file}.js`); if (seq !== routeSeq) return;
    const ctx = { el: view, id: seg[1], sub: seg[2], query: q, onLeave: (f) => cleanups.push(f), go: (h) => (location.hash = h), refreshBadges, rerender: route };
    await mod[fn](ctx);
  } catch (e) {
    console.error(e);
    put(view, html`<div class="errbox"><div class="row">${icon('alert')}<span>${errMsg(e)}</span></div><button class="btn btn-sm" id="retry">Try again</button></div>`);
    $('#retry')?.addEventListener('click', route);
  }
  window.scrollTo(0, 0);
}

/* ---------------- websocket ---------------- */
function connectWS() {
  closeWS(true);
  try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); } catch { return; }
  ws.onopen = () => { wsRetry = 0; setWs(true); bus.emit('ws:open'); };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    bus.emit('ws:' + m.type, m); bus.emit('ws', m);
    if (m.type === 'notification') { unread++; updateBadges(); if (!location.hash.startsWith('#/take/')) toast(m.title, m.body); }
    if (m.type === 'exam' || m.type === 'monitor') refreshBadgesSoon();
  };
  ws.onclose = () => { setWs(false); bus.emit('ws:close'); if (state.user) { wsTimer = setTimeout(connectWS, Math.min(15000, 1000 * 2 ** wsRetry++)); } };
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
}
let bs; const refreshBadgesSoon = () => { clearTimeout(bs); bs = setTimeout(refreshBadges, 1200); };
function closeWS(keep) { clearTimeout(wsTimer); if (ws) { ws.onclose = null; try { ws.close(); } catch { /* ignore */ } ws = null; } if (!keep) setWs(false); }
function setWs(on) { const el = $('#ws-state'); if (el) el.innerHTML = on ? '<span class="pulse" style="background:var(--ok)"></span> Live' : '<span style="color:var(--pen)">Reconnecting…</span>'; }
bus.on('notifications:read', () => { unread = 0; updateBadges(); });
bus.on('notifications:set', (n) => { unread = n; updateBadges(); });

boot();
