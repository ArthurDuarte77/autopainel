import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { q, one } from '../db.js';
import { markSold, notifyMatches, syncVehicle, label } from '../core.js';

const r = Router();
const FIELDS = ['brand', 'model', 'version', 'body_type', 'year', 'km', 'plate', 'color', 'fuel', 'transmission', 'doors',
  'price', 'cost', 'prep_cost', 'status', 'description', 'seller_id'];
export const pick = (src, keys) => Object.fromEntries(keys.filter(k => src?.[k] !== undefined).map(k => [k, src[k] === '' ? null : src[k]]));
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const parse = (v) => v && ({ ...v, photos: typeof v.photos === 'string' ? JSON.parse(v.photos) : v.photos || [] });

const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads',
    filename: (req, f, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(f.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});

r.get('/', async (req, res) => {
  const w = [], p = [];
  const { status, brand, body_type, fuel, search, price_min, price_max, year_min } = req.query;
  if (status) { w.push('v.status=?'); p.push(status); }
  if (brand) { w.push('v.brand=?'); p.push(brand); }
  if (body_type) { w.push('v.body_type=?'); p.push(body_type); }
  if (fuel) { w.push('v.fuel=?'); p.push(fuel); }
  if (price_min) { w.push('v.price>=?'); p.push(price_min); }
  if (price_max) { w.push('v.price<=?'); p.push(price_max); }
  if (year_min) { w.push('v.year>=?'); p.push(year_min); }
  if (search) { w.push('CONCAT_WS(" ",v.brand,v.model,v.version,v.plate,v.color) LIKE ?'); p.push(`%${search}%`); }
  const rows = await q(`SELECT v.*, s.name seller_name, DATEDIFF(COALESCE(v.sold_at, CURDATE()), DATE(v.created_at)) days_in_stock,
      (SELECT COUNT(*) FROM publications pb WHERE pb.vehicle_id=v.id AND pb.status='publicado') published_count
    FROM vehicles v LEFT JOIN sellers s ON s.id=v.seller_id ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY v.created_at DESC`, p);
  res.json(rows.map(parse));
});

r.get('/brands', async (req, res) => res.json((await q('SELECT DISTINCT brand FROM vehicles ORDER BY brand')).map(x => x.brand)));

r.get('/:id', async (req, res) => {
  const v = parse(await one('SELECT v.*, s.name seller_name FROM vehicles v LEFT JOIN sellers s ON s.id=v.seller_id WHERE v.id=?', [req.params.id]));
  if (!v) throw bad('Veículo não encontrado', 404);
  v.publications = await q('SELECT * FROM publications WHERE vehicle_id=?', [v.id]);
  v.transactions = await q('SELECT * FROM transactions WHERE vehicle_id=? ORDER BY date DESC', [v.id]);
  res.json(v);
});

function validate(d, partial) {
  for (const k of ['brand', 'model', 'year', 'price']) if (!partial && !d[k]) throw bad(`Campo obrigatório: ${k}`);
  if (d.plate) d.plate = String(d.plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (d.year && (d.year < 1950 || d.year > new Date().getFullYear() + 1)) throw bad('Ano inválido');
  return d;
}

async function afterSave(id, res, status = 200) {
  await notifyMatches(id).catch(() => 0);
  await syncVehicle(id).catch(() => {});
  res.status(status).json(parse(await one('SELECT * FROM vehicles WHERE id=?', [id])));
}

r.post('/', async (req, res) => {
  const d = validate(pick(req.body, FIELDS));
  if (d.status === 'Vendido') d.status = 'Disponível'; // a sale goes through /sell so finance records are created
  try {
    const { insertId } = await q('INSERT INTO vehicles SET ?', [{ ...d, photos: '[]' }]);
    await afterSave(insertId, res, 201);
  } catch (e) { if (e.code === 'ER_DUP_ENTRY') throw bad('Placa já cadastrada', 409); throw e; }
});

r.put('/:id', async (req, res) => {
  const cur = await one('SELECT * FROM vehicles WHERE id=?', [req.params.id]);
  if (!cur) throw bad('Veículo não encontrado', 404);
  const d = validate(pick(req.body, FIELDS), true);
  const selling = d.status === 'Vendido' && cur.status !== 'Vendido';
  if (selling) delete d.status;
  try { if (Object.keys(d).length) await q('UPDATE vehicles SET ? WHERE id=?', [d, cur.id]); }
  catch (e) { if (e.code === 'ER_DUP_ENTRY') throw bad('Placa já cadastrada', 409); throw e; }
  if (selling) return res.json(parse(await markSold(cur.id, req.body)));
  await afterSave(cur.id, res);
});

r.post('/:id/sell', async (req, res) => {
  const v = await one('SELECT status FROM vehicles WHERE id=?', [req.params.id]);
  if (!v) throw bad('Veículo não encontrado', 404);
  if (v.status === 'Vendido') throw bad('Veículo já vendido', 409);
  res.json(parse(await markSold(req.params.id, req.body || {})));
});

r.delete('/:id', async (req, res) => {
  const v = parse(await one('SELECT * FROM vehicles WHERE id=?', [req.params.id]));
  if (!v) throw bad('Veículo não encontrado', 404);
  await q('UPDATE publications SET active=0 WHERE vehicle_id=?', [v.id]);
  await syncVehicle(v.id).catch(() => {}); // take listings down before deleting
  await q('DELETE FROM vehicles WHERE id=?', [v.id]);
  for (const p of v.photos) if (p.startsWith('/uploads/')) await fs.unlink(p.slice(1)).catch(() => {});
  res.json({ ok: true, label: label(v) });
});

r.post('/:id/photos', upload.array('photos', 20), async (req, res) => {
  const v = parse(await one('SELECT * FROM vehicles WHERE id=?', [req.params.id]));
  if (!v) throw bad('Veículo não encontrado', 404);
  if (!req.files?.length) throw bad('Envie imagens JPG, PNG ou WEBP');
  const photos = [...v.photos, ...req.files.map(f => `/uploads/${f.filename}`)];
  await q('UPDATE vehicles SET photos=? WHERE id=?', [JSON.stringify(photos), v.id]);
  syncVehicle(v.id).catch(() => {});
  res.json({ photos });
});

r.delete('/:id/photos', async (req, res) => {
  const v = parse(await one('SELECT * FROM vehicles WHERE id=?', [req.params.id]));
  if (!v) throw bad('Veículo não encontrado', 404);
  const url = String(req.query.url || '');
  const photos = v.photos.filter(p => p !== url);
  await q('UPDATE vehicles SET photos=? WHERE id=?', [JSON.stringify(photos), v.id]);
  if (url.startsWith('/uploads/') && !url.includes('..')) await fs.unlink(url.slice(1)).catch(() => {});
  res.json({ photos });
});

export default r;
