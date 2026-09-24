import { state, html, raw, put, $, $$, api, qs, bus, icon, bind, toast, fail, confirmDialog, formModal, modal, field, sel, badge, skeleton, empty, errorBox, pager, kpi, fmtDT, fmtDTfull, fmtTime, fmtDate, rel, num, pct, clock, dur, initials, debounce, TYPES, download, errMsg, esc, STATUS } from './core.js';
import { describe, actionIcon, verb } from './charts.js';

const isAdmin = () => state.user.role === 'admin';
const LETTERS = 'ABCDEFGHIJ';

/* ============================== live exams ============================== */
export async function live(ctx) {
  if (ctx.id) return monitor(ctx);
  const el = ctx.el;
  const r = await api('GET', '/exams' + qs({ status: 'live,paused,scheduled', size: 50 }));
  const running = r.items.filter((e) => ['live', 'paused'].includes(e.status)), next = r.items.filter((e) => e.status === 'scheduled');
  put(el, html`<div class="page-head"><div><h1>Live exams</h1><p>Pick a running exam to monitor every student in real time.</p></div></div>
    ${running.length ? html`<div class="auto-grid">${running.map((e) => html`<a class="card card-pad stack-sm" href="#/live/${e.id}" style="text-decoration:none;color:inherit;border-color:var(--hi-2)"><div class="row between">${badge(e.status)}<span class="muted small">${e.classroom_name}</span></div><h2>${e.name}</h2>
      <div class="row" style="gap:20px"><div><b class="mono" style="font-size:1.4rem">${e.in_progress}</b><div class="small muted">taking now</div></div><div><b class="mono" style="font-size:1.4rem">${e.submitted}/${e.enrolled}</b><div class="small muted">submitted</div></div></div><span class="btn btn-hi btn-sm" style="align-self:flex-start">${icon('radio')} Open monitor</span></a>`)}</div>` : empty('No exams are running', 'Start a scheduled exam from its page, or wait for the scheduled time.', 'radio', html`<a class="btn btn-primary" href="#/exams">${icon('file')} Go to exams</a>`)}
    ${next.length ? html`<h2 style="margin:26px 0 12px">Coming up</h2><div class="card"><div class="table-wrap"><table class="tbl"><tbody>${next.map((e) => html`<tr><td><a class="name" href="#/exams/${e.id}">${e.name}</a><div class="sub">${e.classroom_name}</div></td><td>${fmtDT(e.start_at)}</td><td class="actions"><a class="btn btn-sm" href="#/exams/${e.id}">Manage</a></td></tr>`)}</tbody></table></div></div>` : ''}`);
}

async function monitor(ctx) {
  const el = ctx.el; const id = +ctx.id; let S = null, at = 0, flt = '', view = localStorage.getItem('proctor:mview') || 'grid', panel = null;
  const frozen = (r) => r.paused || S.exam.status === 'paused';
  const left = (r) => (r.status === 'submitted' || r.status === 'time_expired' || r.status === 'not_started' ? null : frozen(r) ? r.remainingMs : Math.max(0, r.remainingMs - (performance.now() - at)));
  const tm = (r) => { const v = left(r); return v == null ? '—' : clock(v); };
  async function fetchSnap() {
    try { S = await api('GET', `/exams/${id}/monitor`); at = performance.now(); draw(); if (panel) refreshPanel(); }
    catch (e) { if (!S) put(el, errorBox(e)); else toast('Live data delayed', errMsg(e), 'err'); }
  }
  const C = [['active', 'Active'], ['idle', 'Idle'], ['submitted', 'Submitted'], ['time_expired', 'Time expired'], ['not_started', 'Not started']];
  const seatState = (r) => (r.paused ? 'paused' : r.status);
  function draw() {
    const x = S.exam; const rows = S.rows.filter((r) => !flt || r.status === flt); const running = ['live', 'paused'].includes(x.status);
    const avg = S.rows.length ? Math.round(S.rows.reduce((a, r) => a + (r.status === 'not_started' ? 0 : r.progress), 0) / S.rows.length) : 0;
    put(el, html`<div class="mon-head"><div><a class="small muted" href="#/live">← Live exams</a><div class="row" style="gap:12px;margin-top:6px;flex-wrap:wrap"><h1>${x.name}</h1>${badge(x.status)}<span class="tag">v${x.version}</span></div>
      <p class="muted small" style="margin-top:4px">${S.total} students · ${S.questions} questions · ${x.duration} min · window closes ${fmtTime(x.end_at)}${x.status === 'paused' ? ' · timers frozen' : ''}</p></div>
      <div class="row wrap">${running ? html`${x.status === 'live' ? html`<button class="btn" data-act="pauseall">${icon('pause')} Pause all</button>` : html`<button class="btn btn-primary" data-act="resumeall">${icon('play')} Resume all</button>`}<a class="btn" href="#/exams/${id}">${icon('edit')} Edit exam</a><button class="btn btn-outline-danger" data-act="restartall">${icon('refresh')} Restart for all</button><button class="btn btn-outline-danger" data-act="endexam">${icon('stop')} End exam</button>` : html`<a class="btn" href="#/results/${id}">${icon('chart')} Results</a><a class="btn" href="#/exams/${id}">Manage exam</a>`}</div></div>
      ${x.status === 'paused' ? html`<div class="notice warn" style="margin-bottom:14px">${icon('pause')}<span><b>The exam is paused.</b> Students see a pause message; their timers are frozen and their answers are safe.</span></div>` : ''}
      <div class="counts">${C.map(([k, l]) => html`<button class="count-chip" data-act="flt" data-k="${k}" aria-pressed="${flt === k}"><b>${S.counts[k]}</b><span>${l}</span></button>`)}<div class="card card-pad grow" style="min-width:200px;display:flex;flex-direction:column;justify-content:center;gap:6px"><div class="row between small muted"><span>Overall progress</span><b style="color:var(--ink)">${avg}%</b></div><div class="bar hi"><i style="width:${avg}%"></i></div></div></div>
      <div class="row between wrap" style="margin-bottom:12px"><div class="row"><div class="row" role="group" aria-label="View"><button class="chip" data-act="view" data-k="grid" aria-pressed="${view === 'grid'}">${icon('grid')} Seats</button><button class="chip" data-act="view" data-k="table" aria-pressed="${view === 'table'}">${icon('list')} Table</button></div>${flt ? html`<button class="chip" data-act="flt" data-k="">Clear filter ${icon('x')}</button>` : ''}</div><span class="small muted" id="upd">${icon('radio')} Updated ${rel(Date.now() - (performance.now() - at))}</span></div>
      ${rows.length ? (view === 'grid' ? html`<div class="seats">${rows.map((r) => html`<button class="seat ${seatState(r)}" data-act="open" data-sid="${r.studentId}" aria-label="${r.name}, ${STATUS[r.status]}">
          ${r.restarts ? html`<span class="tag restarts" title="${r.restarts} restart(s)">↻ ${r.restarts}</span>` : ''}<div><div class="nm truncate" style="max-width:${r.restarts ? '75%' : '100%'}">${r.name}</div><div class="small muted mono">${r.roll_no}</div></div>
          <div class="st">${r.paused ? badge('paused', 'Paused') : badge(r.status)}<span>${r.status === 'not_started' ? '' : `Q ${Math.min(r.current, r.total)}/${r.total}`}</span></div>
          <div class="bar ${r.status === 'active' ? '' : r.status === 'idle' ? 'hi' : ''}"><i style="width:${r.progress}%"></i></div>
          <div class="row between"><span class="tm" data-r="${r.studentId}">${tm(r)}</span><span class="small muted">${r.status === 'submitted' || r.status === 'time_expired' ? (r.needsManual ? 'needs marking' : `${num(r.score)} pts`) : r.lastActivity ? rel(r.lastActivity) : ''}</span></div></button>`)}</div>`
        : html`<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Student</th><th>Status</th><th>Question</th><th>Progress</th><th>Time left</th><th>Last activity</th><th>Submission</th><th></th></tr></thead><tbody>${rows.map((r) => html`<tr><td><b>${r.name}</b>${r.restarts ? html` <span class="tag">↻ ${r.restarts}</span>` : ''}<div class="sub mono">${r.roll_no}</div></td><td>${r.paused ? badge('paused', 'Paused') : badge(r.status)}</td><td>${r.status === 'not_started' ? '—' : `${Math.min(r.current, r.total)} / ${r.total}`}</td><td style="min-width:130px"><div class="row"><div class="bar grow"><i style="width:${r.progress}%"></i></div><span class="small mono">${r.progress}%</span></div></td><td class="mono" data-r="${r.studentId}">${tm(r)}</td><td class="small">${r.lastActivity ? rel(r.lastActivity) : '—'}</td><td class="small">${r.status === 'submitted' || r.status === 'time_expired' ? html`${badge(r.rawStatus === 'force_submitted' ? 'force_submitted' : r.status)} ${r.needsManual ? '· needs marking' : ''}` : 'Not submitted'}</td><td class="actions"><button class="btn btn-sm" data-act="open" data-sid="${r.studentId}">Manage</button></td></tr>`)}</tbody></table></div></div>`)
        : empty('No students in this state', 'Try another filter.', 'users')}`);
  }
  put(el, skeleton(4)); await fetchSnap();
  const timer = setInterval(() => { if (!S) return; $$('[data-r]', el).forEach((n) => { const r = S.rows.find((z) => z.studentId === +n.dataset.r); if (r) { n.textContent = tm(r); const v = left(r); n.classList.toggle('low', v != null && v < 300000); } }); if (panel) $$('[data-pr]').forEach((n) => { const r = S.rows.find((z) => z.studentId === panel.sid); if (r) n.textContent = tm(r); }); const u = $('#upd', el); if (u && performance.now() - at > 15000) u.style.color = 'var(--pen)'; }, 1000);
  const poll = setInterval(fetchSnap, 8000);
  const off = bus.on('ws:monitor', (m) => { if (m.examId === id) deb(); }); const deb = debounce(fetchSnap, 300);
  const off2 = bus.on('ws:open', fetchSnap);
  ctx.onLeave(() => { clearInterval(timer); clearInterval(poll); off(); off2(); closePanel(); });

  /* ---- student panel ---- */
  function closePanel() { $('.drawer-back')?.remove(); panel = null; }
  async function openPanel(sid) {
    panel = { sid }; $('.drawer-back')?.remove();
    const back = document.createElement('div'); back.className = 'drawer-back'; back.innerHTML = '<aside class="drawer" role="dialog" aria-modal="true" aria-label="Student controls"></aside>'; document.body.appendChild(back);
    back.onmousedown = (e) => { if (e.target === back) closePanel(); };
    const esc2 = (e) => { if (e.key === 'Escape') { closePanel(); document.removeEventListener('keydown', esc2); } }; document.addEventListener('keydown', esc2);
    bind(back, panelActions); refreshPanel();
  }
  async function refreshPanel() {
    if (!panel) return; const r = S.rows.find((z) => z.studentId === panel.sid); const box = $('.drawer'); if (!r || !box) return;
    let hist = panel.hist; if (r.attemptId && (panel.aid !== r.attemptId || !hist)) { try { const d = await api('GET', `/attempts/${r.attemptId}`); hist = panel.hist = d.history; panel.aid = r.attemptId; } catch { hist = hist || []; } }
    const inprog = r.rawStatus === 'in_progress'; const done = ['submitted', 'time_expired', 'force_submitted'].includes(r.rawStatus); const running = ['live', 'paused'].includes(S.exam.status);
    put(box, html`<div class="row between"><div class="row"><span class="avatar" style="width:44px;height:44px">${initials(r.name)}</span><div><h2>${r.name}</h2><div class="muted small mono">${r.roll_no}${r.section ? ' · ' + r.section : ''}</div></div></div><button class="iconbtn" data-act="closep" aria-label="Close panel">${icon('x')}</button></div>
      <div class="row wrap" style="margin:16px 0">${r.paused ? badge('paused', 'Paused for this student') : badge(r.status)}${r.attemptNo ? html`<span class="tag">Attempt ${r.attemptNo}</span>` : ''}${r.restarts ? html`<span class="tag">${r.restarts} restart${r.restarts > 1 ? 's' : ''}</span>` : ''}</div>
      <dl class="kv"><dt>Time remaining</dt><dd class="mono" data-pr>${tm(r)}${r.extraMs ? html` <span class="muted small">(+${Math.round(r.extraMs / 60000)} min extra)</span>` : ''}</dd><dt>Current question</dt><dd>${r.status === 'not_started' ? '—' : `${Math.min(r.current, r.total)} of ${r.total}`}</dd><dt>Answered</dt><dd>${r.answered} of ${r.total} (${r.progress}%)</dd><dt>Last activity</dt><dd>${r.lastActivity ? rel(r.lastActivity) : '—'}</dd>${done ? html`<dt>Score</dt><dd>${num(r.score)} (${pct(r.percentage)})${r.needsManual ? ' · needs marking' : ''}</dd>` : ''}${r.paused && r.pauseReason ? html`<dt>Pause reason</dt><dd>${r.pauseReason}</dd>` : ''}</dl>
      ${running ? html`<h3 style="margin:22px 0 10px">Controls</h3><div class="stack-sm">
        ${inprog ? html`<div class="grid g2" style="gap:8px">${r.paused ? html`<button class="btn btn-primary" data-act="resume" data-a="${r.attemptId}">${icon('play')} Resume student</button>` : html`<button class="btn" data-act="pause" data-a="${r.attemptId}">${icon('pause')} Pause student</button>`}<button class="btn" data-act="extend" data-a="${r.attemptId}">${icon('clock')} Extend time</button></div><button class="btn btn-outline-danger" data-act="force" data-a="${r.attemptId}">${icon('send')} Force submit</button>` : ''}
        ${r.attemptId && r.rawStatus !== 'not_started' ? html`<button class="btn btn-outline-danger" data-act="restart" data-a="${r.attemptId}">${icon('refresh')} Restart exam for this student</button>` : ''}${r.status === 'not_started' ? html`<p class="muted small">This student has not started yet.</p>` : ''}</div>` : ''}
      ${r.attemptId && r.rawStatus !== 'not_started' ? html`<div class="row" style="margin-top:12px"><button class="btn btn-sm" data-act="viewatt" data-a="${r.attemptId}">${icon('eye')} View attempt &amp; answers</button></div>` : ''}
      <h3 style="margin:24px 0 10px">Attempt history</h3>${hist?.length ? html`<div class="stack-sm">${hist.map((h) => html`<div class="card card-pad" style="padding:10px 12px"><div class="row between"><b>Attempt ${h.attempt_no} <span class="muted small mono">#${h.id}</span></b>${badge(h.status)}</div><div class="small muted" style="margin-top:4px">${h.started_at ? fmtDT(h.started_at) : 'Not started'}${h.ended_at ? ' → ' + fmtTime(h.ended_at) : ''}${h.duration_ms ? ' · ' + dur(h.duration_ms) : ''}${h.score != null && h.status !== 'in_progress' ? ` · ${num(h.score)} pts` : ''}</div>${h.restart_reason ? html`<div class="small" style="margin-top:4px;color:var(--pen-ink)">Restarted: ${h.restart_reason}</div>` : ''}</div>`)}</div>` : html`<p class="muted small">No attempts yet.</p>`}`);
  }
  const act = (fn, ok) => async (t) => { try { await fn(t); if (ok) toast(ok, '', 'ok'); await fetchSnap(); } catch (e) { if (!e.cancelled) fail(e); } };
  const panelActions = {
    closep: closePanel, viewatt: (t) => { closePanel(); ctx.go(`#/attempt/${t.dataset.a}`); },
    pause: (t) => formModal({ title: 'Pause this student', sub: 'Their timer freezes and they see a pause message. Answers stay saved.', submit: 'Pause', fields: field('Reason (shown to the student)', html`<input class="input" name="reason" maxlength="300" placeholder="e.g. Come to the front desk">`), onSubmit: async (f, m) => { await api('POST', `/attempts/${t.dataset.a}/pause`, { reason: f.reason }); m.close(); toast('Student paused', '', 'ok'); fetchSnap(); } }),
    resume: act((t) => api('POST', `/attempts/${t.dataset.a}/resume`, {}), 'Student resumed'),
    extend: (t) => formModal({ title: 'Extend time', fields: html`<div class="stack">${field('Minutes to add', html`<input class="input" name="minutes" type="number" min="1" max="240" value="10" required autofocus>`)}${field('Reason', html`<input class="input" name="reason" maxlength="300" placeholder="Optional">`)}</div>`, submit: 'Add time', onSubmit: async (f, m) => { await api('POST', `/attempts/${t.dataset.a}/extend`, { minutes: +f.minutes, reason: f.reason }); m.close(); toast('Time extended', `${f.minutes} min added`, 'ok'); fetchSnap(); } }),
    force: async (t) => { if (await confirmDialog({ title: 'Force submit this attempt?', message: 'The attempt is submitted with the answers saved so far and the student is locked out of it.', confirmText: 'Force submit', danger: true })) act((x) => api('POST', `/attempts/${x.dataset.a}/force-submit`, { reason: 'Force submitted by staff' }), 'Attempt submitted')(t); },
    restart: (t) => restartModal(t.dataset.a),
  };
  function restartModal(aid) {
    const r = S.rows.find((z) => String(z.attemptId) === String(aid));
    formModal({ title: `Restart exam for ${r?.name || 'student'}`, sub: 'Only this student is reset. Everyone else is unaffected.', size: 'wide', submit: 'Restart exam', danger: true, fields: html`<div class="stack">
      <div class="notice">${icon('info')}<span>Attempt ${r?.attemptNo} is kept in history as <b>Restarted</b>. A new attempt with a new ID is created and the student is moved back to <b>Not started</b>.</span></div>
      ${field('Restart reason (required)', html`<input class="input" name="reason" required minlength="3" maxlength="300" placeholder="e.g. Browser crashed and answers were lost" autofocus>`)}
      <div class="field"><label>Question set</label><label class="check"><input type="radio" name="questionSet" value="same" checked><span>Same question set and order</span></label><label class="check"><input type="radio" name="questionSet" value="new"><span>New question set (reshuffle questions and options)</span></label></div>
      <label class="check"><input type="checkbox" name="clearAnswers" checked><span>Clear previous answers<br><span class="muted small">Untick to carry the saved answers into the new attempt.</span></span></label></div>`,
      onSubmit: async (f, m) => { const res = await api('POST', `/attempts/${aid}/restart`, { reason: f.reason, questionSet: f.questionSet, clearAnswers: f.clearAnswers }); m.close(); toast('Exam restarted', `New attempt #${res.newAttemptId} created`, 'ok'); panel && (panel.hist = null); fetchSnap(); } });
  }
  bind(el, {
    retry: fetchSnap, flt: (t) => { flt = flt === t.dataset.k ? '' : t.dataset.k; draw(); },
    view: (t) => { view = t.dataset.k; localStorage.setItem('proctor:mview', view); draw(); }, open: (t) => openPanel(+t.dataset.sid),
    pauseall: () => formModal({ title: 'Pause exam for everyone', sub: 'All timers freeze until you resume.', submit: 'Pause exam', fields: field('Reason (optional)', html`<input class="input" name="reason" maxlength="300">`), onSubmit: async (f, m) => { await api('POST', `/exams/${id}/status`, { action: 'pause', reason: f.reason }); m.close(); toast('Exam paused', '', 'ok'); fetchSnap(); } }),
    resumeall: act(() => api('POST', `/exams/${id}/status`, { action: 'resume' }), 'Exam resumed'),
    endexam: async () => { const n = S.counts.active + S.counts.idle; if (await confirmDialog({ title: 'End the exam for everyone?', danger: true, confirmText: 'End exam', message: html`${n} student${n === 1 ? '' : 's'} still working will be force-submitted with their saved answers. This cannot be undone.` })) act(() => api('POST', `/exams/${id}/status`, { action: 'end', reason: 'Ended by staff' }), 'Exam ended')(); },
    restartall: async () => {
      let pv; try { pv = await api('GET', `/exams/${id}/restart-preview`); } catch (e) { return fail(e); }
      formModal({ title: 'Restart exam for all students', size: 'wide', danger: true, submit: 'Restart for everyone', fields: html`<div class="stack">
        <div class="notice pen">${icon('alert')}<div><b>${pv.enrolled} students will be reset to Not Started.</b><div class="small" style="margin-top:4px">${pv.inProgress} in progress will be ended · ${pv.completed} already finished · timers and answers reset. Old attempts stay in history; nothing is deleted.</div></div></div>
        ${field('Restart reason (required)', html`<input class="input" name="reason" required minlength="3" maxlength="300" placeholder="e.g. Wrong paper was shared" autofocus>`)}
        <div class="field"><label>Question set</label><label class="check"><input type="radio" name="questionSet" value="same" checked><span>Same questions and order</span></label><label class="check"><input type="radio" name="questionSet" value="new"><span>New question set (reshuffled)</span></label></div>
        ${field('Type RESTART ALL to confirm', html`<input class="input mono" name="confirm" autocomplete="off" placeholder="RESTART ALL">`)}</div>`,
        onMount: (m, form) => { const b = m.el.querySelector('[type=submit]'); const chk = () => (b.disabled = form.elements.confirm.value !== 'RESTART ALL'); form.elements.confirm.oninput = chk; chk(); },
        onSubmit: async (f, m) => { const res = await api('POST', `/exams/${id}/restart-all`, { confirm: f.confirm, reason: f.reason, questionSet: f.questionSet }); m.close(); toast('Exam restarted for everyone', `${res.restarted} students reset`, 'ok'); fetchSnap(); } });
    },
  });
}

/* ============================== results ============================== */
export async function results(ctx) {
  const el = ctx.el;
  if (!ctx.id) {
    const r = await api('GET', '/exams' + qs({ status: 'live,paused,completed,archived', size: 100 }));
    put(el, html`<div class="page-head"><div><h1>Results</h1><p>Scores, marking and publication for every exam.</p></div></div><div class="card">${r.items.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Exam</th><th>Classroom</th><th>Status</th><th>Submitted</th><th>Published</th><th></th></tr></thead><tbody>${r.items.map((e) => html`<tr><td><a class="name" href="#/results/${e.id}">${e.name}</a><div class="sub">${fmtDate(e.start_at)}</div></td><td>${e.classroom_name}</td><td>${badge(e.status)}</td><td>${e.submitted} / ${e.enrolled}</td><td>${e.results_released ? badge('ok', 'Published') : badge('draft', 'Hidden')}</td><td class="actions"><a class="btn btn-sm" href="#/results/${e.id}">Open</a></td></tr>`)}</tbody></table></div>` : empty('No results yet', 'Results appear once an exam has started.', 'chart')}</div>`);
    return;
  }
  const id = +ctx.id; let D, flt = 'all', showRestarted = false;
  async function load() { try { D = await api('GET', `/exams/${id}/results`); draw(); } catch (e) { put(el, errorBox(e)); } }
  const fin = (s) => ['submitted', 'time_expired', 'force_submitted'].includes(s);
  function draw() {
    const x = D.exam, st = D.stats;
    let rows = D.rows.filter((r) => showRestarted || r.status !== 'restarted');
    if (flt === 'marking') rows = rows.filter((r) => r.needs_manual); if (flt === 'pass') rows = rows.filter((r) => fin(r.status) && r.passed); if (flt === 'fail') rows = rows.filter((r) => fin(r.status) && !r.passed);
    put(el, html`<div class="page-head"><div><a class="small muted" href="#/results">← All results</a><div class="row" style="gap:12px;margin-top:6px"><h1>${x.name}</h1>${badge(x.status)}${x.results_released ? badge('ok', 'Published to students') : badge('draft', 'Hidden from students')}</div><p>${num(x.total_marks)} total marks · pass at ${num(x.passing_marks)}</p></div>
      <div class="row wrap"><button class="btn" data-act="csv">${icon('download')} Export CSV</button><a class="btn" href="#/exams/${id}">Manage exam</a><button class="btn ${x.results_released ? '' : 'btn-primary'}" data-act="publish">${icon('send')} ${x.results_released ? 'Unpublish results' : 'Publish results'}</button></div></div>
      <div class="kpis">${kpi('Attempts', st.attempts, 'users')}${kpi('Average', st.avg == null ? '—' : num(st.avg), 'target', '', st.avg == null ? '' : '%')}${kpi('Highest', st.high == null ? '—' : num(st.high), 'arrowup', '', st.high == null ? '' : '%')}${kpi('Lowest', st.low == null ? '—' : num(st.low), 'arrowdown', '', st.low == null ? '' : '%')}${kpi('Pass rate', st.pass == null ? '—' : st.pass, 'check', '', st.pass == null ? '' : '%')}${kpi('Awaiting marking', st.pendingManual, 'edit', st.pendingManual ? 'hot' : '')}</div>
      <div class="toolbar">${[['all', 'All'], ['marking', 'Needs marking'], ['pass', 'Passed'], ['fail', 'Failed']].map(([k, l]) => html`<button class="chip" data-act="flt" data-k="${k}" aria-pressed="${flt === k}">${l}</button>`)}<label class="chip"><input type="checkbox" data-change="restarted" ${showRestarted ? raw('checked') : ''}> Show restarted attempts</label></div>
      <div class="card">${rows.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Student</th><th>Attempt</th><th>Status</th><th>Score</th><th>Result</th><th>Time taken</th><th>Correct / wrong / blank</th><th></th></tr></thead><tbody>${rows.map((r) => html`<tr><td><a class="name" href="#/students/${r.student_id}">${r.name}</a><div class="sub mono">${r.roll_no}</div></td><td>#${r.attempt_no}<div class="sub mono">ID ${r.id}</div></td><td>${badge(r.status)}</td><td>${r.status === 'in_progress' || r.status === 'restarted' ? html`<span class="muted">${r.score != null ? num(r.score) : '—'}</span>` : html`<b>${num(r.score)}</b> <span class="muted small">/ ${num(x.total_marks)} · ${pct(r.percentage)}</span>`}${r.needs_manual ? html`<div><span class="badge warn">${r.needs_manual} to mark</span></div>` : ''}</td><td>${fin(r.status) ? (r.passed ? badge('pass', 'Pass') : badge('fail', 'Fail')) : '—'}</td><td class="small">${r.ended_at && r.started_at ? dur(r.ended_at - r.started_at) : '—'}</td><td class="small mono">${fin(r.status) ? `${r.correct_count ?? 0} / ${r.wrong_count ?? 0} / ${r.unanswered_count ?? 0}` : '—'}</td><td class="actions"><a class="btn btn-sm" href="#/attempt/${r.id}">${fin(r.status) ? 'Review & mark' : 'View'}</a></td></tr>`)}</tbody></table></div>` : empty('No attempts to show', 'Attempts appear here as students submit.', 'chart')}</div>`);
  }
  bind(el, { retry: load, flt: (t) => { flt = t.dataset.k; draw(); }, restarted: (t) => { showRestarted = t.checked; draw(); },
    csv: () => { const rows = [['Roll No', 'Student', 'Attempt', 'Status', 'Score', 'Total', 'Percentage', 'Result', 'Restart reason'], ...D.rows.map((r) => [r.roll_no, r.name, r.attempt_no, r.status, r.score ?? '', D.exam.total_marks, r.percentage ?? '', fin(r.status) ? (r.passed ? 'Pass' : 'Fail') : '', r.restart_reason || ''])]; const csv = '\uFEFF' + rows.map((r) => r.map((c) => { let s = String(c); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `results-${id}.csv`; a.click(); },
    publish: async () => { const release = !D.exam.results_released; try { await api('POST', `/exams/${id}/publish-results`, { release }); toast(release ? 'Results published' : 'Results hidden', release ? 'Students were notified.' : '', 'ok'); load(); } catch (e) { if (e.details?.code === 'PENDING_MANUAL') { if (await confirmDialog({ title: 'Some answers are unmarked', message: e.message, confirmText: 'Publish anyway' })) { try { await api('POST', `/exams/${id}/publish-results`, { release: true, force: true }); toast('Results published', '', 'ok'); load(); } catch (er) { fail(er); } } } else fail(e); } } });
  await load();
  ctx.onLeave(bus.on('ws:monitor', debounce((m) => { if (m.examId === id) load(); }, 1500)));
}

/* ============================== attempt review / marking ============================== */
export async function attempt(ctx) {
  const el = ctx.el; const id = +ctx.id; let D;
  async function load() { try { D = await api('GET', `/attempts/${id}`); draw(); } catch (e) { put(el, errorBox(e)); } }
  const done = () => ['submitted', 'time_expired', 'force_submitted'].includes(D.attempt.status);
  const sel2 = (q, id2) => (Array.isArray(q.answer) ? q.answer.includes(id2) : q.answer === id2);
  const cor = (q, id2) => (Array.isArray(q.correct) ? q.correct.includes(id2) : q.correct === id2);
  function qcard(q) {
    const subj = q.type === 'long' || q.type === 'short'; const pending = q.awarded == null && q.answer != null && subj;
    return html`<div class="card card-pad" data-q="${q.id}"><div class="row between wrap" style="margin-bottom:10px"><div class="row wrap"><b class="mono">Q${q.n}</b><span class="tag">${TYPES[q.type]}</span><span class="muted small">${num(q.marks)} mark${q.marks === 1 ? '' : 's'}</span>${pending ? html`<span class="badge warn">Needs marking</span>` : ''}${q.answer == null ? html`<span class="badge draft">Unanswered</span>` : q.is_correct === 1 ? html`<span class="badge pass">Correct</span>` : q.is_correct === 0 ? html`<span class="badge fail">Wrong</span>` : ''}${q.manual ? html`<span class="badge info">Marked by teacher</span>` : ''}</div><b class="mono">${q.awarded == null ? '—' : num(q.awarded)} / ${num(q.marks)}</b></div>
      <p style="white-space:pre-wrap;font-weight:500;margin-bottom:10px">${q.text}</p>
      ${q.options ? html`<div class="stack-sm">${q.options.map((o, i) => html`<div class="row" style="padding:7px 10px;border-radius:8px;border:1.5px solid ${sel2(q, o.id) ? 'var(--brand)' : 'var(--line)'};${cor(q, o.id) ? 'background:var(--ok-soft)' : sel2(q, o.id) ? 'background:var(--pen-soft)' : ''}"><span class="mono muted" style="width:18px">${q.type === 'tf' ? '' : LETTERS[i]}</span><span class="grow">${o.text}</span>${sel2(q, o.id) ? html`<span class="small"><b>Student's answer</b></span>` : ''}${cor(q, o.id) ? icon('check') : ''}</div>`)}</div>`
        : html`<div class="stack-sm"><div class="lbl">Student's answer</div><div class="card card-pad" style="background:var(--line-2);white-space:pre-wrap">${q.answer ?? html`<span class="muted">No answer</span>`}</div>${q.type === 'short' ? html`<div class="small"><b>Accepted:</b> ${(q.correct || []).length ? q.correct.join(' · ') : 'Marked manually'}</div>` : ''}</div>`}
      ${q.explanation ? html`<div class="small muted" style="margin-top:8px">Explanation: ${q.explanation}</div>` : ''}
      ${done() ? html`<div class="grid" style="grid-template-columns:120px 1fr;margin-top:12px;align-items:start;gap:12px" ${subj ? '' : raw('hidden data-adjust')}><div class="field"><label>Marks</label><input class="input" type="number" min="0" max="${q.marks}" step="0.5" data-m="${q.id}" value="${q.awarded ?? ''}" data-orig="${q.awarded ?? ''}"></div><div class="field"><label>Feedback to student</label><input class="input" data-f="${q.id}" maxlength="2000" value="${q.feedback || ''}" data-orig="${q.feedback || ''}" placeholder="Optional"></div></div>${subj ? '' : html`<button class="btn btn-ghost btn-sm" style="margin-top:8px" data-act="adjust">Adjust marks…</button>`}` : ''}</div>`;
  }
  function draw() {
    const a = D.attempt, x = D.exam, s = D.student;
    put(el, html`<div class="page-head"><div><a class="small muted" href="#/results/${x.id}">← ${x.name}</a><div class="row" style="gap:12px;margin-top:6px"><h1>${s.name}</h1>${badge(a.status)}</div><p class="mono">${s.roll_no} · Attempt ${a.attempt_no} (ID ${a.id})</p></div>
      ${done() ? html`<button class="btn btn-primary" data-act="save">${icon('check')} Save marks</button>` : ''}</div>
      <div class="kpis">${kpi('Score', a.score == null ? '—' : num(a.score), 'target', '', ` / ${num(x.total_marks)}`)}${kpi('Percentage', a.percentage == null ? '—' : num(a.percentage), 'chart', '', a.percentage == null ? '' : '%')}${kpi('Result', done() ? (a.passed ? 'Pass' : 'Fail') : '—', 'shield')}${kpi('Correct / wrong / blank', done() ? `${a.correct_count} / ${a.wrong_count} / ${a.unanswered_count}` : '—', 'check')}${kpi('Time taken', a.started_at && a.ended_at ? dur(a.ended_at - a.started_at) : '—', 'clock')}</div>
      <div class="card card-pad" style="margin-bottom:16px"><h3 style="margin-bottom:10px">Attempt history</h3><div class="table-wrap"><table class="tbl"><thead><tr><th>Attempt ID</th><th>No.</th><th>Start</th><th>End</th><th>Duration</th><th>Score</th><th>Status</th><th>Restart reason</th></tr></thead><tbody>${D.history.map((h) => html`<tr ${h.id === a.id ? raw('style="background:var(--hi-soft)"') : ''}><td class="mono"><a href="#/attempt/${h.id}">${h.id}</a></td><td>${h.attempt_no}</td><td class="small">${fmtDT(h.started_at)}</td><td class="small">${fmtDT(h.ended_at)}</td><td>${dur(h.duration_ms)}</td><td>${h.score == null ? '—' : num(h.score)}</td><td>${badge(h.status)}</td><td class="small">${h.restart_reason || '—'}</td></tr>`)}</tbody></table></div></div>
      ${done() ? '' : html`<div class="notice" style="margin-bottom:16px">${icon('info')}<span>${a.status === 'restarted' ? 'This attempt was restarted. Its answers are preserved for the record.' : 'This attempt is not finished yet. Marks can be entered after submission.'}</span></div>`}
      <div class="stack">${D.questions.map(qcard)}</div>`);
  }
  bind(el, { retry: load,
    adjust: (t) => { const c = t.closest('[data-q]'); c.querySelector('[data-adjust]').hidden = false; t.remove(); },
    save: async () => {
      const grades = []; $$('[data-m]', el).forEach((inp) => { const q = inp.dataset.m; const f = $(`[data-f="${q}"]`, el); const hidden = inp.closest('[data-adjust]')?.hidden; if (hidden) return; if (inp.value === '') return; if (inp.value !== inp.dataset.orig || f.value !== f.dataset.orig) grades.push({ eqId: +q, marks: +inp.value, feedback: f.value }); });
      if (!grades.length) return toast('Nothing to save', 'Enter marks or feedback first.');
      try { const r = await api('PUT', `/attempts/${id}/grade`, { grades }); toast('Marks saved', `${r.changed} question(s) updated`, 'ok'); load(); } catch (e) { fail(e); } } });
  await load();
}

/* ============================== reports ============================== */
const REPORTS = [['student-performance', 'Student performance'], ['classroom-performance', 'Classroom performance'], ['exam-performance', 'Exam performance'], ['question-analysis', 'Question-wise analysis'], ['participation', 'Participation']];
export async function reports(ctx) {
  const el = ctx.el; const f = { type: 'exam-performance', classroomId: '', examId: '' };
  const [cls, ex] = await Promise.all([api('GET', '/classrooms' + qs({ size: 100 })), api('GET', '/exams' + qs({ size: 100 }))]);
  put(el, html`<div class="page-head"><div><h1>Reports</h1><p>Analyse performance and export for sharing.</p></div><div class="row wrap" id="exp"></div></div>
    <div class="tabs" role="tablist">${REPORTS.map(([k, l]) => html`<button role="tab" data-act="type" data-k="${k}" aria-selected="${f.type === k}">${l}</button>`)}</div>
    <div class="toolbar"><select class="input" data-change="cls" aria-label="Classroom"><option value="">All classrooms</option>${cls.items.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select><select class="input" data-change="exam" id="exsel" aria-label="Exam"></select></div><div class="card" id="rep">${skeleton(4)}</div>`);
  const fillExams = () => { $('#exsel', el).innerHTML = `<option value="">${f.type === 'question-analysis' ? 'Choose an exam' : 'All exams'}</option>` + ex.items.filter((e) => e.status !== 'draft' && (!f.classroomId || e.classroom_id === +f.classroomId)).map((e) => `<option value="${e.id}" ${String(e.id) === f.examId ? 'selected' : ''}>${esc(e.name)}</option>`).join(''); };
  async function load() {
    fillExams(); $$('[data-act=type]', el).forEach((b) => b.setAttribute('aria-selected', b.dataset.k === f.type));
    const box = $('#rep', el);
    if (f.type === 'question-analysis' && !f.examId) { put(box, empty('Choose an exam', 'Question-wise analysis is calculated per exam.', 'chart')); $('#exp', el).innerHTML = ''; return; }
    try {
      const r = await api('GET', `/reports/${f.type}` + qs({ classroomId: f.classroomId, examId: f.examId }));
      const link = (fmt) => `/api/reports/${f.type}` + qs({ classroomId: f.classroomId, examId: f.examId, format: fmt });
      put($('#exp', el), html`<button class="btn" data-act="dl" data-u="${link('csv')}">${icon('download')} CSV</button><button class="btn" data-act="dl" data-u="${link('xlsx')}">${icon('download')} Excel</button><button class="btn btn-primary" data-act="dl" data-u="${link('pdf')}">${icon('download')} PDF</button>`);
      const cell = (c, v) => (v == null ? '—' : /%|pass_rate|rate|avg$|high|low|best|lowest/.test(c.label + c.key) && typeof v === 'number' && c.label.includes('%') ? html`<div class="row"><div class="bar grow" style="min-width:60px"><i style="width:${Math.min(100, v)}%"></i></div><b class="mono">${num(v)}</b></div>` : c.key === 'status' ? badge(v) : typeof v === 'number' ? num(v, 2) : v);
      put(box, r.rows.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr>${r.columns.map((c) => html`<th>${c.label}</th>`)}</tr></thead><tbody>${r.rows.map((row) => html`<tr>${r.columns.map((c) => html`<td>${cell(c, row[c.key])}</td>`)}</tr>`)}</tbody></table></div>` : empty('No data for this report', 'Try different filters, or wait for students to submit.', 'chart'));
    } catch (e) { put(box, errorBox(e)); }
  }
  bind(el, { retry: load, type: (t) => { f.type = t.dataset.k; load(); }, cls: (t) => { f.classroomId = t.value; f.examId = ''; load(); }, exam: (t) => { f.examId = t.value; load(); }, dl: (t) => download(t.dataset.u) });
  await load();
}

/* ============================== notifications ============================== */
export async function notifications(ctx) {
  const el = ctx.el; let page = 1;
  const ICON = { exam_started: 'radio', exam_scheduled: 'clock', reminder: 'bell', exam_changed: 'edit', exam_restarted: 'refresh', results: 'chart', submission: 'send', alert: 'alert' };
  async function load() {
    try {
      const r = await api('GET', '/notifications' + qs({ page, size: 20 })); bus.emit('notifications:set', r.unread);
      put(el, html`<div class="page-head"><div><h1>Notifications</h1><p>${r.unread ? `${r.unread} unread` : 'You are all caught up'}</p></div>${r.unread ? html`<button class="btn" data-act="all">${icon('check')} Mark all as read</button>` : ''}</div>
        <div class="card">${r.items.length ? html`<ul class="feed" style="padding:6px 20px">${r.items.map((n) => html`<li style="${n.read ? '' : 'background:linear-gradient(90deg,var(--hi-soft),transparent);margin:0 -20px;padding:10px 20px'}"><span class="ic">${icon(ICON[n.type] || 'bell')}</span><div class="grow"><div style="font-weight:${n.read ? 500 : 700}">${n.title}</div><div class="small muted">${n.body || ''}</div><div class="small muted">${rel(n.created_at)}</div></div>${n.link ? html`<a class="btn btn-sm" href="${n.link}" data-act="go" data-id="${n.id}">Open</a>` : ''}${n.read ? '' : html`<button class="btn btn-ghost btn-sm" data-act="read" data-id="${n.id}" aria-label="Mark as read">${icon('check')}</button>`}</li>`)}</ul>${pager(r)}` : empty('No notifications', 'Exam updates and alerts will appear here.', 'bell')}</div>`);
    } catch (e) { put(el, errorBox(e)); }
  }
  bind(el, { retry: load, page: (t) => { page = +t.dataset.p; load(); }, all: async () => { await api('POST', '/notifications/read', { all: true }); load(); },
    read: async (t) => { await api('POST', '/notifications/read', { ids: [+t.dataset.id] }); load(); },
    go: async (t, e) => { e.preventDefault(); await api('POST', '/notifications/read', { ids: [+t.dataset.id] }).catch(() => {}); ctx.go(t.getAttribute('href')); } });
  await load();
  ctx.onLeave(bus.on('ws:notification', debounce(load, 800)));
}

/* ============================== activity logs ============================== */
export async function logs(ctx) {
  const el = ctx.el; const f = { q: '', action: '', from: '', to: '', page: 1 }; let open = new Set();
  const CATS = [['', 'All activity'], ['auth', 'Sign-ins'], ['classroom', 'Classrooms'], ['student', 'Students'], ['teacher', 'Teachers'], ['question', 'Question bank'], ['exam', 'Exams & live edits'], ['attempt', 'Attempts (restart, pause, submit)'], ['mark', 'Mark changes'], ['results', 'Result publication'], ['settings', 'Settings']];
  put(el, html`<div class="page-head"><div><h1>Activity logs</h1><p>${isAdmin() ? 'Every important action across the school.' : 'Your actions.'} Each entry records who, what, the old and new data, and when.</p></div></div>
    <div class="toolbar"><div class="searchbox">${icon('search')}<input class="input" data-input="q" placeholder="Search user, target or action" aria-label="Search logs"></div>${sel('action', CATS, '', 'data-change="cat" aria-label="Category"')}<input class="input" type="date" data-change="from" aria-label="From date" style="width:auto"><input class="input" type="date" data-change="to" aria-label="To date" style="width:auto"></div><div class="card" id="lg">${skeleton(6)}</div>`);
  async function load() {
    const box = $('#lg', el);
    try {
      const r = await api('GET', '/audit-logs' + qs({ ...f, size: 25, from: f.from ? new Date(f.from).getTime() : '', to: f.to ? new Date(f.to).getTime() + 86399999 : '' }));
      const json = (o) => (o == null ? html`<span class="muted small">—</span>` : html`<pre class="json">${JSON.stringify(o, null, 2)}</pre>`);
      put(box, r.items.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Target</th><th></th></tr></thead><tbody>${r.items.map((l) => html`<tr><td class="small" style="white-space:nowrap">${fmtDTfull(l.created_at)}</td><td><b>${l.user_name}</b><div class="sub">${l.role}</div></td><td><span class="row" style="gap:8px">${icon(actionIcon(l.action))}<span>${verb(l.action)}</span></span><div class="sub mono">${l.action}</div></td><td>${l.target_label || '—'}${l.target_type ? html`<div class="sub">${l.target_type}${l.target_id ? ' #' + l.target_id : ''}</div>` : ''}</td><td class="actions">${l.old_data || l.new_data ? html`<button class="btn btn-ghost btn-sm" data-act="tog" data-id="${l.id}" aria-expanded="${open.has(l.id)}">${icon(open.has(l.id) ? 'up' : 'down')} Details</button>` : ''}</td></tr>
        ${open.has(l.id) ? html`<tr><td colspan="5" style="background:var(--line-2)"><div class="diff"><div class="old"><div class="lbl" style="margin-bottom:4px">Old data</div>${json(l.old_data)}</div><div class="new"><div class="lbl" style="margin-bottom:4px">New data</div>${json(l.new_data)}</div></div>${l.ip ? html`<div class="small muted" style="margin-top:8px">IP ${l.ip}</div>` : ''}</td></tr>` : ''}`)}</tbody></table></div>${pager(r)}` : empty('No log entries', 'Nothing matches these filters.', 'log'));
    } catch (e) { put(box, errorBox(e)); }
  }
  bind(el, { retry: load, q: debounce((t) => { f.q = t.value; f.page = 1; load(); }, 300), cat: (t) => { f.action = t.value; f.page = 1; load(); }, from: (t) => { f.from = t.value; f.page = 1; load(); }, to: (t) => { f.to = t.value; f.page = 1; load(); }, page: (t) => { f.page = +t.dataset.p; load(); }, tog: (t) => { const i = +t.dataset.id; open.has(i) ? open.delete(i) : open.add(i); load(); } });
  await load();
}

/* ============================== settings ============================== */
export async function settings(ctx) {
  const el = ctx.el; let tab = ctx.sub || 'account'; const admin = isAdmin();
  const S = admin ? await api('GET', '/settings') : null;
  const tabs = [['account', 'Account'], ...(admin ? [['general', 'General'], ['teachers', 'Teachers']] : [])];
  put(el, html`<div class="page-head"><div><h1>Settings</h1><p>${admin ? 'School configuration, teachers and your account.' : 'Your account.'}</p></div></div><div class="tabs" role="tablist">${tabs.map(([k, l]) => html`<button role="tab" data-act="tab" data-k="${k}" aria-selected="${tab === k}">${l}</button>`)}</div><div id="sb"></div>`);
  async function draw() {
    $$('[data-act=tab]', el).forEach((b) => b.setAttribute('aria-selected', b.dataset.k === tab)); const box = $('#sb', el);
    if (tab === 'account') {
      put(box, html`<div class="grid g2" style="align-items:start"><form class="card card-pad stack" id="prof" novalidate><h2>Profile</h2>${field('Name', html`<input class="input" name="name" value="${state.user.name}" required maxlength="100">`)}${field('Email', html`<input class="input" value="${state.user.email}" disabled>`)}<div class="err" data-e style="color:var(--pen)"></div><div><button class="btn btn-primary" type="submit">Save profile</button></div></form>
        <form class="card card-pad stack" id="pw" novalidate><h2>Change password</h2>${field('Current password', html`<input class="input" type="password" name="current" autocomplete="current-password" required>`)}${field('New password', html`<input class="input" type="password" name="next" autocomplete="new-password" required minlength="8">`, '8+ characters with letters and numbers.')}<div class="err" data-e style="color:var(--pen)"></div><div><button class="btn btn-primary" type="submit">Update password</button></div></form></div>`);
      $('#prof', box).onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await api('PUT', '/me', { name: f.name.value }); state.user.name = f.name.value.trim(); toast('Profile saved', '', 'ok'); } catch (er) { $('[data-e]', f).textContent = errMsg(er); } };
      $('#pw', box).onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await api('POST', '/auth/password', { current: f.current.value, next: f.next.value }); f.reset(); $('[data-e]', f).textContent = ''; toast('Password updated', 'Other sessions were signed out.', 'ok'); } catch (er) { $('[data-e]', f).textContent = errMsg(er); } };
    } else if (tab === 'general') {
      const n = (k, l, h, min = 1) => field(l, html`<input class="input" type="number" min="${min}" name="${k}" value="${S[k]}" required>`, h);
      put(box, html`<form class="card card-pad stack" id="gen" style="max-width:720px" novalidate><div class="form-grid">${field('School name', html`<input class="input" name="school_name" value="${S.school_name}" required maxlength="120">`)}${field('Current academic year', html`<input class="input" name="academic_year" value="${S.academic_year}" required>`)}${n('default_duration', 'Default exam duration (minutes)')}${n('idle_seconds', 'Mark a student Idle after (seconds)', 'Used by live monitoring.', 10)}${n('reminder_minutes', 'Send exam reminders (minutes before start)')}${n('session_hours', 'Sign-in session length (hours)')}</div><div class="err" data-e style="color:var(--pen)"></div><div><button class="btn btn-primary" type="submit">Save settings</button></div></form>`);
      $('#gen', box).onsubmit = async (e) => { e.preventDefault(); const f = e.target; const body = {}; ['school_name', 'academic_year', 'default_duration', 'idle_seconds', 'reminder_minutes', 'session_hours'].forEach((k) => (body[k] = f[k].value)); try { Object.assign(S, await api('PUT', '/settings', body)); toast('Settings saved', '', 'ok'); } catch (er) { $('[data-e]', f).textContent = errMsg(er); } };
    } else {
      put(box, skeleton(3)); await teachersTab(box);
    }
  }
  async function teachersTab(box) {
    const r = await api('GET', '/teachers');
    put(box, html`<div class="row between" style="margin-bottom:14px"><span class="muted">${r.items.length} teachers</span><button class="btn btn-primary" data-act="newt">${icon('plus')} Add teacher</button></div><div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Teacher</th><th>Department</th><th>Classrooms</th><th>Status</th><th></th></tr></thead><tbody>${r.items.map((t) => html`<tr><td><b>${t.name}</b><div class="sub">${t.email}</div></td><td>${t.department || '—'}</td><td>${t.classrooms}</td><td>${t.active ? badge('ok', 'Active') : badge('draft', 'Disabled')}</td><td class="actions"><button class="btn btn-ghost btn-sm" data-act="editt" data-id="${t.id}" aria-label="Edit ${t.name}">${icon('edit')}</button><button class="btn btn-ghost btn-sm" data-act="delt" data-id="${t.id}" data-n="${t.name}" aria-label="Delete ${t.name}">${icon('trash')}</button></td></tr>`)}</tbody></table></div></div>`);
    box._t = r.items;
  }
  const tForm = (t) => html`<div class="form-grid">${field('Full name', html`<input class="input" name="name" value="${t?.name || ''}" required maxlength="100" autofocus>`)}${field('Email', html`<input class="input" type="email" name="email" value="${t?.email || ''}" required>`)}${field('Department', html`<input class="input" name="department" value="${t?.department || ''}" maxlength="100">`)}${field('Phone', html`<input class="input" name="phone" value="${t?.phone || ''}" maxlength="30">`)}${field(t ? 'New password (optional)' : 'Password', html`<input class="input" type="password" name="password" autocomplete="new-password" ${t ? '' : raw('required')} minlength="8">`, '8+ characters.')}${t ? html`<label class="check" style="align-self:end"><input type="checkbox" name="active" ${t.active ? raw('checked') : ''}><span>Account active</span></label>` : ''}</div>`;
  bind(el, { tab: (t) => { tab = t.dataset.k; draw(); },
    newt: () => formModal({ title: 'Add teacher', size: 'wide', fields: tForm(), submit: 'Add teacher', onSubmit: async (f, m) => { await api('POST', '/teachers', f); m.close(); toast('Teacher added', f.name, 'ok'); draw(); } }),
    editt: (t) => { const x = $('#sb', el)._t.find((z) => z.id === +t.dataset.id); formModal({ title: 'Edit teacher', size: 'wide', fields: tForm(x), onSubmit: async (f, m) => { await api('PUT', `/teachers/${x.id}`, { ...f, password: f.password || undefined }); m.close(); toast('Teacher updated', '', 'ok'); draw(); } }); },
    delt: async (t) => { if (await confirmDialog({ title: `Remove ${t.dataset.n}?`, message: 'Teachers who still have classrooms cannot be removed. Reassign those first.', confirmText: 'Remove', danger: true })) { try { await api('DELETE', `/teachers/${t.dataset.id}`); toast('Teacher removed', '', 'ok'); draw(); } catch (e) { fail(e); } } } });
  await draw();
}
