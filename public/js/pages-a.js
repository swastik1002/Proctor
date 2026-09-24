import { state, html, raw, put, $, $$, api, qs, bus, icon, bind, toast, fail, confirmDialog, formModal, modal, field, sel, badge, skeleton, empty, errorBox, pager, kpi, fmtDT, fmtDate, fmtTime, rel, num, pct, initials, debounce, popMenu, download, errMsg, TYPES } from './core.js';
import { columns, describe, actionIcon } from './charts.js';

const isAdmin = () => state.user.role === 'admin';

/* ============================== dashboard ============================== */
export async function dashboard(ctx) {
  const el = ctx.el;
  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  async function load() {
    let d; try { d = await api('GET', '/dashboard'); } catch (e) { put(el, errorBox(e)); return; }
    const k = d.kpis;
    put(el, html`
      <div class="page-head"><div><h1>${greet()}, ${state.user.name.split(' ')[0]}</h1><p>${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · ${isAdmin() ? 'School overview' : 'Your classrooms at a glance'}</p></div>
        <div class="row"><a class="btn" href="#/exams?new=0">${icon('plus')} New exam</a><a class="btn btn-primary" href="#/classrooms">${icon('school')} Classrooms</a></div></div>
      <div class="kpis">
        ${kpi('Classrooms', k.classrooms, 'school')}${kpi('Students', k.students, 'users')}${kpi('Upcoming exams', k.upcoming, 'clock')}
        ${kpi('Active exams', k.active, 'radio', k.active ? 'hot' : '')}${kpi('Completed exams', k.completed, 'check')}
        ${kpi('Average performance', k.avg == null ? '—' : num(k.avg), 'target', '', k.avg == null ? '' : '%')}${kpi('Live students', k.liveStudents, 'user', k.liveStudents ? 'hot' : '')}
      </div>
      ${d.liveExams.length ? html`<div class="card card-pad" style="margin-bottom:16px;border-color:var(--hi-2)"><div class="row between wrap"><div class="row"><span class="pulse"></span><h2>Exams running now</h2></div></div>
        <div class="auto-grid" style="margin-top:12px">${d.liveExams.map((e) => html`<a class="card card-pad" href="#/live/${e.id}" style="text-decoration:none;color:inherit"><div class="row between"><b>${e.name}</b>${badge(e.status)}</div><div class="muted small" style="margin:4px 0 10px">${e.classroom} · closes ${fmtTime(e.end_at)}</div><span class="btn btn-sm btn-hi">${icon('radio')} Open live monitor</span></a>`)}</div></div>` : ''}
      <div class="grid g2" style="margin-bottom:16px">
        <div class="card"><div class="card-head"><h2>Average score by exam</h2></div><div class="card-body">${columns(d.recent.map((e) => ({ label: e.name.replace(/^(Physics|Mathematics|English|Computer Science)[:\s–-]*/i, '').slice(0, 22), title: e.name, value: e.avg })), { empty: 'Scores appear once students submit.' })}</div></div>
        <div class="card"><div class="card-head"><h2>Participation by exam</h2><span class="muted small">Students who took part</span></div><div class="card-body">${columns(d.recent.map((e) => ({ label: e.name.replace(/^(Physics|Mathematics|English|Computer Science)[:\s–-]*/i, '').slice(0, 22), title: `${e.name}: ${e.taken}/${e.enrolled}`, value: e.enrolled ? Math.round((e.taken / e.enrolled) * 100) : 0 })), { alt: true, empty: 'No exams yet.' })}</div></div>
      </div>
      <div class="grid g2">
        <div class="card"><div class="card-head"><h2>Score distribution</h2><span class="muted small">All finished attempts</span></div><div class="card-body">${columns(['0–20', '20–40', '40–60', '60–80', '80–100'].map((l, i) => ({ label: l + '%', value: d.distribution[i] })), { unit: '', max: Math.max(1, ...d.distribution) })}</div></div>
        <div class="card"><div class="card-head"><h2>Recent activity</h2><a class="small" href="#/logs">View all</a></div><div class="card-body">${d.logs.length ? html`<ul class="feed">${d.logs.map((l) => html`<li><span class="ic">${icon(actionIcon(l.action))}</span><div class="grow"><div>${describe(l)}</div><div class="small muted">${rel(l.created_at)}</div></div></li>`)}</ul>` : empty('No activity yet', 'Actions you take will show up here.', 'log')}</div></div>
      </div>`);
  }
  await load();
  const t = setInterval(load, 20000); ctx.onLeave(() => clearInterval(t));
  ctx.onLeave(bus.on('ws:monitor', debounce(load, 1500)));
}

/* ============================== classrooms ============================== */
async function teacherOptions() { const t = await api('GET', '/teachers'); return t.items; }
function classroomForm(c = {}, teachers = []) {
  return html`<div class="form-grid">
    <div class="field full"><label>Classroom name</label><input class="input" name="name" required maxlength="100" value="${c.name || ''}" placeholder="e.g. Grade 10-A Mathematics" autofocus></div>
    <div class="field"><label>Class / Section</label><input class="input" name="section" maxlength="30" value="${c.section || ''}" placeholder="10-A"></div>
    <div class="field"><label>Subject</label><input class="input" name="subject" required maxlength="100" value="${c.subject || ''}" placeholder="Mathematics"></div>
    ${isAdmin() ? field('Teacher', sel('teacher_id', [['', 'Unassigned'], ...teachers.map((t) => [t.id, t.name])], c.teacher_id)) : ''}
    <div class="field"><label>Academic year</label><input class="input" name="academic_year" maxlength="20" value="${c.academic_year || '2026-27'}"></div>
    <div class="field full"><label>Description</label><textarea class="input" name="description" maxlength="1000">${c.description || ''}</textarea></div></div>`;
}
const classroomPayload = (d) => ({ ...d, teacher_id: d.teacher_id ? +d.teacher_id : null });

export async function classrooms(ctx) {
  if (ctx.id) return classroomDetail(ctx);
  const el = ctx.el; let q = { q: '', page: 1 };
  put(el, html`<div class="page-head"><div><h1>Classrooms</h1><p>Groups of students, their teacher and their exams.</p></div><button class="btn btn-primary" data-act="new">${icon('plus')} New classroom</button></div>
    <div class="toolbar"><div class="searchbox">${icon('search')}<input class="input" data-input="search" placeholder="Search classrooms" aria-label="Search classrooms"></div></div><div id="list">${skeleton(3)}</div>`);
  async function load() {
    const box = $('#list', el);
    try {
      const r = await api('GET', '/classrooms' + qs({ q: q.q, page: q.page, size: 12 }));
      put(box, r.items.length ? html`<div class="auto-grid">${r.items.map((c) => html`<a class="card card-pad stack-sm" href="#/classrooms/${c.id}" style="text-decoration:none;color:inherit">
        <div class="row between"><span class="tag">${c.section || 'Class'}</span>${c.live_exams ? badge('live') : ''}</div><h2>${c.name}</h2>
        <div class="muted small">${c.subject} · ${c.teacher_name || 'No teacher assigned'}</div>
        <div class="row" style="gap:18px;margin-top:6px"><div><b class="mono" style="font-size:1.3rem">${c.students}</b><div class="small muted">students</div></div><div><b class="mono" style="font-size:1.3rem">${c.exams}</b><div class="small muted">exams</div></div><div class="grow"></div><span class="muted small">${c.academic_year || ''}</span></div></a>`)}</div>${r.total > r.size ? pager(r) : ''}`
        : empty('No classrooms found', q.q ? 'Try a different search.' : 'Create your first classroom to start adding students and exams.', 'school', html`<button class="btn btn-primary" data-act="new">${icon('plus')} New classroom</button>`));
    } catch (e) { put(box, errorBox(e)); }
  }
  bind(el, {
    search: debounce((t) => { q = { q: t.value, page: 1 }; load(); }, 300), page: (t) => { q.page = +t.dataset.p; load(); }, retry: load,
    new: async () => {
      const teachers = isAdmin() ? await teacherOptions() : [];
      formModal({ title: 'New classroom', fields: classroomForm({}, teachers), submit: 'Create classroom', size: 'wide',
        onSubmit: async (d, m) => { const r = await api('POST', '/classrooms', classroomPayload(d)); m.close(); toast('Classroom created', d.name, 'ok'); ctx.go(`#/classrooms/${r.id}`); } });
    },
  });
  await load();
}

async function classroomDetail(ctx) {
  const el = ctx.el; const id = +ctx.id;
  async function load() {
    let d; try { d = await api('GET', `/classrooms/${id}`); } catch (e) { put(el, errorBox(e)); return; }
    const c = d.classroom;
    put(el, html`<div class="page-head"><div><a class="small muted" href="#/classrooms">← All classrooms</a><h1 style="margin-top:6px">${c.name}</h1><p>${c.subject} · ${c.section || 'No section'} · ${c.academic_year || ''} · Teacher: ${c.teacher_name || 'Unassigned'}</p></div>
      <div class="row wrap"><button class="btn" data-act="edit">${icon('edit')} Edit</button>${isAdmin() ? html`<button class="btn btn-outline-danger" data-act="del">${icon('trash')} Delete</button>` : ''}<a class="btn btn-primary" href="#/exams?new=${id}">${icon('plus')} New exam</a></div></div>
      ${c.description ? html`<p class="muted" style="margin:-8px 0 18px;max-width:70ch">${c.description}</p>` : ''}
      <div class="kpis">${kpi('Students', d.stats.students, 'users')}${kpi('Exams', d.stats.exams, 'file')}${kpi('Average score', d.stats.avg == null ? '—' : num(d.stats.avg), 'target', '', d.stats.avg == null ? '' : '%')}${kpi('Pass rate', d.stats.pass == null ? '—' : d.stats.pass, 'check', '', d.stats.pass == null ? '' : '%')}</div>
      <div class="grid" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);align-items:start" id="cgrid">
        <div class="card"><div class="card-head"><h2>Students</h2><div class="row"><button class="btn btn-sm" data-act="enroll">${icon('users')} Enroll existing</button><button class="btn btn-sm btn-primary" data-act="addstu">${icon('plus')} New student</button></div></div>
          <div class="table-wrap">${d.students.length ? html`<table class="tbl"><thead><tr><th>Roll No.</th><th>Student</th><th>Avg</th><th></th></tr></thead><tbody>${d.students.map((s) => html`<tr><td class="mono">${s.roll_no}</td><td><a class="name" href="#/students/${s.id}">${s.name}</a><div class="sub">${s.email}</div></td><td>${pct(s.avg)}</td><td class="actions"><button class="btn btn-ghost btn-sm" data-act="unenroll" data-id="${s.id}" data-n="${s.name}" aria-label="Remove ${s.name}">${icon('x')}</button></td></tr>`)}</tbody></table>` : empty('No students yet', 'Add or enroll students to this classroom.', 'users')}</div></div>
        <div class="card"><div class="card-head"><h2>Exams</h2></div><div class="card-body">${d.exams.length ? html`<div class="stack-sm">${d.exams.map((e) => html`<a class="row between card card-pad" style="text-decoration:none;color:inherit;padding:12px 14px" href="#/${['live', 'paused'].includes(e.status) ? 'live' : 'exams'}/${e.id}"><div class="grow"><b class="truncate" style="display:block">${e.name}</b><span class="small muted">${e.start_at ? fmtDT(e.start_at) : 'Not scheduled'} · ${e.duration_min} min</span></div>${badge(e.status)}</a>`)}</div>` : empty('No exams', 'Create an exam for this classroom.', 'file')}</div></div>
      </div>`);
    if (matchMedia('(max-width:900px)').matches) $('#cgrid', el).style.gridTemplateColumns = '1fr';
    bind(el, {
      retry: load,
      edit: async () => { const teachers = isAdmin() ? await teacherOptions() : []; formModal({ title: 'Edit classroom', size: 'wide', fields: classroomForm(c, teachers), onSubmit: async (f, m) => { await api('PUT', `/classrooms/${id}`, classroomPayload(f)); m.close(); toast('Classroom updated', '', 'ok'); load(); } }); },
      del: async () => { if (await confirmDialog({ title: `Delete ${c.name}?`, message: 'This removes the classroom, its enrollment and any draft exams. Classrooms with exam attempts on record cannot be deleted.', confirmText: 'Delete classroom', danger: true })) { try { await api('DELETE', `/classrooms/${id}`); toast('Classroom deleted', c.name, 'ok'); ctx.go('#/classrooms'); } catch (e) { fail(e); } } },
      unenroll: async (t) => { if (await confirmDialog({ title: 'Remove from classroom?', message: `${t.dataset.n} will lose access to this classroom's exams. Their past attempts are kept.`, confirmText: 'Remove', danger: true })) { try { await api('DELETE', `/classrooms/${id}/students/${t.dataset.id}`); load(); } catch (e) { fail(e); } } },
      addstu: () => studentFormModal({ classroomIds: [id], lockClass: true, onDone: load }),
      enroll: async () => {
        const all = await api('GET', '/students' + qs({ size: 100 })); const inC = new Set(d.students.map((s) => s.id)); const cand = all.items.filter((s) => !inC.has(s.id));
        if (!cand.length) return toast('Nobody to enroll', isAdmin() ? 'Every student is already in this classroom.' : 'You can only enroll students from your own classrooms. Use “New student” instead.');
        formModal({ title: 'Enroll existing students', size: 'wide', submit: 'Enroll selected', fields: html`<div class="searchbox" style="margin-bottom:10px">${icon('search')}<input class="input" id="enr-q" placeholder="Filter by name or roll no."></div><div class="stack-sm" id="enr-list" style="max-height:340px;overflow:auto">${cand.map((s) => html`<label class="check card card-pad" style="padding:10px 12px" data-t="${(s.name + s.roll_no).toLowerCase()}"><input type="checkbox" name="s${s.id}"><span><b>${s.name}</b> <span class="muted small">${s.roll_no} · ${s.classrooms || 'No classroom'}</span></span></label>`)}</div>`,
          onMount: (m) => { $('#enr-q', m.el).oninput = (e) => $$('#enr-list label', m.el).forEach((l) => (l.hidden = !l.dataset.t.includes(e.target.value.toLowerCase()))); },
          onSubmit: async (f, m) => { const ids = Object.keys(f).filter((k) => f[k] && k.startsWith('s')).map((k) => +k.slice(1)); if (!ids.length) throw new Error('Select at least one student.'); const r = await api('POST', `/classrooms/${id}/students`, { studentIds: ids }); m.close(); toast('Students enrolled', `${r.added} added`, 'ok'); load(); } });
      },
    });
  }
  await load();
}

/* ============================== students ============================== */
export async function studentFormModal({ student, classroomIds = [], lockClass = false, onDone }) {
  const cls = await api('GET', '/classrooms' + qs({ size: 100 }));
  const editing = !!student;
  if (!classroomIds.length && !isAdmin() && cls.items.length === 1) classroomIds = [cls.items[0].id];
  formModal({ title: editing ? 'Edit student' : 'Add student', size: 'wide', submit: editing ? 'Save changes' : 'Add student', fields: html`<div class="form-grid">
    <div class="field"><label>Full name</label><input class="input" name="name" required maxlength="100" value="${student?.name || ''}" autofocus></div>
    <div class="field"><label>Student ID / Roll No.</label><input class="input" name="roll_no" required maxlength="30" value="${student?.roll_no || ''}" placeholder="10A-13"></div>
    <div class="field"><label>Email</label><input class="input" type="email" name="email" required value="${student?.email || ''}"></div>
    <div class="field"><label>Class / Section</label><input class="input" name="section" maxlength="30" value="${student?.section || ''}"></div>
    ${editing ? '' : html`<div class="field full"><label>Classrooms</label><div class="row wrap">${cls.items.map((c) => html`<label class="chip" style="cursor:pointer"><input type="checkbox" name="c${c.id}" ${classroomIds.includes(c.id) ? raw('checked') : ''} ${lockClass && classroomIds.includes(c.id) ? raw('style="pointer-events:none"') : ''}> ${c.name}</label>`)}</div>${editing ? '' : html`<span class="hint">The student signs in with their email. A default password of Student@123 is set, and they can change it in Profile.</span>`}</div>`}</div>`,
    onSubmit: async (f, m) => {
      const body = { name: f.name, roll_no: f.roll_no, email: f.email, section: f.section };
      if (editing) await api('PUT', `/students/${student.id}`, body);
      else { body.classroomIds = Object.keys(f).filter((k) => f[k] && /^c\d+$/.test(k)).map((k) => +k.slice(1)); const r = await api('POST', '/students', body); toast('Student added', `${f.name} · default password ${r.defaultPassword}`, 'ok'); }
      m.close(); if (editing) toast('Student updated', '', 'ok'); onDone?.();
    } });
}

export async function students(ctx) {
  if (ctx.id) return studentProfile(ctx);
  const el = ctx.el; const q = { q: '', classroomId: '', section: '', sort: 'roll_no', dir: 'asc', page: 1 };
  const cls = await api('GET', '/classrooms' + qs({ size: 100 }));
  put(el, html`<div class="page-head"><div><h1>Students</h1><p>Search, import and manage student records.</p></div>
    <div class="row wrap"><button class="btn" data-act="import">${icon('upload')} Import</button><div class="relative"><button class="btn" data-act="export">${icon('download')} Export</button></div><button class="btn btn-primary" data-act="new">${icon('plus')} Add student</button></div></div>
    <div class="toolbar"><div class="searchbox">${icon('search')}<input class="input" data-input="search" placeholder="Search name, email or roll no." aria-label="Search students"></div>
      <select class="input" data-change="fclass" aria-label="Filter by classroom"><option value="">All classrooms</option>${cls.items.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></div>
    <div class="card"><div id="tbl">${skeleton(6)}</div></div>`);
  const th = (k, l) => html`<th aria-sort="${q.sort === k ? (q.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button data-act="sort" data-k="${k}">${l} ${q.sort === k ? icon(q.dir === 'asc' ? 'up' : 'down') : ''}</button></th>`;
  async function load() {
    const box = $('#tbl', el);
    try {
      const r = await api('GET', '/students' + qs({ ...q, size: 15 }));
      put(box, r.items.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr>${th('roll_no', 'Roll No.')}${th('name', 'Student')}${th('section', 'Section')}<th>Classrooms</th><th>Avg score</th><th></th></tr></thead><tbody>
        ${r.items.map((s) => html`<tr><td class="mono">${s.roll_no}</td><td><a class="name" href="#/students/${s.id}">${s.name}</a><div class="sub">${s.email}</div></td><td>${s.section || '—'}</td><td class="small">${s.classrooms || '—'}</td><td>${pct(s.avg)}</td>
          <td class="actions"><a class="btn btn-ghost btn-sm" href="#/students/${s.id}" aria-label="View ${s.name}">${icon('eye')}</a><button class="btn btn-ghost btn-sm" data-act="edit" data-id="${s.id}" aria-label="Edit ${s.name}">${icon('edit')}</button><button class="btn btn-ghost btn-sm" data-act="del" data-id="${s.id}" data-n="${s.name}" aria-label="Delete ${s.name}">${icon('trash')}</button></td></tr>`)}</tbody></table></div>${pager(r)}`
        : empty('No students match', 'Adjust your search or add a student.', 'users', html`<button class="btn btn-primary" data-act="new">${icon('plus')} Add student</button>`));
      el._rows = r.items;
    } catch (e) { put(box, errorBox(e)); }
  }
  bind(el, {
    search: debounce((t) => { q.q = t.value; q.page = 1; load(); }, 300), fclass: (t) => { q.classroomId = t.value; q.page = 1; load(); }, page: (t) => { q.page = +t.dataset.p; load(); }, retry: load,
    sort: (t) => { q.dir = q.sort === t.dataset.k && q.dir === 'asc' ? 'desc' : 'asc'; q.sort = t.dataset.k; load(); },
    new: () => studentFormModal({ classroomIds: q.classroomId ? [+q.classroomId] : [], onDone: load }),
    edit: (t) => studentFormModal({ student: el._rows.find((s) => s.id === +t.dataset.id), onDone: load }),
    del: async (t) => { if (await confirmDialog({ title: `Delete ${t.dataset.n}?`, message: 'This removes the student account. Students who already have exam attempts cannot be deleted, because their history is preserved.', confirmText: 'Delete student', danger: true })) { try { await api('DELETE', `/students/${t.dataset.id}`); toast('Student deleted', t.dataset.n, 'ok'); load(); } catch (e) { fail(e); } } },
    export: (t) => popMenu(t, [{ label: 'Download CSV', icon: 'download', run: () => download('/api/students/export' + qs({ ...q, format: 'csv' })) }, { label: 'Download Excel (.xlsx)', icon: 'download', run: () => download('/api/students/export' + qs({ ...q, format: 'xlsx' })) }]),
    import: () => importModal(cls.items, load),
  });
  await load();
}

function importModal(classes, done) {
  const tpl = 'Roll No,Name,Email,Section\n10A-13,Sample Student,sample.student@student.school.edu,10-A\n';
  const m = formModal({ title: 'Import students', sub: 'CSV or Excel with columns: Roll No, Name, Email, Section.', size: 'wide', submit: 'Import', fields: html`<div class="stack">
    ${field('File', html`<input class="input" type="file" name="file" accept=".csv,.xlsx" required>`)}
    ${field('Enroll into classroom', sel('classroomId', [['', state.user.role === 'admin' ? 'No classroom (or use a “Classroom” column)' : 'Choose a classroom'], ...classes.map((c) => [c.id, c.name])], ''), 'Existing students matching by email or roll no. are enrolled, not duplicated.')}
    <a href="data:text/csv;charset=utf-8,${encodeURIComponent(tpl)}" download="students-template.csv" class="small">${icon('download')} Download a template</a><div id="imp-res"></div></div>`,
    onSubmit: async (f, mm, form) => {
      const file = form.elements.file.files[0]; if (!file) throw new Error('Choose a file first.');
      const fd = new FormData(); fd.append('file', file); if (f.classroomId) fd.append('classroomId', f.classroomId);
      const res = await fetch('/api/students/import', { method: 'POST', headers: { 'X-CSRF-Token': state.csrf }, body: fd, credentials: 'same-origin' }); const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed.');
      put($('#imp-res', mm.el), html`<div class="notice ${data.errors.length ? 'warn' : 'ok'}">${icon('info')}<div><b>${data.created} created, ${data.enrolled} enrolled.</b>${data.errors.length ? html`<div class="small">${data.errors.slice(0, 8).map((e) => html`<div>Row ${e.row}: ${e.message}</div>`)}${data.errors.length > 8 ? `…and ${data.errors.length - 8} more` : ''}</div>` : ''}</div></div>`);
      done(); const b = mm.el.querySelector('[type=submit]'); b.disabled = false; b.textContent = 'Import again';
    } });
  return m;
}

async function studentProfile(ctx) {
  const el = ctx.el; const id = +ctx.id;
  async function load() {
    let d; try { d = await api('GET', `/students/${id}`); } catch (e) { put(el, errorBox(e)); return; }
    const s = d.student;
    put(el, html`<div class="page-head"><div class="row" style="gap:16px"><span class="avatar" style="width:56px;height:56px;font-size:1.2rem">${initials(s.name)}</span><div><a class="small muted" href="#/students">← All students</a><h1>${s.name}</h1><p>${s.roll_no} · ${s.email} · Section ${s.section || '—'}</p></div></div>
      <div class="row"><button class="btn" data-act="edit">${icon('edit')} Edit</button><button class="btn btn-outline-danger" data-act="del">${icon('trash')} Delete</button></div></div>
      <div class="row wrap" style="margin-bottom:16px">${d.classrooms.map((c) => html`<a class="chip" href="#/classrooms/${c.id}">${icon('school')} ${c.name}</a>`)}${d.classrooms.length ? '' : html`<span class="muted">Not enrolled in any classroom</span>`}</div>
      <div class="kpis">${kpi('Exams', d.stats.exams, 'file')}${kpi('Completed attempts', d.stats.taken, 'check')}${kpi('Average score', d.stats.avg == null ? '—' : num(d.stats.avg), 'target', '', d.stats.avg == null ? '' : '%')}${kpi('Passed', d.stats.passed, 'shield')}</div>
      <div class="card"><div class="card-head"><h2>Exam history</h2></div><div class="table-wrap">${d.history.length ? html`<table class="tbl"><thead><tr><th>Exam</th><th>Attempt</th><th>Status</th><th>Score</th><th>Date</th><th>Note</th></tr></thead><tbody>${d.history.map((h) => html`<tr><td><a class="name" href="#/attempt/${h.id}">${h.exam_name}</a></td><td>#${h.attempt_no}</td><td>${badge(h.status)}</td><td>${h.status === 'restarted' || h.status === 'in_progress' ? '—' : html`<b>${num(h.score)}</b>/${num(h.total_marks)} <span class="muted small">(${pct(h.percentage)})</span> ${h.passed ? badge('pass', 'Pass') : badge('fail', 'Fail')}`}</td><td class="small">${fmtDT(h.ended_at || h.started_at)}</td><td class="small muted">${h.restart_reason || ''}</td></tr>`)}</tbody></table>` : empty('No exam history yet', 'Attempts appear here once this student takes an exam.', 'history')}</div></div>`);
    bind(el, { retry: load, edit: () => studentFormModal({ student: { ...s }, onDone: load }),
      del: async () => { if (await confirmDialog({ title: `Delete ${s.name}?`, message: 'Students with exam attempts on record cannot be deleted.', confirmText: 'Delete', danger: true })) { try { await api('DELETE', `/students/${id}`); toast('Student deleted', '', 'ok'); ctx.go('#/students'); } catch (e) { fail(e); } } } });
  }
  await load();
}
