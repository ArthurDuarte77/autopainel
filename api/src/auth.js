import crypto from 'node:crypto';

const secret = () => process.env.JWT_SECRET || 'dev-secret';
const b64 = (s) => Buffer.from(s).toString('base64url');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Minimal HS256 JWT.
export function signToken(payload, ttlSec = 60 * 60 * 12) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', secret()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyToken(token) {
  const [head, body, sig] = String(token).split('.');
  if (!sig) return null;
  const exp = crypto.createHmac('sha256', secret()).update(`${head}.${body}`).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() / 1000 ? p : null;
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const user = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : req.query.token || '');
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  req.user = user;
  next();
}
