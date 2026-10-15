import { Router } from 'express';
import { q, one } from '../db.js';
import { channels } from '../integrations/channels.js';
import { syncPublication } from '../core.js';

const r = Router();
const chan = (id) => {
  if (!channels[id]) throw Object.assign(new Error('Canal inválido'), { status: 400 });
  return channels[id];
};

// Grid: every non-sold vehicle × every channel.
r.get('/', async (req, res) => {
  const vehicles = await q(`SELECT id, brand, model, version, year, price, plate, status, photos FROM vehicles
    WHERE status<>'Vendido' OR id IN (SELECT vehicle_id FROM publications WHERE status='publicado') ORDER BY created_at DESC`);
  const pubs = await q('SELECT * FROM publications');
  const tokens = new Set((await q('SELECT provider FROM integration_tokens')).map(t => t.provider));
  res.json({
    // connected = account actually linked (OAuth login done), not just credentials filled in.
    channels: Object.values(channels).map(c => ({ id: c.id, name: c.name, kind: c.kind, configured: c.configured(), connected: c.oauth ? tokens.has(c.id) : c.configured(),
      active: pubs.filter(p => p.channel === c.id && p.active).length, published: pubs.filter(p => p.channel === c.id && p.status === 'publicado').length })),
    vehicles: vehicles.map(v => ({ ...v, photos: typeof v.photos === 'string' ? JSON.parse(v.photos) : v.photos || [],
      publications: Object.fromEntries(pubs.filter(p => p.vehicle_id === v.id).map(p => [p.channel, p])) })),
  });
});

r.put('/:vehicleId/:channel', async (req, res) => {
  chan(req.params.channel);
  const v = await one('SELECT id, status FROM vehicles WHERE id=?', [req.params.vehicleId]);
  if (!v) throw Object.assign(new Error('Veículo não encontrado'), { status: 404 });
  const active = req.body?.active ? 1 : 0;
  if (active && v.status === 'Vendido') throw Object.assign(new Error('Veículo vendido não pode ser publicado'), { status: 409 });
  await q(`INSERT INTO publications (vehicle_id, channel, active, status) VALUES (?,?,?,'pendente')
    ON DUPLICATE KEY UPDATE active=VALUES(active)`, [v.id, req.params.channel, active]);
  res.json(await syncPublication(v.id, req.params.channel));
});

r.post('/:vehicleId/:channel/sync', async (req, res) => {
  chan(req.params.channel);
  const p = await syncPublication(req.params.vehicleId, req.params.channel);
  if (!p) throw Object.assign(new Error('Publicação não encontrada'), { status: 404 });
  res.json(p);
});

// Sync everything (optionally a single channel).
r.post('/sync', async (req, res) => {
  const ch = req.body?.channel;
  if (ch) chan(ch);
  const pubs = await q(`SELECT vehicle_id, channel FROM publications WHERE (active=1 OR external_id IS NOT NULL) ${ch ? 'AND channel=?' : ''}`, ch ? [ch] : []);
  const out = { total: pubs.length, publicado: 0, pendente: 0, erro: 0, inativo: 0 };
  for (const p of pubs) {
    const r2 = await syncPublication(p.vehicle_id, p.channel);
    if (r2) out[r2.status]++;
  }
  res.json(out);
});

// Bulk: activate one channel for all available vehicles.
r.post('/channel/:channel/all', async (req, res) => {
  chan(req.params.channel);
  const active = req.body?.active === false ? 0 : 1;
  const vs = await q(`SELECT id FROM vehicles WHERE status<>'Vendido'`);
  for (const v of vs) {
    await q(`INSERT INTO publications (vehicle_id, channel, active, status) VALUES (?,?,?,'pendente') ON DUPLICATE KEY UPDATE active=VALUES(active)`,
      [v.id, req.params.channel, active]);
    await syncPublication(v.id, req.params.channel);
  }
  res.json({ ok: true, count: vs.length });
});

export default r;
