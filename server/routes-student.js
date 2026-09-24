'use strict';
const express = require('express');
const db = require('./db');
const { now, J, S, HttpError, bad, forbidden, notFound, conflict, audit, hub } = require('./lib');
const { requireRole, staff, canAccessClassroom } = require('./auth');
const core = require('./core');
const { w, paging, scopeIds, inList, sendTable } = require('./routes-manage');
const { attemptDetail } = require('./routes-exam');

/* ============================== student ============================== */
const s = express.Router();
s.use(['/student', /^\/attempts\/\d+\/(session|sync|submit)$/], requireRole('student'));
const FIN = `'submitted','time_expired','force_submitted'`;

function myExams(user) {
  return db.prepare(`SELECT e.id,e.name,e.subject,e.description,e.status,e.start_at,e.end_at,e.duration_min,e.total_marks,e.passing_marks,e.max_attempts,e.negative_marking,e.results_released,e.version,c.name classroom_name
    FROM exams e JOIN classrooms c ON c.id=e.classroom_id JOIN classroom_students cs ON cs.classroom_id=c.id WHERE cs.student_id=? AND e.status<>'draft' ORDER BY COALESCE(e.start_at,e.created_at)`).all(user.studentId)
    .map((e) => {
      const cnt = db.prepare('SELECT COUNT(*) c FROM exam_questions WHERE exam_id=? AND removed=0').get(e.id).c;
      const done = db.prepare(`SELECT COUNT(*) c FROM attempts WHERE exam_id=? AND student_id=? AND status IN (${FIN})`).get(e.id, user.studentId).c;
      const cur = db.prepare(`SELECT id,status,paused_at FROM attempts WHERE exam_id=? AND student_id=? AND status IN ('in_progress','not_started') ORDER BY attempt_no DESC LIMIT 1`).get(e.id, user.studentId);
      const t = now();
      const windowOpen = e.status === 'live' && (!e.end_at || t <= e.end_at);
      const canStart = windowOpen && (!!cur || done < e.max_attempts);
      return { ...e, questions: cnt, attemptsUsed: done, currentAttempt: cur ? { id: cur.id, status: cur.status } : null, canStart, results_released: !!e.results_released };
    });
}

s.get('/student/dashboard', w((req, res) => {
  const exams = myExams(req.user);
  const results = db.prepare(`SELECT a.id, a.score, a.percentage, a.passed, a.ended_at, e.name exam_name, e.total_marks FROM attempts a JOIN exams e ON e.id=a.exam_id
    WHERE a.student_id=? AND a.status IN (${FIN}) AND e.results_released=1 ORDER BY a.ended_at DESC LIMIT 6`).all(req.user.studentId);
  const st = db.prepare(`SELECT COUNT(*) n, AVG(a.percentage) avg FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND a.status IN (${FIN}) AND e.results_released=1`).get(req.user.studentId);
  res.json({
    active: exams.filter((e) => ['live', 'paused'].includes(e.status)), upcoming: exams.filter((e) => e.status === 'scheduled'), results,
    stats: { classrooms: db.prepare('SELECT COUNT(*) c FROM classroom_students WHERE student_id=?').get(req.user.studentId).c, completed: st.n, avg: st.avg == null ? null : Math.round(st.avg * 10) / 10,
      upcoming: exams.filter((e) => e.status === 'scheduled').length, active: exams.filter((e) => ['live', 'paused'].includes(e.status)).length },
  });
}));
s.get('/student/classrooms', w((req, res) => {
  const items = db.prepare(`SELECT c.id,c.name,c.section,c.subject,c.academic_year,c.description,u.name teacher_name,
    (SELECT COUNT(*) FROM classroom_students x WHERE x.classroom_id=c.id) classmates,
    (SELECT COUNT(*) FROM exams e WHERE e.classroom_id=c.id AND e.status IN ('scheduled','live','paused')) open_exams
    FROM classroom_students cs JOIN classrooms c ON c.id=cs.classroom_id LEFT JOIN teachers t ON t.id=c.teacher_id LEFT JOIN users u ON u.id=t.user_id WHERE cs.student_id=? ORDER BY c.name`).all(req.user.studentId);
  res.json({ items });
}));
s.get('/student/exams', w((req, res) => {
  const all = myExams(req.user);
  const scope = req.query.scope;
  res.json({ items: scope === 'upcoming' ? all.filter((e) => e.status === 'scheduled') : scope === 'active' ? all.filter((e) => ['live', 'paused'].includes(e.status)) : all });
}));
s.get('/student/results', w((req, res) => {
  const items = db.prepare(`SELECT a.id, a.attempt_no, a.score, a.percentage, a.passed, a.correct_count, a.wrong_count, a.unanswered_count, a.ended_at, a.needs_manual, e.id exam_id, e.name exam_name, e.total_marks, e.passing_marks, e.subject
    FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND a.status IN (${FIN}) AND e.results_released=1 ORDER BY a.ended_at DESC`).all(req.user.studentId);
  const pending = db.prepare(`SELECT COUNT(DISTINCT e.id) c FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND a.status IN (${FIN}) AND e.results_released=0`).get(req.user.studentId).c;
  res.json({ items, awaiting: pending });
}));
s.get('/student/results/:id', w((req, res) => {
  const att = db.prepare('SELECT * FROM attempts WHERE id=? AND student_id=?').get(+req.params.id, req.user.studentId);
  if (!att) throw notFound();
  const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(att.exam_id);
  if (!exam.results_released || !core.FINAL.has(att.status)) throw forbidden('Results for this exam have not been published yet.');
  res.json({ attempt: { id: att.id, no: att.attempt_no, score: att.score, percentage: att.percentage, passed: !!att.passed, correct: att.correct_count, wrong: att.wrong_count, unanswered: att.unanswered_count, started_at: att.started_at, ended_at: att.ended_at, status: att.status, pending: att.needs_manual },
    exam: { id: exam.id, name: exam.name, total_marks: exam.total_marks, passing_marks: exam.passing_marks, show_answers: !!exam.show_answers }, questions: attemptDetail(att, exam, true) });
}));
s.get('/student/history', w((req, res) => {
  const rows = db.prepare(`SELECT a.id, a.attempt_no, a.status, a.started_at, a.ended_at, a.score, a.percentage, a.passed, a.restart_reason, e.id exam_id, e.name exam_name, e.total_marks, e.results_released
    FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND a.status<>'not_started' ORDER BY a.created_at DESC`).all(req.user.studentId)
    .map((a) => ({ ...a, duration_ms: a.started_at && a.ended_at ? a.ended_at - a.started_at : null, ...(a.results_released || !core.FINAL.has(a.status) ? {} : { score: null, percentage: null, passed: null }), results_released: !!a.results_released }));
  res.json({ items: rows });
}));

s.post('/student/exams/:id/start', w((req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(+req.params.id);
  if (!exam || !db.prepare('SELECT 1 FROM classroom_students WHERE classroom_id=? AND student_id=?').get(exam.classroom_id, req.user.studentId)) throw notFound('Exam not found.');
  if (exam.status === 'paused') throw conflict('This exam is paused by your teacher. Wait for it to resume.');
  if (exam.status !== 'live') throw conflict(exam.status === 'scheduled' ? 'This exam has not started yet.' : 'This exam is not open.');
  const t = now();
  let att = db.prepare(`SELECT * FROM attempts WHERE exam_id=? AND student_id=? AND status IN ('in_progress','not_started') ORDER BY attempt_no DESC LIMIT 1`).get(exam.id, req.user.studentId);
  if (!att) {
    if (exam.end_at && t > exam.end_at) throw conflict('The exam window has closed.');
    const done = db.prepare(`SELECT COUNT(*) c FROM attempts WHERE exam_id=? AND student_id=? AND status IN (${FIN})`).get(exam.id, req.user.studentId).c;
    if (done >= exam.max_attempts) throw conflict(`You have used all ${exam.max_attempts} attempt(s) for this exam.`);
    att = core.newAttempt(exam, req.user.studentId, { status: 'in_progress' });
    audit(req.user, 'attempt.start', 'attempt', att.id, exam.name, null, { attemptNo: att.attempt_no }, req.ip);
  } else if (att.status === 'not_started') {
    db.prepare(`UPDATE attempts SET status='in_progress', started_at=?, deadline_at=?, last_activity=? WHERE id=?`).run(t, t + exam.duration_min * 60000, t, att.id);
    att = db.prepare('SELECT * FROM attempts WHERE id=?').get(att.id);
    audit(req.user, 'attempt.start', 'attempt', att.id, exam.name, null, { attemptNo: att.attempt_no }, req.ip);
  }
  hub.monitor(exam.id);
  res.json({ attemptId: att.id });
}));

function myAttempt(req) {
  const att = db.prepare('SELECT * FROM attempts WHERE id=? AND student_id=?').get(+req.params.id, req.user.studentId);
  if (!att) throw notFound('Attempt not found.');
  return { att, exam: db.prepare('SELECT * FROM exams WHERE id=?').get(att.exam_id) };
}
s.get('/attempts/:id/session', w((req, res) => {
  const { att, exam } = myAttempt(req);
  if (att.status === 'not_started') throw conflict('Start the exam from your Active Exams page.');
  if (att.status === 'in_progress') {
    db.prepare('UPDATE attempts SET last_activity=? WHERE id=?').run(now(), att.id);
    hub.monitor(exam.id);
  }
  res.json(core.buildSession(att, exam));
}));

const upsert = () => db.prepare(`INSERT INTO answers(attempt_id,exam_question_id,answer,review,visited,client_ts,updated_at) VALUES (@a,@q,@ans,@rev,@vis,@ts,@now)
  ON CONFLICT(attempt_id,exam_question_id) DO UPDATE SET answer=excluded.answer, review=excluded.review, visited=excluded.visited, client_ts=excluded.client_ts, updated_at=excluded.updated_at
  WHERE excluded.client_ts>=answers.client_ts`);
function saveAnswers(att, exam, list) {
  if (!Array.isArray(list) || !list.length) return [];
  const eqs = new Map(core.activeQuestions(exam.id).map((q) => [q.id, q]));
  const stmt = upsert(); const saved = [];
  db.transaction(() => {
    for (const it of list.slice(0, 200)) {
      const eq = eqs.get(Number(it.eqId));
      if (!eq) continue; // question removed while student was answering: ignore quietly
      let ans = it.answer;
      if (eq.type === 'multi') ans = Array.isArray(ans) ? ans.filter((x) => typeof x === 'string').slice(0, 10) : null;
      else if (eq.type === 'mcq' || eq.type === 'tf') ans = typeof ans === 'string' ? ans : null;
      else ans = typeof ans === 'string' ? ans.slice(0, 20000) : null;
      ans = core.sanitizeAnswer(eq, ans);
      if (typeof ans === 'string' && !ans.trim()) ans = null;
      const ts = Math.min(Number(it.ts) || 0, now() + 60000);
      stmt.run({ a: att.id, q: eq.id, ans: ans === null ? null : JSON.stringify(ans), rev: it.review ? 1 : 0, vis: it.visited ? 1 : 0, ts, now: now() });
      saved.push(eq.id);
    }
  })();
  return saved;
}

function syncState(att, exam, saved) {
  return { status: att.status, ...core.timeState(att, exam), version: exam.version, examStatus: exam.status, saved };
}

s.post('/attempts/:id/sync', w((req, res) => {
  let { att, exam } = myAttempt(req);
  if (att.status !== 'in_progress') return res.json(syncState(att, exam, []));
  const t = now();
  const frozen = core.frozenAt(att, exam);
  if (frozen) return res.json(syncState(att, exam, [])); // paused: answers stay queued on the client until resume
  const rem = core.remainingMs(att, exam, t);
  if (rem < -5000) { att = core.finalizeAttempt(att.id, 'time_expired', { reason: 'Timer reached zero' }); return res.json(syncState(att, exam, [])); }
  const saved = saveAnswers(att, exam, req.body.answers);
  const cur = Number.isInteger(req.body.current) ? Math.max(0, Math.min(req.body.current, 10000)) : att.current_q;
  db.prepare('UPDATE attempts SET last_activity=?, current_q=? WHERE id=?').run(t, cur, att.id);
  if (rem <= 0) { att = core.finalizeAttempt(att.id, 'time_expired', { reason: 'Timer reached zero' }); return res.json(syncState(att, exam, saved)); }
  att = db.prepare('SELECT * FROM attempts WHERE id=?').get(att.id);
  if (saved.length || Math.random() < 0.3) hub.monitor(exam.id);
  res.json(syncState(att, exam, saved));
}));

s.post('/attempts/:id/submit', w((req, res) => {
  let { att, exam } = myAttempt(req);
  if (att.status !== 'in_progress') return res.json(syncState(att, exam, []));
  if (core.frozenAt(att, exam)) throw conflict('The exam is paused. You can submit once it resumes.');
  const rem = core.remainingMs(att, exam);
  if (rem > -5000) saveAnswers(att, exam, req.body.answers);
  att = core.finalizeAttempt(att.id, rem <= 0 ? 'time_expired' : 'submitted', { by: req.user });
  res.json({ ...syncState(att, exam, []), released: !!exam.results_released });
}));

/* ============================== reports ============================== */
const rp = express.Router();
const pct = (x) => (x == null ? null : Math.round(x * 10) / 10);

function reportData(req) {
  const type = req.params.type;
  const ids = scopeIds(req.user);
  const cw = ids ? ` AND e.classroom_id IN (${inList(ids)})` : '';
  const q = req.query;
  const classFilter = q.classroomId ? ` AND e.classroom_id=${Number(q.classroomId) || 0}` : '';
  const examFilter = q.examId ? ` AND e.id=${Number(q.examId) || 0}` : '';
  if (q.classroomId && !canAccessClassroom(req.user, +q.classroomId)) throw forbidden();
  if (q.examId) { const e = db.prepare('SELECT classroom_id FROM exams WHERE id=?').get(+q.examId); if (!e || !canAccessClassroom(req.user, e.classroom_id)) throw forbidden(); }

  if (type === 'student-performance') {
    const rows = db.prepare(`SELECT s.roll_no, u.name, (SELECT GROUP_CONCAT(c.name,'; ') FROM classroom_students cs JOIN classrooms c ON c.id=cs.classroom_id WHERE cs.student_id=s.id) classrooms,
      COUNT(a.id) attempts, ROUND(AVG(a.percentage),1) avg, ROUND(MAX(a.percentage),1) best, ROUND(MIN(a.percentage),1) lowest, SUM(a.passed) passed
      FROM students s JOIN users u ON u.id=s.user_id JOIN attempts a ON a.student_id=s.id AND a.status IN (${FIN}) JOIN exams e ON e.id=a.exam_id
      WHERE 1=1 ${cw}${classFilter}${examFilter} GROUP BY s.id ORDER BY avg DESC`).all();
    return { title: 'Student performance', columns: [['roll_no', 'Roll No'], ['name', 'Student'], ['classrooms', 'Classrooms'], ['attempts', 'Attempts'], ['avg', 'Average %'], ['best', 'Best %'], ['lowest', 'Lowest %'], ['passed', 'Passed']], rows };
  }
  if (type === 'classroom-performance') {
    const rows = db.prepare(`SELECT c.name, c.subject, u.name teacher, (SELECT COUNT(*) FROM classroom_students x WHERE x.classroom_id=c.id) students,
      (SELECT COUNT(*) FROM exams e WHERE e.classroom_id=c.id AND e.status IN ('completed','archived','live','paused')) exams,
      ROUND(AVG(a.percentage),1) avg, ROUND(100.0*SUM(a.passed)/NULLIF(COUNT(a.id),0),0) pass_rate, COUNT(a.id) attempts
      FROM classrooms c LEFT JOIN teachers t ON t.id=c.teacher_id LEFT JOIN users u ON u.id=t.user_id LEFT JOIN exams e ON e.classroom_id=c.id LEFT JOIN attempts a ON a.exam_id=e.id AND a.status IN (${FIN})
      WHERE 1=1 ${ids ? ` AND c.id IN (${inList(ids)})` : ''}${q.classroomId ? ` AND c.id=${Number(q.classroomId) || 0}` : ''} GROUP BY c.id ORDER BY c.name`).all();
    return { title: 'Classroom performance', columns: [['name', 'Classroom'], ['subject', 'Subject'], ['teacher', 'Teacher'], ['students', 'Students'], ['exams', 'Exams'], ['attempts', 'Attempts'], ['avg', 'Average %'], ['pass_rate', 'Pass rate %']], rows };
  }
  if (type === 'exam-performance') {
    const rows = db.prepare(`SELECT e.name, c.name classroom, e.status, e.total_marks, e.passing_marks, COUNT(a.id) attempts, ROUND(AVG(a.score),1) avg_score, ROUND(AVG(a.percentage),1) avg,
      ROUND(MAX(a.percentage),1) high, ROUND(MIN(a.percentage),1) low, ROUND(100.0*SUM(a.passed)/NULLIF(COUNT(a.id),0),0) pass_rate
      FROM exams e JOIN classrooms c ON c.id=e.classroom_id LEFT JOIN attempts a ON a.exam_id=e.id AND a.status IN (${FIN})
      WHERE e.status<>'draft' ${cw}${classFilter}${examFilter} GROUP BY e.id ORDER BY COALESCE(e.start_at,e.created_at) DESC`).all();
    return { title: 'Exam performance', columns: [['name', 'Exam'], ['classroom', 'Classroom'], ['status', 'Status'], ['total_marks', 'Total marks'], ['attempts', 'Attempts'], ['avg_score', 'Avg score'], ['avg', 'Average %'], ['high', 'Highest %'], ['low', 'Lowest %'], ['pass_rate', 'Pass rate %']], rows };
  }
  if (type === 'question-analysis') {
    if (!q.examId) throw bad('Choose an exam for the question-wise analysis.');
    const rows = db.prepare(`SELECT eq.position n, eq.text, eq.type, eq.difficulty, eq.marks, COUNT(an.id) attempts,
      SUM(CASE WHEN an.is_correct=1 THEN 1 ELSE 0 END) correct, SUM(CASE WHEN an.is_correct=0 THEN 1 ELSE 0 END) wrong, SUM(CASE WHEN an.answer IS NULL THEN 1 ELSE 0 END) unanswered, ROUND(AVG(an.marks_awarded),2) avg_marks
      FROM exam_questions eq JOIN exams e ON e.id=eq.exam_id LEFT JOIN answers an ON an.exam_question_id=eq.id AND an.attempt_id IN (SELECT id FROM attempts WHERE exam_id=eq.exam_id AND status IN (${FIN}))
      WHERE eq.removed=0 ${cw}${examFilter} GROUP BY eq.id ORDER BY eq.position`).all()
      .map((x, i) => ({ ...x, n: i + 1, text: x.text.length > 90 ? x.text.slice(0, 90) + '…' : x.text, correct_pct: x.attempts ? Math.round(100 * x.correct / x.attempts) : null, wrong_pct: x.attempts ? Math.round(100 * x.wrong / x.attempts) : null }));
    return { title: 'Question-wise analysis', columns: [['n', '#'], ['text', 'Question'], ['type', 'Type'], ['difficulty', 'Difficulty'], ['marks', 'Marks'], ['attempts', 'Answers'], ['correct_pct', 'Correct %'], ['wrong_pct', 'Wrong %'], ['unanswered', 'Unanswered'], ['avg_marks', 'Avg marks']], rows };
  }
  if (type === 'participation') {
    const rows = db.prepare(`SELECT e.name, c.name classroom, e.status,
      (SELECT COUNT(*) FROM classroom_students cs WHERE cs.classroom_id=e.classroom_id) enrolled,
      (SELECT COUNT(DISTINCT student_id) FROM attempts a WHERE a.exam_id=e.id AND a.status IN ('in_progress',${FIN})) started,
      (SELECT COUNT(DISTINCT student_id) FROM attempts a WHERE a.exam_id=e.id AND a.status IN (${FIN})) completed,
      (SELECT COUNT(*) FROM attempts a WHERE a.exam_id=e.id AND a.status='restarted') restarts
      FROM exams e JOIN classrooms c ON c.id=e.classroom_id WHERE e.status<>'draft' ${cw}${classFilter}${examFilter} ORDER BY COALESCE(e.start_at,e.created_at) DESC`).all()
      .map((x) => ({ ...x, not_started: x.enrolled - x.started, rate: x.enrolled ? Math.round(100 * x.completed / x.enrolled) : 0 }));
    return { title: 'Participation', columns: [['name', 'Exam'], ['classroom', 'Classroom'], ['status', 'Status'], ['enrolled', 'Enrolled'], ['started', 'Started'], ['completed', 'Completed'], ['not_started', 'Not started'], ['restarts', 'Restarts'], ['rate', 'Completion %']], rows };
  }
  throw notFound('Unknown report.');
}
rp.get('/reports/:type', staff, w(async (req, res) => {
  const d = reportData(req);
  const cols = d.columns.map(([key, label]) => ({ key, label }));
  if (req.query.format && req.query.format !== 'json') {
    audit(req.user, 'report.export', 'report', null, d.title, null, { format: req.query.format, filters: { classroomId: req.query.classroomId, examId: req.query.examId } }, req.ip);
    return sendTable(res, req.query.format, req.params.type, d.title, cols, d.rows);
  }
  res.json({ title: d.title, columns: cols, rows: d.rows });
}));

module.exports = { student: s, reports: rp };
