# Proctor: Classroom & Online Exam Management

A full-stack exam platform with three role-based portals (Admin, Teacher, Student), live monitoring over WebSockets, and real-time exam controls (edit a live exam, restart one or all students, pause, extend, force submit) that never lose answers or delete attempt history.

**Stack:** Node.js 20+, Express, SQLite (better-sqlite3), `ws`, vanilla ES-module front end (no build step).

## Run it

```bash
npm install
npm start            # http://localhost:3000  (PORT=8080 npm start to change)
```

The first start creates `data/examhub.db` and loads demo data (4 classrooms, 44 students, 9 exams, 48 questions, one exam **live right now**, completed exams with results and attempt history, audit logs).
`npm run reseed` wipes and reloads the demo data. `npm test` runs the API flow test against a running server (`BASE=http://localhost:3000`).

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@school.edu | Admin@123 |
| Teacher | priya.nair@school.edu | Teacher@123 |
| Student | aarav.sharma@student.school.edu | Student@123 |

Other teachers: arjun.mehta@school.edu, farah.khan@school.edu (same password). Every student uses `Student@123`.

**Suggested demo:** open the teacher in one window and Aarav (student) in another. The Physics exam is live. Start it as Aarav, answer some questions, then use the teacher's Live monitor to pause, extend time, edit a question (you'll get the live-edit warning), and restart Aarav.

## How the critical live controls work

* **Server is the clock.** Each attempt has a server `deadline_at`. The browser timer is display-only; `sync`/`submit` are validated against server time (5 s grace), and a server ticker (every 2 s) auto-submits expired attempts even if the student's browser is gone.
* **Pause / resume** freeze time for the whole exam or one student; on resume the deadline shifts by the paused duration so no time is lost. Answers are never discarded.
* **Live editing** works on an exam-specific copy of each question (`exam_questions`). Answers are keyed by question id and option id, so editing text/options/marks/correct answer can't corrupt them. Every change bumps `exams.version`, is written to `exam_changes` (who, what, old, new, when) and the audit log, and finished attempts are re-evaluated (manual marks preserved). The API answers `409 LIVE_EDIT_WARNING` until the client confirms. Removing a question soft-removes it so answers stay in history. Question *type* can't change once students have started.
* **Restart one student** creates a new attempt (new ID, next attempt no.), marks the old one `restarted` with the reason and who did it, and resets only that student. Options: same/new question set, clear or carry over answers.
* **Restart all** requires typing `RESTART ALL`, shows affected counts, ends in-progress attempts, creates new `not_started` attempts for everyone, and never deletes anything. The start window is extended if needed.
* **Auto-save & offline:** answers sync ~1 s after each change plus a 5 s heartbeat, with last-write-wins per question by client timestamp. Every change is also stored in `localStorage` and re-sent after a reconnect or page reload.
* **Results** are hidden from students until the teacher/admin publishes them (or the exam's "publish automatically when it ends" setting fires).

## Security

Password hashing (bcrypt), server-side sessions (random 256-bit id, only a SHA-256 stored, HttpOnly + SameSite=Lax cookie; set `COOKIE_SECURE=1` behind HTTPS), CSRF token on every state-changing request plus Origin check, role checks on every route with per-classroom ownership checks for teachers, parameterised SQL throughout, input validation, rate limiting (general and login) with account lockout, Helmet CSP (no inline scripts), auto-escaping HTML templating on the client, CSV-formula neutralisation in exports, and correct answers are never sent to students during an exam. Behind a proxy set `TRUST_PROXY=1`.

## Project layout

```
server/  db.js (schema) · core.js (grading, timers, attempts, monitor) · auth.js · routes-*.js · seed.js · sim.js · index.js
public/  index.html · css/app.css · js/ (app, core, pages-a/b/c, student, exam-taker, charts)
tests/   api-flow.test.js
```

`server/sim.js` keeps seeded demo students moving on the live exam so the monitor looks alive; disable with `DEMO_SIM=0`.

## Notes

* Total marks are calculated from an exam's questions (the form shows the current total) rather than typed in, so they can never disagree with the questions.
* A teacher's "maximum attempts" counts completed attempts; restarts by staff don't consume a student's attempts.
* Google Fonts are loaded from the CDN with system-font fallbacks, so the app also works offline.
