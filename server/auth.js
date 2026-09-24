'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { now, HttpError, bad, forbidden, v, audit, sha, getSettings } = require('./lib');

const COOKIE = 'sid';
const failed = new Map(); // email -> {n, until}

function cookieOpts(maxAge) {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', path: '/', maxAge };
}

function createSession(res, user, req) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const hours = Number(getSettings().session_hours || 8);
  const exp = now() + hours * 3600000;
  db.prepare('INSERT INTO sessions(id,user_id,csrf,ip,user_agent,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
    .run(sha(sid), user.id, csrf, req.ip, String(req.headers['user-agent'] || '').slice(0, 200), now(), exp);
  res.cookie(COOKIE, sid, cookieOpts(hours * 3600000));
  return csrf;
}

function loadUser(sid) {
  if (!sid) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE id=?').get(sha(sid));
  if (!s || s.expires_at < now()) { if (s) db.prepare('DELETE FROM sessions WHERE id=?').run(s.id); return null; }
  const u = db.prepare('SELECT id,email,name,role,active FROM users WHERE id=?').get(s.user_id);
  if (!u || !u.active) return null;
  if (u.role === 'teacher') u.teacherId = db.prepare('SELECT id FROM teachers WHERE user_id=?').get(u.id)?.id;
  if (u.role === 'student') u.studentId = db.prepare('SELECT id FROM students WHERE user_id=?').get(u.id)?.id;
  // sliding expiry (refresh at most once a minute)
  if (s.expires_at - now() < (Number(getSettings().session_hours || 8) * 3600000 - 60000))
    db.prepare('UPDATE sessions SET expires_at=? WHERE id=?').run(now() + Number(getSettings().session_hours || 8) * 3600000, s.id);
  return { user: u, csrf: s.csrf, sid: s.id };
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}

// Attach req.user (if any)
function attach(req, res, next) {
  const s = loadUser(req.cookies?.[COOKIE]);
  if (s) { req.user = s.user; req.csrf = s.csrf; req.sessionId = s.sid; }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return next(forbidden('Cross-site request blocked.'));
    if (req.headers['x-csrf-token'] !== req.csrf) return next(forbidden('Security token missing or expired. Refresh the page and try again.'));
  }
  next();
}
const requireRole = (...roles) => (req, res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
const staff = requireRole('admin', 'teacher');

/* ---------- ownership checks for teachers ---------- */
function canAccessClassroom(user, classroomId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'teacher') return false;
  return !!db.prepare('SELECT 1 FROM classrooms WHERE id=? AND teacher_id=?').get(classroomId, user.teacherId);
}
function loadExamFor(user, id) {
  const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(id);
  if (!exam) throw new HttpError(404, 'Exam not found.');
  if (!canAccessClassroom(user, exam.classroom_id)) throw forbidden('This exam belongs to another teacher\'s classroom.');
  return exam;
}
function loadAttemptFor(user, id) {
  const att = db.prepare('SELECT * FROM attempts WHERE id=?').get(id);
  if (!att) throw new HttpError(404, 'Attempt not found.');
  const exam = loadExamFor(user, att.exam_id);
  return { att, exam };
}
const teacherScopeSql = (user, alias = 'c') => (user.role === 'teacher' ? ` AND ${alias}.teacher_id=${Number(user.teacherId) || 0}` : '');

/* ---------- login / logout ---------- */
function login(req, res) {
  const email = v.email(req.body, 'email');
  const password = String(req.body.password || '');
  if (!password) throw bad('Password is required.', { field: 'password' });
  const f = failed.get(email);
  if (f && f.until > now()) throw new HttpError(429, `Too many failed attempts. Try again in ${Math.ceil((f.until - now()) / 60000)} minute(s).`);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = u && u.active && bcrypt.compareSync(password, u.password_hash);
  if (!ok) {
    const n = (f?.n || 0) + 1;
    failed.set(email, { n, until: n >= 8 ? now() + 5 * 60000 : 0 });
    audit(u ? { id: u.id, name: u.name, role: u.role } : null, 'auth.login_failed', 'user', u?.id, email, null, null, req.ip);
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  failed.delete(email);
  db.prepare('UPDATE users SET last_login=? WHERE id=?').run(now(), u.id);
  const csrf = createSession(res, u, req);
  audit(u, 'auth.login', 'user', u.id, u.email, null, null, req.ip);
  res.json({ user: publicUser(u), csrf });
}
function publicUser(u) {
  const o = { id: u.id, name: u.name, email: u.email, role: u.role };
  if (u.role === 'student') { const s = db.prepare('SELECT id,roll_no,section FROM students WHERE user_id=?').get(u.id); if (s) Object.assign(o, { studentId: s.id, roll_no: s.roll_no, section: s.section }); }
  if (u.role === 'teacher') { const t = db.prepare('SELECT id,department FROM teachers WHERE user_id=?').get(u.id); if (t) Object.assign(o, { teacherId: t.id, department: t.department }); }
  return o;
}
function logout(req, res) {
  if (req.user) audit(req.user, 'auth.logout', 'user', req.user.id, req.user.email, null, null, req.ip);
  if (req.sessionId) db.prepare('DELETE FROM sessions WHERE id=?').run(req.sessionId);
  res.clearCookie(COOKIE, cookieOpts(0));
  res.json({ ok: true });
}
function changePassword(req, res) {
  const cur = String(req.body.current || ''), next = String(req.body.next || '');
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(cur, u.password_hash)) throw bad('Current password is incorrect.', { field: 'current' });
  if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) throw bad('New password needs 8+ characters with letters and numbers.', { field: 'next' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(next, 10), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(u.id, req.sessionId);
  audit(req.user, 'auth.password_change', 'user', u.id, u.email, null, null, req.ip);
  res.json({ ok: true });
}

module.exports = { COOKIE, attach, requireAuth, requireRole, staff, canAccessClassroom, loadExamFor, loadAttemptFor, teacherScopeSql, login, logout, changePassword, publicUser, parseCookies, loadUser };
