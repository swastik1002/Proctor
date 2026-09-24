// Core utilities: safe templating, icons, API client, dialogs, formatters.
export const state = { user: null, csrf: null };

/* ---------- safe HTML templating (escapes by default → XSS-safe) ---------- */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => ({ __raw: String(s ?? '') });
const val = (v) => (v == null || v === false ? '' : Array.isArray(v) ? v.map(val).join('') : typeof v === 'object' && '__raw' in v ? v.__raw : esc(v));
export function html(strings, ...vals) { let o = ''; strings.forEach((s, i) => { o += s; if (i < vals.length) o += val(vals[i]); }); return raw(o); }
export const put = (el, h) => { el.innerHTML = Array.isArray(h) ? val(h) : h && h.__raw !== undefined ? h.__raw : esc(h); };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- tiny event bus ---------- */
const handlers = {};
export const bus = {
  on(t, fn) { (handlers[t] ||= new Set()).add(fn); return () => handlers[t].delete(fn); },
  emit(t, d) { (handlers[t] || []).forEach((f) => { try { f(d); } catch (e) { console.error(e); } }); },
};

/* ---------- icons ---------- */
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  school: '<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c2 .6 3.3 2.4 3.5 5.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 115 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01"/>',
  file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 000 8.4M16.2 7.8a6 6 0 010 8.4M4.9 4.9a10 10 0 000 14.2M19.1 4.9a10 10 0 010 14.2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  pie: '<path d="M12 3v9h9a9 9 0 10-9-9z"/><path d="M10 5a8 8 0 108 9"/>',
  bell: '<path d="M6 16v-5a6 6 0 1112 0v5l2 2H4zM10 21h4"/>',
  log: '<path d="M8 3h11v14a3 3 0 01-3 3H5a3 3 0 003-3zM8 3a3 3 0 00-3 3v1h3M11 8h5M11 12h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', edit: '<path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>', upload: '<path d="M12 16V5M7 9l5-5 5 5M4 20h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="M7 5l12 7-12 7z"/>',
  refresh: '<path d="M20 11a8 8 0 00-14-4L4 9M4 4v5h5M4 13a8 8 0 0014 4l2-2M20 20v-5h-5"/>',
  logout: '<path d="M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4M16 8l4 4-4 4M20 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  right: '<path d="M9 5l7 7-7 7"/>', left: '<path d="M15 5l-7 7 7 7"/>', down: '<path d="M6 9l6 6 6-6"/>', up: '<path d="M6 15l6-6 6 6"/>',
  arrowup: '<path d="M12 19V5M6 11l6-6 6 6"/>', arrowdown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>', flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', book: '<path d="M4 19V5a2 2 0 012-2h13v16H6a2 2 0 00-2 2M4 19a2 2 0 002 2h13"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  offline: '<path d="M2 2l20 20M8.5 16.4a5 5 0 017 0M2 8.8a15 15 0 015-3M22 8.8a15 15 0 00-9.4-3.7M5 12.9a10 10 0 015-2.6M19 12.9a10 10 0 00-2-1.5M12 20h.01"/>',
  history: '<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.4L3 8M3 3v5h5M12 7v5l3 2"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', tick: '<path d="M6 12.5l4 4 8-9"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>', edit2: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
};
export const icon = (n, cls = '') => raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`);

/* ---------- API ---------- */
export async function api(method, path, body, opts = {}) {
  let res;
  try {
    res = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) { const err = new Error('Cannot reach the server. Check your connection.'); err.network = true; throw err; }
  let data = null; try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    if (res.status === 401 && !opts.noAuthRedirect) bus.emit('unauth');
    const err = new Error(data?.error || `Request failed (${res.status})`); err.status = res.status; err.details = data?.details; throw err;
  }
  return data;
}
export const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); }); const s = p.toString(); return s ? '?' + s : ''; };

/* ---------- formatting ---------- */
export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDT = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDTfull = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
export function rel(ms) {
  if (!ms) return '—';
  const d = Date.now() - ms; const a = Math.abs(d); const fut = d < 0;
  const s = Math.round(a / 1000);
  let t = s < 10 ? 'just now' : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`;
  if (t === 'just now') return t;
  return fut ? `in ${t}` : `${t} ago`;
}
export function clock(ms, forceH) { ms = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(ms / 3600), m = Math.floor((ms % 3600) / 60), s = ms % 60; const p = (n) => String(n).padStart(2, '0'); return h || forceH ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`; }
export const dur = (ms) => (ms == null ? '—' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
export const num = (n, d = 1) => (n == null ? '—' : Number.isInteger(+n) ? String(+n) : (+n).toFixed(d).replace(/\.?0+$/, ''));
export const pct = (n) => (n == null ? '—' : `${num(n)}%`);
export const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const toLocalInput = (ms) => { if (!ms) return ''; const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
export const fromLocalInput = (s) => (s ? new Date(s).getTime() : null);
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export const STATUS = { draft: 'Draft', scheduled: 'Scheduled', live: 'Live', paused: 'Paused', completed: 'Completed', archived: 'Archived', active: 'Active', idle: 'Idle', submitted: 'Submitted', time_expired: 'Time expired', not_started: 'Not started', in_progress: 'In progress', restarted: 'Restarted', force_submitted: 'Force submitted' };
export const badge = (s, label) => html`<span class="badge ${s}">${s === 'live' ? html`<i class="pulse"></i>` : ''}${label || STATUS[s] || s}</span>`;
export const TYPES = { mcq: 'MCQ', multi: 'Multiple select', tf: 'True / False', short: 'Short answer', long: 'Long answer' };
export const diffTag = (d) => html`<span class="tag ${d}">${d}</span>`;

/* ---------- delegated events ---------- */
export function bind(el, actions = {}) {
  el.onclick = (e) => { const t = e.target.closest('[data-act]'); if (t && el.contains(t) && actions[t.dataset.act]) { if (t.tagName === 'A' && t.dataset.act) e.preventDefault(); actions[t.dataset.act](t, e); } };
  el.oninput = (e) => { const t = e.target.closest('[data-input]'); if (t && actions[t.dataset.input]) actions[t.dataset.input](t, e); };
  el.onchange = (e) => { const t = e.target.closest('[data-change]'); if (t && actions[t.dataset.change]) actions[t.dataset.change](t, e); };
}

/* ---------- toasts ---------- */
export function toast(title, msg = '', kind = '') {
  const box = $('#toasts'); const el = document.createElement('div'); el.className = 'toast ' + kind;
  el.innerHTML = `<div><b>${esc(title)}</b>${msg ? `<span>${esc(msg)}</span>` : ''}</div>`;
  box.appendChild(el); setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, kind === 'err' ? 6500 : 4000);
}
export const errMsg = (e) => e?.message || 'Something went wrong.';
export const fail = (e) => toast('That did not work', errMsg(e), 'err');

/* ---------- modal ---------- */
export function modal({ title, body, foot, size = '', onMount, dismiss = true, sub }) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><div><h2>${esc(title)}</h2>${sub ? `<p class="muted small" style="margin-top:4px">${esc(sub)}</p>` : ''}</div>${dismiss ? `<button class="iconbtn" data-close aria-label="Close">${icon('x').__raw}</button>` : ''}</div><div class="modal-body">${body?.__raw ?? ''}</div>${foot ? `<div class="modal-foot">${foot.__raw}</div>` : ''}</div>`;
  const prev = document.activeElement;
  const m = { el: back, root: back.querySelector('.modal'), body: back.querySelector('.modal-body'), foot: back.querySelector('.modal-foot'),
    close(v) { back.remove(); document.removeEventListener('keydown', key); prev?.focus?.(); m.onclose?.(v); } };
  const key = (e) => { if (e.key === 'Escape' && dismiss && back === document.body.lastElementChild) m.close(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back && dismiss) m.close(); });
  back.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) m.close(); });
  document.addEventListener('keydown', key); document.body.appendChild(back);
  (back.querySelector('[autofocus], input:not([type=hidden]), textarea, select') || back.querySelector('.modal')).focus?.();
  onMount?.(m);
  return m;
}
export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, extra }) {
  return new Promise((resolve) => {
    const m = modal({ title, body: html`<div class="stack-sm"><p>${message}</p>${extra || ''}</div>`, foot: html`<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${confirmText}</button>`,
      onMount: (mm) => { mm.el.querySelector('[data-ok]').onclick = () => { mm.close(true); }; } });
    m.onclose = (v) => resolve(!!v);
  });
}
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = el.value;
  }
  return o;
}
// Form modal: fields = html string of form controls; onSubmit(data, modal) may throw → inline error
export function formModal({ title, sub, fields, submit = 'Save', size = '', danger = false, onSubmit, onMount, cancel = 'Cancel' }) {
  const id = 'f' + Math.random().toString(36).slice(2, 7);
  const m = modal({ title, sub, size, body: html`<form id="${id}" novalidate>${fields}<div class="err" data-form-err style="color:var(--pen);font-weight:500;margin-top:12px" role="alert"></div></form>`,
    foot: html`<button class="btn" data-close type="button">${cancel}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit" form="${id}">${submit}</button>`,
    onMount: (mm) => {
      const form = mm.el.querySelector('form'); const btn = mm.el.querySelector('[type=submit]');
      form.onsubmit = async (e) => {
        e.preventDefault(); $$('.invalid', form).forEach((x) => x.classList.remove('invalid')); $('[data-form-err]', form).textContent = '';
        const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
        try { await onSubmit(formData(form), mm, form); }
        catch (err) {
          if (err.cancelled) { btn.disabled = false; btn.innerHTML = label; return; }
          $('[data-form-err]', form).textContent = errMsg(err);
          const f = err.details?.field; if (f && form.elements[f]) { form.elements[f].classList.add('invalid'); form.elements[f].focus(); }
          btn.disabled = false; btn.innerHTML = label;
        }
      };
      onMount?.(mm, form);
    } });
  return m;
}
export const field = (label, control, hint) => html`<div class="field"><label>${label}</label>${control}${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;
export const sel = (name, opts, cur, extra = '') => html`<select class="input" name="${name}" ${raw(extra)}>${opts.map(([v, l]) => html`<option value="${v}" ${String(v) === String(cur ?? '') ? raw('selected') : ''}>${l}</option>`)}</select>`;

/* ---------- shared view fragments ---------- */
export const skeleton = (n = 4) => html`<div class="stack">${Array.from({ length: n }, () => html`<div class="skel" style="height:56px"></div>`)}</div>`;
export const empty = (title, msg, ic = 'book', action) => html`<div class="empty">${icon(ic)}<h3>${title}</h3><p>${msg || ''}</p>${action ? html`<div style="margin-top:14px">${action}</div>` : ''}</div>`;
export const errorBox = (e, retry = true) => html`<div class="errbox"><div class="row">${icon('alert')}<span>${errMsg(e)}</span></div>${retry ? html`<button class="btn btn-sm" data-act="retry">Try again</button>` : ''}</div>`;
export function pager({ page, size, total }) {
  const pages = Math.max(1, Math.ceil(total / size)); const from = total ? (page - 1) * size + 1 : 0; const to = Math.min(total, page * size);
  return html`<div class="pager"><span>${total ? `${from}–${to} of ${total}` : 'No results'}</span><div class="row"><button class="btn btn-sm" data-act="page" data-p="${page - 1}" ${page <= 1 ? raw('disabled') : ''}>${icon('left')} Prev</button><span>Page ${page} / ${pages}</span><button class="btn btn-sm" data-act="page" data-p="${page + 1}" ${page >= pages ? raw('disabled') : ''}>Next ${icon('right')}</button></div></div>`;
}
export const kpi = (label, value, ic, cls = '', unit = '') => html`<div class="card kpi ${cls}"><div class="label">${icon(ic)} ${label}</div><div class="value">${value}${unit ? html`<small>${unit}</small>` : ''}</div></div>`;

// Reusable password field with confirm etc. and file download helper
export const download = (url) => { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };

/* ---------- popover menu ---------- */
export function popMenu(anchor, items) {
  document.querySelectorAll('.pop.floating').forEach((x) => x.remove());
  const pop = document.createElement('div'); pop.className = 'pop floating'; pop.setAttribute('role', 'menu');
  pop.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button role="menuitem" data-i="${i}" ${it.danger ? 'style="color:var(--pen)"' : ''}>${it.icon ? icon(it.icon).__raw : ''}${esc(it.label)}</button>`).join('');
  anchor.parentElement.classList.add('relative'); anchor.parentElement.appendChild(pop);
  const off = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); } };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
  pop.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { pop.remove(); document.removeEventListener('mousedown', off); items[+b.dataset.i].run(); } };
  return pop;
}
