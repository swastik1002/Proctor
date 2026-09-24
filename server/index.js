'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');

const db = require('./db');
const { HttpError, hub, now } = require('./lib');
const auth = require('./auth');
const core = require('./core');
const manage = require('./routes-manage');
const exams = require('./routes-exam');
const { student, reports } = require('./routes-student');

if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
  console.log('Empty database detected, loading demo data...');
  require('./seed').run();
}

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'", 'ws:', 'wss:'],
      objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, etag: true }));

const api = express.Router();
api.use(rateLimit({ windowMs: 60000, limit: 900, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Slow down and try again shortly.' } }));
api.use('/auth/login', rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in a few minutes.' } }));
api.use(auth.attach);
const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
api.post('/auth/login', wrap(auth.login));
api.post('/auth/logout', wrap(auth.logout));
api.get('/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: auth.publicUser(req.user), csrf: req.csrf });
});
api.use(auth.requireAuth);
api.post('/auth/password', wrap(auth.changePassword));
api.use(manage.router);
api.use(exams.router);
api.use(student);
api.use(reports);
api.use((req, res, next) => next(new HttpError(404, 'Endpoint not found.')));
app.use('/api', api);

app.use((err, req, res, next) => { // eslint-disable-line
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large (2 MB max).' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  if (err.code && String(err.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'That change conflicts with existing data.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) return socket.destroy();
  const cookies = auth.parseCookies(req.headers.cookie);
  const s = auth.loadUser(cookies[auth.COOKIE]);
  const origin = req.headers.origin;
  if (!s || (origin && new URL(origin).host !== req.headers.host)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const client = { ws, user: s.user };
    hub.add(client);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => hub.remove(client));
    ws.on('error', () => hub.remove(client));
    ws.on('message', () => { /* server-push only */ });
    ws.send(JSON.stringify({ type: 'hello', serverTime: now() }));
  });
});
setInterval(() => { for (const c of hub.clients) { if (!c.ws.isAlive) { c.ws.terminate(); hub.remove(c); } else { c.ws.isAlive = false; try { c.ws.ping(); } catch { /* */ } } } }, 25000);

// server clock: auto-start, auto-expire, auto-close
setInterval(() => { try { core.tick(); } catch (e) { console.error('tick failed', e); } }, 2000);
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now()), 3600000);

require('./sim').start();
const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) server.listen(PORT, () => console.log(`Proctor running at http://localhost:${PORT}`));
module.exports = { app, server };
