import { Router } from 'express';
import { q, one, log } from '../db.js';
import { pick } from './vehicles.js';
import { env } from '../http.js';
import { sendMail, toCSV } from '../services.js';

const r = Router();
const FIELDS = ['date', 'description', 'type', 'category', 'amount', 'status', 'vehicle_id', 'seller_id', 'document'];
const TYPES = ['Receber', 'Pagar'];
const CATS = ['venda', 'sinal', 'comissao', 'preparacao', 'anuncio', 'aluguel', 'fornecedor', 'imposto', 'outros'];
const STATUS = ['Pago', 'Pendente'];
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const month = (m) => (/^\d{4}-\d{2}$/.test(m || '') ? m : null);

function filters(qs) {
  const w = [], p = [];
  if (month(qs.month)) { w.push("DATE_FORMAT(t.date,'%Y-%m')=?"); p.push(qs.month); }
  for (const k of ['type', 'status', 'category']) if (qs[k]) { w.push(`t.${k}=?`); p.push(qs[k]); }
  if (qs.search) { w.push('CONCAT_WS(" ",t.description,t.document) LIKE ?'); p.push(`%${qs.search}%`); }
  return [w.length ? `WHERE ${w.join(' AND ')}` : '', p];
}

const list = async (qs) => {
  const [where, p] = filters(qs);
  return q(`SELECT t.*, s.name seller_name, CONCAT_WS(' ',v.brand,v.model,v.year) vehicle_label
    FROM transactions t LEFT JOIN sellers s ON s.id=t.seller_id LEFT JOIN vehicles v ON v.id=t.vehicle_id
    ${where} ORDER BY t.date DESC, t.id DESC`, p);
};

r.get('/', async (req, res) => res.json(await list(req.query)));

// Cards: saldo (cash realized all-time), a receber / a pagar (pending), comissões do mês.
r.get('/summary', async (req, res) => {
  const m = month(req.query.month) || new Date().toISOString().slice(0, 7);
  const s = await one(`SELECT
      COALESCE(SUM(CASE WHEN status='Pago' THEN IF(type='Receber',amount,-amount) END),0) saldo,
      COALESCE(SUM(CASE WHEN status='Pendente' AND type='Receber' THEN amount END),0) a_receber,
      COALESCE(SUM(CASE WHEN status='Pendente' AND type='Pagar' THEN amount END),0) a_pagar,
      COALESCE(SUM(CASE WHEN category='comissao' AND DATE_FORMAT(date,'%Y-%m')=? THEN amount END),0) comissoes_mes,
      COALESCE(SUM(CASE WHEN type='Receber' AND DATE_FORMAT(date,'%Y-%m')=? THEN amount END),0) entradas_mes,
      COALESCE(SUM(CASE WHEN type='Pagar' AND DATE_FORMAT(date,'%Y-%m')=? THEN amount END),0) saidas_mes
    FROM transactions`, [m, m, m]);
  res.json({ month: m, ...s });
});

const COLS = [['date', 'Data'], ['description', 'Descrição'], ['type', 'Tipo'], ['category', 'Categoria'], ['amount', 'Valor'],
  ['status', 'Status'], ['vehicle_label', 'Veículo'], ['seller_name', 'Vendedor'], ['document', 'Documento']];

r.get('/export.csv', async (req, res) => {
  res.attachment(`financeiro-${month(req.query.month) || 'completo'}.csv`).type('text/csv; charset=utf-8').send(toCSV(await list(req.query), COLS));
});

// Sends the month's CSV to the accountant via SMTP.
r.post('/send-accountant', async (req, res) => {
  const to = req.body?.email || env('ACCOUNTANT_EMAIL');
  if (!to) throw bad('Informe o e-mail do contador (ACCOUNTANT_EMAIL no .env)');
  const m = month(req.body?.month) || new Date().toISOString().slice(0, 7);
  const rows = await list({ month: m });
  const store = env('STORE_NAME', 'AutoPainel');
  try {
    await sendMail({ to, subject: `${store} — Lançamentos ${m}`,
      text: `Olá,\n\nSegue em anexo o relatório financeiro de ${m} (${rows.length} lançamentos).\n\n${store}`,
      attachments: [{ filename: `financeiro-${m}.csv`, content: toCSV(rows, COLS) }] });
    await log('smtp', `contador ${m}`, true, to);
  } catch (e) { await log('smtp', `contador ${m}`, false, e.message); throw e; }
  res.json({ ok: true, to, count: rows.length });
});

function validate(d, partial) {
  for (const k of ['date', 'description', 'type', 'amount']) if (!partial && !d[k]) throw bad(`Campo obrigatório: ${k}`);
  if (d.type && !TYPES.includes(d.type)) throw bad('Tipo inválido');
  if (d.category && !CATS.includes(d.category)) throw bad('Categoria inválida');
  if (d.status && !STATUS.includes(d.status)) throw bad('Status inválido');
  if (d.amount != null && !(Number(d.amount) > 0)) throw bad('Valor deve ser positivo');
  return d;
}

r.post('/', async (req, res) => {
  const d = validate(pick(req.body, FIELDS));
  const { insertId } = await q('INSERT INTO transactions SET ?', [{ category: 'outros', status: 'Pendente', ...d }]);
  res.status(201).json(await one('SELECT * FROM transactions WHERE id=?', [insertId]));
});

r.put('/:id', async (req, res) => {
  const d = validate(pick(req.body, FIELDS), true);
  if (!(await one('SELECT id FROM transactions WHERE id=?', [req.params.id]))) throw bad('Lançamento não encontrado', 404);
  if (Object.keys(d).length) await q('UPDATE transactions SET ? WHERE id=?', [d, req.params.id]);
  res.json(await one('SELECT * FROM transactions WHERE id=?', [req.params.id]));
});

r.delete('/:id', async (req, res) => {
  const { affectedRows } = await q('DELETE FROM transactions WHERE id=?', [req.params.id]);
  if (!affectedRows) throw bad('Lançamento não encontrado', 404);
  res.json({ ok: true });
});

export default r;
