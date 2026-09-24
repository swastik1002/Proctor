// Student exam screen: server-synced timer, autosave with offline queue, palette, live pause/restart handling.
import { state, html, raw, put, $, $$, api, bus, icon, bind, toast, confirmDialog, modal, clock, num, TYPES, errMsg, esc } from './core.js';

const LETTERS = 'ABCDEFGHIJ';
const hasAnswer = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'string' && !v.trim());

export async function takeExam({ el, id, onLeave, go }) {
  const attId = +id; const LS = `proctor:attempt:${attId}`;
  let S = null, answers = {}, dirty = {}, idx = 0;
  let deadline = 0, syncRem = 0, frozen = false, examPaused = false, pauseReason = null;
  let syncing = false, again = false, offline = false, lastSaved = null, retryMs = 2000, ended = false, autoSubmitting = false, syncTimer = null, submitting = false;
  const timers = [];

  /* ---------- local persistence ---------- */
  const persist = () => { try { localStorage.setItem(LS, JSON.stringify({ dirty, idx })); } catch { /* storage full or blocked: server sync still works */ } };
  function restoreLocal() {
    try { const l = JSON.parse(localStorage.getItem(LS) || 'null'); if (!l) return; dirty = l.dirty || {}; for (const d of Object.values(dirty)) answers[d.eqId] = { answer: d.answer, review: d.review, visited: d.visited }; if (Number.isInteger(l.idx)) idx = l.idx; } catch { /* ignore corrupt */ }
  }

  /* ---------- load ---------- */
  async function loadSession(refresh) {
    const s = await api('GET', `/attempts/${attId}/session`);
    if (s.attempt.status !== 'in_progress') { S = s; return finish(s.attempt.status); }
    const curId = S?.questions?.[idx]?.id;
    S = s;
    const base = {}; for (const [k, v] of Object.entries(s.answers)) base[k] = v;
    for (const d of Object.values(dirty)) base[d.eqId] = { answer: d.answer, review: d.review, visited: d.visited };
    answers = base;
    if (refresh && curId) { const i = S.questions.findIndex((q) => q.id === curId); idx = i >= 0 ? i : Math.min(idx, S.questions.length - 1); }
    else if (!refresh) idx = Math.min(Math.max(idx || s.attempt.current || 0, 0), S.questions.length - 1);
    applyTime(s);
  }
  function applyTime(t) { deadline = performance.now() + t.remainingMs; syncRem = t.remainingMs; frozen = !!t.frozen; examPaused = !!t.examPaused; pauseReason = t.pauseReason || null; }

  try { restoreLocal(); await loadSession(false); }
  catch (e) { return put(el, html`<div class="overlay"><div class="card box"><div class="big-ic" style="background:var(--pen-soft);color:var(--pen)">${icon('alert')}</div><h2>Can’t open this exam</h2><p class="muted" style="margin:8px 0 18px">${errMsg(e)}</p><a class="btn btn-primary" href="#/active">Back to my exams</a></div></div>`); }
  if (ended) return;

  /* ---------- shell ---------- */
  put(el, html`<div class="exam-shell"><div id="banner"></div>
    <header class="exam-top"><div class="grow" style="min-width:0"><h1 class="truncate">${S.exam.name}</h1><div class="small muted truncate">${S.student.name} · ${S.student.roll_no} · Attempt ${S.attempt.no}</div></div>
      <span class="sync-pill" id="sync" role="status" aria-live="polite"><i></i><span>Saved</span></span>
      <div class="exam-timer" id="timer" role="timer" aria-label="Time remaining">--:--</div>
      <button class="btn hide-sm" data-act="info">${icon('info')} Instructions</button><button class="btn pal-toggle" data-act="pal">${icon('grid')} Questions</button><button class="btn btn-primary" data-act="submit">${icon('send')} Submit</button></header>
    <div class="exam-body"><main><article class="card qcard" id="qcard" aria-live="polite"></article></main><aside class="card palette" id="palette" aria-label="Question palette"></aside></div></div>`);
  window.onbeforeunload = (e) => { if (!ended) { e.preventDefault(); e.returnValue = ''; } };

  /* ---------- rendering ---------- */
  const Q = () => S.questions[idx];
  const ansOf = (q) => answers[q.id] || {};
  function qState(q) { const a = ansOf(q); const has = hasAnswer(a.answer); if (a.review) return 'review' + (has ? ' answered' : ''); if (has) return 'answered'; if (a.visited) return 'unanswered'; return ''; }
  function drawQuestion() {
    const q = Q(), a = ansOf(q), cur = a.answer;
    const sel = (oid) => (Array.isArray(cur) ? cur.includes(oid) : cur === oid);
    let body;
    if (q.type === 'mcq' || q.type === 'tf' || q.type === 'multi') {
      const multi = q.type === 'multi';
      body = html`<div role="${multi ? 'group' : 'radiogroup'}" aria-label="Answer options">${multi ? html`<p class="muted small" style="margin:-10px 0 12px">Select all that apply.</p>` : ''}${q.options.map((o, i) => html`<button type="button" class="opt ${multi ? 'multi' : ''} ${sel(o.id) ? 'sel' : ''}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${sel(o.id)}" data-act="pick" data-o="${o.id}" style="width:100%;text-align:left"><span class="mark">${icon('check')}</span>${q.type === 'tf' ? '' : html`<span class="k">${LETTERS[i]}</span>`}<span class="grow">${o.text}</span></button>`)}</div>`;
    } else if (q.type === 'short') body = html`<label class="lbl" for="txt">Your answer</label><input class="input" id="txt" data-input="txt" maxlength="500" autocomplete="off" value="${cur ?? ''}" style="font-size:1.05rem;min-height:48px">`;
    else body = html`<label class="lbl" for="txt">Your answer</label><textarea class="input" id="txt" data-input="txt" maxlength="20000" style="min-height:220px;font-size:1.02rem" placeholder="Write your answer here…">${cur ?? ''}</textarea><div class="small muted right" id="cc">${(cur || '').length} characters</div>`;
    put($('#qcard', el), html`<div class="qmeta"><b class="mono" style="font-size:1.05rem">Question ${idx + 1} <span class="muted">of ${S.questions.length}</span></b><span class="tag">${TYPES[q.type]}</span><span class="small muted">${num(q.marks)} mark${q.marks === 1 ? '' : 's'}${S.exam.negative && q.negative && q.type !== 'long' && q.type !== 'short' ? ` · −${num(q.negative)} for a wrong answer` : ''}</span>${a.review ? html`<span class="badge live">${icon('flag')} Marked for review</span>` : ''}</div>
      <div class="qtext">${q.text}</div>${body}
      <div class="qnav"><div class="row wrap"><button class="btn" data-act="clear" ${hasAnswer(cur) ? '' : raw('disabled')}>${icon('x')} Clear answer</button><button class="btn ${a.review ? 'btn-hi' : ''}" data-act="review" aria-pressed="${!!a.review}">${icon('flag')} ${a.review ? 'Unmark review' : 'Mark for review'}</button></div>
        <div class="row"><button class="btn" data-act="prev" ${idx === 0 ? raw('disabled') : ''}>${icon('left')} Previous</button>${idx < S.questions.length - 1 ? html`<button class="btn btn-primary" data-act="next">Next ${icon('right')}</button>` : html`<button class="btn btn-primary" data-act="submit">Review &amp; submit ${icon('right')}</button>`}</div></div>`);
  }
  function drawPalette() {
    const c = { answered: 0, unanswered: 0, review: 0, nv: 0 };
    S.questions.forEach((q) => { const a = ansOf(q); if (hasAnswer(a.answer)) c.answered++; if (a.review) c.review++; if (!hasAnswer(a.answer) && a.visited) c.unanswered++; if (!a.visited && !hasAnswer(a.answer)) c.nv++; });
    put($('#palette', el), html`<div class="row between"><h3>Question palette</h3><button class="iconbtn pal-toggle" data-act="pal" aria-label="Close palette">${icon('x')}</button></div>
      <div class="pal-grid">${S.questions.map((q, i) => html`<button class="pal ${qState(q)} ${i === idx ? 'current' : ''}" data-act="goto" data-i="${i}" aria-label="Question ${i + 1}: ${qState(q).includes('review') ? 'marked for review' : qState(q).includes('answered') ? 'answered' : qState(q) === 'unanswered' ? 'unanswered' : 'not visited'}" ${i === idx ? raw('aria-current="true"') : ''}>${i + 1}</button>`)}</div>
      <div class="pal-legend"><span><i style="background:var(--brand);border-color:var(--brand)"></i>Answered ${c.answered}</span><span><i style="background:var(--pen-soft)"></i>Unanswered ${c.unanswered}</span><span><i style="background:var(--hi);border-color:var(--hi-2)"></i>Review ${c.review}</span><span><i></i>Not visited ${c.nv}</span></div>`);
    return c;
  }
  const drawAll = () => { drawQuestion(); drawPalette(); };

  /* ---------- answer mutations ---------- */
  function queue(q) {
    const a = answers[q.id] || {}; dirty[q.id] = { eqId: q.id, answer: hasAnswer(a.answer) ? a.answer : null, review: !!a.review, visited: !!a.visited, ts: Date.now() };
    persist(); setPill(); scheduleSync(900);
  }
  function setAns(q, v) { answers[q.id] = { ...(answers[q.id] || {}), answer: v, visited: true }; queue(q); }
  function visit() { const q = Q(); if (!ansOf(q).visited) { answers[q.id] = { ...(answers[q.id] || {}), visited: true }; queue(q); } }
  function go2(i) { idx = Math.max(0, Math.min(S.questions.length - 1, i)); persist(); visit(); drawAll(); $('#palette', el).classList.remove('open'); window.scrollTo({ top: 0 }); }

  /* ---------- sync engine ---------- */
  function setPill() {
    const p = $('#sync', el); if (!p) return; const n = Object.keys(dirty).length;
    p.className = 'sync-pill' + (offline ? ' off' : syncing || n ? ' busy' : '');
    p.lastElementChild.textContent = offline ? `Offline · ${n} saved on this device` : frozen ? 'Paused' : syncing ? 'Saving…' : n ? 'Saving soon…' : lastSaved ? `Saved ${lastSaved.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Saved';
    const b = $('#banner', el); if (b && !b.dataset.keep) b.innerHTML = offline ? `<div class="banner">You’re offline. Keep answering: your work is stored on this device and will sync when you reconnect.</div>` : '';
  }
  const scheduleSync = (ms) => { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms); };
  async function sync() {
    if (ended || submitting) return; if (syncing) { again = true; return; }
    syncing = true; setPill(); const batch = Object.values(dirty);
    try {
      const res = await api('POST', `/attempts/${attId}/sync`, { answers: batch, current: idx }, { noAuthRedirect: false });
      offline = false; retryMs = 2000;
      if (!res.frozen && res.status === 'in_progress') { for (const d of batch) if (dirty[d.eqId] && dirty[d.eqId].ts === d.ts) delete dirty[d.eqId]; persist(); lastSaved = new Date(); }
      await onState(res);
    } catch (e) {
      if (e.network || e.status >= 500) { offline = true; retryMs = Math.min(15000, retryMs * 1.7); scheduleSync(retryMs); }
      else if (e.status === 404 || e.status === 403) { toast('Exam unavailable', errMsg(e), 'err'); go('#/active'); }
    } finally { syncing = false; setPill(); if (again) { again = false; scheduleSync(200); } }
  }
  async function onState(res) {
    if (res.status && res.status !== 'in_progress') return finish(res.status);
    applyTime(res); showPause();
    if (res.version !== S.exam.version) { try { await loadSession(true); banner('Your teacher updated this exam. Your answers are safe.'); drawAll(); } catch { /* try again next sync */ } }
  }
  function banner(msg) { const b = $('#banner', el); b.dataset.keep = '1'; b.innerHTML = `<div class="banner" role="status">${esc(msg)}</div>`; setTimeout(() => { delete b.dataset.keep; if (!offline) b.innerHTML = ''; }, 12000); }
  function showPause() {
    let o = $('#pause-ov'); const on = frozen && !ended;
    if (!on) { o?.remove(); return; }
    if (!o) { o = document.createElement('div'); o.id = 'pause-ov'; o.className = 'overlay'; document.body.appendChild(o); }
    o.innerHTML = `<div class="card box" role="alertdialog" aria-labelledby="pt"><div class="big-ic">${icon('pause').__raw}</div><h2 id="pt">${examPaused ? 'The exam is paused' : 'Your exam is paused'}</h2><p class="muted" style="margin:8px 0">${esc(pauseReason || (examPaused ? 'Your teacher paused the exam for everyone.' : 'Your teacher paused your exam.'))}</p><p>Your answers are saved and your timer is stopped. This screen continues automatically.</p></div>`;
  }

  /* ---------- finish states ---------- */
  function finish(status) {
    if (ended) return; ended = true; timers.forEach(clearInterval); clearTimeout(syncTimer); window.onbeforeunload = null; $('#pause-ov')?.remove(); document.querySelectorAll('.modal-back').forEach((m) => m.remove());
    if (status !== 'restarted') { try { localStorage.removeItem(LS); } catch { /* ignore */ } }
    const M = {
      submitted: ['Exam submitted', 'Your answers are saved. Your score appears in Results once your teacher publishes it.', 'check', 'ok'],
      time_expired: ['Time is up', 'Your exam was submitted automatically with everything you had answered.', 'clock', 'warn'],
      force_submitted: ['Submitted by your teacher', 'Your teacher ended this attempt. Your answers were saved and submitted.', 'send', 'warn'],
      restarted: ['Your exam was restarted', 'Your teacher restarted your exam, so this attempt is closed and kept on record. Start a fresh attempt from Active Exams.', 'refresh', 'warn'],
    }[status] || ['This attempt has ended', 'You can no longer make changes.', 'info', 'info'];
    put(el, html`<div class="overlay" style="position:static;min-height:100vh"><div class="card box"><div class="big-ic" style="${M[3] === 'ok' ? 'background:var(--ok-soft);color:var(--ok)' : ''}">${icon(M[2])}</div><h1>${M[0]}</h1><p class="muted" style="margin:10px 0 22px">${M[1]}</p><div class="row" style="justify-content:center;gap:10px"><a class="btn btn-primary" href="${status === 'restarted' ? '#/active' : '#/dashboard'}">${status === 'restarted' ? 'Go to active exams' : 'Back to dashboard'}</a>${status !== 'restarted' ? html`<a class="btn" href="#/history">Exam history</a>` : ''}</div></div></div>`);
  }

  /* ---------- submission ---------- */
  const allAnswers = () => Object.entries(answers).map(([k, a]) => ({ eqId: +k, answer: hasAnswer(a.answer) ? a.answer : null, review: !!a.review, visited: !!a.visited, ts: Date.now() }));
  async function doSubmit(auto) {
    if (submitting || ended) return; submitting = true; clearTimeout(syncTimer);
    try { const res = await api('POST', `/attempts/${attId}/submit`, { answers: allAnswers() }); dirty = {}; finish(res.status === 'in_progress' ? 'submitted' : res.status); }
    catch (e) {
      submitting = false;
      if (e.status === 409) { toast('Cannot submit right now', errMsg(e), 'err'); return; }
      if (auto) { setTimeout(() => doSubmit(true), 3000); return; }
      toast('Not submitted yet', 'We could not reach the server. Your answers are saved on this device. Try again.', 'err');
    }
  }
  function confirmSubmit() {
    const c = drawPalette(); const total = S.questions.length; const left = total - c.answered;
    const m = modal({ title: 'Submit your exam?', body: html`<div class="stack-sm"><div class="grid g3" style="gap:10px"><div class="card card-pad center"><b class="mono" style="font-size:1.6rem">${c.answered}</b><div class="small muted">answered</div></div><div class="card card-pad center"><b class="mono" style="font-size:1.6rem;color:${left ? 'var(--pen)' : 'inherit'}">${left}</b><div class="small muted">unanswered</div></div><div class="card card-pad center"><b class="mono" style="font-size:1.6rem">${c.review}</b><div class="small muted">for review</div></div></div>${left ? html`<div class="notice warn">${icon('alert')}<span>You have ${left} unanswered question${left > 1 ? 's' : ''}. Once you submit you cannot go back.</span></div>` : html`<p>All questions are answered. Once you submit you cannot make changes.</p>`}</div>`,
      foot: html`<button class="btn" data-close>Keep working</button><button class="btn btn-primary" data-ok>Submit exam</button>` });
    m.el.querySelector('[data-ok]').onclick = (e) => { e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span>'; m.close(); doSubmit(false); };
  }

  /* ---------- timer ---------- */
  function tick() {
    if (ended) return; const t = $('#timer', el); if (!t) return;
    const rem = frozen ? syncRem : Math.max(0, deadline - performance.now());
    t.textContent = clock(rem); t.classList.toggle('low', !frozen && rem < 300000); t.classList.toggle('frozen', frozen);
    if (!frozen && rem <= 0 && !autoSubmitting) { autoSubmitting = true; banner('Time is up. Submitting your exam…'); doSubmit(true); }
  }

  /* ---------- events ---------- */
  bind(el, {
    pick: (t) => { const q = Q(); const o = t.dataset.o; if (q.type === 'multi') { const s = new Set(Array.isArray(ansOf(q).answer) ? ansOf(q).answer : []); s.has(o) ? s.delete(o) : s.add(o); setAns(q, [...s]); } else setAns(q, ansOf(q).answer === o ? null : o); drawAll(); },
    txt: (t) => { const q = Q(); setAns(q, t.value); drawPalette(); const cc = $('#cc', el); if (cc) cc.textContent = `${t.value.length} characters`; const clr = $('[data-act=clear]', el); if (clr) clr.disabled = !hasAnswer(t.value); },
    clear: () => { setAns(Q(), null); drawAll(); }, review: () => { const q = Q(); answers[q.id] = { ...(answers[q.id] || {}), review: !ansOf(q).review, visited: true }; queue(q); drawAll(); },
    prev: () => go2(idx - 1), next: () => go2(idx + 1), goto: (t) => go2(+t.dataset.i), submit: confirmSubmit, pal: () => $('#palette', el).classList.toggle('open'),
    info: () => modal({ title: S.exam.name, sub: `${S.exam.duration} minutes · ${S.questions.length} questions · ${num(S.exam.totalMarks)} marks`, body: html`<p style="white-space:pre-wrap">${S.exam.instructions || 'Read every question carefully and answer to the best of your ability.'}</p>`, foot: html`<button class="btn btn-primary" data-close>Continue exam</button>` }),
  });
  const onKey = (e) => { if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.querySelector('.modal-back') || ended) return; if (e.key === 'ArrowRight') go2(idx + 1); if (e.key === 'ArrowLeft') go2(idx - 1); };
  const onOnline = () => sync(); const onVis = () => { if (!document.hidden) sync(); };
  document.addEventListener('keydown', onKey); window.addEventListener('online', onOnline); document.addEventListener('visibilitychange', onVis);
  const offs = [bus.on('ws:attempt', (m) => { if (m.attemptId === attId || m.newAttemptId) sync(); }), bus.on('ws:exam', () => sync()), bus.on('ws:open', () => sync())];
  timers.push(setInterval(tick, 250), setInterval(() => { if (!syncing && !ended) sync(); }, 5000));
  onLeave(() => { ended = true; timers.forEach(clearInterval); clearTimeout(syncTimer); offs.forEach((f) => f()); document.removeEventListener('keydown', onKey); window.removeEventListener('online', onOnline); document.removeEventListener('visibilitychange', onVis); window.onbeforeunload = null; $('#pause-ov')?.remove(); });

  visit(); drawAll(); tick(); showPause(); setPill();
  if (Object.keys(dirty).length) scheduleSync(300); // flush anything saved locally before a reload or crash
}
