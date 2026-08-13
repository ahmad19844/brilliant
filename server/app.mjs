import express from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, migrateAndSeed } from './db.mjs';
import { login, loginStudent, requireAdmin, requirePasswordChanged, requireStudent, changePassword } from './auth.mjs';
import { registerStudent, startAttempt, saveAnswer, submitAttempt, publishSubject, resumeAttempt } from './exams.mjs';
import { listSubjectsForStudent } from './repositories.mjs';
import { validateQuestion } from './validation.mjs';
import { createBackup, restoreBackup } from './backup.mjs';

function loginLimiter() {
  const attempts = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter(time => now - time < 15 * 60_000);
    if (recent.length >= 10) return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    recent.push(now); attempts.set(key, recent); next();
  };
}

export function makeApp({ dbPath = join(tmpdir(), 'bfia-cbt.db'), secureCookies = process.env.COOKIE_SECURE === 'true' } = {}) {
  const db = openDatabase(dbPath); migrateAndSeed(db);
  const app = express();
  app.set('trust proxy', 1); app.disable('x-powered-by'); app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => { req.cookies = Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(x => x.trim().split('='))); next(); });
  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });
  app.use('/assets', express.static(join(import.meta.dirname, '../assets')));
  app.use('/admin', express.static(join(import.meta.dirname, '../public/admin')));
  app.use('/student', express.static(join(import.meta.dirname, '../public/student')));
  app.get('/', (req, res) => res.redirect('/student/'));
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  const error = (res, e) => res.status(e.code === 'FORBIDDEN' ? 403 : e.code === 'ATTEMPT_SUBMITTED' ? 409 : 400).json({ error: e.message, code: e.code });
  const cookie = (name, value) => `${name}=${value}; HttpOnly; SameSite=Strict; Path=/${secureCookies ? '; Secure' : ''}`;
  const adminReady = [requireAdmin(db), requirePasswordChanged];
  const studentOnly = requireStudent(db);

  app.post('/api/admin/login', loginLimiter(), (req, res) => {
    const result = login(db, req.body.username, req.body.password);
    if (!result) return res.status(401).json({ error: 'Invalid credentials' });
    res.setHeader('Set-Cookie', cookie('bfia_session', result.token)); res.json({ mustChangePassword: result.mustChangePassword });
  });
  app.get('/api/admin/me', requireAdmin(db), (req, res) => res.json({ username: req.admin.username, mustChangePassword: !!req.admin.must_change_password }));
  app.post('/api/admin/password', requireAdmin(db), (req, res) => { try { changePassword(db, req.admin.id, req.body.oldPassword, req.body.newPassword); res.json({ ok: true }); } catch (e) { error(res, e); } });
  app.get('/api/admin/subjects', adminReady, (req, res) => res.json(db.prepare('SELECT s.*, COUNT(qu.id) questionCount FROM subjects s LEFT JOIN questions qu ON qu.subject_id=s.id GROUP BY s.id').all()));
  app.post('/api/admin/subjects', adminReady, (req, res) => { try { const out = db.prepare('INSERT INTO subjects(name) VALUES(?)').run(req.body.name.trim()); res.json({ id: out.lastInsertRowid }); } catch (e) { error(res, e); } });
  app.get('/api/admin/subjects/:id/questions', adminReady, (req, res) => res.json(db.prepare('SELECT * FROM questions WHERE subject_id=? ORDER BY number').all(req.params.id).map(x => ({ ...x, options: JSON.parse(x.options) }))));
  app.post('/api/admin/subjects/:id/questions', adminReady, (req, res) => { try { validateQuestion(req.body); const number = db.prepare('SELECT COALESCE(MAX(number),0)+1 n FROM questions WHERE subject_id=?').get(req.params.id).n; if (number > 50) throw new Error('Maximum 50 questions'); const out = db.prepare('INSERT INTO questions(subject_id,number,text,options,correct_option) VALUES(?,?,?,?,?)').run(req.params.id, number, req.body.text, JSON.stringify(req.body.options), req.body.correctOption); res.json({ id: out.lastInsertRowid, number }); } catch (e) { error(res, e); } });
  app.post('/api/admin/subjects/:id/publish', adminReady, (req, res) => { try { publishSubject(db, +req.params.id); res.json({ ok: true }); } catch (e) { error(res, e); } });
  app.get('/api/admin/results', adminReady, (req, res) => { let sql = 'SELECT r.exam_number,r.full_name,r.gender,s.name subject,a.score,a.status,a.submitted_at FROM attempts a JOIN registrations r ON r.id=a.registration_id JOIN subjects s ON s.id=a.subject_id WHERE 1=1', parameters = []; if (req.query.examNumber) { sql += ' AND r.exam_number=?'; parameters.push(req.query.examNumber); } if (req.query.subjectId) { sql += ' AND s.id=?'; parameters.push(req.query.subjectId); } res.json(db.prepare(sql).all(...parameters)); });
  app.post('/api/admin/backup', adminReady, async (req, res) => { try { await createBackup({ sourceDbPath: dbPath, destinationPath: req.body.destinationPath, password: req.body.password }); res.json({ ok: true }); } catch (e) { error(res, e); } });
  app.post('/api/admin/restore', adminReady, async (req, res) => { try { await restoreBackup({ backupPath: req.body.backupPath, destinationDbPath: dbPath, password: req.body.password }); res.json({ ok: true }); } catch (e) { error(res, e); } });

  app.post('/api/student/register', (req, res) => { try { res.json(registerStudent(db, req.body)); } catch (e) { error(res, e); } });
  app.get('/api/subjects', (req, res) => res.json(db.prepare('SELECT id,name FROM subjects WHERE published=1 ORDER BY id').all()));
  app.post('/api/student/login', loginLimiter(), (req, res) => { const result = loginStudent(db, String(req.body.examNumber || '').toUpperCase(), String(req.body.accessCode || '')); if (!result) return res.status(401).json({ error: 'Invalid BFIA number or access code' }); res.setHeader('Set-Cookie', cookie('bfia_student', result.token)); res.json({ student: { examNumber: result.student.exam_number, fullName: result.student.full_name }, subjects: listSubjectsForStudent(db, result.student.exam_number) }); });
  app.post('/api/student/:number/attempts', studentOnly, (req, res) => { try { if (req.student.exam_number !== req.params.number) throw Object.assign(new Error('Student session does not match this BFIA number'), { code: 'FORBIDDEN' }); res.json(startAttempt(db, req.params.number, +req.body.subjectId)); } catch (e) { error(res, e); } });
  const ownedAttempt = (req) => { const attempt = resumeAttempt(db, +req.params.id); if (!attempt || attempt.registration_id !== req.student.id) throw Object.assign(new Error('Attempt not found'), { code: 'FORBIDDEN' }); return attempt; };
  app.get('/api/attempts/:id', studentOnly, (req, res) => { try { let attempt = ownedAttempt(req); if (attempt.status === 'active' && Date.now() >= attempt.ends_at) submitAttempt(db, attempt.id); attempt = resumeAttempt(db, attempt.id); const questions = db.prepare('SELECT number,text,options FROM questions WHERE subject_id=? ORDER BY number').all(attempt.subject_id).map(x => ({ ...x, options: JSON.parse(x.options) })); const answers = db.prepare('SELECT question_number,selected_option FROM answers WHERE attempt_id=?').all(attempt.id); res.json({ attempt, questions, answers }); } catch (e) { error(res, e); } });
  app.put('/api/attempts/:id/answers/:number', studentOnly, (req, res) => { try { ownedAttempt(req); res.json({ answer: saveAnswer(db, +req.params.id, +req.params.number, req.body.selectedOption) }); } catch (e) { error(res, e); } });
  app.post('/api/attempts/:id/submit', studentOnly, (req, res) => { try { ownedAttempt(req); res.json(submitAttempt(db, +req.params.id)); } catch (e) { error(res, e); } });
  return app;
}

export async function startLocalServer({ dbPath = join(process.cwd(), 'bfia-cbt.db'), host = '0.0.0.0', port = 0, secureCookies = false } = {}) { const server = createServer(makeApp({ dbPath, secureCookies })); await new Promise(ok => server.listen(port, host, ok)); const actualPort = server.address().port; return { baseUrl: `http://127.0.0.1:${actualPort}`, lanUrl: `http://${host}:${actualPort}/student`, close: () => new Promise(ok => server.close(ok)) }; }
