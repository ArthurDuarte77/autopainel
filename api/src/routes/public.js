// Public catalog for the store's own site (no JWT): vehicle list/detail, XML feed and lead form.
import { Router } from 'express';
import crypto from 'node:crypto';
import { q, one } from '../db.js';
import { env, has } from '../http.js';
import { importLeads } from '../core.js';
import { title, description, photos } from '../integrations/format.js';

const r = Router();
const COLS = 'v.id, v.brand, v.model, v.version, v.body_type, v.year, v.km, v.color, v.fuel, v.transmission, v.doors, v.price, v.status, v.description, v.photos';
const SITE = `FROM vehicles v JOIN publications p ON p.vehicle_id=v.id AND p.channel='site' AND p.active=1 WHERE v.status<>'Vendido'`;
const out = (v) => ({ ...v, title: title(v, 120), photos: photos(v) });

r.get('/vehicles', async (req, res) => res.json((await q(`SELECT ${COLS} ${SITE} ORDER BY v.created_at DESC`)).map(out)));

r.get('/vehicles/:id', async (req, res) => {
  const v = await one(`SELECT ${COLS} ${SITE} AND v.id=?`, [req.params.id]);
  if (!v) return res.status(404).json({ error: 'Veículo não encontrado' });
  res.json({ ...out(v), description_text: description(v) });
});

// Generic XML feed (Google/Facebook catalog-style) for portals that import by URL.
r.get('/feed.xml', async (req, res) => {
  const x = (s) => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const items = (await q(`SELECT ${COLS} ${SITE} ORDER BY v.created_at DESC`)).map(v => `  <vehicle>
    <id>${v.id}</id><title>${x(title(v, 120))}</title><brand>${x(v.brand)}</brand><model>${x(v.model)}</model><version>${x(v.version)}</version>
    <year>${v.year}</year><km>${v.km}</km><color>${x(v.color)}</color><fuel>${x(v.fuel)}</fuel><transmission>${x(v.transmission)}</transmission>
    <body_type>${x(v.body_type)}</body_type><price>${v.price}</price><description>${x(description(v))}</description>
    <photos>${photos(v).map(p => `<photo>${x(p)}</photo>`).join('')}</photos>
  </vehicle>`);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<vehicles store="${x(env('STORE_NAME', 'AutoPainel'))}">\n${items.join('\n')}\n</vehicles>\n`);
});

// Contact form of the own site. Optional HMAC check when SITE_WEBHOOK_SECRET is set and signature header sent.
r.post('/leads', async (req, res) => {
  const b = req.body || {};
  const sig = req.headers['x-autopainel-signature'];
  if (sig && has('SITE_WEBHOOK_SECRET')) {
    const ok = crypto.createHmac('sha256', env('SITE_WEBHOOK_SECRET')).update(JSON.stringify(b)).digest('hex');
    if (sig !== ok) return res.status(401).json({ error: 'Assinatura inválida' });
  }
  const name = String(b.name || '').trim();
  if (!name || !(b.phone || b.email)) return res.status(400).json({ error: 'Informe nome e telefone ou e-mail' });
  const vehicle_id = b.vehicle_id && (await one('SELECT id FROM vehicles WHERE id=?', [b.vehicle_id]))?.id;
  const r2 = await importLeads('site', [{ name, phone: b.phone, email: b.email, interest: b.message || b.interest || 'Contato pelo site',
    vehicle_id: vehicle_id || null, notes: b.message || null }]);
  res.status(201).json({ ok: true, ...r2 });
});

export default r;
