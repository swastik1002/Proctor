import { state, html, raw, put, $, $$, api, qs, bus, icon, bind, toast, fail, confirmDialog, modal, field, badge, skeleton, empty, errorBox, kpi, fmtDT, fmtDate, fmtTime, rel, num, pct, dur, debounce, TYPES, errMsg, initials } from './core.js';

const LETTERS = 'ABCDEFGHIJ';
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

/* Shared: an exam card with the right call to action */
function examCard(e, { hero = false } = {}) {
  const active = ['live', 'paused'].includes(e.status);
  let cta = '';
  if (active) {
    if (e.status === 'paused') cta = html`<div class="notice warn" style="margin-top:6px">${icon('pause')}<span><b>Paused by your teacher.</b> Wait for it to resume. ${e.currentAttempt ? 'Your answers are safe.' : ''}</span></div>`;
    else if (e.currentAttempt?.status === 'in_progress') cta = html`<button class="btn btn-hi" data-act="resume" data-a="${e.currentAttempt.id}">${icon('play')} Resume exam</button>`;
    else if (e.canStart) cta = html`<button class="btn btn-hi" data-act="start" data-id="${e.id}">${icon('play')} ${e.attemptsUsed ? 'Start new attempt' : 'Start exam'}</button>`;
    else cta = html`<span class="badge ok">${icon('check')} ${e.attemptsUsed >= e.max_attempts ? 'Submitted' : 'Closed'}</span>`;
  } else if (e.status === 'scheduled') cta = html`<span class="badge scheduled">${icon('clock')} Starts ${rel(e.start_at)}</span>`;
  return html`<div class="card card-pad stack-sm" data-exam="${e.id}"><div class="row between"><span class="muted small truncate">${e.classroom_name}${e.subject ? ' · ' + e.subject : ''}</span>${badge(e.status)}</div><h2>${e.name}</h2>
    ${e.description ? html`<p class="muted small">${e.description}</p>` : ''}
    <div class="row wrap small muted" style="gap:14px"><span>${icon('clock')} ${e.start_at ? fmtDT(e.start_at) : 'TBA'}</span><span>${e.duration_min} min</span><span>${e.questions} questions</span><span>${num(e.total_marks)} marks</span>${e.negative_marking ? html`<span>Negative marking</span>` : ''}<span>Attempt ${Math.min(e.attemptsUsed + 1, e.max_attempts)} of ${e.max_attempts}</span></div>
    ${cta ? html`<div class="row wrap" style="margin-top:6px">${cta}</div>` : ''}</div>`;
}

async function startFlow(e, ctx) {
  if (e.currentAttempt?.status === 'in_progress') return ctx.go(`#/take/${e.currentAttempt.id}`);
  const ok = await confirmDialog({ title: `Start ${e.name}?`, confirmText: 'Start exam now',
    message: html`You have <b>${e.duration_min} minutes</b> once you begin. The timer runs on the server, so closing the tab or losing connection does not pause it.`,
    extra: html`<ul class="small muted" style="margin:0;padding-left:18px"><li>${e.questions} questions · ${num(e.total_marks)} marks${e.negative_marking ? ' · wrong answers lose marks' : ''}</li><li>Answers save automatically. If you go offline they are kept on this device and sent when you reconnect.</li><li>The exam submits by itself when time runs out.</li></ul>` });
  if (!ok) return;
  try { const r = await api('POST', `/student/exams/${e.id}/start`); ctx.go(`#/take/${r.attemptId}`); } catch (er) { fail(er); }
}
function examActions(ctx, listRef, reload) {
  return { retry: reload,
    start: (t) => startFlow(listRef().find((x) => x.id === +t.dataset.id), ctx), resume: (t) => ctx.go(`#/take/${t.dataset.a}`) };
}

/* ============================== dashboard ============================== */
export async function dashboard(ctx) {
  const el = ctx.el; let D;
  async function load() {
    try { D = await api('GET', '/student/dashboard'); } catch (e) { put(el, errorBox(e)); return; }
    const hero = D.active.find((e) => e.status === 'live' && (e.canStart || e.currentAttempt)) || D.active[0];
    put(el, html`<div class="page-head"><div><h1>${greet()}, ${state.user.name.split(' ')[0]}</h1><p>${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
      ${hero ? html`<div class="card" style="background:var(--board);color:#fff;border:0;padding:24px 26px;margin-bottom:18px;position:relative;overflow:hidden"><div class="row wrap between" style="gap:18px"><div style="max-width:60ch"><span class="badge live">${hero.status === 'paused' ? 'Paused' : html`<i class="pulse"></i> Live now`}</span><h2 style="font-size:1.6rem;margin:10px 0 6px">${hero.name}</h2><p style="color:var(--chalk-dim)">${hero.classroom_name} · ${hero.duration_min} minutes · ${hero.questions} questions · ${num(hero.total_marks)} marks</p></div>
        <div>${hero.status === 'paused' ? html`<span class="badge warn">Paused by teacher</span>` : hero.currentAttempt?.status === 'in_progress' ? html`<button class="btn btn-hi" data-act="resume" data-a="${hero.currentAttempt.id}" style="min-height:48px;font-size:1rem">${icon('play')} Resume exam</button>` : hero.canStart ? html`<button class="btn btn-hi" data-act="start" data-id="${hero.id}" style="min-height:48px;font-size:1rem">${icon('play')} Start exam</button>` : html`<span class="badge ok">Submitted</span>`}</div></div></div>` : ''}
      <div class="kpis">${kpi('My classrooms', D.stats.classrooms, 'school')}${kpi('Active exams', D.stats.active, 'radio', D.stats.active ? 'hot' : '')}${kpi('Upcoming exams', D.stats.upcoming, 'clock')}${kpi('Average score', D.stats.avg == null ? '—' : num(D.stats.avg), 'target', '', D.stats.avg == null ? '' : '%')}</div>
      <div class="grid g2" style="align-items:start"><div class="card"><div class="card-head"><h2>Upcoming exams</h2><a class="small" href="#/upcoming">See all</a></div><div class="card-body">${D.upcoming.length ? html`<div class="stack-sm">${D.upcoming.slice(0, 4).map((e) => html`<div class="row between card card-pad" style="padding:12px 14px"><div class="grow"><b>${e.name}</b><div class="small muted">${fmtDT(e.start_at)} · ${e.duration_min} min</div></div><span class="badge scheduled">${rel(e.start_at)}</span></div>`)}</div>` : empty('Nothing scheduled', 'New exams will appear here.', 'clock')}</div></div>
        <div class="card"><div class="card-head"><h2>Recent results</h2><a class="small" href="#/results">See all</a></div><div class="card-body">${D.results.length ? html`<div class="stack-sm">${D.results.slice(0, 4).map((r) => html`<a class="row between card card-pad" style="padding:12px 14px;text-decoration:none;color:inherit" href="#/result/${r.id}"><div class="grow"><b>${r.exam_name}</b><div class="small muted">${fmtDate(r.ended_at)}</div></div><div class="right"><b class="mono">${num(r.score)}/${num(r.total_marks)}</b><div>${r.passed ? badge('pass', 'Pass') : badge('fail', 'Fail')}</div></div></a>`)}</div>` : empty('No results yet', 'Published results show up here.', 'chart')}</div></div></div>`);
    bind(el, examActions(ctx, () => D.active, load));
  }
  await load();
  ctx.onLeave(bus.on('ws:exam', debounce(load, 500))); ctx.onLeave(bus.on('ws:attempt', debounce(load, 500)));
}

/* ============================== classrooms ============================== */
export async function classrooms(ctx) {
  const r = await api('GET', '/student/classrooms');
  put(ctx.el, html`<div class="page-head"><div><h1>My classrooms</h1><p>The classes you belong to.</p></div></div>${r.items.length ? html`<div class="auto-grid">${r.items.map((c) => html`<div class="card card-pad stack-sm"><div class="row between"><span class="tag">${c.section || 'Class'}</span>${c.open_exams ? html`<span class="badge scheduled">${c.open_exams} open exam${c.open_exams > 1 ? 's' : ''}</span>` : ''}</div><h2>${c.name}</h2><p class="muted small">${c.subject} · Teacher: ${c.teacher_name || 'TBA'}</p>${c.description ? html`<p class="small">${c.description}</p>` : ''}<div class="small muted">${c.classmates} classmates · ${c.academic_year || ''}</div></div>`)}</div>` : empty('No classrooms yet', 'Your teacher will add you to a classroom.', 'school')}`);
}

/* ============================== upcoming / active ============================== */
async function examList(ctx, scope, title, sub, emptyMsg, ic) {
  const el = ctx.el; let items = [];
  async function load() {
    try { items = (await api('GET', '/student/exams?scope=' + scope)).items; } catch (e) { put(el, errorBox(e)); return; }
    put(el, html`<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div></div>${items.length ? html`<div class="auto-grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">${items.map((e) => examCard(e))}</div>` : empty(emptyMsg[0], emptyMsg[1], ic)}`);
  }
  bind(el, examActions(ctx, () => items, load));
  await load();
  const t = setInterval(load, 30000); ctx.onLeave(() => clearInterval(t));
  ctx.onLeave(bus.on('ws:exam', debounce(load, 400))); ctx.onLeave(bus.on('ws:attempt', debounce(load, 400)));
}
export const upcoming = (ctx) => examList(ctx, 'upcoming', 'Upcoming exams', 'Scheduled exams for your classrooms.', ['No upcoming exams', 'You are all caught up. New exams will show here.'], 'clock');
export const active = (ctx) => examList(ctx, 'active', 'Active exams', 'Exams you can take right now.', ['No active exams', 'When a teacher starts an exam it appears here immediately.'], 'radio');

/* ============================== results ============================== */
export async function results(ctx) {
  const r = await api('GET', '/student/results');
  put(ctx.el, html`<div class="page-head"><div><h1>Results</h1><p>Scores appear after your teacher publishes them.</p></div></div>
    ${r.awaiting ? html`<div class="notice" style="margin-bottom:16px">${icon('clock')}<span>${r.awaiting} exam${r.awaiting > 1 ? 's are' : ' is'} submitted and waiting for your teacher to publish results.</span></div>` : ''}
    ${r.items.length ? html`<div class="auto-grid">${r.items.map((x) => html`<a class="card card-pad stack-sm" href="#/result/${x.id}" style="text-decoration:none;color:inherit"><div class="row between"><span class="muted small">${x.subject || ''}</span>${x.passed ? badge('pass', 'Passed') : badge('fail', 'Not passed')}</div><h2>${x.exam_name}</h2>
      <div class="row" style="align-items:flex-end;gap:6px"><b class="mono" style="font-size:2rem;line-height:1">${num(x.score)}</b><span class="muted">/ ${num(x.total_marks)}</span><span class="grow"></span><b class="mono">${pct(x.percentage)}</b></div><div class="bar ${x.passed ? '' : 'pen'}"><i style="width:${Math.min(100, x.percentage)}%"></i></div>
      <div class="small muted">${x.correct_count} correct · Attempt ${x.attempt_no} · ${fmtDate(x.ended_at)}${x.needs_manual ? ' · some answers still being marked' : ''}</div></a>`)}</div>` : empty('No published results yet', 'Once results are published you can review every question here.', 'chart')}`);
}

export async function result(ctx) {
  const d = await api('GET', `/student/results/${ctx.id}`); const a = d.attempt, x = d.exam;
  const sel = (q, id) => (Array.isArray(q.answer) ? q.answer.includes(id) : q.answer === id);
  const cor = (q, id) => (Array.isArray(q.correct) ? q.correct.includes(id) : q.correct === id);
  put(ctx.el, html`<div class="page-head"><div><a class="small muted" href="#/results">← All results</a><div class="row" style="gap:12px;margin-top:6px"><h1>${x.name}</h1>${a.passed ? badge('pass', 'Passed') : badge('fail', 'Not passed')}</div><p>Attempt ${a.no} · ${fmtDT(a.ended_at)}</p></div></div>
    ${a.pending ? html`<div class="notice warn" style="margin-bottom:16px">${icon('info')}<span>${a.pending} answer${a.pending > 1 ? 's are' : ' is'} still being marked, so this score may change.</span></div>` : ''}
    <div class="kpis">${kpi('Score', num(a.score), 'target', '', ` / ${num(x.total_marks)}`)}${kpi('Percentage', num(a.percentage), 'chart', '', '%')}${kpi('Correct', a.correct, 'check')}${kpi('Wrong', a.wrong, 'x')}${kpi('Unanswered', a.unanswered, 'help')}${kpi('Time taken', a.started_at && a.ended_at ? dur(a.ended_at - a.started_at) : '—', 'clock')}</div>
    <div class="stack">${d.questions.map((q) => html`<div class="card card-pad"><div class="row between wrap" style="margin-bottom:8px"><div class="row wrap"><b class="mono">Q${q.n}</b><span class="tag">${TYPES[q.type]}</span>${q.answer == null ? html`<span class="badge draft">Unanswered</span>` : q.is_correct === 1 ? html`<span class="badge pass">Correct</span>` : q.is_correct === 0 ? html`<span class="badge fail">Incorrect</span>` : html`<span class="badge warn">Being marked</span>`}</div><b class="mono">${q.awarded == null ? '—' : num(q.awarded)} / ${num(q.marks)}</b></div>
      <p style="white-space:pre-wrap;font-weight:500;margin-bottom:10px">${q.text}</p>
      ${q.options ? html`<div class="stack-sm">${q.options.map((o, i) => html`<div class="row" style="padding:7px 10px;border-radius:8px;border:1.5px solid ${sel(q, o.id) ? 'var(--brand)' : 'var(--line)'};${x.show_answers && cor(q, o.id) ? 'background:var(--ok-soft)' : sel(q, o.id) && q.is_correct === 0 ? 'background:var(--pen-soft)' : ''}"><span class="mono muted" style="width:18px">${q.type === 'tf' ? '' : LETTERS[i]}</span><span class="grow">${o.text}</span>${sel(q, o.id) ? html`<span class="small"><b>Your answer</b></span>` : ''}${x.show_answers && cor(q, o.id) ? icon('check') : ''}</div>`)}</div>` : html`<div class="card card-pad" style="background:var(--line-2);white-space:pre-wrap">${q.answer ?? html`<span class="muted">No answer</span>`}</div>${x.show_answers && q.type === 'short' && (q.correct || []).length ? html`<div class="small" style="margin-top:6px"><b>Accepted:</b> ${q.correct.join(' · ')}</div>` : ''}`}
      ${q.feedback ? html`<div class="notice ok" style="margin-top:10px">${icon('edit')}<span><b>Teacher feedback:</b> ${q.feedback}</span></div>` : ''}${x.show_answers && q.explanation ? html`<div class="small muted" style="margin-top:8px">Explanation: ${q.explanation}</div>` : ''}</div>`)}</div>`);
}

/* ============================== history ============================== */
export async function history(ctx) {
  const r = await api('GET', '/student/history');
  put(ctx.el, html`<div class="page-head"><div><h1>Exam history</h1><p>Every attempt you have made, including restarted ones.</p></div></div><div class="card">${r.items.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Exam</th><th>Attempt</th><th>Started</th><th>Ended</th><th>Duration</th><th>Score</th><th>Status</th><th>Note</th></tr></thead><tbody>${r.items.map((h) => html`<tr><td>${h.results_released && ['submitted', 'time_expired', 'force_submitted'].includes(h.status) ? html`<a class="name" href="#/result/${h.id}">${h.exam_name}</a>` : html`<span class="name">${h.exam_name}</span>`}</td><td>#${h.attempt_no}<div class="sub mono">ID ${h.id}</div></td><td class="small">${fmtDT(h.started_at)}</td><td class="small">${fmtDT(h.ended_at)}</td><td>${dur(h.duration_ms)}</td><td>${h.score == null ? html`<span class="muted small">${['submitted', 'time_expired', 'force_submitted'].includes(h.status) ? 'Awaiting publication' : '—'}</span>` : html`<b>${num(h.score)}</b> <span class="muted small">/ ${num(h.total_marks)}</span>`}</td><td>${badge(h.status)}</td><td class="small">${h.restart_reason ? `Restarted: ${h.restart_reason}` : ''}</td></tr>`)}</tbody></table></div>` : empty('No attempts yet', 'Your attempts will be listed here.', 'history')}</div>`);
}

/* ============================== profile ============================== */
export async function profile(ctx) {
  const u = state.user; const el = ctx.el;
  put(el, html`<div class="page-head"><div class="row" style="gap:16px"><span class="avatar" style="width:56px;height:56px;font-size:1.2rem">${initials(u.name)}</span><div><h1>${u.name}</h1><p>${u.roll_no} · ${u.email}${u.section ? ' · Section ' + u.section : ''}</p></div></div></div>
    <div class="grid g2" style="align-items:start"><form class="card card-pad stack" id="prof" novalidate><h2>Profile</h2>${field('Name', html`<input class="input" name="name" value="${u.name}" required maxlength="100">`)}${field('Student ID / Roll No.', html`<input class="input" value="${u.roll_no || ''}" disabled>`)}${field('Email', html`<input class="input" value="${u.email}" disabled>`)}<div class="err" data-e style="color:var(--pen)"></div><div><button class="btn btn-primary" type="submit">Save profile</button></div></form>
    <form class="card card-pad stack" id="pw" novalidate><h2>Change password</h2>${field('Current password', html`<input class="input" type="password" name="current" autocomplete="current-password" required>`)}${field('New password', html`<input class="input" type="password" name="next" autocomplete="new-password" required minlength="8">`, '8+ characters with letters and numbers.')}<div class="err" data-e style="color:var(--pen)"></div><div><button class="btn btn-primary" type="submit">Update password</button></div></form></div>`);
  $('#prof', el).onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await api('PUT', '/me', { name: f.name.value }); state.user.name = f.name.value.trim(); toast('Profile saved', '', 'ok'); } catch (er) { $('[data-e]', f).textContent = errMsg(er); } };
  $('#pw', el).onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await api('POST', '/auth/password', { current: f.current.value, next: f.next.value }); f.reset(); $('[data-e]', f).textContent = ''; toast('Password updated', '', 'ok'); } catch (er) { $('[data-e]', f).textContent = errMsg(er); } };
}
