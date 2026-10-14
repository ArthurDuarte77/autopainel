import { Router } from 'express';
import { q, one } from '../db.js';
import { fipe, lookupPlate, marketRefs, appraise, average, APPRAISAL_DEFAULTS } from '../services.js';

const r = Router();
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const json = (x, d) => (x == null ? d : typeof x === 'string' ? JSON.parse(x) : x);
const parse = (a) => a && ({ ...a, market_refs: json(a.market_refs, []), params: json(a.params, {}) });

r.get('/defaults', (req, res) => res.json(APPRAISAL_DEFAULTS));

// Plate → vehicle data (+ FIPE when the plate API returns it, else best-effort FIPE name search).
r.get('/plate/:plate', async (req, res) => {
  const v = await lookupPlate(req.params.plate);
  if (!v.fipe_price && v.brand && v.model && v.year) {
    const f = await fipe.search(v.brand, v.model, v.year).catch(() => null);
    if (f) Object.assign(v, { fipe_code: f.codeFipe, fipe_price: f.value });
  }
  res.json(v);
});

// FIPE cascade (brand → model → year → price) and name search.
r.get('/fipe/brands', async (req, res) => res.json(await fipe.brands()));
r.get('/fipe/brands/:b/models', async (req, res) => res.json(await fipe.models(req.params.b)));
r.get('/fipe/brands/:b/models/:m/years', async (req, res) => res.json(await fipe.years(req.params.b, req.params.m)));
r.get('/fipe/brands/:b/models/:m/years/:y', async (req, res) => res.json(await fipe.price(req.params.b, req.params.m, req.params.y)));
r.get('/fipe/search', async (req, res) => {
  const { brand, model, year } = req.query;
  if (!brand || !model || !year) throw bad('Informe marca, modelo e ano');
  try { res.json(await fipe.search(brand, model, year)); } catch (e) { throw e.status ? e : bad(e.message, 404); }
});

// Market references from Mercado Livre listings.
r.get('/market', async (req, res) => {
  if (!req.query.q) throw bad('Informe o modelo');
  const refs = await marketRefs(String(req.query.q), req.query.year);
  res.json({ refs, average: Math.round(average(refs.map(x => x.price))) });
});

// Market value = average of FIPE + manual/market refs (whatever is provided).
r.post('/calculate', (req, res) => {
  const b = req.body || {};
  const refs = (b.market_refs || []).map(x => Number(x.price ?? x));
  const market = Number(b.market_value) || average([...refs, ...(b.use_fipe === false ? [] : [b.fipe_price])]);
  if (!market) throw bad('Informe FIPE ou referências de mercado');
  res.json(appraise(market, b.params));
});

r.get('/', async (req, res) => res.json((await q('SELECT * FROM appraisals ORDER BY created_at DESC LIMIT 200')).map(parse)));

r.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.model) throw bad('Informe o modelo');
  const refs = b.market_refs || [];
  const market = Number(b.market_value) || average([...refs.map(x => x.price), b.fipe_price]);
  if (!market) throw bad('Informe FIPE ou referências de mercado');
  const a = appraise(market, b.params);
  const row = { plate: b.plate ? String(b.plate).toUpperCase().replace(/[^A-Z0-9]/g, '') : null, model: b.model, year: b.year || null,
    color: b.color || null, fipe_code: b.fipe_code || null, fipe_price: b.fipe_price || null, market_refs: JSON.stringify(refs),
    market_value: a.market_value, params: JSON.stringify(a.params), max_price: a.max_price, est_profit: a.est_profit };
  const { insertId } = await q('INSERT INTO appraisals SET ?', [row]);
  res.status(201).json(parse(await one('SELECT * FROM appraisals WHERE id=?', [insertId])));
});

r.delete('/:id', async (req, res) => {
  const { affectedRows } = await q('DELETE FROM appraisals WHERE id=?', [req.params.id]);
  if (!affectedRows) throw bad('Avaliação não encontrada', 404);
  res.json({ ok: true });
});

export default r;
