import { Router } from 'express';
import { q, one } from '../db.js';
import { pick } from './vehicles.js';
import { opportunities, pushLeadToCrms, markSold, label } from '../core.js';
import { matches, sendWhatsApp } from '../services.js';

const r = Router();
const FIELDS = ['name', 'phone', 'email', 'interest', 'brand', 'model', 'body_type', 'fuel', 'year_min', 'price_max', 'stage', 'seller_id', 'vehicle_id', 'source', 'notes'];
const STAGES = ['Novo', 'Em contato', 'Proposta', 'Negociação', 'Fechado', 'Perdido'];
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const json = (x, d) => (x == null ? d : typeof x === 'string' ? JSON.parse(x) : x);
const parse = (l) => l && ({ ...l, crm_refs: json(l.crm_refs, {}), notified_vehicle_ids: json(l.notified_vehicle_ids, []) });

// Kanban list; each lead carries the stock vehicles that match it ("Chegou: …" badge).
r.get('/', async (req, res) => {
  const w = [], p = [];
  if (req.query.stage) { w.push('l.stage=?'); p.push(req.query.stage); }
  if (req.query.seller_id) { w.push('l.seller_id=?'); p.push(req.query.seller_id); }
  if (req.query.search) { w.push('CONCAT_WS(" ",l.name,l.phone,l.email,l.interest) LIKE ?'); p.push(`%${req.query.search}%`); }
  const leads = await q(`SELECT l.*, s.name seller_name, CONCAT_WS(' ',v.brand,v.model,v.version,v.year) vehicle_label
    FROM leads l LEFT JOIN sellers s ON s.id=l.seller_id LEFT JOIN vehicles v ON v.id=l.vehicle_id
    ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY l.updated_at DESC`, p);
  const stock = await q(`SELECT id, brand, model, version, year, price, status, body_type, fuel FROM vehicles WHERE status IN ('Disponível','Em preparação')`);
  res.json(leads.map(l => ({ ...parse(l), matches: ['Fechado', 'Perdido'].includes(l.stage) ? [] : stock.filter(v => matches(l, v)).map(v => ({ id: v.id, label: label(v), price: v.price })) })));
});

r.get('/opportunities', async (req, res) => res.json(await opportunities()));

r.get('/:id', async (req, res) => {
  const l = parse(await one('SELECT * FROM leads WHERE id=?', [req.params.id]));
  if (!l) throw bad('Lead não encontrado', 404);
  l.events = await q('SELECT * FROM events WHERE lead_id=? ORDER BY date DESC, time DESC', [l.id]);
  res.json(l);
});

function validate(d, partial) {
  if (!partial && !d.name) throw bad('Campo obrigatório: name');
  if (!partial && !d.interest) d.interest = [d.brand, d.model, d.body_type].filter(Boolean).join(' ') || 'Contato';
  if (d.stage && !STAGES.includes(d.stage)) throw bad('Etapa inválida');
  return d;
}

r.post('/', async (req, res) => {
  const d = validate(pick(req.body, FIELDS));
  if (d.stage === 'Fechado') d.stage = 'Negociação'; // closing goes through /:id/sell or PUT
  const { insertId } = await q('INSERT INTO leads SET ?', [{ ...d, crm_refs: '{}' }]);
  pushLeadToCrms(insertId).catch(() => {});
  res.status(201).json(parse(await one('SELECT * FROM leads WHERE id=?', [insertId])));
});

r.put('/:id', async (req, res) => {
  const cur = await one('SELECT * FROM leads WHERE id=?', [req.params.id]);
  if (!cur) throw bad('Lead não encontrado', 404);
  const d = validate(pick(req.body, FIELDS), true);
  if (Object.keys(d).length) await q('UPDATE leads SET ? WHERE id=?', [d, cur.id]);
  pushLeadToCrms(cur.id).catch(() => {}); // stage/data change mirrored to configured CRMs
  res.json(parse(await one('SELECT * FROM leads WHERE id=?', [cur.id])));
});

r.delete('/:id', async (req, res) => {
  const { affectedRows } = await q('DELETE FROM leads WHERE id=?', [req.params.id]);
  if (!affectedRows) throw bad('Lead não encontrado', 404);
  res.json({ ok: true });
});

r.post('/:id/sync-crm', async (req, res) => {
  if (!(await one('SELECT id FROM leads WHERE id=?', [req.params.id]))) throw bad('Lead não encontrado', 404);
  res.json(await pushLeadToCrms(req.params.id));
});

// Close the deal: sells the vehicle (finance + listings) and marks the lead Fechado.
r.post('/:id/sell', async (req, res) => {
  const l = await one('SELECT * FROM leads WHERE id=?', [req.params.id]);
  if (!l) throw bad('Lead não encontrado', 404);
  const vid = req.body?.vehicle_id || l.vehicle_id;
  const v = vid && await one('SELECT status FROM vehicles WHERE id=?', [vid]);
  if (!v) throw bad('Informe o veículo vendido');
  if (v.status === 'Vendido') throw bad('Veículo já vendido', 409);
  await markSold(vid, { ...req.body, seller_id: req.body?.seller_id || l.seller_id, lead_id: l.id });
  res.json(parse(await one('SELECT * FROM leads WHERE id=?', [l.id])));
});

// Manual WhatsApp message to the lead (Cloud API).
r.post('/:id/whatsapp', async (req, res) => {
  const l = await one('SELECT * FROM leads WHERE id=?', [req.params.id]);
  if (!l?.phone) throw bad('Lead sem telefone');
  if (!req.body?.message) throw bad('Mensagem vazia');
  await sendWhatsApp(l.phone, String(req.body.message));
  res.json({ ok: true });
});

export default r;
