import express from 'express';
import { q, one, waitDb } from './db.js';
import { hashPassword, requireAuth } from './auth.js';
import { env } from './http.js';
import auth from './routes/auth.js';
import pub from './routes/public.js';
import integrations, { publicIntegrations } from './routes/integrations.js';
import vehicles from './routes/vehicles.js';
import publications from './routes/publications.js';
import leads from './routes/leads.js';
import finance from './routes/finance.js';
import appraisals from './routes/appraisals.js';
import misc from './routes/misc.js';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads', { maxAge: '7d' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', auth);
app.use('/api/public', pub);
app.use('/api', publicIntegrations); // OAuth callbacks + webhooks (no JWT)

app.use('/api', requireAuth);
app.use('/api/integrations', integrations);
app.use('/api/vehicles', vehicles);
app.use('/api/publications', publications);
app.use('/api/leads', leads);
app.use('/api/finance', finance);
app.use('/api/appraisals', appraisals);
app.use('/api', misc);

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
app.use((err, req, res, next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  // Upstream API errors (status from third party) become 502 so the client does not log out on a 401 from e.g. ML.
  const fromUpstream = err.data !== undefined;
  res.status(fromUpstream ? 502 : status).json({ error: err.message || 'Erro interno' });
});

await waitDb();
if (!(await one('SELECT id FROM users LIMIT 1'))) {
  await q('INSERT INTO users SET ?', [{ name: env('ADMIN_NAME', 'Administrador'), email: env('ADMIN_EMAIL', 'admin@autopainel.local'),
    password_hash: hashPassword(env('ADMIN_PASSWORD', 'admin123')), role: 'admin' }]);
  console.log(`Admin criado: ${env('ADMIN_EMAIL', 'admin@autopainel.local')}`);
}
const port = Number(env('API_PORT', '3000'));
app.listen(port, () => console.log(`AutoPainel API on :${port}`));
