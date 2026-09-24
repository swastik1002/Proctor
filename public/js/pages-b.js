import { state, html, raw, put, $, $$, api, qs, bus, icon, bind, toast, fail, confirmDialog, formModal, modal, field, sel, badge, skeleton, empty, errorBox, pager, kpi, fmtDT, fmtDTfull, fmtTime, rel, num, pct, debounce, TYPES, diffTag, toLocalInput, fromLocalInput, errMsg, esc } from './core.js';

const isAdmin = () => state.user.role === 'admin';
const TYPE_OPTS = Object.entries(TYPES);
const LETTERS = 'ABCDEFGHIJ';
const rid = () => 'o' + Math.random().toString(36).slice(2, 6);

/* ============================== question editor (shared) ============================== */
export function openQuestionEditor({ q, title, subjects = [], topics = [], lockType = false, showBank = false, submit = 'Save question', onSave, defaults = {} }) {
  const s = q ? JSON.parse(JSON.stringify(q)) : { type: 'mcq', text: '', marks: 1, negative_marks: 0, difficulty: 'medium', subject: defaults.subject || '', topic: '', explanation: '', options: [{ id: rid(), text: '' }, { id: rid(), text: '' }, { id: rid(), text: '' }, { id: rid(), text: '' }], correct: null };
  if (s.type === 'short' && Array.isArray(s.correct)) s.accepted = s.correct.join('\n');
  const optsHtml = () => {
    if (s.type === 'mcq' || s.type === 'multi') {
      const multi = s.type === 'multi'; const isC = (id) => (multi ? (s.correct || []).includes(id) : s.correct === id);
      return html`<div class="stack-sm"><span class="lbl">Options <span class="muted small">— mark the correct ${multi ? 'answers' : 'answer'}</span></span>
        ${(s.options || []).map((o, i) => html`<div class="row"><input type="${multi ? 'checkbox' : 'radio'}" name="corr" style="width:18px;height:18px;accent-color:var(--brand)" data-change="corr" data-id="${o.id}" ${isC(o.id) ? raw('checked') : ''} aria-label="Option ${LETTERS[i]} is correct"><span class="mono muted" style="width:18px">${LETTERS[i]}</span><input class="input grow" data-input="opt" data-i="${i}" value="${o.text}" placeholder="Option ${LETTERS[i]}" maxlength="500"><button type="button" class="btn btn-ghost btn-sm" data-act="rmopt" data-i="${i}" aria-label="Remove option ${LETTERS[i]}">${icon('x')}</button></div>`)}
        ${(s.options || []).length < 10 ? html`<div><button type="button" class="btn btn-sm" data-act="addopt">${icon('plus')} Add option</button></div>` : ''}</div>`;
    }
    if (s.type === 'tf') return html`<div class="stack-sm"><span class="lbl">Correct answer</span><div class="row"><label class="chip"><input type="radio" name="tf" value="true" data-change="tf" ${s.correct === 'true' ? raw('checked') : ''}> True</label><label class="chip"><input type="radio" name="tf" value="false" data-change="tf" ${s.correct === 'false' ? raw('checked') : ''}> False</label></div></div>`;
    if (s.type === 'short') return html`<div class="field"><label>Accepted answers</label><textarea class="input" data-input="acc" placeholder="One accepted answer per line" style="min-height:80px">${s.accepted || ''}</textarea><span class="hint">Matching is case-insensitive. Leave empty to mark this question manually.</span></div>`;
    return html`<div class="notice">${icon('info')}<span>Long answers are marked manually by the teacher after submission.</span></div>`;
  };
  const m = formModal({ title, size: 'wide', submit, fields: html`<div class="stack">
    <div class="form-grid"><div class="field"><label>Type</label><select class="input" name="type" data-change="type" ${lockType ? raw('disabled') : ''}>${TYPE_OPTS.map(([k, l]) => html`<option value="${k}" ${k === s.type ? raw('selected') : ''}>${l}</option>`)}</select>${lockType ? html`<span class="hint">Locked: students have already started this exam.</span>` : ''}</div>
      <div class="field"><label>Difficulty</label><select class="input" name="difficulty"><option value="easy" ${s.difficulty === 'easy' ? raw('selected') : ''}>Easy</option><option value="medium" ${s.difficulty === 'medium' ? raw('selected') : ''}>Medium</option><option value="hard" ${s.difficulty === 'hard' ? raw('selected') : ''}>Hard</option></select></div></div>
    <div class="field"><label>Question</label><textarea class="input" name="text" required maxlength="5000" style="min-height:90px" data-input="text" autofocus>${s.text}</textarea></div>
    <div id="qopts">${optsHtml()}</div>
    <div class="form-grid"><div class="field"><label>Marks</label><input class="input" name="marks" type="number" min="0" step="0.25" value="${s.marks}" required></div><div class="field"><label>Negative marks</label><input class="input" name="negative_marks" type="number" min="0" step="0.25" value="${s.negative_marks}"><span class="hint">Deducted for a wrong answer only when the exam uses negative marking.</span></div>
      <div class="field"><label>Subject</label><input class="input" name="subject" list="dl-subj" value="${s.subject || ''}" maxlength="100"><datalist id="dl-subj">${subjects.map((x) => html`<option value="${x}">`)}</datalist></div>
      <div class="field"><label>Topic</label><input class="input" name="topic" list="dl-topic" value="${s.topic || ''}" maxlength="100"><datalist id="dl-topic">${topics.map((x) => html`<option value="${x}">`)}</datalist></div></div>
    <div class="field"><label>Explanation <span class="muted small">(shown to students with released results)</span></label><textarea class="input" name="explanation" maxlength="3000">${s.explanation || ''}</textarea></div>
    ${showBank ? html`<label class="check"><input type="checkbox" name="saveToBank" checked><span>Also save to the question bank for reuse</span></label>` : ''}</div>`,
    onMount: (mm, form) => {
      const redraw = () => put($('#qopts', form), optsHtml());
      bind(form, {
        type: (t) => { s.type = t.value; if (s.type === 'mcq' || s.type === 'multi') { s.options = s.options?.length ? s.options : [{ id: rid(), text: '' }, { id: rid(), text: '' }]; s.correct = s.type === 'multi' ? [] : null; } else s.correct = s.type === 'tf' ? 'true' : null; redraw(); },
        opt: (t) => { s.options[+t.dataset.i].text = t.value; }, text: (t) => { s.text = t.value; }, acc: (t) => { s.accepted = t.value; },
        corr: (t) => { if (s.type === 'multi') { const c = new Set(s.correct || []); t.checked ? c.add(t.dataset.id) : c.delete(t.dataset.id); s.correct = [...c]; } else s.correct = t.dataset.id; },
        tf: (t) => { s.correct = t.value; },
        addopt: () => { s.options.push({ id: rid(), text: '' }); redraw(); $$('[data-input=opt]', form).pop()?.focus(); },
        rmopt: (t) => { const o = s.options.splice(+t.dataset.i, 1)[0]; if (s.type === 'multi') s.correct = (s.correct || []).filter((x) => x !== o.id); else if (s.correct === o.id) s.correct = null; redraw(); },
      });
    },
    onSubmit: async (f, mm) => {
      const body = { type: s.type, text: f.text, difficulty: f.difficulty, marks: +f.marks, negative_marks: +(f.negative_marks || 0), subject: f.subject, topic: f.topic, explanation: f.explanation };
      if (s.type === 'mcq' || s.type === 'multi') { body.options = s.options.filter((o) => o.text.trim()); body.correct = s.correct; }
      else if (s.type === 'tf') body.correct = s.correct; else if (s.type === 'short') body.correct = (s.accepted || '').split('\n').map((x) => x.trim()).filter(Boolean);
      await onSave(body, !!f.saveToBank, mm);
    } });
  return m;
}

function questionPreview(q) {
  const cor = (id) => (Array.isArray(q.correct) ? q.correct.includes(id) : q.correct === id);
  return html`<div class="stack-sm"><p style="white-space:pre-wrap;font-weight:500">${q.text}</p>
    ${q.options ? q.options.map((o, i) => html`<div class="row" style="padding:6px 10px;border-radius:8px;${cor(o.id) ? 'background:var(--ok-soft);color:var(--ok-ink);font-weight:600' : ''}"><span class="mono muted" style="width:18px">${q.type === 'tf' ? '' : LETTERS[i]}</span><span>${o.text}</span>${cor(o.id) ? icon('check') : ''}</div>`) : ''}
    ${q.type === 'short' ? html`<div class="small"><b>Accepted:</b> ${(q.correct || []).length ? q.correct.join(' · ') : 'Marked manually'}</div>` : ''}${q.type === 'long' ? html`<div class="small muted">Marked manually.</div>` : ''}
    ${q.explanation ? html`<div class="notice">${icon('info')}<span>${q.explanation}</span></div>` : ''}</div>`;
}

/* ============================== question bank ============================== */
export async function questions(ctx) {
  const el = ctx.el; const f = { q: '', subject: '', topic: '', type: '', difficulty: '', mine: '', page: 1 }; let meta = { subjects: [], topics: [] };
  put(el, html`<div class="page-head"><div><h1>Question bank</h1><p>Reusable questions for every exam. Copy them into an exam and edit freely.</p></div><button class="btn btn-primary" data-act="new">${icon('plus')} New question</button></div>
    <div class="toolbar"><div class="searchbox">${icon('search')}<input class="input" data-input="q" placeholder="Search question text or topic" aria-label="Search questions"></div>
      <select class="input" data-change="subject" id="f-subj" aria-label="Subject"><option value="">All subjects</option></select><select class="input" data-change="topic" id="f-topic" aria-label="Topic"><option value="">All topics</option></select>
      <select class="input" data-change="type" aria-label="Type"><option value="">All types</option>${TYPE_OPTS.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select>
      <select class="input" data-change="difficulty" aria-label="Difficulty"><option value="">Any difficulty</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
      <button class="chip" data-act="mine" aria-pressed="false" id="f-mine">My questions</button></div>
    <div class="card"><div id="tbl">${skeleton(6)}</div></div>`);
  async function load() {
    const box = $('#tbl', el);
    try {
      const r = await api('GET', '/questions' + qs({ ...f, size: 12 }));
      if (!meta.subjects.length || r.subjects.length !== meta.subjects.length) { meta = { subjects: r.subjects, topics: r.topics }; $('#f-subj', el).innerHTML = `<option value="">All subjects</option>` + r.subjects.map((s) => `<option ${s === f.subject ? 'selected' : ''} value="${esc(s)}">${esc(s)}</option>`).join(''); $('#f-topic', el).innerHTML = `<option value="">All topics</option>` + r.topics.map((s) => `<option ${s === f.topic ? 'selected' : ''} value="${esc(s)}">${esc(s)}</option>`).join(''); }
      el._items = r.items;
      put(box, r.items.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Question</th><th>Type</th><th>Difficulty</th><th>Marks</th><th>Author</th><th></th></tr></thead><tbody>${r.items.map((x) => html`<tr>
        <td style="max-width:460px"><a class="name" href="#" data-act="view" data-id="${x.id}" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)">${x.text}</a><div class="sub">${x.subject || ''}${x.topic ? ' · ' + x.topic : ''}</div></td><td><span class="tag">${TYPES[x.type]}</span></td><td>${diffTag(x.difficulty)}</td><td class="mono">${num(x.marks)}${x.negative_marks ? html` <span class="muted">/ −${num(x.negative_marks)}</span>` : ''}</td><td class="small">${x.author || '—'}</td>
        <td class="actions"><button class="btn btn-ghost btn-sm" data-act="view" data-id="${x.id}" aria-label="Preview">${icon('eye')}</button>${x.editable ? html`<button class="btn btn-ghost btn-sm" data-act="edit" data-id="${x.id}" aria-label="Edit question">${icon('edit')}</button>` : ''}<button class="btn btn-ghost btn-sm" data-act="dup" data-id="${x.id}" aria-label="Duplicate question">${icon('copy')}</button>${x.editable ? html`<button class="btn btn-ghost btn-sm" data-act="del" data-id="${x.id}" aria-label="Delete question">${icon('trash')}</button>` : ''}</td></tr>`)}</tbody></table></div>${pager(r)}`
        : empty('No questions found', 'Change the filters or add a new question.', 'help', html`<button class="btn btn-primary" data-act="new">${icon('plus')} New question</button>`));
    } catch (e) { put(box, errorBox(e)); }
  }
  const byId = (t) => el._items.find((x) => x.id === +t.dataset.id);
  const setF = (k) => (t) => { f[k] = t.value; f.page = 1; load(); };
  const editor = (x) => openQuestionEditor({ q: x, title: x ? 'Edit question' : 'New question', subjects: meta.subjects, topics: meta.topics,
    onSave: async (body, _b, m) => { if (x) await api('PUT', `/questions/${x.id}`, body); else await api('POST', '/questions', body); m.close(); toast(x ? 'Question updated' : 'Question added', '', 'ok'); meta = { subjects: [], topics: [] }; load(); } });
  bind(el, { q: debounce((t) => { f.q = t.value; f.page = 1; load(); }, 300), subject: setF('subject'), topic: setF('topic'), type: setF('type'), difficulty: setF('difficulty'), page: (t) => { f.page = +t.dataset.p; load(); }, retry: load,
    mine: (t) => { f.mine = f.mine ? '' : '1'; t.setAttribute('aria-pressed', !!f.mine); f.page = 1; load(); }, new: () => editor(null), edit: (t) => editor(byId(t)),
    view: (t) => { const x = byId(t); modal({ title: TYPES[x.type] + ' · ' + x.difficulty, sub: `${x.subject || ''} ${x.topic ? '· ' + x.topic : ''} · ${num(x.marks)} mark(s)`, body: questionPreview(x), foot: html`<button class="btn" data-close>Close</button>` }); },
    dup: async (t) => { try { await api('POST', `/questions/${t.dataset.id}/duplicate`); toast('Question duplicated', 'A copy was added to your questions.', 'ok'); load(); } catch (e) { fail(e); } },
    del: async (t) => { if (await confirmDialog({ title: 'Delete this question?', message: 'It will be removed from the bank. Exams that already use it keep their own copy.', confirmText: 'Delete', danger: true })) { try { await api('DELETE', `/questions/${t.dataset.id}`); toast('Question deleted', '', 'ok'); load(); } catch (e) { fail(e); } } } });
  await load();
}

/* ============================== exams list ============================== */
const STATUS_CHIPS = [['', 'All'], ['draft', 'Draft'], ['scheduled', 'Scheduled'], ['live,paused', 'Live'], ['completed', 'Completed'], ['archived', 'Archived']];
async function examFormModal({ exam, classes, classroomId, hasAttempts, onDone, ctx }) {
  const editing = !!exam; const settings = await api('GET', '/settings');
  const hr = new Date(); hr.setMinutes(0, 0, 0); const startDef = hr.getTime() + 3600000;
  const e = exam || { name: '', description: '', instructions: '', classroom_id: classroomId || '', start_at: startDef, end_at: startDef + 3 * 3600000, duration_min: +settings.default_duration || 60, passing_marks: 0, max_attempts: 1, negative_marking: 0, shuffle_questions: 0, shuffle_options: 0, release_mode: 'manual', show_answers: 1 };
  const live = editing && ['live', 'paused'].includes(exam.status);
  const chk = (n, l, h) => html`<label class="check"><input type="checkbox" name="${n}" ${e[n] ? raw('checked') : ''}><span>${l}${h ? html`<br><span class="muted small">${h}</span>` : ''}</span></label>`;
  return formModal({ title: editing ? 'Edit exam details' : 'Create exam', size: 'xl', submit: editing ? 'Save changes' : 'Create exam', sub: editing ? '' : 'You can add questions on the next screen.',
    fields: html`<div class="form-grid">
      <div class="field full"><label>Exam name</label><input class="input" name="name" required maxlength="150" value="${e.name}" autofocus placeholder="e.g. Physics Unit Test: Motion &amp; Forces"></div>
      <div class="field"><label>Classroom</label><select class="input" name="classroom_id" required ${editing && (hasAttempts || live) ? raw('disabled') : ''}><option value="">Choose classroom</option>${classes.map((c) => html`<option value="${c.id}" ${+e.classroom_id === c.id ? raw('selected') : ''}>${c.name}</option>`)}</select></div>
      <div class="field"><label>Subject</label><input class="input" name="subject" maxlength="100" value="${e.subject || ''}" placeholder="Defaults to the classroom subject"></div>
      <div class="field"><label>Opens (start)</label><input class="input" type="datetime-local" name="start_at" value="${toLocalInput(e.start_at)}" ${live ? raw('disabled') : ''}></div>
      <div class="field"><label>Closes (end of start window)</label><input class="input" type="datetime-local" name="end_at" value="${toLocalInput(e.end_at)}"><span class="hint">Students can begin until this time.</span></div>
      <div class="field"><label>Duration (minutes)</label><input class="input" type="number" name="duration_min" min="1" max="600" value="${e.duration_min}" required>${live ? html`<span class="hint" style="color:var(--pen)">Changing this adjusts every in-progress student's timer.</span>` : ''}</div>
      <div class="field"><label>Passing marks</label><input class="input" type="number" name="passing_marks" min="0" step="0.5" value="${e.passing_marks}"><span class="hint">Total marks are calculated from the questions you add${editing ? ` (currently ${num(exam.total_marks)})` : ''}.</span></div>
      <div class="field"><label>Maximum attempts</label><input class="input" type="number" name="max_attempts" min="1" max="10" value="${e.max_attempts}"></div>
      <div class="field"><label>Result release</label>${sel('release_mode', [['manual', 'I will publish results manually'], ['on_completion', 'Publish automatically when the exam ends']], e.release_mode)}</div>
      <div class="field full"><label>Description</label><textarea class="input" name="description" maxlength="1000" style="min-height:64px">${e.description || ''}</textarea></div>
      <div class="field full"><label>Instructions shown to students</label><textarea class="input" name="instructions" maxlength="3000">${e.instructions || ''}</textarea></div>
      <div class="full grid g2">${chk('negative_marking', 'Negative marking', 'Wrong objective answers lose the question’s negative marks.')}${chk('shuffle_questions', 'Randomise question order', 'Each attempt gets its own order.')}${chk('shuffle_options', 'Randomise option order', 'MCQ options are shuffled per student.')}${chk('show_answers', 'Show correct answers after results are published', '')}</div></div>`,
    onSubmit: async (f, m) => {
      const body = { name: f.name, description: f.description, instructions: f.instructions, subject: f.subject, classroom_id: f.classroom_id ? +f.classroom_id : (editing ? exam.classroom_id : null), start_at: live ? exam.start_at : fromLocalInput(f.start_at), end_at: fromLocalInput(f.end_at), duration_min: +f.duration_min, passing_marks: +(f.passing_marks || 0), max_attempts: +(f.max_attempts || 1), negative_marking: f.negative_marking, shuffle_questions: f.shuffle_questions, shuffle_options: f.shuffle_options, release_mode: f.release_mode, show_answers: f.show_answers };
      if (editing) {
        await withLive(exam, (ack) => api('PUT', `/exams/${exam.id}`, { ...body, ack }));
        m.close(); toast('Exam updated', '', 'ok'); onDone?.();
      } else { const r = await api('POST', '/exams', body); m.close(); toast('Exam created', 'Now add some questions.', 'ok'); ctx.go(`#/exams/${r.id}`); }
    } });
}

// Live-edit safety: server answers 409 LIVE_EDIT_WARNING; we show the warning then resend with ack
export async function withLive(exam, fn) {
  try { return await fn(false); }
  catch (e) {
    if (e.details?.code !== 'LIVE_EDIT_WARNING') throw e;
    const ok = await confirmDialog({ title: 'Change a live exam?', confirmText: 'Apply to live exam', danger: true,
      message: html`This exam is ${e.details.status === 'paused' ? 'paused' : 'live'}${e.details.inProgress ? html` and <b>${e.details.inProgress} student${e.details.inProgress === 1 ? ' is' : 's are'}</b> taking it right now` : ''}. The change reaches them within seconds.`,
      extra: html`<ul class="small muted" style="margin:0;padding-left:18px"><li>Saved answers are kept. They are tied to the question, not its text.</li><li>Finished attempts are re-evaluated if scoring changes.</li><li>Who, what, the old value and the new value are recorded in the exam’s version history.</li></ul>` });
    if (!ok) { const err = new Error('cancelled'); err.cancelled = true; throw err; }
    return await fn(true);
  }
}

export async function exams(ctx) {
  if (ctx.id) return examDetail(ctx);
  const el = ctx.el; const f = { q: '', status: '', classroomId: '', page: 1 };
  const classes = (await api('GET', '/classrooms' + qs({ size: 100 }))).items;
  put(el, html`<div class="page-head"><div><h1>Exams</h1><p>Create, schedule and run exams.</p></div><button class="btn btn-primary" data-act="new">${icon('plus')} Create exam</button></div>
    <div class="toolbar"><div class="searchbox">${icon('search')}<input class="input" data-input="q" placeholder="Search exams" aria-label="Search exams"></div>
      <select class="input" data-change="cls" aria-label="Classroom"><option value="">All classrooms</option>${classes.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
      <div class="row wrap" role="group" aria-label="Status filter">${STATUS_CHIPS.map(([k, l]) => html`<button class="chip" data-act="status" data-k="${k}" aria-pressed="${f.status === k}">${l}</button>`)}</div></div><div id="list">${skeleton(3)}</div>`);
  async function load() {
    const box = $('#list', el);
    try {
      const r = await api('GET', '/exams' + qs({ ...f, size: 12 }));
      $$('[data-act=status]', el).forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === f.status));
      put(box, r.items.length ? html`<div class="auto-grid">${r.items.map((x) => html`<div class="card card-pad stack-sm">
        <div class="row between"><span class="muted small truncate">${x.classroom_name}</span>${badge(x.status)}</div><a href="#/exams/${x.id}" style="color:inherit"><h2>${x.name}</h2></a>
        <div class="muted small">${x.start_at ? fmtDT(x.start_at) : 'No date set'} · ${x.duration_min} min · ${x.question_count} questions · ${num(x.total_marks)} marks</div>
        ${['live', 'paused', 'completed', 'archived'].includes(x.status) ? html`<div><div class="row between small muted" style="margin-bottom:4px"><span>${x.in_progress ? `${x.in_progress} taking now · ` : ''}${x.submitted}/${x.enrolled} submitted</span></div><div class="bar ${['live', 'paused'].includes(x.status) ? 'hi' : ''}"><i style="width:${x.enrolled ? Math.round((x.submitted / x.enrolled) * 100) : 0}%"></i></div></div>` : ''}
        <div class="row wrap" style="margin-top:4px"><a class="btn btn-sm" href="#/exams/${x.id}">${icon('edit')} Manage</a>${['live', 'paused'].includes(x.status) ? html`<a class="btn btn-sm btn-hi" href="#/live/${x.id}">${icon('radio')} Monitor</a>` : ''}${['completed', 'archived', 'live', 'paused'].includes(x.status) ? html`<a class="btn btn-sm" href="#/results/${x.id}">${icon('chart')} Results</a>` : ''}</div></div>`)}</div>${r.total > r.size ? pager(r) : ''}`
        : empty('No exams found', f.q || f.status ? 'Try clearing the filters.' : 'Create your first exam to get started.', 'file', html`<button class="btn btn-primary" data-act="new">${icon('plus')} Create exam</button>`));
    } catch (e) { put(box, errorBox(e)); }
  }
  const openNew = (cid) => examFormModal({ classes, classroomId: cid, ctx });
  bind(el, { q: debounce((t) => { f.q = t.value; f.page = 1; load(); }, 300), cls: (t) => { f.classroomId = t.value; f.page = 1; load(); }, status: (t) => { f.status = t.dataset.k; f.page = 1; load(); }, page: (t) => { f.page = +t.dataset.p; load(); }, retry: load, new: () => openNew() });
  await load();
  if (ctx.query.new !== undefined) { history.replaceState(null, '', '#/exams'); openNew(+ctx.query.new || undefined); }
}

/* ============================== exam detail ============================== */
async function examDetail(ctx) {
  const el = ctx.el; const id = +ctx.id; let tab = ctx.sub || 'questions'; let D;
  const classes = (await api('GET', '/classrooms' + qs({ size: 100 }))).items; const bankMeta = { subjects: [], topics: [] };
  async function load(keepTab) {
    try { D = await api('GET', `/exams/${id}`); } catch (e) { put(el, errorBox(e)); return; }
    render();
  }
  const isLiveNow = () => ['live', 'paused'].includes(D.exam.status);
  const locked = () => ['completed', 'archived'].includes(D.exam.status);
  function actions() {
    const s = D.exam.status;
    const b = (act, ic, l, cls = '') => html`<button class="btn ${cls}" data-act="${act}">${icon(ic)} ${l}</button>`;
    if (s === 'draft') return html`${b('editmeta', 'edit', 'Edit details')}${b('schedule', 'clock', 'Schedule', '')}${b('startnow', 'play', 'Start now', 'btn-hi')}${b('delete', 'trash', '', 'btn-outline-danger')}`;
    if (s === 'scheduled') return html`${b('editmeta', 'edit', 'Edit details')}${b('unschedule', 'left', 'Back to draft')}${b('startnow', 'play', 'Start now', 'btn-hi')}`;
    if (s === 'live') return html`<a class="btn btn-hi" href="#/live/${id}">${icon('radio')} Live monitor</a>${b('editmeta', 'edit', 'Edit details')}${b('pause', 'pause', 'Pause exam')}${b('end', 'stop', 'End exam', 'btn-outline-danger')}`;
    if (s === 'paused') return html`<a class="btn btn-hi" href="#/live/${id}">${icon('radio')} Live monitor</a>${b('resume', 'play', 'Resume exam', 'btn-primary')}${b('end', 'stop', 'End exam', 'btn-outline-danger')}`;
    if (s === 'completed') return html`<a class="btn" href="#/results/${id}">${icon('chart')} Results</a>${b('publish', 'send', D.exam.results_released ? 'Unpublish results' : 'Publish results', D.exam.results_released ? '' : 'btn-primary')}${b('archive', 'archive', 'Archive')}`;
    return html`<a class="btn" href="#/results/${id}">${icon('chart')} Results</a>${b('unarchive', 'refresh', 'Unarchive')}`;
  }
  function render() {
    const x = D.exam;
    put(el, html`<div class="page-head"><div><a class="small muted" href="#/exams">← All exams</a><div class="row" style="margin-top:6px;gap:12px"><h1>${x.name}</h1>${badge(x.status)}${x.results_released ? badge('ok', 'Results published') : ''}</div>
      <p>${D.classroom.name} · ${x.start_at ? fmtDTfull(x.start_at).replace(/:\d\d /, ' ') : 'Not scheduled'} · ${x.duration_min} min · ${num(x.total_marks)} marks (pass ${num(x.passing_marks)})</p></div><div class="row wrap">${actions()}</div></div>
      ${isLiveNow() ? html`<div class="notice hi" style="margin-bottom:16px">${icon('radio')}<div><b>This exam is ${x.status === 'paused' ? 'paused' : 'live'} · version ${x.version}.</b> ${D.inProgress} student${D.inProgress === 1 ? ' is' : 's are'} taking it. Edits apply to them immediately, and you will be asked to confirm each one. Every change is recorded in the Changes tab.</div></div>` : ''}
      <div class="tabs" role="tablist">${[['questions', `Questions (${D.questions.length})`], ['settings', 'Settings'], ['changes', 'Changes']].map(([k, l]) => html`<button role="tab" aria-selected="${tab === k}" data-act="tab" data-k="${k}">${l}</button>`)}</div><div id="tabbody"></div>`);
    drawTab();
  }
  function drawTab() {
    const box = $('#tabbody', el); const x = D.exam; $$('[data-act=tab]', el).forEach((b) => b.setAttribute('aria-selected', b.dataset.k === tab));
    if (tab === 'settings') {
      const row = (k, v) => html`<dt>${k}</dt><dd>${v}</dd>`;
      put(box, html`<div class="card card-pad"><dl class="kv">${row('Classroom', D.classroom.name)}${row('Subject', x.subject || '—')}${row('Window', `${fmtDT(x.start_at)} → ${fmtDT(x.end_at)}`)}${row('Duration', `${x.duration_min} minutes`)}${row('Total / passing', `${num(x.total_marks)} / ${num(x.passing_marks)} marks`)}${row('Max attempts', x.max_attempts)}${row('Negative marking', x.negative_marking ? 'On' : 'Off')}${row('Randomise', `${x.shuffle_questions ? 'Questions' : ''}${x.shuffle_questions && x.shuffle_options ? ' + ' : ''}${x.shuffle_options ? 'Options' : ''}${!x.shuffle_questions && !x.shuffle_options ? 'Off' : ''}`)}${row('Results', x.release_mode === 'manual' ? 'Published manually' : 'Published when the exam ends')}${row('Correct answers', x.show_answers ? 'Shown with results' : 'Hidden')}${row('Version', x.version)}${row('Instructions', x.instructions || '—')}</dl>${locked() ? '' : html`<div style="margin-top:16px"><button class="btn" data-act="editmeta">${icon('edit')} Edit details</button></div>`}</div>`);
    } else if (tab === 'changes') {
      put(box, html`<div class="card">${skeleton(3)}</div>`);
      api('GET', `/exams/${id}/changes`).then((r) => {
        const short = (v) => (v == null ? '—' : v.length > 70 ? v.slice(0, 70) + '…' : v);
        put(box, html`<div class="card"><div class="table-wrap">${r.items.length ? html`<table class="tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Old value</th><th>New value</th><th>Ver.</th></tr></thead><tbody>${r.items.map((c) => html`<tr><td class="small">${fmtDTfull(c.created_at)}</td><td>${c.user_name || 'System'}</td><td><span class="tag">${c.entity}</span> ${c.action}${c.field ? html` · <b>${c.field}</b>` : ''}</td><td class="small mono" style="max-width:220px;word-break:break-word;color:var(--pen-ink)">${short(c.old_value)}</td><td class="small mono" style="max-width:220px;word-break:break-word;color:var(--ok-ink)">${short(c.new_value)}</td><td>v${c.exam_version}</td></tr>`)}</tbody></table>` : empty('No changes recorded', 'Edits to this exam and its questions will appear here.', 'history')}</div></div>`);
      }).catch((e) => put(box, errorBox(e)));
    } else {
      put(box, html`<div class="row between wrap" style="margin-bottom:14px"><span class="muted">${D.questions.length} question${D.questions.length === 1 ? '' : 's'} · ${num(x.total_marks)} total marks</span>${locked() ? '' : html`<div class="row"><button class="btn" data-act="addbank">${icon('help')} Add from question bank</button><button class="btn btn-primary" data-act="newq">${icon('plus')} Write new question</button></div>`}</div>
        ${D.questions.length ? html`<div class="stack">${D.questions.map((q, i) => html`<div class="card card-pad"><div class="row between wrap" style="margin-bottom:8px"><div class="row wrap"><b class="mono">Q${i + 1}</b><span class="tag">${TYPES[q.type]}</span>${diffTag(q.difficulty || 'medium')}<span class="muted small">${num(q.marks)} mark${q.marks === 1 ? '' : 's'}${q.negative_marks ? ` · −${num(q.negative_marks)} wrong` : ''}${q.topic ? ' · ' + q.topic : ''}</span></div>
          ${locked() ? '' : html`<div class="row"><button class="btn btn-ghost btn-sm" data-act="up" data-i="${i}" ${i === 0 ? raw('disabled') : ''} aria-label="Move question up">${icon('arrowup')}</button><button class="btn btn-ghost btn-sm" data-act="down" data-i="${i}" ${i === D.questions.length - 1 ? raw('disabled') : ''} aria-label="Move question down">${icon('arrowdown')}</button><button class="btn btn-sm" data-act="editq" data-id="${q.id}">${icon('edit')} Edit</button><button class="btn btn-sm btn-outline-danger" data-act="rmq" data-id="${q.id}" aria-label="Remove question">${icon('trash')}</button></div>`}</div>${questionPreview(q)}</div>`)}</div>`
        : empty('No questions yet', 'Add questions from the bank or write new ones.', 'help', locked() ? '' : html`<button class="btn btn-primary" data-act="addbank">${icon('help')} Add from question bank</button>`)}`);
    }
  }
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok, '', 'ok'); await load(); } catch (e) { if (!e.cancelled) fail(e); } };
  const status = (action, extra = {}) => api('POST', `/exams/${id}/status`, { action, ...extra });
  const editQuestion = (q) => openQuestionEditor({ q, title: 'Edit question', submit: 'Save changes', lockType: D.hasAttempts, subjects: bankMeta.subjects, topics: bankMeta.topics,
    onSave: async (body, _b, m) => { const r = await withLive(D.exam, (ack) => api('PUT', `/exams/${id}/questions/${q.id}`, { ...body, ack })); m.close(); toast(r.changed ? 'Question updated' : 'No changes', r.regraded ? `${r.regraded} finished attempt(s) re-evaluated` : '', 'ok'); load(); } });
  const swap = (i, j) => { const ids = D.questions.map((q) => q.id); [ids[i], ids[j]] = [ids[j], ids[i]]; run(() => withLive(D.exam, (ack) => api('POST', `/exams/${id}/questions/reorder`, { order: ids, ack }))); };
  bind(el, {
    retry: load, tab: (t) => { tab = t.dataset.k; drawTab(); },
    editmeta: () => examFormModal({ exam: D.exam, classes, hasAttempts: D.hasAttempts, onDone: load, ctx }),
    schedule: () => run(() => status('schedule'), 'Exam scheduled. Students were notified.'),
    unschedule: () => run(() => status('unschedule'), 'Moved back to draft'),
    startnow: async () => { if (await confirmDialog({ title: 'Start this exam now?', message: 'Students in the classroom will be notified and can begin immediately.', confirmText: 'Start exam' })) run(() => status('start'), 'Exam is live'); },
    pause: () => formModal({ title: 'Pause exam for everyone', sub: 'Timers freeze and students see a pause message. Saved answers stay intact.', submit: 'Pause exam', fields: field('Reason (optional)', html`<input class="input" name="reason" maxlength="300" placeholder="e.g. Fire drill">`), onSubmit: async (f, m) => { await status('pause', { reason: f.reason }); m.close(); toast('Exam paused', '', 'ok'); load(); } }),
    resume: () => run(() => status('resume'), 'Exam resumed. Timers are running again.'),
    end: async () => { if (await confirmDialog({ title: 'End this exam for everyone?', danger: true, confirmText: 'End exam', message: html`${D.inProgress} student${D.inProgress === 1 ? '' : 's'} still in progress will be force-submitted with the answers saved so far. This cannot be undone.` })) run(() => status('end', { reason: 'Ended by staff' }), 'Exam ended'); },
    archive: () => run(() => status('archive'), 'Exam archived'), unarchive: () => run(() => status('unarchive'), 'Exam restored'),
    delete: async () => { if (await confirmDialog({ title: 'Delete this draft?', message: 'The exam and its question list will be permanently removed.', confirmText: 'Delete', danger: true })) { try { await api('DELETE', `/exams/${id}`); toast('Draft deleted', '', 'ok'); ctx.go('#/exams'); } catch (e) { fail(e); } } },
    publish: async () => {
      const release = !D.exam.results_released;
      try { await api('POST', `/exams/${id}/publish-results`, { release }); toast(release ? 'Results published' : 'Results hidden', release ? 'Students were notified.' : '', 'ok'); load(); }
      catch (e) { if (e.details?.code === 'PENDING_MANUAL') { if (await confirmDialog({ title: 'Some answers are unmarked', message: e.message, confirmText: 'Publish anyway' })) run(async () => api('POST', `/exams/${id}/publish-results`, { release: true, force: true }), 'Results published'); } else fail(e); }
    },
    editq: (t) => editQuestion(D.questions.find((q) => q.id === +t.dataset.id)),
    rmq: async (t) => { const q = D.questions.find((z) => z.id === +t.dataset.id); if (await confirmDialog({ title: 'Remove this question?', danger: true, confirmText: 'Remove', message: isLiveNow() || D.hasAttempts ? 'Students’ answers to it are kept in their attempt history but the question no longer counts toward scores.' : 'It will be removed from this exam.' })) run(() => withLive(D.exam, (ack) => api('DELETE', `/exams/${id}/questions/${q.id}`, { ack })), 'Question removed'); },
    up: (t) => swap(+t.dataset.i, +t.dataset.i - 1), down: (t) => swap(+t.dataset.i, +t.dataset.i + 1),
    newq: () => openQuestionEditor({ title: 'New question for this exam', showBank: true, submit: 'Add to exam', subjects: bankMeta.subjects, topics: bankMeta.topics, defaults: { subject: D.exam.subject },
      onSave: async (body, saveToBank, m) => { await withLive(D.exam, (ack) => api('POST', `/exams/${id}/questions`, { question: body, saveToBank, ack })); m.close(); toast('Question added', '', 'ok'); load(); } }),
    addbank: async () => {
      const inExam = new Set(D.questions.map((q) => q.source_question_id).filter(Boolean)); let subj = D.exam.subject || '';
      const m = formModal({ title: 'Add from question bank', size: 'xl', submit: 'Add selected', fields: html`<div class="toolbar" style="margin-bottom:10px"><div class="searchbox">${icon('search')}<input class="input" id="bk-q" placeholder="Search questions"></div><label class="chip"><input type="checkbox" id="bk-all"> All subjects</label></div><div id="bk-list" class="stack-sm" style="max-height:52vh;overflow:auto">${skeleton(3)}</div>`,
        onMount: (mm) => {
          const draw = async () => { const r = await api('GET', '/questions' + qs({ subject: $('#bk-all', mm.el).checked ? '' : subj, q: $('#bk-q', mm.el).value, size: 100 })); const list = r.items.filter((x) => !inExam.has(x.id));
            put($('#bk-list', mm.el), list.length ? list.map((x) => html`<label class="check card card-pad" style="padding:10px 12px"><input type="checkbox" name="q${x.id}"><span class="grow"><span style="font-weight:500">${x.text}</span><br><span class="row wrap small muted" style="gap:8px"><span class="tag">${TYPES[x.type]}</span>${diffTag(x.difficulty)}<span>${num(x.marks)} mark(s)</span><span>${x.topic || ''}</span></span></span></label>`) : empty('Nothing to add', 'Try another subject or search.', 'help')); };
          $('#bk-q', mm.el).oninput = debounce(draw, 250); $('#bk-all', mm.el).onchange = draw; draw().catch(fail);
        },
        onSubmit: async (f, mm, form) => { const ids = [...form.querySelectorAll('input[name^=q]:checked')].map((c) => +c.name.slice(1)); if (!ids.length) throw new Error('Select at least one question.'); await withLive(D.exam, (ack) => api('POST', `/exams/${id}/questions`, { questionIds: ids, ack })); mm.close(); toast('Questions added', `${ids.length} added`, 'ok'); load(); } });
    },
  });
  await load();
  ctx.onLeave(bus.on('ws:monitor', debounce(() => { if (isLiveNow() && tab === 'questions') api('GET', `/exams/${id}`).then((d) => { D.inProgress = d.inProgress; }).catch(() => {}); }, 2000)));
}
