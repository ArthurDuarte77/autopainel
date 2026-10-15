// Dashboard, agenda (events), sellers and settings.
import { Router } from 'express';
import { q, one } from '../db.js';
import { pick } from './vehicles.js';
import { env } from '../http.js';
import { opportunities, today, label } from '../core.js';

const r = Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const ym = (d) => d.slice(0, 7);
const shift = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const setting = async (k, d) => (await one('SELECT v FROM settings WHERE k=?', [k]))?.v ?? d;

// ---------------------------------------------------------------- Dashboard
r.get('/dashboard', async (req, res) => {
  const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : ym(today());
  const prev = shift(m, -1);
  const months = Array.from({ length: 6 }, (_, i) => shift(m, i - 5));

  const revRows = await q(`SELECT DATE_FORMAT(date,'%Y-%m') m, SUM(amount) total FROM transactions
    WHERE type='Receber' AND category='venda' AND DATE_FORMAT(date,'%Y-%m') IN (?) GROUP BY m`, [months]);
  const rev = Object.fromEntries(revRows.map(x => [x.m, Number(x.total)]));
  const goal = Number(await setting('monthly_revenue_goal', 600000));

  const stock = await one(`SELECT COUNT(*) n, COALESCE(SUM(price),0) value FROM vehicles WHERE status IN ('Disponível','Em preparação','Reservado')`);
  const available = await one(`SELECT COUNT(*) n FROM vehicles WHERE status='Disponível'`);

  // Profit per sold vehicle = sale − purchase − preparation − commission.
  const profit = async (mm) => one(`SELECT COUNT(*) n, AVG(v.sold_price - COALESCE(v.cost,0) - COALESCE(v.prep_cost,0)
      - COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.vehicle_id=v.id AND t.category='comissao'),0)) avg_profit
    FROM vehicles v WHERE v.status='Vendido' AND DATE_FORMAT(v.sold_at,'%Y-%m')=?`, [mm]);
  const [pNow, pPrev] = [await profit(m), await profit(prev)];
  const avgNow = Math.round(Number(pNow.avg_profit) || 0), avgPrev = Math.round(Number(pPrev.avg_profit) || 0);

  const sellers = await q(`SELECT s.id, s.name, s.monthly_goal,
      (SELECT COUNT(*) FROM vehicles v WHERE v.seller_id=s.id AND v.status='Vendido' AND DATE_FORMAT(v.sold_at,'%Y-%m')=?) sold,
      (SELECT COALESCE(SUM(sold_price),0) FROM vehicles v WHERE v.seller_id=s.id AND v.status='Vendido' AND DATE_FORMAT(v.sold_at,'%Y-%m')=?) revenue
    FROM sellers s WHERE s.active=1 ORDER BY sold DESC, s.name`, [m, m]);

  const opps = (await opportunities()).slice(0, 6).map(o => ({
    lead: { id: o.lead.id, name: o.lead.name, interest: o.lead.interest, stage: o.lead.stage, phone: o.lead.phone },
    vehicles: o.vehicles.map(v => ({ id: v.id, label: label(v), price: v.price, status: v.status })) }));

  res.json({
    store: env('STORE_NAME', 'AutoPainel'), user: req.user, month: m,
    revenue: { value: rev[m] || 0, goal, pct: goal ? Math.round((rev[m] || 0) / goal * 100) : 0, prev: rev[prev] || 0 },
    stock: { count: Number(stock.n), value: Number(stock.value), available: Number(available.n) },
    avg_profit: { value: avgNow, prev: avgPrev, sold: Number(pNow.n), delta_pct: avgPrev ? Math.round((avgNow - avgPrev) / avgPrev * 100) : null },
    chart: months.map(x => ({ month: x, value: rev[x] || 0 })),
    sellers: sellers.map(s => ({ ...s, sold: Number(s.sold), revenue: Number(s.revenue), pct: s.monthly_goal ? Math.round(s.sold / s.monthly_goal * 100) : 0 })),
    opportunities: opps,
    today_events: await q(`SELECT * FROM events WHERE date=? ORDER BY time`, [today()]),
  });
});

// ---------------------------------------------------------------- Agenda
const EV = ['date', 'time', 'title', 'category', 'lead_id', 'vehicle_id', 'done', 'notes'];
const EV_CATS = ['Cliente', 'Estoque', 'Financeiro', 'Outro'];

r.get('/events', async (req, res) => {
  const w = [], p = [];
  if (req.query.date) { w.push('e.date=?'); p.push(req.query.date); }
  if (req.query.from) { w.push('e.date>=?'); p.push(req.query.from); }
  if (req.query.to) { w.push('e.date<=?'); p.push(req.query.to); }
  res.json(await q(`SELECT e.*, l.name lead_name, l.phone lead_phone, CONCAT_WS(' ',v.brand,v.model,v.year) vehicle_label
    FROM events e LEFT JOIN leads l ON l.id=e.lead_id LEFT JOIN vehicles v ON v.id=e.vehicle_id
    ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY e.date, e.time`, p));
});

const evValidate = (d, partial) => {
  if (!partial && (!d.date || !d.title)) throw bad('Informe data e título');
  if (d.category && !EV_CATS.includes(d.category)) throw bad('Categoria inválida');
  if ('done' in d) d.done = d.done ? 1 : 0;
  return d;
};

r.post('/events', async (req, res) => {
  const { insertId } = await q('INSERT INTO events SET ?', [{ category: 'Outro', ...evValidate(pick(req.body, EV)) }]);
  res.status(201).json(await one('SELECT * FROM events WHERE id=?', [insertId]));
});

r.put('/events/:id', async (req, res) => {
  const d = evValidate(pick(req.body, EV), true);
  if (!(await one('SELECT id FROM events WHERE id=?', [req.params.id]))) throw bad('Evento não encontrado', 404);
  if (Object.keys(d).length) await q('UPDATE events SET ? WHERE id=?', [d, req.params.id]);
  res.json(await one('SELECT * FROM events WHERE id=?', [req.params.id]));
});

r.delete('/events/:id', async (req, res) => {
  const { affectedRows } = await q('DELETE FROM events WHERE id=?', [req.params.id]);
  if (!affectedRows) throw bad('Evento não encontrado', 404);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Sellers
const SF = ['name', 'email', 'phone', 'commission_pct', 'monthly_goal', 'active'];

r.get('/sellers', async (req, res) => res.json(await q('SELECT * FROM sellers ORDER BY active DESC, name')));

r.post('/sellers', async (req, res) => {
  const d = pick(req.body, SF);
  if (!d.name) throw bad('Informe o nome');
  const { insertId } = await q('INSERT INTO sellers SET ?', [d]);
  res.status(201).json(await one('SELECT * FROM sellers WHERE id=?', [insertId]));
});

r.put('/sellers/:id', async (req, res) => {
  const d = pick(req.body, SF);
  if (!(await one('SELECT id FROM sellers WHERE id=?', [req.params.id]))) throw bad('Vendedor não encontrado', 404);
  if (Object.keys(d).length) await q('UPDATE sellers SET ? WHERE id=?', [d, req.params.id]);
  res.json(await one('SELECT * FROM sellers WHERE id=?', [req.params.id]));
});

// Soft delete: sellers are referenced by sales/commissions history.
r.delete('/sellers/:id', async (req, res) => {
  const { affectedRows } = await q('UPDATE sellers SET active=0 WHERE id=?', [req.params.id]);
  if (!affectedRows) throw bad('Vendedor não encontrado', 404);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Settings
r.get('/settings', async (req, res) => res.json(Object.fromEntries((await q(`SELECT k, v FROM settings WHERE k NOT LIKE 'cred:%' AND k NOT LIKE 'plate:%'`)).map(x => [x.k, x.v]))));

r.put('/settings', async (req, res) => {
  if (req.user.role !== 'admin') throw bad('Apenas administradores', 403);
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!/^[a-z_]{1,64}$/.test(k)) throw bad(`Chave inválida: ${k}`);
    await q('INSERT INTO settings (k, v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [k, String(v ?? '')]);
  }
  res.json(Object.fromEntries((await q(`SELECT k, v FROM settings WHERE k NOT LIKE 'cred:%' AND k NOT LIKE 'plate:%'`)).map(x => [x.k, x.v])));
});

export default r;
