import { Router } from 'express';
import { q, one } from '../db.js';
import { verifyPassword, signToken, requireAuth, hashPassword } from '../auth.js';
import { env } from '../http.js';

const r = Router();

r.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = email && await one('SELECT * FROM users WHERE email=?', [String(email).trim().toLowerCase()]);
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'E-mail ou senha inválidos' });
  const user = { id: u.id, name: u.name, email: u.email, role: u.role };
  res.json({ token: signToken(user), user });
});

const signupOn = () => env('ALLOW_SIGNUP', 'false') === 'true';
r.get('/signup', (req, res) => res.json({ enabled: signupOn() }));

// Self-service signup (opt-in via ALLOW_SIGNUP); new accounts never get admin.
r.post('/register', async (req, res) => {
  if (!signupOn()) return res.status(403).json({ error: 'Cadastro desativado' });
  const name = String(req.body?.name || '').trim(), email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || '');
  if (!name || name.length > 120 || email.length > 160 || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Informe nome e e-mail válidos' });
  if (password.length < 6) return res.status(400).json({ error: 'Senha precisa de 6+ caracteres' });
  const user = { name, email, role: 'vendedor' };
  try { user.id = (await q('INSERT INTO users SET ?', [{ ...user, password_hash: hashPassword(password) }])).insertId; }
  catch (e) { if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'E-mail já cadastrado' }); throw e; }
  res.status(201).json({ token: signToken(user), user });
});

r.get('/me', requireAuth, (req, res) => res.json({ ...req.user, store: env('STORE_NAME', 'AutoPainel') }));

r.post('/password', requireAuth, async (req, res) => {
  const { current, password } = req.body || {};
  const u = await one('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!u || !verifyPassword(String(current || ''), u.password_hash)) return res.status(400).json({ error: 'Senha atual incorreta' });
  if (String(password || '').length < 6) return res.status(400).json({ error: 'Nova senha precisa de 6+ caracteres' });
  await q('UPDATE users SET password_hash=? WHERE id=?', [hashPassword(password), u.id]);
  res.json({ ok: true });
});

export default r;
