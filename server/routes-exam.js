'use strict';
const express = require('express');
const db = require('./db');
const { now, J, S, HttpError, bad, forbidden, notFound, conflict, v, audit, hub, notify, classroomStudentUserIds } = require('./lib');
const { staff, canAccessClassroom, loadExamFor, loadAttemptFor } = require('./auth');
const core = require('./core');
const { w, paging, like, scopeIds, inList } = require('./routes-manage');

const r = express.Router();
const isLive = (e) => e.status === 'live' || e.status === 'paused';
const hasAttempts = (examId) => db.prepare(`SELECT COUNT(*) c FROM attempts WHERE exam_id=? AND status<>'not_started'`).get(examId).c > 0;
const inProgressCount = (examId) => db.prepare(`SELECT COUNT(*) c FROM attempts WHERE exam_id=? AND status='in_progress'`).get(examId).c;

function liveGuard(exam, req) {
  if (!isLive(exam)) return;
  if (req.body?.ack === true) return;
  throw new HttpError(409, 'This exam is live. Changes apply immediately to students who are taking it.', { code: 'LIVE_EDIT_WARNING', inProgress: inProgressCount(exam.id), status: exam.status });
}
function logChange(exam, user, entity, entityId, action, changes) {
  const ins = db.prepare(`INSERT INTO exam_changes(exam_id,user_id,user_name,entity,entity_id,action,field,old_value,new_value,exam_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const t = now();
  const val = (x) => (x === undefined || x === null ? null : typeof x === 'string' ? x : JSON.stringify(x));
  db.transaction(() => (changes.length ? changes : [{ field: null, old: null, new: null }]).forEach((c) => ins.run(exam.id, user.id, user.name, entity, entityId, action, c.field, val(c.old), val(c.new), exam.version, t)))();
}
// After any edit to a live exam: bump version, tell students + monitor, re-evaluate finished attempts if scoring changed
function afterEdit(exam, user, { scoring = false, summary = 'Exam updated', ip, silent = false } = {}) {
  core.recalcExamTotal(exam.id);
  let regraded = 0;
  if (isLive(exam)) {
    db.prepare('UPDATE exams SET version=version+1, updated_at=? WHERE id=?').run(now(), exam.id);
    exam.version += 1;
    if (scoring) regraded = core.regradeExam(exam.id);
    if (!silent) {
      notify(classroomStudentUserIds(exam.classroom_id), { title: 'Exam updated', body: `${exam.name} was updated by your teacher. Your answers are safe.`, type: 'exam_changed', link: '#/active' });
      hub.sendTo((u) => u.role === 'student', { type: 'exam', examId: exam.id, event: 'changed', version: exam.version });
    }
  } else db.prepare('UPDATE exams SET updated_at=? WHERE id=?').run(now(), exam.id);
  hub.monitor(exam.id);
  return regraded;
}

/* ================= list / create ================= */
r.get('/exams', staff, w((req, res) => {
  const { size, page, offset } = paging(req, 12);
  const ids = scopeIds(req.user);
  const wh = ['1=1'], p = [];
  if (ids) wh.push(`e.classroom_id IN (${inList(ids)})`);
  if (req.query.status) { const s = String(req.query.status).split(','); wh.push(`e.status IN (${s.map(() => '?').join(',')})`); p.push(...s); }
  if (req.query.classroomId) { wh.push('e.classroom_id=?'); p.push(+req.query.classroomId); }
  if (req.query.q) { wh.push(`(e.name LIKE ? ESCAPE '\\' OR e.subject LIKE ? ESCAPE '\\')`); p.push(like(req.query.q), like(req.query.q)); }
  const total = db.prepare(`SELECT COUNT(*) c FROM exams e WHERE ${wh.join(' AND ')}`).get(...p).c;
  const items = db.prepare(`SELECT e.*, c.name classroom_name,
    (SELECT COUNT(*) FROM exam_questions q WHERE q.exam_id=e.id AND q.removed=0) question_count,
    (SELECT COUNT(*) FROM classroom_students cs WHERE cs.classroom_id=e.classroom_id) enrolled,
    (SELECT COUNT(*) FROM attempts a WHERE a.exam_id=e.id AND a.status='in_progress') in_progress,
    (SELECT COUNT(DISTINCT student_id) FROM attempts a WHERE a.exam_id=e.id AND a.status IN ('submitted','time_expired','force_submitted')) submitted
    FROM exams e JOIN classrooms c ON c.id=e.classroom_id WHERE ${wh.join(' AND ')}
    ORDER BY CASE e.status WHEN 'live' THEN 0 WHEN 'paused' THEN 1 WHEN 'scheduled' THEN 2 WHEN 'draft' THEN 3 WHEN 'completed' THEN 4 ELSE 5 END, COALESCE(e.start_at, e.created_at) DESC LIMIT ? OFFSET ?`).all(...p, size, offset);
  res.json({ items, total, page, size });
}));

function examInput(b, exam) {
  const o = {
    name: v.str(b, 'name', { req: true, max: 150, label: 'Exam name' }), description: v.str(b, 'description', { max: 1000 }), instructions: v.str(b, 'instructions', { max: 3000 }),
    subject: v.str(b, 'subject', { max: 100 }), classroom_id: v.int(b, 'classroom_id', { req: true, min: 1, label: 'Classroom' }),
    start_at: v.num(b, 'start_at', { label: 'Start time' }), end_at: v.num(b, 'end_at', { label: 'End time' }),
    duration_min: v.int(b, 'duration_min', { req: true, min: 1, max: 600, label: 'Duration' }),
    passing_marks: v.num(b, 'passing_marks', { min: 0, def: 0, label: 'Passing marks' }), max_attempts: v.int(b, 'max_attempts', { min: 1, max: 10, def: 1, label: 'Maximum attempts' }),
    negative_marking: v.bool(b, 'negative_marking'), shuffle_questions: v.bool(b, 'shuffle_questions'), shuffle_options: v.bool(b, 'shuffle_options'),
    release_mode: v.oneOf(b, 'release_mode', ['manual', 'on_completion'], { def: 'manual', label: 'Result release' }), show_answers: v.bool(b, 'show_answers', 1),
  };
  if (o.start_at && o.end_at && o.end_at <= o.start_at) throw bad('End time must be after the start time.', { field: 'end_at' });
  if (o.start_at && o.end_at && (o.end_at - o.start_at) < o.duration_min * 60000 && !exam) throw bad('The exam window is shorter than the duration. Extend the end time.', { field: 'end_at' });
  return o;
}

r.post('/exams', staff, w((req, res) => {
  const o = examInput(req.body);
  if (!canAccessClassroom(req.user, o.classroom_id)) throw forbidden('Choose one of your classrooms.');
  const cls = db.prepare('SELECT subject FROM classrooms WHERE id=?').get(o.classroom_id);
  if (!cls) throw bad('Classroom not found.', { field: 'classroom_id' });
  const id = db.transaction(() => {
    const info = db.prepare(`INSERT INTO exams(name,description,instructions,classroom_id,subject,start_at,end_at,duration_min,passing_marks,max_attempts,negative_marking,shuffle_questions,shuffle_options,release_mode,show_answers,status,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`).run(o.name, o.description, o.instructions, o.classroom_id, o.subject || cls.subject, o.start_at, o.end_at, o.duration_min, o.passing_marks, o.max_attempts,
      o.negative_marking, o.shuffle_questions, o.shuffle_options, o.release_mode, o.show_answers, req.user.id, now(), now());
    const eid = info.lastInsertRowid;
    const ids = (Array.isArray(req.body.questionIds) ? req.body.questionIds : []).map(Number).filter(Boolean);
    addBankQuestions(eid, ids);
    core.recalcExamTotal(eid);
    return eid;
  })();
  audit(req.user, 'exam.create', 'exam', id, o.name, null, o, req.ip);
  res.status(201).json({ id });
}));

function addBankQuestions(examId, ids) {
  let pos = db.prepare('SELECT COALESCE(MAX(position),0) m FROM exam_questions WHERE exam_id=?').get(examId).m;
  const added = [];
  for (const qid of ids) {
    const q = db.prepare('SELECT * FROM questions WHERE id=? AND deleted=0').get(qid);
    if (!q) continue;
    const info = db.prepare(`INSERT INTO exam_questions(exam_id,source_question_id,position,type,text,options,correct,marks,negative_marks,difficulty,topic,explanation,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(examId, q.id, ++pos, q.type, q.text, q.options, q.correct, q.marks, q.negative_marks, q.difficulty, q.topic, q.explanation, now());
    added.push({ id: info.lastInsertRowid, text: q.text });
  }
  return added;
}

/* ================= detail / meta edit ================= */
r.get('/exams/:id', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  const cls = db.prepare(`SELECT c.id,c.name,c.subject, (SELECT COUNT(*) FROM classroom_students WHERE classroom_id=c.id) students FROM classrooms c WHERE c.id=?`).get(exam.classroom_id);
  const questions = core.activeQuestions(exam.id);
  res.json({ exam, classroom: cls, questions, hasAttempts: hasAttempts(exam.id), inProgress: inProgressCount(exam.id),
    counts: db.prepare(`SELECT status, COUNT(*) c FROM attempts WHERE exam_id=? GROUP BY status`).all(exam.id) });
}));

r.put('/exams/:id', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  const o = examInput(req.body, exam);
  const finished = ['completed', 'archived'].includes(exam.status);
  if (finished) {
    const allowed = { release_mode: o.release_mode, show_answers: o.show_answers, name: o.name, description: o.description, passing_marks: o.passing_marks };
    Object.keys(o).forEach((k) => { if (!(k in allowed)) o[k] = exam[k]; else o[k] = allowed[k]; });
  }
  if (o.classroom_id !== exam.classroom_id) {
    if (hasAttempts(exam.id) || isLive(exam)) throw conflict('The classroom cannot change once students have started this exam.');
    if (!canAccessClassroom(req.user, o.classroom_id)) throw forbidden('Choose one of your classrooms.');
  }
  liveGuard(exam, req);
  if (isLive(exam)) { o.start_at = exam.start_at; o.classroom_id = exam.classroom_id; }
  const diffs = [];
  for (const k of ['name', 'description', 'instructions', 'subject', 'classroom_id', 'start_at', 'end_at', 'duration_min', 'passing_marks', 'max_attempts', 'negative_marking', 'shuffle_questions', 'shuffle_options', 'release_mode', 'show_answers'])
    if (String(exam[k] ?? '') !== String(o[k] ?? '')) diffs.push({ field: k, old: exam[k], new: o[k] });
  if (!diffs.length) return res.json({ ok: true, changed: 0 });
  db.transaction(() => {
    db.prepare(`UPDATE exams SET name=?,description=?,instructions=?,subject=?,classroom_id=?,start_at=?,end_at=?,duration_min=?,passing_marks=?,max_attempts=?,negative_marking=?,shuffle_questions=?,shuffle_options=?,release_mode=?,show_answers=?,updated_at=? WHERE id=?`)
      .run(o.name, o.description, o.instructions, o.subject, o.classroom_id, o.start_at, o.end_at, o.duration_min, o.passing_marks, o.max_attempts, o.negative_marking, o.shuffle_questions, o.shuffle_options, o.release_mode, o.show_answers, now(), exam.id);
    const dur = diffs.find((d) => d.field === 'duration_min');
    if (dur && isLive(exam)) {
      const delta = (o.duration_min - exam.duration_min) * 60000;
      db.prepare(`UPDATE attempts SET deadline_at=deadline_at+? WHERE exam_id=? AND status='in_progress'`).run(delta, exam.id);
    }
    logChange(exam, req.user, 'exam', exam.id, 'update', diffs);
  })();
  const fresh = db.prepare('SELECT * FROM exams WHERE id=?').get(exam.id);
  const scoring = diffs.some((d) => ['negative_marking', 'passing_marks'].includes(d.field));
  afterEdit(fresh, req.user, { scoring });
  audit(req.user, isLive(exam) ? 'exam.live_edit' : 'exam.update', 'exam', exam.id, exam.name, Object.fromEntries(diffs.map((d) => [d.field, d.old])), Object.fromEntries(diffs.map((d) => [d.field, d.new])), req.ip);
  hub.sendTo((u) => u.role === 'student', { type: 'exam', examId: exam.id, event: 'changed' });
  res.json({ ok: true, changed: diffs.length });
}));

r.delete('/exams/:id', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  if (exam.status !== 'draft' || hasAttempts(exam.id)) throw conflict('Only draft exams without attempts can be deleted. Archive completed exams instead.');
  db.prepare('DELETE FROM exams WHERE id=?').run(exam.id);
  audit(req.user, 'exam.delete', 'exam', exam.id, exam.name, exam, null, req.ip);
  res.json({ ok: true });
}));

r.get('/exams/:id/changes', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  res.json({ items: db.prepare('SELECT * FROM exam_changes WHERE exam_id=? ORDER BY id DESC LIMIT 200').all(exam.id) });
}));

/* ================= exam questions (live-editable) ================= */
r.post('/exams/:id/questions', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  if (['completed', 'archived'].includes(exam.status)) throw conflict('Completed exams cannot be changed.');
  liveGuard(exam, req);
  let added = [];
  db.transaction(() => {
    if (Array.isArray(req.body.questionIds) && req.body.questionIds.length) added = addBankQuestions(exam.id, req.body.questionIds.map(Number).filter(Boolean));
    if (req.body.question) {
      const q = core.normalizeQuestion(req.body.question); const [o, c] = core.enc(q);
      let qid = null;
      if (req.body.saveToBank) {
        qid = db.prepare(`INSERT INTO questions(subject,topic,type,text,options,correct,marks,negative_marks,difficulty,explanation,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(q.subject || exam.subject, q.topic, q.type, q.text, o, c, q.marks, q.negative_marks, q.difficulty, q.explanation, req.user.id, now(), now()).lastInsertRowid;
      }
      const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 m FROM exam_questions WHERE exam_id=?').get(exam.id).m;
      const id = db.prepare(`INSERT INTO exam_questions(exam_id,source_question_id,position,type,text,options,correct,marks,negative_marks,difficulty,topic,explanation,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(exam.id, qid, pos, q.type, q.text, o, c, q.marks, q.negative_marks, q.difficulty, q.topic, q.explanation, now()).lastInsertRowid;
      added.push({ id, text: q.text });
    }
    if (!added.length) throw bad('Choose at least one question to add.');
    logChange(exam, req.user, 'question', added[0].id, 'add', added.map((a) => ({ field: 'question', old: null, new: a.text.slice(0, 120) })));
  })();
  afterEdit(exam, req.user, { scoring: true });
  audit(req.user, isLive(exam) ? 'exam.live_edit' : 'exam.questions_add', 'exam', exam.id, exam.name, null, { added: added.map((a) => a.text.slice(0, 80)) }, req.ip);
  res.status(201).json({ added: added.length });
}));

r.put('/exams/:id/questions/:qid', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  if (['completed', 'archived'].includes(exam.status)) throw conflict('Completed exams cannot be changed.');
  const old = core.hydrateEq(db.prepare('SELECT * FROM exam_questions WHERE id=? AND exam_id=? AND removed=0').get(+req.params.qid, exam.id));
  if (!old) throw notFound('Question not found in this exam.');
  const q = core.normalizeQuestion({ ...req.body, type: req.body.type || old.type });
  if (q.type !== old.type && hasAttempts(exam.id)) throw conflict('The question type cannot change after students have started the exam, because their answers would no longer fit. Edit the text, options or marks instead, or add a new question.');
  liveGuard(exam, req);
  const fields = ['type', 'text', 'options', 'correct', 'marks', 'negative_marks', 'difficulty', 'topic', 'explanation'];
  const diffs = fields.filter((f) => JSON.stringify(old[f] ?? null) !== JSON.stringify(q[f] ?? null)).map((f) => ({ field: f, old: old[f], new: q[f] }));
  if (!diffs.length) return res.json({ ok: true, changed: 0 });
  const [o, c] = core.enc(q);
  db.transaction(() => {
    db.prepare(`UPDATE exam_questions SET type=?,text=?,options=?,correct=?,marks=?,negative_marks=?,difficulty=?,topic=?,explanation=?,updated_at=? WHERE id=?`)
      .run(q.type, q.text, o, c, q.marks, q.negative_marks, q.difficulty, q.topic, q.explanation, now(), old.id);
    logChange(exam, req.user, 'question', old.id, 'update', diffs);
  })();
  const scoring = diffs.some((d) => ['correct', 'marks', 'negative_marks', 'options', 'type'].includes(d.field));
  const regraded = afterEdit(exam, req.user, { scoring });
  audit(req.user, isLive(exam) ? 'exam.live_edit' : 'exam.question_update', 'exam_question', old.id, old.text.slice(0, 80),
    Object.fromEntries(diffs.map((d) => [d.field, d.old])), Object.fromEntries(diffs.map((d) => [d.field, d.new])), req.ip);
  res.json({ ok: true, changed: diffs.length, regraded });
}));

r.delete('/exams/:id/questions/:qid', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  if (['completed', 'archived'].includes(exam.status)) throw conflict('Completed exams cannot be changed.');
  const old = db.prepare('SELECT * FROM exam_questions WHERE id=? AND exam_id=? AND removed=0').get(+req.params.qid, exam.id);
  if (!old) throw notFound('Question not found in this exam.');
  liveGuard(exam, req);
  const active = db.prepare('SELECT COUNT(*) c FROM exam_questions WHERE exam_id=? AND removed=0').get(exam.id).c;
  if (isLive(exam) && active <= 1) throw conflict('A live exam needs at least one question.');
  db.transaction(() => {
    const answered = db.prepare('SELECT COUNT(*) c FROM answers WHERE exam_question_id=?').get(old.id).c;
    if (hasAttempts(exam.id) || answered) db.prepare('UPDATE exam_questions SET removed=1, updated_at=? WHERE id=?').run(now(), old.id); // keep answers for history
    else db.prepare('DELETE FROM exam_questions WHERE id=?').run(old.id);
    logChange(exam, req.user, 'question', old.id, 'remove', [{ field: 'question', old: old.text.slice(0, 120), new: null }]);
  })();
  afterEdit(exam, req.user, { scoring: true });
  audit(req.user, isLive(exam) ? 'exam.live_edit' : 'exam.question_remove', 'exam_question', old.id, old.text.slice(0, 80), { text: old.text, marks: old.marks }, null, req.ip);
  res.json({ ok: true });
}));

r.post('/exams/:id/questions/reorder', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  if (['completed', 'archived'].includes(exam.status)) throw conflict('Completed exams cannot be changed.');
  const order = (Array.isArray(req.body.order) ? req.body.order : []).map(Number);
  const cur = core.activeQuestions(exam.id).map((q) => q.id);
  if (order.length !== cur.length || !cur.every((id) => order.includes(id))) throw bad('The new order must include every question exactly once.');
  if (order.join() === cur.join()) return res.json({ ok: true });
  liveGuard(exam, req);
  db.transaction(() => {
    order.forEach((id, i) => db.prepare('UPDATE exam_questions SET position=? WHERE id=?').run(i + 1, id));
    logChange(exam, req.user, 'exam', exam.id, 'reorder', [{ field: 'order', old: cur, new: order }]);
  })();
  afterEdit(exam, req.user, { scoring: false });
  audit(req.user, isLive(exam) ? 'exam.live_edit' : 'exam.reorder', 'exam', exam.id, exam.name, { order: cur }, { order }, req.ip);
  res.json({ ok: true });
}));

/* ================= status transitions ================= */
r.post('/exams/:id/status', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  const action = v.oneOf(req.body, 'action', ['schedule', 'unschedule', 'start', 'pause', 'resume', 'end', 'archive', 'unarchive'], { req: true });
  const reason = v.str(req.body, 'reason', { max: 300 });
  const from = exam.status; const t = now();
  const need = (...s) => { if (!s.includes(exam.status)) throw conflict(`You can't ${action} an exam that is ${exam.status}.`); };
  const nq = db.prepare('SELECT COUNT(*) c FROM exam_questions WHERE exam_id=? AND removed=0').get(exam.id).c;
  let to = from;
  if (action === 'schedule') {
    need('draft');
    if (!nq) throw bad('Add at least one question before scheduling.');
    if (!exam.start_at || !exam.end_at) throw bad('Set a start and end time before scheduling.');
    if (exam.end_at <= t) throw bad('The end time is already in the past.');
    if (exam.passing_marks > exam.total_marks) throw bad(`Passing marks (${exam.passing_marks}) exceed total marks (${exam.total_marks}).`);
    to = 'scheduled';
    db.prepare(`UPDATE exams SET status='scheduled', reminder_sent=0, updated_at=? WHERE id=?`).run(t, exam.id);
    notify(classroomStudentUserIds(exam.classroom_id), { title: 'Exam scheduled', body: `${exam.name} is scheduled for ${new Date(exam.start_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`, type: 'exam_scheduled', link: '#/upcoming' });
  } else if (action === 'unschedule') {
    need('scheduled'); to = 'draft'; db.prepare(`UPDATE exams SET status='draft', updated_at=? WHERE id=?`).run(t, exam.id);
  } else if (action === 'start') {
    need('draft', 'scheduled');
    if (!nq) throw bad('Add at least one question before starting.');
    to = 'live';
    const end = Math.max(exam.end_at || 0, t + exam.duration_min * 60000 + 5 * 60000);
    db.prepare(`UPDATE exams SET status='live', start_at=?, end_at=?, updated_at=? WHERE id=?`).run(Math.min(exam.start_at || t, t), end, t, exam.id);
    notify(classroomStudentUserIds(exam.classroom_id), { title: 'Exam started', body: `${exam.name} is now open. You can begin.`, type: 'exam_started', link: '#/active' });
  } else if (action === 'pause') {
    need('live'); to = 'paused';
    db.prepare(`UPDATE exams SET status='paused', paused_at=?, updated_at=? WHERE id=?`).run(t, t, exam.id);
    notify(classroomStudentUserIds(exam.classroom_id), { title: 'Exam paused', body: `${exam.name} was paused. Your timer is stopped and answers are saved.`, type: 'exam_changed', link: '#/active' });
  } else if (action === 'resume') {
    need('paused'); to = 'live';
    db.transaction(() => {
      db.prepare(`UPDATE attempts SET deadline_at=deadline_at+? WHERE exam_id=? AND status='in_progress' AND paused_at IS NULL`).run(t - exam.paused_at, exam.id);
      db.prepare(`UPDATE exams SET status='live', paused_at=NULL, updated_at=? WHERE id=?`).run(t, exam.id);
    })();
    notify(classroomStudentUserIds(exam.classroom_id), { title: 'Exam resumed', body: `${exam.name} has resumed. Your timer is running again.`, type: 'exam_changed', link: '#/active' });
  } else if (action === 'end') {
    need('live', 'paused'); to = 'completed';
    db.prepare('SELECT id FROM attempts WHERE exam_id=? AND status=?').all(exam.id, 'in_progress').forEach((a) => core.finalizeAttempt(a.id, 'force_submitted', { by: req.user, reason: reason || 'Exam ended by staff' }));
    core.completeExam(db.prepare('SELECT * FROM exams WHERE id=?').get(exam.id), req.user, reason || 'Ended by staff');
  } else if (action === 'archive') { need('completed'); to = 'archived'; db.prepare(`UPDATE exams SET status='archived', updated_at=? WHERE id=?`).run(t, exam.id); }
  else if (action === 'unarchive') { need('archived'); to = 'completed'; db.prepare(`UPDATE exams SET status='completed', updated_at=? WHERE id=?`).run(t, exam.id); }
  logChange({ ...exam, version: exam.version }, req.user, 'exam', exam.id, 'status', [{ field: 'status', old: from, new: to }]);
  const auditName = { pause: 'exam.pause', resume: 'exam.resume', end: 'exam.force_end', start: 'exam.start', schedule: 'exam.schedule', unschedule: 'exam.unschedule', archive: 'exam.archive', unarchive: 'exam.unarchive' }[action];
  if (action !== 'end') audit(req.user, auditName, 'exam', exam.id, exam.name, { status: from }, { status: to, reason }, req.ip);
  else audit(req.user, 'exam.force_end', 'exam', exam.id, exam.name, { status: from }, { status: to, reason }, req.ip);
  hub.sendTo((u) => u.role === 'student', { type: 'exam', examId: exam.id, event: action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : action === 'end' ? 'completed' : action });
  hub.monitor(exam.id);
  res.json({ status: to });
}));

/* ================= live monitoring & attempt controls ================= */
r.get('/exams/:id/monitor', staff, w((req, res) => res.json(core.monitorSnapshot(loadExamFor(req.user, +req.params.id)))));

r.get('/exams/:id/restart-preview', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  const enrolled = db.prepare('SELECT COUNT(*) c FROM classroom_students WHERE classroom_id=?').get(exam.classroom_id).c;
  const q = (st) => db.prepare(`SELECT COUNT(DISTINCT student_id) c FROM attempts WHERE exam_id=? AND status IN (${st})`).get(exam.id).c;
  res.json({ enrolled, inProgress: q(`'in_progress'`), completed: q(`'submitted','time_expired','force_submitted'`) });
}));

r.post('/exams/:id/restart-all', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  if (req.body.confirm !== 'RESTART ALL') throw bad('Type RESTART ALL exactly to confirm.', { field: 'confirm' });
  const reason = v.str(req.body, 'reason', { req: true, min: 3, max: 300, label: 'Restart reason' });
  const questionSet = v.oneOf(req.body, 'questionSet', ['same', 'new'], { def: 'same' });
  if (!isLive(exam)) throw conflict('Only live or paused exams can be restarted.');
  const students = db.prepare('SELECT student_id id FROM classroom_students WHERE classroom_id=?').all(exam.classroom_id);
  let ended = 0;
  db.transaction(() => {
    for (const s of students) {
      const latest = db.prepare(`SELECT * FROM attempts WHERE exam_id=? AND student_id=? AND status<>'restarted' ORDER BY attempt_no DESC LIMIT 1`).get(exam.id, s.id);
      if (!latest) { core.newAttempt(exam, s.id, { status: 'not_started', shuffleNew: questionSet === 'new' }); continue; }
      if (latest.status === 'in_progress') ended++;
      core.restartAttempt(exam, latest, req.user, { reason, questionSet, clearAnswers: true, quiet: true }, req.ip);
    }
    db.prepare('UPDATE exams SET version=version+1, updated_at=? WHERE id=?').run(now(), exam.id);
    logChange(exam, req.user, 'exam', exam.id, 'restart_all', [{ field: 'restart_all', old: null, new: { reason, students: students.length } }]);
  })();
  audit(req.user, 'exam.restart_all', 'exam', exam.id, exam.name, { inProgress: ended, students: students.length }, { reason, questionSet }, req.ip);
  notify(classroomStudentUserIds(exam.classroom_id), { title: 'Exam restarted', body: `${exam.name} was restarted for the whole class. Reason: ${reason}. Start a fresh attempt when you are ready.`, type: 'exam_restarted', link: '#/active' });
  hub.sendTo((u) => u.role === 'student', { type: 'exam', examId: exam.id, event: 'restarted' });
  hub.monitor(exam.id);
  res.json({ ok: true, restarted: students.length });
}));

r.post('/attempts/:id/restart', staff, w((req, res) => {
  const { att, exam } = loadAttemptFor(req.user, +req.params.id);
  const reason = v.str(req.body, 'reason', { req: true, min: 3, max: 300, label: 'Restart reason' });
  const questionSet = v.oneOf(req.body, 'questionSet', ['same', 'new'], { def: 'same' });
  const n = core.restartAttempt(exam, att, req.user, { reason, questionSet, clearAnswers: req.body.clearAnswers !== false }, req.ip);
  res.json({ newAttemptId: n.id, attemptNo: n.attempt_no });
}));

function activeAttempt(req) {
  const { att, exam } = loadAttemptFor(req.user, +req.params.id);
  if (att.status !== 'in_progress') throw conflict('This attempt is not in progress.');
  return { att, exam, stuUid: db.prepare('SELECT s.user_id uid, u.name FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(att.student_id) };
}
const pushAttempt = (att, exam, stuUid, reason) => { hub.toUsers([stuUid.uid], { type: 'attempt', attemptId: att.id, examId: exam.id, reason }); hub.monitor(exam.id); };

r.post('/attempts/:id/pause', staff, w((req, res) => {
  const { att, exam, stuUid } = activeAttempt(req);
  if (att.paused_at) throw conflict('This student is already paused.');
  const reason = v.str(req.body, 'reason', { max: 300 });
  const at = exam.status === 'paused' ? exam.paused_at : now();
  db.prepare('UPDATE attempts SET paused_at=?, pause_reason=? WHERE id=?').run(at, reason, att.id);
  audit(req.user, 'attempt.pause', 'attempt', att.id, `${stuUid.name} · ${exam.name}`, null, { reason }, req.ip);
  notify([stuUid.uid], { title: 'Your exam was paused', body: reason || 'Your teacher paused your exam. Your timer is stopped.', type: 'exam_changed', link: '#/active' });
  pushAttempt(att, exam, stuUid, 'paused'); res.json({ ok: true });
}));
r.post('/attempts/:id/resume', staff, w((req, res) => {
  const { att, exam, stuUid } = activeAttempt(req);
  if (!att.paused_at) throw conflict('This student is not paused.');
  const add = exam.status === 'paused' ? Math.max(0, exam.paused_at - att.paused_at) : now() - att.paused_at;
  db.prepare('UPDATE attempts SET paused_at=NULL, pause_reason=NULL, deadline_at=deadline_at+? WHERE id=?').run(add, att.id);
  audit(req.user, 'attempt.resume', 'attempt', att.id, `${stuUid.name} · ${exam.name}`, null, null, req.ip);
  pushAttempt(att, exam, stuUid, 'resumed'); res.json({ ok: true });
}));
r.post('/attempts/:id/extend', staff, w((req, res) => {
  const { att, exam, stuUid } = activeAttempt(req);
  const minutes = v.int(req.body, 'minutes', { req: true, min: 1, max: 240, label: 'Minutes' });
  const reason = v.str(req.body, 'reason', { max: 300 });
  const before = core.remainingMs(att, exam);
  db.prepare('UPDATE attempts SET deadline_at=deadline_at+?, extra_ms=extra_ms+? WHERE id=?').run(minutes * 60000, minutes * 60000, att.id);
  audit(req.user, 'attempt.extend_time', 'attempt', att.id, `${stuUid.name} · ${exam.name}`, { remainingSec: Math.round(before / 1000) }, { addedMinutes: minutes, reason }, req.ip);
  notify([stuUid.uid], { title: 'Extra time added', body: `${minutes} minute(s) were added to your ${exam.name} timer.`, type: 'exam_changed', link: '#/active' });
  pushAttempt(att, exam, stuUid, 'extended'); res.json({ ok: true });
}));
r.post('/attempts/:id/force-submit', staff, w((req, res) => {
  const { att } = activeAttempt(req);
  core.finalizeAttempt(att.id, 'force_submitted', { by: req.user, reason: v.str(req.body, 'reason', { max: 300 }) || 'Force submitted by staff' });
  res.json({ ok: true });
}));

/* ================= results & grading ================= */
r.get('/exams/:id/results', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  const rows = db.prepare(`SELECT a.id, a.attempt_no, a.status, a.started_at, a.ended_at, a.score, a.percentage, a.passed, a.needs_manual, a.correct_count, a.wrong_count, a.unanswered_count, a.restart_reason,
    s.id student_id, s.roll_no, u.name FROM attempts a JOIN students s ON s.id=a.student_id JOIN users u ON u.id=s.user_id WHERE a.exam_id=? AND a.status<>'not_started' ORDER BY s.roll_no, a.attempt_no`).all(exam.id);
  const fin = rows.filter((x) => ['submitted', 'time_expired', 'force_submitted'].includes(x.status));
  const pcts = fin.map((x) => x.percentage);
  const stats = { attempts: fin.length, avg: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length * 10) / 10 : null, high: pcts.length ? Math.max(...pcts) : null, low: pcts.length ? Math.min(...pcts) : null,
    pass: fin.length ? Math.round(100 * fin.filter((x) => x.passed).length / fin.length) : null, pendingManual: fin.filter((x) => x.needs_manual).length };
  res.json({ exam: { id: exam.id, name: exam.name, status: exam.status, total_marks: exam.total_marks, passing_marks: exam.passing_marks, results_released: exam.results_released }, rows, stats });
}));

function attemptDetail(att, exam, forStudent) {
  const qs = core.orderedQuestions(att, exam);
  const rows = new Map(db.prepare('SELECT * FROM answers WHERE attempt_id=?').all(att.id).map((x) => [x.exam_question_id, x]));
  return qs.map((q, i) => {
    const a = rows.get(q.id);
    const base = { id: q.id, n: i + 1, type: q.type, text: q.text, options: q.options, marks: q.marks, negative: q.negative_marks, answer: a ? J(a.answer) : null, awarded: a?.marks_awarded ?? null, is_correct: a?.is_correct ?? null, feedback: a?.feedback || null, manual: !!a?.graded_by, review: !!a?.review };
    if (!forStudent || exam.show_answers) { base.correct = q.correct; base.explanation = q.explanation; }
    return base;
  });
}
r.get('/attempts/:id', staff, w((req, res) => {
  const { att, exam } = loadAttemptFor(req.user, +req.params.id);
  const st = db.prepare('SELECT s.id, s.roll_no, u.name, u.email FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(att.student_id);
  res.json({ attempt: att, exam: { id: exam.id, name: exam.name, total_marks: exam.total_marks, passing_marks: exam.passing_marks, status: exam.status, negative_marking: exam.negative_marking }, student: st,
    questions: attemptDetail(att, exam, false), history: core.attemptHistory(exam.id, att.student_id) });
}));
r.put('/attempts/:id/grade', staff, w((req, res) => {
  const { att, exam } = loadAttemptFor(req.user, +req.params.id);
  if (!['submitted', 'time_expired', 'force_submitted'].includes(att.status)) throw conflict('Only finished attempts can be graded.');
  const grades = Array.isArray(req.body.grades) ? req.body.grades : [];
  if (!grades.length) throw bad('No marks to save.');
  const changes = [];
  db.transaction(() => {
    for (const g of grades) {
      const eq = db.prepare('SELECT * FROM exam_questions WHERE id=? AND exam_id=?').get(+g.eqId, exam.id);
      if (!eq) throw bad('Unknown question in grades.');
      const marks = Number(g.marks);
      if (!Number.isFinite(marks) || marks < 0 || marks > eq.marks) throw bad(`Marks for question must be between 0 and ${eq.marks}.`);
      const fb = g.feedback ? String(g.feedback).slice(0, 2000) : null;
      let row = db.prepare('SELECT * FROM answers WHERE attempt_id=? AND exam_question_id=?').get(att.id, eq.id);
      if (!row) { db.prepare('INSERT INTO answers(attempt_id,exam_question_id,answer,updated_at) VALUES (?,?,NULL,?)').run(att.id, eq.id, now()); row = db.prepare('SELECT * FROM answers WHERE attempt_id=? AND exam_question_id=?').get(att.id, eq.id); }
      if (row.marks_awarded !== marks || (row.feedback || null) !== fb) changes.push({ q: eq.text.slice(0, 60), old: { marks: row.marks_awarded, feedback: row.feedback }, new: { marks, feedback: fb } });
      db.prepare('UPDATE answers SET marks_awarded=?, feedback=?, graded_by=?, graded_at=?, is_correct=? WHERE id=?').run(marks, fb, req.user.id, now(), marks > 0 ? 1 : 0, row.id);
    }
    core.gradeAttempt(att.id);
  })();
  const st = db.prepare('SELECT u.name FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(att.student_id);
  if (changes.length) audit(req.user, 'mark.change', 'attempt', att.id, `${st.name} · ${exam.name}`, changes.map((c) => ({ q: c.q, ...c.old })), changes.map((c) => ({ q: c.q, ...c.new })), req.ip);
  hub.monitor(exam.id);
  res.json({ ok: true, changed: changes.length });
}));

r.post('/exams/:id/publish-results', staff, w((req, res) => {
  const exam = loadExamFor(req.user, +req.params.id);
  const release = req.body.release === false ? 0 : 1;
  if (release && !['completed', 'archived', 'live', 'paused'].includes(exam.status)) throw conflict('Results can be published once the exam has started.');
  if (release) {
    const pending = db.prepare(`SELECT COUNT(*) c FROM attempts WHERE exam_id=? AND status IN ('submitted','time_expired','force_submitted') AND needs_manual>0`).get(exam.id).c;
    if (pending && !req.body.force) throw new HttpError(409, `${pending} attempt(s) still have answers waiting for manual marking. Publish anyway?`, { code: 'PENDING_MANUAL', pending });
  }
  db.prepare('UPDATE exams SET results_released=?, updated_at=? WHERE id=?').run(release, now(), exam.id);
  audit(req.user, release ? 'results.publish' : 'results.unpublish', 'exam', exam.id, exam.name, { released: exam.results_released }, { released: release }, req.ip);
  if (release && !exam.results_released) notify(classroomStudentUserIds(exam.classroom_id), { title: 'Results published', body: `Results for ${exam.name} are now available.`, type: 'results', link: '#/results' });
  hub.sendTo((u) => u.role === 'student', { type: 'exam', examId: exam.id, event: 'results' });
  res.json({ released: release });
}));

module.exports = { router: r, attemptDetail };
