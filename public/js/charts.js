import { html, raw, esc } from './core.js';

export function columns(items, { max = 100, unit = '%', alt = false, empty = 'No data yet' } = {}) {
  if (!items.length) return html`<p class="muted small" style="padding:40px 0;text-align:center">${empty}</p>`;
  return html`<div class="cols" role="img" aria-label="Bar chart">${items.map((i) => html`<div class="col" title="${i.title || i.label}">
    <span class="v">${i.value == null ? '–' : i.value + unit}</span>
    <div style="flex:1;width:100%;display:flex;align-items:flex-end;justify-content:center;min-height:0"><div class="b ${i.alt || alt ? 'alt' : ''}" style="height:${Math.max(2, Math.min(100, ((i.value || 0) / max) * 100))}%"></div></div>
    <span class="l">${i.label}</span></div>`)}</div>`;
}

export function donut(parts, center) {
  const total = parts.reduce((a, b) => a + b.value, 0) || 1; let acc = 0;
  const stops = parts.filter((p) => p.value > 0).map((p) => { const from = (acc / total) * 100; acc += p.value; return `${p.color} ${from}% ${(acc / total) * 100}%`; });
  return raw(`<div class="donut" data-c="${esc(center)}" style="background:conic-gradient(${stops.length ? stops.join(',') : 'var(--line) 0 100%'})"></div>`);
}

const VERBS = {
  'auth.login': 'signed in', 'auth.logout': 'signed out', 'auth.login_failed': 'had a failed sign-in', 'auth.password_change': 'changed their password',
  'classroom.create': 'created classroom', 'classroom.update': 'updated classroom', 'classroom.delete': 'deleted classroom', 'classroom.add_students': 'added students to', 'classroom.remove_student': 'removed a student from',
  'student.create': 'added student', 'student.update': 'updated student', 'student.delete': 'deleted student', 'student.import': 'imported students from', 'student.export': 'exported',
  'teacher.create': 'added teacher', 'teacher.update': 'updated teacher', 'teacher.delete': 'removed teacher',
  'question.create': 'created question', 'question.update': 'edited question', 'question.delete': 'deleted question', 'question.duplicate': 'duplicated question',
  'exam.create': 'created exam', 'exam.update': 'updated exam', 'exam.delete': 'deleted exam', 'exam.schedule': 'scheduled', 'exam.unschedule': 'unscheduled', 'exam.start': 'started', 'exam.pause': 'paused', 'exam.resume': 'resumed',
  'exam.force_end': 'ended', 'exam.complete': 'completed', 'exam.archive': 'archived', 'exam.unarchive': 'unarchived', 'exam.live_edit': 'edited live exam', 'exam.question_update': 'edited a question in', 'exam.question_remove': 'removed a question from', 'exam.questions_add': 'added questions to', 'exam.reorder': 'reordered questions in',
  'exam.restart_all': 'restarted for all students:', 'attempt.restart': 'restarted attempt for', 'attempt.pause': 'paused', 'attempt.resume': 'resumed', 'attempt.extend_time': 'extended time for', 'attempt.force_submit': 'force-submitted', 'attempt.submit': 'submitted', 'attempt.start': 'started', 'attempt.time_expired': 'ran out of time on',
  'mark.change': 'changed marks for', 'results.publish': 'published results for', 'results.unpublish': 'unpublished results for', 'settings.update': 'updated', 'profile.update': 'updated their profile', 'report.export': 'exported report',
};
export const verb = (a) => VERBS[a] || a.replace(/[._]/g, ' ');
export const describe = (l) => html`<b>${l.user_name}</b> ${verb(l.action)}${l.target_label ? html` <span class="muted">${l.target_label}</span>` : ''}`;
export const actionIcon = (a) => (a.startsWith('auth') ? 'lock' : a.startsWith('exam') || a.startsWith('attempt') ? 'file' : a.startsWith('student') || a.startsWith('classroom') || a.startsWith('teacher') ? 'users' : a.startsWith('results') || a.startsWith('mark') ? 'chart' : a.startsWith('question') ? 'help' : 'log');
