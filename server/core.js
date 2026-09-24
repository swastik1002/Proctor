'use strict';
const db = require('./db');
const { now, J, S, bad, conflict, notFound, audit, hub, notify, classroomStudentUserIds, getSettings, randId, seededShuffle, mulberry32 } = require('./lib');

const OBJECTIVE = new Set(['mcq', 'multi', 'tf']);
const FINAL = new Set(['submitted', 'time_expired', 'force_submitted']);

/* ================= question normalisation ================= */
function normalizeQuestion(b) {
  const type = ['mcq', 'multi', 'tf', 'short', 'long'].includes(b.type) ? b.type : null;
  if (!type) throw bad('Choose a valid question type.', { field: 'type' });
  const text = String(b.text || '').trim();
  if (!text) throw bad('Question text is required.', { field: 'text' });
  if (text.length > 5000) throw bad('Question text is too long (5000 characters max).', { field: 'text' });
  const marks = Number(b.marks ?? 1);
  const neg = Number(b.negative_marks ?? 0);
  if (!Number.isFinite(marks) || marks < 0 || marks > 1000) throw bad('Marks must be between 0 and 1000.', { field: 'marks' });
  if (!Number.isFinite(neg) || neg < 0 || neg > marks) throw bad('Negative marks must be between 0 and the question marks.', { field: 'negative_marks' });
  const difficulty = ['easy', 'medium', 'hard'].includes(b.difficulty) ? b.difficulty : 'medium';
  const out = {
    type, text, marks, negative_marks: neg, difficulty,
    topic: b.topic ? String(b.topic).trim().slice(0, 100) : null,
    subject: b.subject ? String(b.subject).trim().slice(0, 100) : null,
    explanation: b.explanation ? String(b.explanation).trim().slice(0, 3000) : null,
    options: null, correct: null,
  };
  if (type === 'mcq' || type === 'multi') {
    let opts = Array.isArray(b.options) ? b.options : [];
    opts = opts.map((o) => ({ id: String(o.id || 'o' + randId(4)).slice(0, 20), text: String(o.text || '').trim().slice(0, 500) })).filter((o) => o.text);
    if (opts.length < 2) throw bad('Add at least two options.', { field: 'options' });
    if (opts.length > 10) throw bad('A question can have at most 10 options.', { field: 'options' });
    const ids = new Set(opts.map((o) => o.id));
    if (ids.size !== opts.length) throw bad('Option ids must be unique.', { field: 'options' });
    out.options = opts;
    if (type === 'mcq') {
      if (!ids.has(b.correct)) throw bad('Select the correct option.', { field: 'correct' });
      out.correct = b.correct;
    } else {
      const c = Array.isArray(b.correct) ? [...new Set(b.correct)] : [];
      if (!c.length || c.some((x) => !ids.has(x))) throw bad('Select at least one correct option.', { field: 'correct' });
      out.correct = c;
    }
  } else if (type === 'tf') {
    out.options = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }];
    if (b.correct !== 'true' && b.correct !== 'false') throw bad('Choose True or False as the correct answer.', { field: 'correct' });
    out.correct = b.correct;
  } else if (type === 'short') {
    let c = Array.isArray(b.correct) ? b.correct : typeof b.correct === 'string' ? b.correct.split('\n') : [];
    c = c.map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
    out.correct = c; // empty => manual marking
  }
  return out;
}
const enc = (q) => [q.options ? S(q.options) : null, q.correct === null || q.correct === undefined ? null : S(q.correct)];
function hydrateEq(r) { return r && { ...r, options: J(r.options), correct: J(r.correct) }; }

/* ================= grading ================= */
const isEmptyAnswer = (a) => a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0);
function gradeQuestion(eq, answer, negativeMarking) {
  if (isEmptyAnswer(answer)) return { status: 'unanswered', marks: 0 };
  const neg = negativeMarking ? eq.negative_marks || 0 : 0;
  if (eq.type === 'mcq' || eq.type === 'tf') {
    return answer === eq.correct ? { status: 'correct', marks: eq.marks } : { status: 'wrong', marks: -neg };
  }
  if (eq.type === 'multi') {
    const a = Array.isArray(answer) ? [...answer].sort() : [];
    const c = [...(eq.correct || [])].sort();
    return a.length === c.length && a.every((x, i) => x === c[i]) ? { status: 'correct', marks: eq.marks } : { status: 'wrong', marks: -neg };
  }
  if (eq.type === 'short') {
    const acc = eq.correct || [];
    if (!acc.length) return { status: 'pending', marks: 0 };
    const n = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
    return acc.some((x) => n(x) === n(answer)) ? { status: 'correct', marks: eq.marks } : { status: 'wrong', marks: 0 };
  }
  return { status: 'pending', marks: 0 };
}

const activeQuestions = (examId) => db.prepare('SELECT * FROM exam_questions WHERE exam_id=? AND removed=0 ORDER BY position, id').all(examId).map(hydrateEq);

function gradeAttempt(attemptId) {
  const att = db.prepare('SELECT * FROM attempts WHERE id=?').get(attemptId);
  const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(att.exam_id);
  const eqs = activeQuestions(exam.id);
  const rows = db.prepare('SELECT * FROM answers WHERE attempt_id=?').all(attemptId);
  const map = new Map(rows.map((r) => [r.exam_question_id, r]));
  const insert = db.prepare(`INSERT OR IGNORE INTO answers(attempt_id,exam_question_id,answer,updated_at) VALUES (?,?,NULL,?)`);
  const upd = db.prepare('UPDATE answers SET marks_awarded=?, is_correct=? WHERE id=?');
  let score = 0, correct = 0, wrong = 0, unans = 0, pending = 0, total = 0;
  db.transaction(() => {
    for (const eq of eqs) {
      total += eq.marks;
      let row = map.get(eq.id);
      if (!row) { insert.run(attemptId, eq.id, now()); row = db.prepare('SELECT * FROM answers WHERE attempt_id=? AND exam_question_id=?').get(attemptId, eq.id); }
      const ans = J(row.answer);
      const manual = row.graded_by != null;
      let g;
      if (manual) g = { status: row.marks_awarded > 0 ? 'correct' : isEmptyAnswer(ans) ? 'unanswered' : 'wrong', marks: row.marks_awarded || 0 };
      else g = gradeQuestion(eq, ans, exam.negative_marking);
      if (g.status === 'pending') pending++;
      if (g.status === 'correct') correct++; else if (g.status === 'wrong') wrong++; else if (g.status === 'unanswered') unans++;
      score += g.marks;
      if (!manual) upd.run(g.status === 'pending' ? null : g.marks, g.status === 'pending' ? null : g.status === 'correct' ? 1 : g.status === 'wrong' ? 0 : null, row.id);
      else if (row.marks_awarded != null) upd.run(row.marks_awarded, g.status === 'correct' ? 1 : g.status === 'wrong' ? 0 : null, row.id);
    }
    score = Math.max(0, Math.round(score * 100) / 100);
    const pct = total ? Math.round((score / total) * 10000) / 100 : 0;
    db.prepare(`UPDATE attempts SET score=?, correct_count=?, wrong_count=?, unanswered_count=?, percentage=?, passed=?, needs_manual=?, evaluated_at=? WHERE id=?`)
      .run(score, correct, wrong, unans, pct, score >= exam.passing_marks ? 1 : 0, pending, now(), attemptId);
  })();
}

function regradeExam(examId) {
  const ids = db.prepare(`SELECT id FROM attempts WHERE exam_id=? AND status IN ('submitted','time_expired','force_submitted','restarted') AND evaluated_at IS NOT NULL`).all(examId);
  ids.forEach((r) => gradeAttempt(r.id));
  return ids.length;
}

function recalcExamTotal(examId) {
  const r = db.prepare('SELECT COALESCE(SUM(marks),0) t FROM exam_questions WHERE exam_id=? AND removed=0').get(examId);
  db.prepare('UPDATE exams SET total_marks=? WHERE id=?').run(r.t, examId);
  return r.t;
}

/* ================= timing (server is the clock) ================= */
const frozenAt = (att, exam) => att.paused_at || (exam.status === 'paused' ? exam.paused_at : null);
const remainingMs = (att, exam, t = now()) => (att.deadline_at == null ? exam.duration_min * 60000 : att.deadline_at - (frozenAt(att, exam) || t));

/* ================= attempt lifecycle ================= */
function buildOrder(examId, seed, shuffle) {
  const ids = activeQuestions(examId).map((q) => q.id);
  return shuffle ? seededShuffle(ids, seed) : ids;
}

function newAttempt(exam, studentId, { status = 'not_started', shuffleNew = false, copyFrom = null, restartOf = null } = {}) {
  const max = db.prepare('SELECT COALESCE(MAX(attempt_no),0) m FROM attempts WHERE exam_id=? AND student_id=?').get(exam.id, studentId).m;
  let seed = Math.floor(Math.random() * 2 ** 31) + 1, shuffleQ = exam.shuffle_questions, shuffleO = exam.shuffle_options, order;
  if (copyFrom) { seed = copyFrom.seed; shuffleQ = copyFrom.shuffle_q; shuffleO = copyFrom.shuffle_o; order = copyFrom.question_order; }
  else if (shuffleNew) { shuffleQ = 1; shuffleO = 1; }
  if (order === undefined) order = S(buildOrder(exam.id, seed, shuffleQ));
  const t = now();
  const info = db.prepare(`INSERT INTO attempts(exam_id,student_id,attempt_no,status,question_order,seed,shuffle_q,shuffle_o,restart_of,created_at,started_at,deadline_at,last_activity)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(exam.id, studentId, max + 1, status, order, seed, shuffleQ, shuffleO, restartOf, t,
    status === 'in_progress' ? t : null, status === 'in_progress' ? t + exam.duration_min * 60000 : null, status === 'in_progress' ? t : null);
  return db.prepare('SELECT * FROM attempts WHERE id=?').get(info.lastInsertRowid);
}

function finalizeAttempt(attId, status, { by = null, reason = null } = {}) {
  const att = db.prepare('SELECT * FROM attempts WHERE id=?').get(attId);
  if (!att || FINAL.has(att.status) || att.status === 'restarted') return att;
  db.prepare('UPDATE attempts SET status=?, ended_at=?, paused_at=NULL, pause_reason=NULL, end_reason=? WHERE id=?').run(status, now(), reason, attId);
  gradeAttempt(attId);
  const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(att.exam_id);
  const st = db.prepare('SELECT s.user_id uid, u.name, s.roll_no FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(att.student_id);
  hub.toUsers([st.uid], { type: 'attempt', attemptId: attId, examId: exam.id, reason: status });
  hub.monitor(exam.id);
  const tch = db.prepare('SELECT t.user_id uid FROM classrooms c JOIN teachers t ON t.id=c.teacher_id WHERE c.id=?').get(exam.classroom_id);
  if (tch) notify([tch.uid], { title: 'Submission received', body: `${st.name} (${st.roll_no}) ${status === 'submitted' ? 'submitted' : status === 'time_expired' ? 'ran out of time on' : 'was force-submitted on'} ${exam.name}.`, type: 'submission', link: `#/live/${exam.id}` });
  audit(by, status === 'submitted' ? 'attempt.submit' : status === 'time_expired' ? 'attempt.time_expired' : 'attempt.force_submit', 'attempt', attId, `${st.name} · ${exam.name}`, null, { status, reason });
  maybeAutoComplete(exam.id);
  return db.prepare('SELECT * FROM attempts WHERE id=?').get(attId);
}

function maybeAutoComplete(examId) {
  const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(examId);
  if (exam.status !== 'live') return;
  if (now() <= exam.end_at) return;
  const open = db.prepare(`SELECT COUNT(*) c FROM attempts WHERE exam_id=? AND status='in_progress'`).get(examId).c;
  if (!open) completeExam(exam, null, 'Exam window closed');
}

function completeExam(exam, user, why) {
  db.prepare(`UPDATE exams SET status='completed', paused_at=NULL, updated_at=? WHERE id=?`).run(now(), exam.id);
  let published = false;
  if (exam.release_mode === 'on_completion' && !exam.results_released) {
    db.prepare('UPDATE exams SET results_released=1 WHERE id=?').run(exam.id); published = true;
    notify(classroomStudentUserIds(exam.classroom_id), { title: 'Results published', body: `Results for ${exam.name} are now available.`, type: 'results', link: '#/results' });
    audit(user, 'results.publish', 'exam', exam.id, exam.name, { released: 0 }, { released: 1, mode: 'on_completion' });
  }
  audit(user, 'exam.complete', 'exam', exam.id, exam.name, { status: exam.status }, { status: 'completed', reason: why, published });
  hub.monitor(exam.id);
  hub.sendTo((u) => u.role === 'student', { type: 'exam', examId: exam.id, event: 'completed' });
}

// Called every few seconds: start scheduled exams, expire timed-out attempts, close windows, send reminders
function tick() {
  const t = now();
  const settings = getSettings();
  const starting = db.prepare(`SELECT * FROM exams WHERE status='scheduled' AND start_at<=?`).all(t);
  for (const e of starting) {
    db.prepare(`UPDATE exams SET status='live', updated_at=? WHERE id=?`).run(t, e.id);
    audit(null, 'exam.start', 'exam', e.id, e.name, { status: 'scheduled' }, { status: 'live', auto: true });
    notify(classroomStudentUserIds(e.classroom_id), { title: 'Exam started', body: `${e.name} is now open. You can begin.`, type: 'exam_started', link: '#/active' });
    hub.sendTo((u) => u.role === 'student', { type: 'exam', examId: e.id, event: 'started' });
    hub.monitor(e.id);
  }
  const remindMs = Number(settings.reminder_minutes || 30) * 60000;
  const reminders = db.prepare(`SELECT * FROM exams WHERE status='scheduled' AND reminder_sent=0 AND start_at<=?`).all(t + remindMs);
  for (const e of reminders) {
    db.prepare('UPDATE exams SET reminder_sent=1 WHERE id=?').run(e.id);
    notify(classroomStudentUserIds(e.classroom_id), { title: 'Exam reminder', body: `${e.name} starts at ${new Date(e.start_at).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}.`, type: 'reminder', link: '#/upcoming' });
  }
  const open = db.prepare(`SELECT a.*, e.status estatus, e.paused_at epaused FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.status='in_progress'`).all();
  for (const a of open) {
    const frozen = a.paused_at || (a.estatus === 'paused' ? a.epaused : null);
    if (frozen) continue;
    if (a.deadline_at <= t) finalizeAttempt(a.id, 'time_expired', { reason: 'Timer reached zero' });
  }
  const live = db.prepare(`SELECT id FROM exams WHERE status='live' AND end_at<?`).all(t);
  live.forEach((e) => maybeAutoComplete(e.id));
}

/* ================= student-facing session payload ================= */
function orderedQuestions(att, exam) {
  const eqs = activeQuestions(exam.id);
  if (!att.shuffle_q) return eqs;
  const map = new Map(eqs.map((q) => [q.id, q]));
  const stored = J(att.question_order, []);
  const first = stored.filter((id) => map.has(id)).map((id) => map.get(id));
  const seen = new Set(stored);
  return first.concat(eqs.filter((q) => !seen.has(q.id)));
}
function studentQuestion(eq, att, n) {
  let options = eq.options;
  if (options && att.shuffle_o && (eq.type === 'mcq' || eq.type === 'multi')) options = seededShuffle(options, (att.seed ^ (eq.id * 2654435761)) >>> 0);
  return { id: eq.id, n, type: eq.type, text: eq.text, options, marks: eq.marks, negative: eq.negative_marks };
}
function sanitizeAnswer(eq, a) {
  if (a == null) return null;
  const ids = new Set((eq.options || []).map((o) => o.id));
  if (eq.type === 'multi') { const f = (Array.isArray(a) ? a : []).filter((x) => ids.has(x)); return f.length ? f : null; }
  if (eq.type === 'mcq' || eq.type === 'tf') return ids.has(a) ? a : null;
  return a === '' ? null : a;
}

function buildSession(att, exam) {
  const qs = orderedQuestions(att, exam);
  const rows = db.prepare('SELECT * FROM answers WHERE attempt_id=?').all(att.id);
  const am = new Map(rows.map((r) => [r.exam_question_id, r]));
  const answers = {};
  const questions = qs.map((q, i) => {
    const r = am.get(q.id);
    if (r) answers[q.id] = { answer: sanitizeAnswer(q, J(r.answer)), review: !!r.review, visited: !!r.visited };
    return studentQuestion(q, att, i + 1);
  });
  const st = db.prepare('SELECT s.roll_no, u.name, s.section FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(att.student_id);
  const cls = db.prepare('SELECT name FROM classrooms WHERE id=?').get(exam.classroom_id);
  return {
    attempt: { id: att.id, no: att.attempt_no, status: att.status, current: att.current_q, paused: !!att.paused_at, pauseReason: att.pause_reason },
    exam: { id: exam.id, name: exam.name, subject: exam.subject, classroom: cls?.name, instructions: exam.instructions, description: exam.description,
      duration: exam.duration_min, version: exam.version, status: exam.status, paused: exam.status === 'paused', negative: !!exam.negative_marking, totalMarks: exam.total_marks },
    student: st, questions, answers, ...timeState(att, exam),
  };
}
function timeState(att, exam) {
  const t = now();
  return { serverTime: t, remainingMs: att.status === 'in_progress' ? Math.max(0, remainingMs(att, exam, t)) : 0,
    frozen: !!(att.status === 'in_progress' && frozenAt(att, exam)), examPaused: exam.status === 'paused', attemptPaused: !!att.paused_at, pauseReason: att.pause_reason };
}

/* ================= restart / controls ================= */
function ensureWindow(exam, user, ms) {
  const need = now() + ms;
  if (exam.end_at && exam.end_at < need) {
    db.prepare('UPDATE exams SET end_at=? WHERE id=?').run(need, exam.id);
    db.prepare(`INSERT INTO exam_changes(exam_id,user_id,user_name,entity,entity_id,action,field,old_value,new_value,exam_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(exam.id, user?.id, user?.name, 'exam', exam.id, 'update', 'end_at', String(exam.end_at), String(need), exam.version, now());
    exam.end_at = need;
  }
}

function restartAttempt(exam, att, user, { reason, questionSet = 'same', clearAnswers = true, quiet = false }, ip) {
  if (!['live', 'paused'].includes(exam.status)) throw conflict('Only live or paused exams can be restarted.');
  if (att.status === 'restarted') throw conflict('This attempt has already been restarted.');
  const tx = db.transaction(() => {
    const wasActive = att.status === 'in_progress' || att.status === 'not_started';
    if (wasActive) {
      db.prepare(`UPDATE attempts SET status='restarted', ended_at=?, paused_at=NULL, restart_reason=?, restarted_by=? WHERE id=?`).run(now(), reason, user.id, att.id);
    } else {
      db.prepare(`UPDATE attempts SET restart_reason=?, restarted_by=? WHERE id=?`).run(reason, user.id, att.id);
    }
    if (att.status !== 'not_started' && wasActive) gradeAttempt(att.id);
    const fresh = db.prepare('SELECT * FROM attempts WHERE id=?').get(att.id);
    const n = newAttempt(exam, att.student_id, { status: 'not_started', shuffleNew: questionSet === 'new', copyFrom: questionSet === 'same' ? fresh : null, restartOf: att.id });
    if (!clearAnswers) {
      db.prepare(`INSERT INTO answers(attempt_id,exam_question_id,answer,review,visited,client_ts,updated_at)
        SELECT ?,exam_question_id,answer,review,visited,client_ts,? FROM answers WHERE attempt_id=?`).run(n.id, now(), att.id);
    }
    if (!wasActive) db.prepare(`UPDATE attempts SET status=status WHERE id=?`).run(att.id);
    return n;
  });
  const n = tx();
  ensureWindow(exam, user, exam.duration_min * 60000 + 15 * 60000);
  if (quiet) return n;
  const st = db.prepare('SELECT s.user_id uid, u.name FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(att.student_id);
  audit(user, 'attempt.restart', 'attempt', att.id, `${st.name} · ${exam.name}`, { attempt: att.id, no: att.attempt_no, status: att.status }, { newAttempt: n.id, no: n.attempt_no, reason, questionSet, clearAnswers }, ip);
  notify([st.uid], { title: 'Your exam was restarted', body: `${exam.name} was restarted for you. Reason: ${reason}. You can begin a fresh attempt.`, type: 'exam_restarted', link: '#/active' });
  hub.toUsers([st.uid], { type: 'attempt', attemptId: att.id, examId: exam.id, reason: 'restarted', newAttemptId: n.id });
  hub.monitor(exam.id);
  return n;
}

/* ================= monitoring snapshot ================= */
function monitorSnapshot(exam) {
  const s = getSettings();
  const idle = Number(s.idle_seconds || 90) * 1000;
  const t = now();
  const total = db.prepare('SELECT COUNT(*) c FROM exam_questions WHERE exam_id=? AND removed=0').get(exam.id).c;
  const students = db.prepare(`SELECT s.id sid, s.roll_no, u.name, u.email, s.section FROM classroom_students cs JOIN students s ON s.id=cs.student_id JOIN users u ON u.id=s.user_id
    WHERE cs.classroom_id=? ORDER BY s.roll_no`).all(exam.classroom_id);
  const atts = db.prepare(`SELECT * FROM attempts WHERE exam_id=? ORDER BY attempt_no`).all(exam.id);
  const byStudent = new Map();
  for (const a of atts) { if (!byStudent.has(a.student_id)) byStudent.set(a.student_id, []); byStudent.get(a.student_id).push(a); }
  const answered = new Map(db.prepare(`SELECT a.attempt_id id, COUNT(*) c FROM answers a JOIN exam_questions q ON q.id=a.exam_question_id AND q.removed=0
    JOIN attempts t ON t.id=a.attempt_id WHERE t.exam_id=? AND a.answer IS NOT NULL GROUP BY a.attempt_id`).all(exam.id).map((r) => [r.id, r.c]));
  const rows = students.map((st) => {
    const list = byStudent.get(st.sid) || [];
    const latest = [...list].reverse().find((a) => a.status !== 'restarted') || null;
    const base = { studentId: st.sid, roll_no: st.roll_no, name: st.name, section: st.section, attempts: list.length, restarts: list.filter((a) => a.status === 'restarted').length };
    if (!latest || latest.status === 'not_started') return { ...base, attemptId: latest?.id || null, status: 'not_started', progress: 0, answered: 0, total, current: 0, remainingMs: null, lastActivity: null, paused: false };
    const ans = answered.get(latest.id) || 0;
    let status = 'active';
    if (latest.status === 'in_progress') status = t - (latest.last_activity || 0) > idle ? 'idle' : 'active';
    else if (latest.status === 'time_expired') status = 'time_expired';
    else status = 'submitted';
    return { ...base, attemptId: latest.id, attemptNo: latest.attempt_no, status, rawStatus: latest.status, answered: ans, total, progress: total ? Math.round((ans / total) * 100) : 0,
      current: latest.current_q + 1, remainingMs: latest.status === 'in_progress' ? Math.max(0, remainingMs(latest, exam, t)) : 0,
      lastActivity: latest.last_activity, paused: !!latest.paused_at, pauseReason: latest.pause_reason, extraMs: latest.extra_ms,
      score: latest.status === 'in_progress' ? null : latest.score, percentage: latest.percentage, needsManual: latest.needs_manual };
  });
  const c = { active: 0, idle: 0, submitted: 0, time_expired: 0, not_started: 0 };
  rows.forEach((r) => c[r.status]++);
  return { exam: { id: exam.id, name: exam.name, status: exam.status, version: exam.version, duration: exam.duration_min, start_at: exam.start_at, end_at: exam.end_at, paused_at: exam.paused_at },
    serverTime: t, counts: c, total: rows.length, questions: total, rows };
}

function attemptHistory(examId, studentId) {
  return db.prepare(`SELECT id, attempt_no, status, started_at, ended_at, score, percentage, passed, restart_reason, restart_of, end_reason,
    CASE WHEN started_at IS NOT NULL AND ended_at IS NOT NULL THEN ended_at-started_at END duration_ms FROM attempts WHERE exam_id=? AND student_id=? ORDER BY attempt_no`).all(examId, studentId);
}

module.exports = { OBJECTIVE, FINAL, normalizeQuestion, enc, hydrateEq, gradeQuestion, gradeAttempt, regradeExam, recalcExamTotal, activeQuestions,
  frozenAt, remainingMs, timeState, newAttempt, finalizeAttempt, completeExam, maybeAutoComplete, tick, buildSession, orderedQuestions, ensureWindow,
  restartAttempt, monitorSnapshot, attemptHistory, isEmptyAnswer, sanitizeAnswer, buildOrder };
