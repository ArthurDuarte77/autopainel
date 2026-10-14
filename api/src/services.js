// FIPE, plate lookup, market references, appraisal math, lead matching, e-mail and WhatsApp.
import nodemailer from 'nodemailer';
import { http, env, has } from './http.js';
import { getToken } from './db.js';

// ---------------------------------------------------------------- FIPE (parallelum v2)
const fipeH = () => (has('FIPE_TOKEN') ? { 'X-Subscription-Token': env('FIPE_TOKEN') } : {});
const fipeGet = (path) => http(`${env('FIPE_API_URL', 'https://fipe.parallelum.com.br/api/v2')}${path}`, { headers: fipeH() });
export const parseBRL = (s) => Number(String(s ?? '').replace(/[^\d,]/g, '').replace(',', '.')) || 0;

export const fipe = {
  brands: (type = 'cars') => fipeGet(`/${type}/brands`),
  models: (b, type = 'cars') => fipeGet(`/${type}/brands/${b}/models`),
  years: (b, m, type = 'cars') => fipeGet(`/${type}/brands/${b}/models/${m}/years`),
  async price(b, m, y, type = 'cars') {
    const r = await fipeGet(`/${type}/brands/${b}/models/${m}/years/${y}`);
    return { ...r, value: parseBRL(r.price) };
  },
  async byCode(code, year) {
    const years = await fipeGet(`/cars/${code}/years`);
    const y = years.find(x => x.code.startsWith(`${year}-`)) || years[0];
    const r = await fipeGet(`/cars/${code}/years/${y.code}`);
    return { ...r, value: parseBRL(r.price) };
  },
  // Best-effort lookup by names (used when plate API is not configured).
  async search(brand, model, year) {
    const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const b = (await this.brands()).find(x => norm(x.name).includes(norm(brand)) || norm(brand).includes(norm(x.name)));
    if (!b) throw new Error(`Marca não encontrada na FIPE: ${brand}`);
    const words = norm(model).split(/\s+/).filter(Boolean);
    const models = (await this.models(b.code)).filter(x => words.every(w => norm(x.name).includes(w)));
    for (const m of models.slice(0, 8)) {
      const y = (await this.years(b.code, m.code)).find(x => x.code.startsWith(`${year}-`));
      if (y) return this.price(b.code, m.code, y.code);
    }
    throw new Error(`Modelo/ano não encontrado na FIPE: ${model} ${year}`);
  },
};

// ---------------------------------------------------------------- Plate lookup (wdapi2-compatible)
export async function lookupPlate(plate) {
  const p = String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p)) throw Object.assign(new Error('Placa inválida'), { status: 400 });
  if (!has('PLATE_API_TOKEN')) throw Object.assign(new Error('Consulta de placa não configurada (PLATE_API_TOKEN). Preencha marca/modelo/ano manualmente.'), { status: 501 });
  const r = await http(`${env('PLATE_API_URL').replace(/\/$/, '')}/${p}/${env('PLATE_API_TOKEN')}`);
  const best = (r.fipe?.dados || []).sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  return {
    plate: p, brand: r.MARCA || r.marca, model: r.MODELO || r.modelo, version: r.VERSAO || r.versao || '',
    year: Number(r.anoModelo || r.ano) || null, color: r.cor || r.COR || '', fuel: r.combustivel || '',
    fipe_code: best?.codigo_fipe || null, fipe_price: best ? parseBRL(best.texto_valor) : null,
  };
}

// ---------------------------------------------------------------- Market references (Mercado Livre search)
export async function marketRefs(query, year) {
  const t = await getToken('mercadolivre').catch(() => null);
  const headers = t?.access_token ? { Authorization: `Bearer ${t.access_token}` } : {};
  const r = await http(`https://api.mercadolibre.com/sites/${env('ML_SITE_ID', 'MLB')}/search?category=${env('ML_CATEGORY_ID', 'MLB1744')}&q=${encodeURIComponent(`${query} ${year || ''}`.trim())}&limit=20`, { headers });
  return (r.results || []).filter(x => x.price > 0).slice(0, 10)
    .map(x => ({ source: 'Mercado Livre', title: x.title, price: x.price, url: x.permalink }));
}

// ---------------------------------------------------------------- Appraisal math
// Profit target is a % of the expected sale price; everything else is cost.
// max = market − margin − commission − prep − docs − other
export const APPRAISAL_DEFAULTS = { margin_pct: 12, commission_pct: 2, prep_cost: 3800, docs_cost: 974, other_cost: 1000 };
export function appraise(market, params = {}) {
  const p = { ...APPRAISAL_DEFAULTS, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)])) };
  const profit = market * p.margin_pct / 100;
  const commission = market * p.commission_pct / 100;
  const costs = commission + p.prep_cost + p.docs_cost + p.other_cost;
  const max = Math.max(0, market - profit - costs);
  return { params: p, market_value: Math.round(market), costs: Math.round(costs), max_price: Math.round(max), est_profit: Math.round(profit) };
}
export const average = (nums) => { const v = nums.map(Number).filter(n => n > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };

// ---------------------------------------------------------------- Lead ↔ stock matching
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
export function matches(lead, v) {
  if (!['Disponível', 'Em preparação'].includes(v.status)) return false;
  const crit = [lead.brand, lead.model, lead.body_type, lead.fuel, lead.year_min, lead.price_max].some(x => x != null && x !== '');
  if (!crit) return false;
  if (lead.brand && norm(lead.brand) !== norm(v.brand)) return false;
  if (lead.model && !norm(v.model).includes(norm(lead.model))) return false;
  if (lead.body_type && norm(lead.body_type) !== norm(v.body_type)) return false;
  if (lead.fuel && norm(lead.fuel) !== norm(v.fuel)) return false;
  if (lead.year_min && Number(v.year) < Number(lead.year_min)) return false;
  if (lead.price_max && Number(v.price) > Number(lead.price_max)) return false;
  return true;
}

// ---------------------------------------------------------------- E-mail
export async function sendMail({ to, subject, text, attachments }) {
  if (!has('SMTP_HOST')) throw Object.assign(new Error('SMTP não configurado no .env (SMTP_HOST)'), { status: 501 });
  const t = nodemailer.createTransport({
    host: env('SMTP_HOST'), port: Number(env('SMTP_PORT', '587')), secure: env('SMTP_SECURE') === 'true',
    auth: has('SMTP_USER') ? { user: env('SMTP_USER'), pass: env('SMTP_PASS') } : undefined,
  });
  return t.sendMail({ from: env('SMTP_FROM', env('SMTP_USER')), to, subject, text, attachments });
}

export function toCSV(rows, cols) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const c2 = cols.map(c => (Array.isArray(c) ? c : [c, c])); // key or [key, header]
  return '﻿' + [c2.map(c => esc(c[1])).join(';'), ...rows.map(r => c2.map(([k]) => esc(r[k])).join(';'))].join('\n');
}

// ---------------------------------------------------------------- WhatsApp Cloud API
export const whatsappConfigured = () => has('WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID');
export async function sendWhatsApp(phone, body) {
  if (!whatsappConfigured()) throw Object.assign(new Error('WhatsApp não configurado'), { status: 501 });
  let to = String(phone).replace(/\D/g, '');
  if (to.length <= 11) to = `55${to}`;
  return http(`https://graph.facebook.com/v21.0/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}` },
    body: { messaging_product: 'whatsapp', to, type: 'text', text: { body } } });
}
