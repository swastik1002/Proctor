'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('./db');
const { now, J, S, HttpError, bad, forbidden, notFound, conflict, v, audit, notify, getSettings, DEFAULT_SETTINGS } = require('./lib');
const { staff, requireRole, canAccessClassroom, teacherScopeSql, publicUser } = require('./auth');
const core = require('./core');

const r = express.Router();
const w = (fn) => (req, res, next) => { try { const out = fn(req, res, next); if (out && typeof out.catch === 'function') out.catch(next); } catch (e) { next(e); } };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const DEMO_PW_HASH = () => bcrypt.hashSync('Student@123', 10);

const paging = (req, def = 20) => {
  const size = Math.min(100, Math.max(1, parseInt(req.query.size) || def));
  const page = Math.max(1, parseInt(req.query.page) || 1);
  return { size, page, offset: (page - 1) * size };
};
const like = (s) => `%${String(s).replace(/[%_\\]/g, (m) => '\\' + m)}%`;
const scopeIds = (user) => (user.role === 'admin' ? null : db.prepare('SELECT id FROM classrooms WHERE teacher_id=?').all(user.teacherId || 0).map((x) => x.id));
const inList = (ids) => (ids.length ? ids.join(',') : '0');

/* ================= dashboard ================= */
r.get('/dashboard', staff, w((req, res) => {
  const ids = scopeIds(req.user);
  const cw = ids ? `AND e.classroom_id IN (${inList(ids)})` : '';
  const cc = ids ? `WHERE id IN (${inList(ids)})` : '';
  const classrooms = db.prepare(`SELECT COUNT(*) c FROM classrooms ${cc}`).get().c;
  const students = ids
    ? db.prepare(`SELECT COUNT(DISTINCT student_id) c FROM classroom_students WHERE classroom_id IN (${inList(ids)})`).get().c
    : db.prepare('SELECT COUNT(*) c FROM students').get().c;
  const cnt = (st) => db.prepare(`SELECT COUNT(*) c FROM exams e WHERE status IN (${st.map(() => '?').join(',')}) ${cw}`).get(...st).c;
  const upcoming = cnt(['scheduled']), active = cnt(['live', 'paused']), completed = cnt(['completed']);
  const avg = db.prepare(`SELECT AVG(a.percentage) p FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.status IN ('submitted','time_expired','force_submitted') ${cw}`).get().p;
  const liveStudents = db.prepare(`SELECT COUNT(*) c FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.status='in_progress' AND e.status IN ('live','paused') ${cw}`).get().c;
  const recent = db.prepare(`SELECT e.id, e.name, e.status, e.classroom_id,
      (SELECT COUNT(*) FROM classroom_students cs WHERE cs.classroom_id=e.classroom_id) enrolled,
      (SELECT COUNT(DISTINCT student_id) FROM attempts a WHERE a.exam_id=e.id AND a.status IN ('in_progress','submitted','time_expired','force_submitted')) taken,
      (SELECT ROUND(AVG(percentage),1) FROM attempts a WHERE a.exam_id=e.id AND a.status IN ('submitted','time_expired','force_submitted')) avg
    FROM exams e WHERE e.status IN ('completed','live','paused') ${cw} ORDER BY COALESCE(e.start_at,e.created_at) DESC LIMIT 8`).all().reverse();
  const buckets = [0, 0, 0, 0, 0];
  db.prepare(`SELECT a.percentage p FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.status IN ('submitted','time_expired','force_submitted') ${cw}`).all()
    .forEach((x) => { buckets[Math.min(4, Math.floor((x.p || 0) / 20))]++; });
  const logs = db.prepare(`SELECT id,user_name,role,action,target_type,target_label,created_at FROM audit_logs ${req.user.role === 'admin' ? '' : `WHERE user_id=${req.user.id}`} ORDER BY id DESC LIMIT 8`).all();
  const liveExams = db.prepare(`SELECT e.id,e.name,e.status,e.end_at,c.name classroom FROM exams e JOIN classrooms c ON c.id=e.classroom_id WHERE e.status IN ('live','paused') ${cw} ORDER BY e.start_at`).all();
  res.json({ kpis: { classrooms, students, upcoming, active, completed, avg: avg == null ? null : Math.round(avg * 10) / 10, liveStudents }, recent, distribution: buckets, logs, liveExams });
}));

/* ================= classrooms ================= */
function classroomInput(b) {
  return {
    name: v.str(b, 'name', { req: true, max: 100, label: 'Name' }), section: v.str(b, 'section', { max: 30 }),
    subject: v.str(b, 'subject', { req: true, max: 100, label: 'Subject' }), teacher_id: v.int(b, 'teacher_id', { min: 1, label: 'Teacher' }),
    academic_year: v.str(b, 'academic_year', { max: 20 }), description: v.str(b, 'description', { max: 1000 }),
  };
}
r.get('/classrooms', staff, w((req, res) => {
  const { size, page, offset } = paging(req, 12);
  const wh = ['1=1'], p = [];
  if (req.user.role === 'teacher') { wh.push('c.teacher_id=?'); p.push(req.user.teacherId || 0); }
  if (req.query.q) { wh.push(`(c.name LIKE ? ESCAPE '\\' OR c.subject LIKE ? ESCAPE '\\' OR c.section LIKE ? ESCAPE '\\')`); p.push(like(req.query.q), like(req.query.q), like(req.query.q)); }
  if (req.query.year) { wh.push('c.academic_year=?'); p.push(req.query.year); }
  const base = `FROM classrooms c LEFT JOIN teachers t ON t.id=c.teacher_id LEFT JOIN users u ON u.id=t.user_id WHERE ${wh.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) c ${base}`).get(...p).c;
  const items = db.prepare(`SELECT c.*, u.name teacher_name,
    (SELECT COUNT(*) FROM classroom_students cs WHERE cs.classroom_id=c.id) students,
    (SELECT COUNT(*) FROM exams e WHERE e.classroom_id=c.id) exams,
    (SELECT COUNT(*) FROM exams e WHERE e.classroom_id=c.id AND e.status IN ('live','paused')) live_exams
    ${base} ORDER BY c.name LIMIT ? OFFSET ?`).all(...p, size, offset);
  res.json({ items, total, page, size });
}));
r.post('/classrooms', staff, w((req, res) => {
  const c = classroomInput(req.body);
  if (req.user.role === 'teacher') c.teacher_id = req.user.teacherId;
  if (c.teacher_id && !db.prepare('SELECT 1 FROM teachers WHERE id=?').get(c.teacher_id)) throw bad('Selected teacher does not exist.', { field: 'teacher_id' });
  const info = db.prepare(`INSERT INTO classrooms(name,section,subject,teacher_id,academic_year,description,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(c.name, c.section, c.subject, c.teacher_id, c.academic_year, c.description, now());
  audit(req.user, 'classroom.create', 'classroom', info.lastInsertRowid, c.name, null, c, req.ip);
  res.status(201).json({ id: info.lastInsertRowid });
}));
r.get('/classrooms/:id', staff, w((req, res) => {
  const id = +req.params.id;
  if (!canAccessClassroom(req.user, id)) throw forbidden();
  const c = db.prepare(`SELECT c.*, u.name teacher_name FROM classrooms c LEFT JOIN teachers t ON t.id=c.teacher_id LEFT JOIN users u ON u.id=t.user_id WHERE c.id=?`).get(id);
  if (!c) throw notFound('Classroom not found.');
  const students = db.prepare(`SELECT s.id, s.roll_no, u.name, u.email, s.section,
    (SELECT ROUND(AVG(a.percentage),1) FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=s.id AND e.classroom_id=? AND a.status IN ('submitted','time_expired','force_submitted')) avg
    FROM classroom_students cs JOIN students s ON s.id=cs.student_id JOIN users u ON u.id=s.user_id WHERE cs.classroom_id=? ORDER BY s.roll_no`).all(id, id);
  const exams = db.prepare(`SELECT id,name,status,start_at,end_at,duration_min,total_marks,results_released FROM exams WHERE classroom_id=? ORDER BY COALESCE(start_at,created_at) DESC`).all(id);
  const st = db.prepare(`SELECT ROUND(AVG(a.percentage),1) avg, ROUND(100.0*SUM(a.passed)/NULLIF(COUNT(*),0),0) pass FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE e.classroom_id=? AND a.status IN ('submitted','time_expired','force_submitted')`).get(id);
  res.json({ classroom: c, students, exams, stats: { students: students.length, exams: exams.length, avg: st.avg, pass: st.pass } });
}));
r.put('/classrooms/:id', staff, w((req, res) => {
  const id = +req.params.id;
  if (!canAccessClassroom(req.user, id)) throw forbidden();
  const old = db.prepare('SELECT * FROM classrooms WHERE id=?').get(id);
  if (!old) throw notFound('Classroom not found.');
  const c = classroomInput(req.body);
  if (req.user.role === 'teacher') c.teacher_id = old.teacher_id;
  db.prepare(`UPDATE classrooms SET name=?,section=?,subject=?,teacher_id=?,academic_year=?,description=? WHERE id=?`).run(c.name, c.section, c.subject, c.teacher_id, c.academic_year, c.description, id);
  audit(req.user, 'classroom.update', 'classroom', id, c.name, old, c, req.ip);
  res.json({ ok: true });
}));
r.delete('/classrooms/:id', requireRole('admin'), w((req, res) => {
  const id = +req.params.id;
  const old = db.prepare('SELECT * FROM classrooms WHERE id=?').get(id);
  if (!old) throw notFound('Classroom not found.');
  const att = db.prepare('SELECT COUNT(*) c FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE e.classroom_id=?').get(id).c;
  if (att) throw conflict(`This classroom has ${att} exam attempt(s) on record. Remove its exams' history is not allowed; archive its exams instead.`);
  db.prepare('DELETE FROM classrooms WHERE id=?').run(id);
  audit(req.user, 'classroom.delete', 'classroom', id, old.name, old, null, req.ip);
  res.json({ ok: true });
}));
r.post('/classrooms/:id/students', staff, w((req, res) => {
  const id = +req.params.id;
  if (!canAccessClassroom(req.user, id)) throw forbidden();
  const ids = (Array.isArray(req.body.studentIds) ? req.body.studentIds : [req.body.studentId]).map(Number).filter(Boolean);
  if (!ids.length) throw bad('Choose at least one student.');
  const ins = db.prepare('INSERT OR IGNORE INTO classroom_students(classroom_id,student_id) VALUES (?,?)');
  let added = 0;
  db.transaction(() => ids.forEach((s) => { if (db.prepare('SELECT 1 FROM students WHERE id=?').get(s)) added += ins.run(id, s).changes; }))();
  const c = db.prepare('SELECT name FROM classrooms WHERE id=?').get(id);
  audit(req.user, 'classroom.add_students', 'classroom', id, c.name, null, { studentIds: ids, added }, req.ip);
  res.json({ added });
}));
r.delete('/classrooms/:id/students/:sid', staff, w((req, res) => {
  const id = +req.params.id, sid = +req.params.sid;
  if (!canAccessClassroom(req.user, id)) throw forbidden();
  const info = db.prepare('DELETE FROM classroom_students WHERE classroom_id=? AND student_id=?').run(id, sid);
  if (info.changes) audit(req.user, 'classroom.remove_student', 'classroom', id, db.prepare('SELECT name FROM classrooms WHERE id=?').get(id)?.name, { studentId: sid }, null, req.ip);
  res.json({ ok: true });
}));

/* ================= teachers (admin) ================= */
r.get('/teachers', staff, w((req, res) => {
  const rows = db.prepare(`SELECT t.id, u.id user_id, u.name, u.email, u.active, t.department, t.phone,
    (SELECT COUNT(*) FROM classrooms c WHERE c.teacher_id=t.id) classrooms FROM teachers t JOIN users u ON u.id=t.user_id ORDER BY u.name`).all();
  res.json({ items: req.user.role === 'admin' ? rows : rows.map((x) => ({ id: x.id, name: x.name, department: x.department })) });
}));
r.post('/teachers', requireRole('admin'), w((req, res) => {
  const name = v.str(req.body, 'name', { req: true, max: 100, label: 'Name' }), email = v.email(req.body, 'email');
  const pw = v.str(req.body, 'password', { req: true, min: 8, max: 100, label: 'Password' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw conflict('That email is already in use.');
  const id = db.transaction(() => {
    const u = db.prepare(`INSERT INTO users(email,name,password_hash,role,created_at) VALUES (?,?,?,?,?)`).run(email, name, bcrypt.hashSync(pw, 10), 'teacher', now());
    return db.prepare('INSERT INTO teachers(user_id,department,phone) VALUES (?,?,?)').run(u.lastInsertRowid, v.str(req.body, 'department', { max: 100 }), v.str(req.body, 'phone', { max: 30 })).lastInsertRowid;
  })();
  audit(req.user, 'teacher.create', 'teacher', id, name, null, { name, email }, req.ip);
  res.status(201).json({ id });
}));
r.put('/teachers/:id', requireRole('admin'), w((req, res) => {
  const t = db.prepare('SELECT t.*, u.name, u.email, u.active FROM teachers t JOIN users u ON u.id=t.user_id WHERE t.id=?').get(+req.params.id);
  if (!t) throw notFound();
  const name = v.str(req.body, 'name', { req: true, max: 100 }), email = v.email(req.body, 'email');
  if (db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(email, t.user_id)) throw conflict('That email is already in use.');
  const active = v.bool(req.body, 'active', t.active);
  db.transaction(() => {
    db.prepare('UPDATE users SET name=?,email=?,active=? WHERE id=?').run(name, email, active, t.user_id);
    if (req.body.password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(v.str(req.body, 'password', { min: 8, max: 100 }), 10), t.user_id);
    db.prepare('UPDATE teachers SET department=?, phone=? WHERE id=?').run(v.str(req.body, 'department', { max: 100 }), v.str(req.body, 'phone', { max: 30 }), t.id);
  })();
  audit(req.user, 'teacher.update', 'teacher', t.id, name, { name: t.name, email: t.email, active: t.active }, { name, email, active }, req.ip);
  res.json({ ok: true });
}));
r.delete('/teachers/:id', requireRole('admin'), w((req, res) => {
  const t = db.prepare('SELECT t.*, u.name FROM teachers t JOIN users u ON u.id=t.user_id WHERE t.id=?').get(+req.params.id);
  if (!t) throw notFound();
  const n = db.prepare('SELECT COUNT(*) c FROM classrooms WHERE teacher_id=?').get(t.id).c;
  if (n) throw conflict(`${t.name} still teaches ${n} classroom(s). Reassign them first.`);
  db.prepare('DELETE FROM users WHERE id=?').run(t.user_id);
  audit(req.user, 'teacher.delete', 'teacher', t.id, t.name, { name: t.name }, null, req.ip);
  res.json({ ok: true });
}));

/* ================= students ================= */
function studentScope(req, wh, p) {
  if (req.user.role === 'teacher') { wh.push('s.id IN (SELECT student_id FROM classroom_students cs JOIN classrooms c ON c.id=cs.classroom_id WHERE c.teacher_id=?)'); p.push(req.user.teacherId || 0); }
}
function studentQuery(req) {
  const wh = ['1=1'], p = [];
  studentScope(req, wh, p);
  if (req.query.q) { wh.push(`(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR s.roll_no LIKE ? ESCAPE '\\')`); const l = like(req.query.q); p.push(l, l, l); }
  if (req.query.classroomId) { wh.push('s.id IN (SELECT student_id FROM classroom_students WHERE classroom_id=?)'); p.push(+req.query.classroomId); }
  if (req.query.section) { wh.push('s.section=?'); p.push(req.query.section); }
  return { where: wh.join(' AND '), p };
}
const SORTS = { name: 'u.name', roll_no: 's.roll_no', email: 'u.email', section: 's.section' };
r.get('/students', staff, w((req, res) => {
  const { size, page, offset } = paging(req, 15);
  const { where, p } = studentQuery(req);
  const sort = SORTS[req.query.sort] || 's.roll_no', dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const base = `FROM students s JOIN users u ON u.id=s.user_id WHERE ${where}`;
  const total = db.prepare(`SELECT COUNT(*) c ${base}`).get(...p).c;
  const items = db.prepare(`SELECT s.id, s.roll_no, s.section, s.phone, u.name, u.email, u.active,
    (SELECT GROUP_CONCAT(c.name, ', ') FROM classroom_students cs JOIN classrooms c ON c.id=cs.classroom_id WHERE cs.student_id=s.id) classrooms,
    (SELECT ROUND(AVG(a.percentage),1) FROM attempts a WHERE a.student_id=s.id AND a.status IN ('submitted','time_expired','force_submitted')) avg
    ${base} ORDER BY ${sort} ${dir}, s.id LIMIT ? OFFSET ?`).all(...p, size, offset);
  res.json({ items, total, page, size });
}));
function studentInput(b, partial) {
  return { name: v.str(b, 'name', { req: true, max: 100, label: 'Name' }), email: v.email(b, 'email'),
    roll_no: v.str(b, 'roll_no', { req: true, max: 30, label: 'Roll No.' }), section: v.str(b, 'section', { max: 30 }), phone: v.str(b, 'phone', { max: 30 }) };
}
function createStudent(s, classroomIds, pwHash) {
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(s.email)) throw conflict(`Email ${s.email} is already in use.`);
  if (db.prepare('SELECT 1 FROM students WHERE roll_no=?').get(s.roll_no)) throw conflict(`Roll No. ${s.roll_no} already exists.`);
  return db.transaction(() => {
    const u = db.prepare(`INSERT INTO users(email,name,password_hash,role,created_at) VALUES (?,?,?,?,?)`).run(s.email, s.name, pwHash, 'student', now());
    const st = db.prepare('INSERT INTO students(user_id,roll_no,section,phone,created_at) VALUES (?,?,?,?,?)').run(u.lastInsertRowid, s.roll_no, s.section, s.phone, now());
    classroomIds.forEach((c) => db.prepare('INSERT OR IGNORE INTO classroom_students VALUES (?,?)').run(c, st.lastInsertRowid));
    return st.lastInsertRowid;
  })();
}
function allowedClassrooms(req, ids) {
  ids = (ids || []).map(Number).filter(Boolean);
  ids.forEach((id) => { if (!canAccessClassroom(req.user, id)) throw forbidden('You can only add students to your own classrooms.'); });
  return ids;
}
r.post('/students', staff, w((req, res) => {
  const s = studentInput(req.body);
  const cls = allowedClassrooms(req, req.body.classroomIds);
  if (req.user.role === 'teacher' && !cls.length) throw bad('Choose one of your classrooms for this student.');
  const id = createStudent(s, cls, DEMO_PW_HASH());
  audit(req.user, 'student.create', 'student', id, s.name, null, { ...s, classroomIds: cls }, req.ip);
  res.status(201).json({ id, defaultPassword: 'Student@123' });
}));
function canSeeStudent(req, id) {
  if (req.user.role === 'admin') return true;
  return !!db.prepare('SELECT 1 FROM classroom_students cs JOIN classrooms c ON c.id=cs.classroom_id WHERE cs.student_id=? AND c.teacher_id=?').get(id, req.user.teacherId || 0);
}
r.get('/students/export', staff, w(async (req, res) => {
  const { where, p } = studentQuery(req);
  const rows = db.prepare(`SELECT s.roll_no, u.name, u.email, s.section, (SELECT GROUP_CONCAT(c.name,'; ') FROM classroom_students cs JOIN classrooms c ON c.id=cs.classroom_id WHERE cs.student_id=s.id) classrooms
    FROM students s JOIN users u ON u.id=s.user_id WHERE ${where} ORDER BY s.roll_no`).all(...p);
  const cols = [['roll_no', 'Roll No'], ['name', 'Name'], ['email', 'Email'], ['section', 'Section'], ['classrooms', 'Classrooms']];
  audit(req.user, 'student.export', 'student', null, `${rows.length} students`, null, { format: req.query.format || 'csv' }, req.ip);
  await sendTable(res, req.query.format, 'students', 'Students', cols.map(([key, label]) => ({ key, label })), rows);
}));
r.get('/students/:id', staff, w((req, res) => {
  const id = +req.params.id;
  if (!canSeeStudent(req, id)) throw forbidden();
  const s = db.prepare(`SELECT s.id,s.roll_no,s.section,s.phone,u.name,u.email,u.active,u.last_login,s.created_at FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?`).get(id);
  if (!s) throw notFound('Student not found.');
  const classrooms = db.prepare(`SELECT c.id,c.name,c.subject FROM classroom_students cs JOIN classrooms c ON c.id=cs.classroom_id WHERE cs.student_id=?`).all(id);
  const history = db.prepare(`SELECT a.id, a.attempt_no, a.status, a.started_at, a.ended_at, a.score, a.percentage, a.passed, a.restart_reason, e.id exam_id, e.name exam_name, e.total_marks
    FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND a.status<>'not_started' ORDER BY a.created_at DESC`).all(id);
  const fin = history.filter((h) => ['submitted', 'time_expired', 'force_submitted'].includes(h.status));
  res.json({ student: s, classrooms, history, stats: { exams: new Set(history.map((h) => h.exam_id)).size, avg: fin.length ? Math.round(fin.reduce((a, b) => a + b.percentage, 0) / fin.length * 10) / 10 : null, passed: fin.filter((h) => h.passed).length, taken: fin.length } });
}));
r.put('/students/:id', staff, w((req, res) => {
  const id = +req.params.id;
  if (!canSeeStudent(req, id)) throw forbidden();
  const old = db.prepare(`SELECT s.*, u.name, u.email FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?`).get(id);
  if (!old) throw notFound('Student not found.');
  const s = studentInput(req.body);
  if (db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(s.email, old.user_id)) throw conflict('That email is already in use.');
  if (db.prepare('SELECT 1 FROM students WHERE roll_no=? AND id<>?').get(s.roll_no, id)) throw conflict('That Roll No. already exists.');
  db.transaction(() => {
    db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(s.name, s.email, old.user_id);
    db.prepare('UPDATE students SET roll_no=?,section=?,phone=? WHERE id=?').run(s.roll_no, s.section, s.phone, id);
  })();
  audit(req.user, 'student.update', 'student', id, s.name, { name: old.name, email: old.email, roll_no: old.roll_no, section: old.section }, s, req.ip);
  res.json({ ok: true });
}));
r.delete('/students/:id', staff, w((req, res) => {
  const id = +req.params.id;
  if (!canSeeStudent(req, id)) throw forbidden();
  const old = db.prepare(`SELECT s.*, u.name FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?`).get(id);
  if (!old) throw notFound();
  const att = db.prepare('SELECT COUNT(*) c FROM attempts WHERE student_id=?').get(id).c;
  if (att) throw conflict(`${old.name} has ${att} exam attempt(s) on record, which are preserved. Remove the student from classrooms instead.`);
  db.prepare('DELETE FROM users WHERE id=?').run(old.user_id);
  audit(req.user, 'student.delete', 'student', id, old.name, { name: old.name, roll_no: old.roll_no }, null, req.ip);
  res.json({ ok: true });
}));

// CSV / Excel import
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
r.post('/students/import', staff, upload.single('file'), w(async (req, res) => {
  if (!req.file) throw bad('Choose a .csv or .xlsx file to import.');
  const name = (req.file.originalname || '').toLowerCase();
  let rows;
  if (name.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.file.buffer);
    rows = []; wb.worksheets[0].eachRow((row) => rows.push(row.values.slice(1).map((c) => (c && typeof c === 'object' ? c.text || c.result || '' : c ?? '')).map(String)));
  } else if (name.endsWith('.csv')) rows = parseCsv(req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''));
  else throw bad('Only .csv and .xlsx files are supported.');
  if (rows.length < 2) throw bad('The file has no data rows.');
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
  const idx = (...k) => head.findIndex((h) => k.includes(h));
  const iRoll = idx('rollno', 'roll', 'studentid', 'id'), iName = idx('name', 'studentname', 'fullname'), iEmail = idx('email'), iSec = idx('section', 'class', 'classsection'), iCls = idx('classroom');
  if (iRoll < 0 || iName < 0 || iEmail < 0) throw bad('Header row must include Roll No, Name and Email columns.');
  const fixedClass = req.body.classroomId ? +req.body.classroomId : null;
  if (fixedClass && !canAccessClassroom(req.user, fixedClass)) throw forbidden();
  const hash = DEMO_PW_HASH();
  const result = { created: 0, enrolled: 0, errors: [] };
  const myClasses = db.prepare(`SELECT id,name FROM classrooms ${req.user.role === 'teacher' ? 'WHERE teacher_id=' + (req.user.teacherId || 0) : ''}`).all();
  for (let i = 1; i < rows.length && i <= 1000; i++) {
    const c = rows[i];
    try {
      const s = { roll_no: (c[iRoll] || '').trim(), name: (c[iName] || '').trim(), email: (c[iEmail] || '').trim().toLowerCase(), section: iSec >= 0 ? (c[iSec] || '').trim() || null : null, phone: null };
      if (!s.roll_no || !s.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) throw new Error('Missing or invalid roll no, name or email');
      let cls = fixedClass ? [fixedClass] : [];
      if (iCls >= 0 && c[iCls]) { const m = myClasses.find((x) => x.name.toLowerCase() === c[iCls].trim().toLowerCase()); if (m) cls = [m.id]; }
      const existing = db.prepare('SELECT s.id FROM students s JOIN users u ON u.id=s.user_id WHERE u.email=? OR s.roll_no=?').get(s.email, s.roll_no);
      if (existing) { cls.forEach((k) => { result.enrolled += db.prepare('INSERT OR IGNORE INTO classroom_students VALUES (?,?)').run(k, existing.id).changes; }); if (!cls.length) throw new Error('Already exists'); continue; }
      if (req.user.role === 'teacher' && !cls.length) throw new Error('Choose a classroom for the import');
      createStudent(s, cls, hash); result.created++;
    } catch (e) { result.errors.push({ row: i + 1, message: e.message }); }
  }
  audit(req.user, 'student.import', 'student', null, req.file.originalname, null, { created: result.created, errors: result.errors.length }, req.ip);
  res.json(result);
}));

/* ================= export helper (CSV / XLSX / PDF) ================= */
async function sendTable(res, format, filename, title, columns, rows) {
  format = ['csv', 'xlsx', 'pdf'].includes(format) ? format : 'csv';
  const cell = (x) => (x == null ? '' : x);
  if (format === 'csv') {
    const esc = (x) => { let s = String(cell(x)); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send('\uFEFF' + [columns.map((c) => esc(c.label)).join(','), ...rows.map((rw) => columns.map((c) => esc(rw[c.key])).join(','))].join('\n'));
  }
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(title.slice(0, 30));
    ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17372F' } };
    rows.forEach((rw) => ws.addRow(columns.reduce((o, c) => (o[c.key] = cell(rw[c.key]), o), {})));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    await wb.xlsx.write(res); return res.end();
  }
  const PDF = require('pdfkit');
  const doc = new PDF({ margin: 36, size: 'A4', layout: columns.length > 6 ? 'landscape' : 'portrait' });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);
  doc.fontSize(16).fillColor('#17372F').text(title); doc.fontSize(8).fillColor('#666').text(`Generated ${new Date().toLocaleString('en-IN')}`); doc.moveDown();
  const width = doc.page.width - 72, cw = width / columns.length;
  const drawRow = (vals, bold) => {
    const y = doc.y; const h = 16;
    if (y + h > doc.page.height - 40) { doc.addPage(); }
    const yy = doc.y;
    if (bold) doc.rect(36, yy - 2, width, h).fill('#17372F');
    doc.fillColor(bold ? '#fff' : '#111').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    vals.forEach((t, i) => doc.text(String(cell(t)), 40 + i * cw, yy + 2, { width: cw - 6, height: 12, ellipsis: true, lineBreak: false }));
    doc.y = yy + h;
  };
  drawRow(columns.map((c) => c.label), true);
  rows.forEach((rw) => drawRow(columns.map((c) => rw[c.key]), false));
  doc.end();
}

/* ================= question bank ================= */
r.get('/questions', staff, w((req, res) => {
  const { size, page, offset } = paging(req, 15);
  const wh = ['q.deleted=0'], p = [];
  if (req.query.q) { wh.push(`(q.text LIKE ? ESCAPE '\\' OR q.topic LIKE ? ESCAPE '\\')`); p.push(like(req.query.q), like(req.query.q)); }
  for (const k of ['subject', 'topic', 'type', 'difficulty']) if (req.query[k]) { wh.push(`q.${k}=?`); p.push(req.query[k]); }
  if (req.query.mine === '1') { wh.push('q.created_by=?'); p.push(req.user.id); }
  const total = db.prepare(`SELECT COUNT(*) c FROM questions q WHERE ${wh.join(' AND ')}`).get(...p).c;
  const items = db.prepare(`SELECT q.*, u.name author FROM questions q LEFT JOIN users u ON u.id=q.created_by WHERE ${wh.join(' AND ')} ORDER BY q.id DESC LIMIT ? OFFSET ?`).all(...p, size, offset)
    .map((x) => ({ ...x, options: J(x.options), correct: J(x.correct), editable: req.user.role === 'admin' || x.created_by === req.user.id }));
  const subjects = db.prepare('SELECT DISTINCT subject FROM questions WHERE deleted=0 AND subject IS NOT NULL ORDER BY subject').all().map((x) => x.subject);
  const topics = db.prepare('SELECT DISTINCT topic FROM questions WHERE deleted=0 AND topic IS NOT NULL ORDER BY topic').all().map((x) => x.topic);
  res.json({ items, total, page, size, subjects, topics });
}));
r.post('/questions', staff, w((req, res) => {
  const q = core.normalizeQuestion(req.body); const [o, c] = core.enc(q);
  const info = db.prepare(`INSERT INTO questions(subject,topic,type,text,options,correct,marks,negative_marks,difficulty,explanation,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(q.subject, q.topic, q.type, q.text, o, c, q.marks, q.negative_marks, q.difficulty, q.explanation, req.user.id, now(), now());
  audit(req.user, 'question.create', 'question', info.lastInsertRowid, q.text.slice(0, 80), null, q, req.ip);
  res.status(201).json({ id: info.lastInsertRowid });
}));
function ownQuestion(req) {
  const q = db.prepare('SELECT * FROM questions WHERE id=? AND deleted=0').get(+req.params.id);
  if (!q) throw notFound('Question not found.');
  if (req.user.role !== 'admin' && q.created_by !== req.user.id) throw forbidden('You can only change questions you created. Duplicate it to make your own copy.');
  return q;
}
r.put('/questions/:id', staff, w((req, res) => {
  const old = ownQuestion(req); const q = core.normalizeQuestion(req.body); const [o, c] = core.enc(q);
  db.prepare(`UPDATE questions SET subject=?,topic=?,type=?,text=?,options=?,correct=?,marks=?,negative_marks=?,difficulty=?,explanation=?,updated_at=? WHERE id=?`)
    .run(q.subject, q.topic, q.type, q.text, o, c, q.marks, q.negative_marks, q.difficulty, q.explanation, now(), old.id);
  audit(req.user, 'question.update', 'question', old.id, q.text.slice(0, 80), { text: old.text, marks: old.marks, correct: J(old.correct) }, { text: q.text, marks: q.marks, correct: q.correct }, req.ip);
  res.json({ ok: true });
}));
r.post('/questions/:id/duplicate', staff, w((req, res) => {
  const old = db.prepare('SELECT * FROM questions WHERE id=? AND deleted=0').get(+req.params.id);
  if (!old) throw notFound();
  const info = db.prepare(`INSERT INTO questions(subject,topic,type,text,options,correct,marks,negative_marks,difficulty,explanation,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(old.subject, old.topic, old.type, old.text, old.options, old.correct, old.marks, old.negative_marks, old.difficulty, old.explanation, req.user.id, now(), now());
  audit(req.user, 'question.duplicate', 'question', info.lastInsertRowid, old.text.slice(0, 80), { from: old.id }, null, req.ip);
  res.status(201).json({ id: info.lastInsertRowid });
}));
r.delete('/questions/:id', staff, w((req, res) => {
  const old = ownQuestion(req);
  db.prepare('UPDATE questions SET deleted=1, updated_at=? WHERE id=?').run(now(), old.id);
  audit(req.user, 'question.delete', 'question', old.id, old.text.slice(0, 80), { text: old.text }, null, req.ip);
  res.json({ ok: true });
}));

/* ================= notifications / logs / settings / profile ================= */
r.get('/notifications', w((req, res) => {
  const { size, page, offset } = paging(req, 20);
  const total = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=?').get(req.user.id).c;
  const items = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?').all(req.user.id, size, offset);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0').get(req.user.id).c;
  res.json({ items, total, page, size, unread });
}));
r.post('/notifications/read', w((req, res) => {
  if (req.body.all) db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
  else (Array.isArray(req.body.ids) ? req.body.ids : []).forEach((id) => db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(+id, req.user.id));
  res.json({ ok: true });
}));
r.get('/audit-logs', staff, w((req, res) => {
  const { size, page, offset } = paging(req, 25);
  const wh = ['1=1'], p = [];
  if (req.user.role === 'teacher') { wh.push('user_id=?'); p.push(req.user.id); }
  if (req.query.q) { wh.push(`(user_name LIKE ? ESCAPE '\\' OR target_label LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\')`); const l = like(req.query.q); p.push(l, l, l); }
  if (req.query.action) { wh.push('action LIKE ?'); p.push(req.query.action + '%'); }
  if (req.query.from) { wh.push('created_at>=?'); p.push(+req.query.from); }
  if (req.query.to) { wh.push('created_at<=?'); p.push(+req.query.to); }
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE ${wh.join(' AND ')}`).get(...p).c;
  const items = db.prepare(`SELECT * FROM audit_logs WHERE ${wh.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, size, offset).map((x) => ({ ...x, old_data: J(x.old_data), new_data: J(x.new_data) }));
  res.json({ items, total, page, size });
}));
r.get('/settings', w((req, res) => res.json(getSettings())));
r.put('/settings', requireRole('admin'), w((req, res) => {
  const old = getSettings(), out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (req.body[k] === undefined) continue;
    const val = String(req.body[k]).trim().slice(0, 120);
    if (!val) throw bad(`${k.replace(/_/g, ' ')} cannot be empty.`);
    if (['default_duration', 'idle_seconds', 'session_hours', 'reminder_minutes'].includes(k) && !(Number(val) > 0)) throw bad(`${k.replace(/_/g, ' ')} must be a positive number.`);
    out[k] = val; db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, val);
  }
  audit(req.user, 'settings.update', 'settings', null, 'System settings', old, { ...old, ...out }, req.ip);
  res.json(getSettings());
}));
r.put('/me', w((req, res) => {
  const name = v.str(req.body, 'name', { req: true, max: 100, label: 'Name' });
  db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user.id);
  audit(req.user, 'profile.update', 'user', req.user.id, name, { name: req.user.name }, { name }, req.ip);
  res.json({ ok: true });
}));

module.exports = { router: r, sendTable, w, paging, like, scopeIds, inList };
