'use strict';
// Demo-only: keeps seeded students on the live exam "moving" so the monitor looks alive.
const db = require('./db');
const core = require('./core');
const { now, S, J } = require('./lib');

function step() {
  if (process.env.DEMO_SIM === '0') return;
  const on = db.prepare(`SELECT value FROM settings WHERE key='demo_sim'`).get();
  if (!on || on.value !== '1') return;
  const t = now();
  const rows = db.prepare(`SELECT a.* FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN students s ON s.id=a.student_id JOIN users u ON u.id=s.user_id
    WHERE a.status='in_progress' AND a.paused_at IS NULL AND e.status='live' AND a.last_activity>? AND u.email LIKE '%@student.school.edu' AND u.email<>'aarav.sharma@student.school.edu'`).all(t - 60000);
  for (const a of rows) {
    if (Math.random() < 0.4) continue;
    db.prepare('UPDATE attempts SET last_activity=? WHERE id=?').run(t, a.id);
    if (Math.random() < 0.3) {
      const eqs = core.activeQuestions(a.exam_id);
      const done = new Set(db.prepare('SELECT exam_question_id id FROM answers WHERE attempt_id=? AND answer IS NOT NULL').all(a.id).map((r) => r.id));
      const idx = eqs.findIndex((q) => !done.has(q.id));
      if (idx === -1) { if (Math.random() < 0.15) core.finalizeAttempt(a.id, 'submitted', { reason: 'demo' }); continue; }
      const q = eqs[idx]; let ans;
      const good = Math.random() < 0.7;
      if (q.type === 'mcq' || q.type === 'tf') ans = good ? q.correct : q.options.find((o) => o.id !== q.correct).id;
      else if (q.type === 'multi') ans = good ? q.correct : q.correct.slice(0, 1);
      else if (q.type === 'short') ans = good && q.correct.length ? q.correct[0] : 'not sure';
      else ans = 'Every action has an equal and opposite reaction, for example a rocket launching.';
      db.prepare(`INSERT INTO answers(attempt_id,exam_question_id,answer,visited,client_ts,updated_at) VALUES (?,?,?,1,?,?) ON CONFLICT(attempt_id,exam_question_id) DO UPDATE SET answer=excluded.answer`).run(a.id, q.id, S(ans), t, t);
      db.prepare('UPDATE attempts SET current_q=? WHERE id=?').run(Math.min(idx + 1, eqs.length - 1), a.id);
    }
    require('./lib').hub.monitor(a.exam_id);
  }
}
module.exports = { start: () => setInterval(() => { try { step(); } catch (e) { console.error('sim', e.message); } }, 4000) };
