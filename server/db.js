'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'examhub.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','teacher','student')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS teachers(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  department TEXT, phone TEXT
);
CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  roll_no TEXT NOT NULL UNIQUE,
  section TEXT, phone TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS classrooms(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  section TEXT, subject TEXT NOT NULL,
  teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  academic_year TEXT, description TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS classroom_students(
  classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY(classroom_id, student_id)
);
CREATE TABLE IF NOT EXISTS questions(
  id INTEGER PRIMARY KEY,
  subject TEXT, topic TEXT,
  type TEXT NOT NULL CHECK(type IN ('mcq','multi','tf','short','long')),
  text TEXT NOT NULL,
  options TEXT, correct TEXT,
  marks REAL NOT NULL DEFAULT 1,
  negative_marks REAL NOT NULL DEFAULT 0,
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
  explanation TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS exams(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, description TEXT, instructions TEXT,
  classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  subject TEXT,
  start_at INTEGER, end_at INTEGER,
  duration_min INTEGER NOT NULL DEFAULT 60,
  total_marks REAL NOT NULL DEFAULT 0,
  passing_marks REAL NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  negative_marking INTEGER NOT NULL DEFAULT 0,
  shuffle_questions INTEGER NOT NULL DEFAULT 0,
  shuffle_options INTEGER NOT NULL DEFAULT 0,
  release_mode TEXT NOT NULL DEFAULT 'manual' CHECK(release_mode IN ('manual','on_completion')),
  show_answers INTEGER NOT NULL DEFAULT 1,
  results_released INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','live','paused','completed','archived')),
  paused_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exam_questions(
  id INTEGER PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  source_question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL, text TEXT NOT NULL,
  options TEXT, correct TEXT,
  marks REAL NOT NULL DEFAULT 1,
  negative_marks REAL NOT NULL DEFAULT 0,
  difficulty TEXT, topic TEXT, explanation TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exam_changes(
  id INTEGER PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER, user_name TEXT,
  entity TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL,
  field TEXT, old_value TEXT, new_value TEXT,
  exam_version INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts(
  id INTEGER PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','in_progress','submitted','time_expired','force_submitted','restarted')),
  started_at INTEGER, ended_at INTEGER, deadline_at INTEGER,
  paused_at INTEGER, pause_reason TEXT,
  extra_ms INTEGER NOT NULL DEFAULT 0,
  question_order TEXT, seed INTEGER NOT NULL DEFAULT 1,
  shuffle_q INTEGER NOT NULL DEFAULT 0, shuffle_o INTEGER NOT NULL DEFAULT 0,
  current_q INTEGER NOT NULL DEFAULT 0,
  last_activity INTEGER,
  score REAL, correct_count INTEGER, wrong_count INTEGER, unanswered_count INTEGER,
  percentage REAL, passed INTEGER, needs_manual INTEGER NOT NULL DEFAULT 0,
  evaluated_at INTEGER,
  restart_reason TEXT, restarted_by INTEGER, restart_of INTEGER,
  end_reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(exam_id, student_id, attempt_no)
);
CREATE TABLE IF NOT EXISTS answers(
  id INTEGER PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  exam_question_id INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  answer TEXT, review INTEGER NOT NULL DEFAULT 0, visited INTEGER NOT NULL DEFAULT 0,
  marks_awarded REAL, is_correct INTEGER,
  feedback TEXT, graded_by INTEGER, graded_at INTEGER,
  client_ts INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  UNIQUE(attempt_id, exam_question_id)
);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT, type TEXT, link TEXT,
  read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs(
  id INTEGER PRIMARY KEY,
  user_id INTEGER, user_name TEXT, role TEXT,
  action TEXT NOT NULL, target_type TEXT, target_id TEXT, target_label TEXT,
  old_data TEXT, new_data TEXT, ip TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, ip TEXT, user_agent TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);

CREATE INDEX IF NOT EXISTS idx_attempts_exam ON attempts(exam_id, status);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_eq_exam ON exam_questions(exam_id, removed, position);
CREATE INDEX IF NOT EXISTS idx_exams_class ON exams(classroom_id, status);
CREATE INDEX IF NOT EXISTS idx_q_subject ON questions(subject, topic, deleted);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at);
CREATE INDEX IF NOT EXISTS idx_changes_exam ON exam_changes(exam_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_cs_student ON classroom_students(student_id);
`);

module.exports = db;
