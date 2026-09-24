'use strict';
const crypto = require('crypto');
const db = require('./db');

const now = () => Date.now();
const J = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
const S = (o) => (o === undefined || o === null ? null : JSON.stringify(o));

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const bad = (m, d) => new HttpError(400, m, d);
const forbidden = (m = 'You do not have permission to do this.') => new HttpError(403, m);
const notFound = (m = 'Not found.') => new HttpError(404, m);
const conflict = (m) => new HttpError(409, m);

/* ---------- validation ---------- */
const v = {
  str(o, k, { req = false, min = 0, max = 500, label = k } = {}) {
    let x = o[k];
    if (x === undefined || x === null || x === '') {
      if (req) throw bad(`${label} is required.`, { field: k });
      return null;
    }
    if (typeof x !== 'string' && typeof x !== 'number') throw bad(`${label} is invalid.`, { field: k });
    x = String(x).trim();
    if (req && !x) throw bad(`${label} is required.`, { field: k });
    if (x.length < min) throw bad(`${label} must be at least ${min} characters.`, { field: k });
    if (x.length > max) throw bad(`${label} must be at most ${max} characters.`, { field: k });
    return x;
  },
  num(o, k, { req = false, min = -Infinity, max = Infinity, label = k, def = null } = {}) {
    let x = o[k];
    if (x === undefined || x === null || x === '') {
      if (req) throw bad(`${label} is required.`, { field: k });
      return def;
    }
    x = Number(x);
    if (!Number.isFinite(x)) throw bad(`${label} must be a number.`, { field: k });
    if (x < min || x > max) throw bad(`${label} must be between ${min} and ${max}.`, { field: k });
    return x;
  },
  int(o, k, opts = {}) {
    const x = v.num(o, k, opts);
    if (x !== null && !Number.isInteger(x)) throw bad(`${opts.label || k} must be a whole number.`, { field: k });
    return x;
  },
  bool(o, k, def = 0) { const x = o[k]; if (x === undefined || x === null) return def; return x === true || x === 1 || x === '1' || x === 'true' ? 1 : 0; },
  oneOf(o, k, list, { req = false, def = null, label = k } = {}) {
    const x = o[k];
    if (x === undefined || x === null || x === '') { if (req) throw bad(`${label} is required.`, { field: k }); return def; }
    if (!list.includes(x)) throw bad(`${label} must be one of: ${list.join(', ')}.`, { field: k });
    return x;
  },
  email(o, k, { req = true } = {}) {
    const x = v.str(o, k, { req, max: 200, label: 'Email' });
    if (x && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) throw bad('Enter a valid email address.', { field: k });
    return x ? x.toLowerCase() : x;
  },
};

/* ---------- audit + notifications ---------- */
function audit(user, action, targetType, targetId, label, oldData, newData, ip, at) {
  db.prepare(`INSERT INTO audit_logs(user_id,user_name,role,action,target_type,target_id,target_label,old_data,new_data,ip,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(user?.id ?? null, user?.name ?? 'System', user?.role ?? 'system', action,
    targetType || null, targetId == null ? null : String(targetId), label ?? null, S(oldData), S(newData), ip ?? null, at || now());
}

/* ---------- realtime hub ---------- */
const hub = {
  clients: new Set(),
  add(c) { this.clients.add(c); },
  remove(c) { this.clients.delete(c); },
  sendTo(pred, msg) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.ws.readyState === 1 && pred(c.user)) { try { c.ws.send(data); } catch { /* ignore */ } }
    }
  },
  toUsers(userIds, msg) { const set = new Set(userIds); this.sendTo((u) => set.has(u.id), msg); },
  _timers: new Map(),
  // staff who can see exam: admins + classroom teacher. Coalesced so bursts don't flood.
  monitor(examId, extra = {}) {
    if (this._timers.has(examId)) return;
    this._timers.set(examId, setTimeout(() => {
      this._timers.delete(examId);
      const row = db.prepare(`SELECT t.user_id tuid FROM exams e JOIN classrooms c ON c.id=e.classroom_id LEFT JOIN teachers t ON t.id=c.teacher_id WHERE e.id=?`).get(examId);
      this.sendTo((u) => u.role === 'admin' || (row && u.id === row.tuid), { type: 'monitor', examId, ...extra });
    }, 400));
  },
};

function notify(userIds, { title, body, type = 'info', link = null }) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  const ins = db.prepare('INSERT INTO notifications(user_id,title,body,type,link,read,created_at) VALUES (?,?,?,?,?,0,?)');
  const t = now();
  db.transaction(() => ids.forEach((id) => ins.run(id, title, body, type, link, t)))();
  for (const id of ids) hub.toUsers([id], { type: 'notification', title, body, ntype: type, link });
}

const classroomStudentUserIds = (classroomId) =>
  db.prepare(`SELECT s.user_id id FROM classroom_students cs JOIN students s ON s.id=cs.student_id WHERE cs.classroom_id=?`).all(classroomId).map((r) => r.id);
const adminIds = () => db.prepare(`SELECT id FROM users WHERE role='admin' AND active=1`).all().map((r) => r.id);

/* ---------- settings ---------- */
const DEFAULT_SETTINGS = {
  school_name: 'Riverside Public School',
  academic_year: '2026-27',
  default_duration: '60',
  idle_seconds: '90',
  session_hours: '8',
  reminder_minutes: '30',
};
function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = r.value;
  return out;
}

/* ---------- misc ---------- */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randId = (n = 5) => crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, 'x').slice(0, n).toLowerCase();
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seed) {
  const a = [...arr]; const r = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

module.exports = { now, J, S, HttpError, bad, forbidden, notFound, conflict, v, audit, hub, notify,
  classroomStudentUserIds, adminIds, getSettings, DEFAULT_SETTINGS, sha, randId, seededShuffle, mulberry32 };
