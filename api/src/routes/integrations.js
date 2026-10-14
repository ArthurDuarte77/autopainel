import { Router } from 'express';
import { q, log, getToken } from '../db.js';
import { signToken, verifyToken } from '../auth.js';
import { env, has, publicUrl } from '../http.js';
import { channels } from '../integrations/channels.js';
import { crms } from '../integrations/crms.js';
import { importLeads } from '../core.js';
import { whatsappConfigured } from '../services.js';

// .env keys each integration needs (shown in the Integrações page).
const ENV_KEYS = {
  mercadolivre: ['ML_CLIENT_ID', 'ML_CLIENT_SECRET'], olx: ['OLX_CLIENT_ID', 'OLX_CLIENT_SECRET'], site: ['SITE_WEBHOOK_URL (opcional)', 'SITE_WEBHOOK_SECRET'],
  tray: ['TRAY_CONSUMER_KEY', 'TRAY_CONSUMER_SECRET', 'TRAY_API_ADDRESS', 'TRAY_CODE'], nuvemshop: ['NUVEMSHOP_STORE_ID', 'NUVEMSHOP_ACCESS_TOKEN'],
  shopify: ['SHOPIFY_SHOP', 'SHOPIFY_ACCESS_TOKEN'], woocommerce: ['WOOCOMMERCE_URL', 'WOOCOMMERCE_CONSUMER_KEY', 'WOOCOMMERCE_CONSUMER_SECRET'],
  lojaintegrada: ['LOJA_INTEGRADA_API_KEY', 'LOJA_INTEGRADA_APP_KEY'],
  rdstation: ['RDSTATION_CRM_TOKEN'], rdmarketing: ['RDSTATION_MARKETING_API_KEY'], hubspot: ['HUBSPOT_ACCESS_TOKEN'],
  pipedrive: ['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN'],
  salesforce: ['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_USERNAME', 'SALESFORCE_PASSWORD', 'SALESFORCE_SECURITY_TOKEN'],
  bitrix24: ['BITRIX24_WEBHOOK_URL'], zoho: ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'], ploomes: ['PLOOMES_USER_KEY'], agendor: ['AGENDOR_API_TOKEN'],
  fipe: ['FIPE_TOKEN (opcional)'], plate: ['PLATE_API_URL', 'PLATE_API_TOKEN'],
  smtp: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'ACCOUNTANT_EMAIL'], whatsapp: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN'],
};

// ---------------------------------------------------------------- Protected
const r = Router();

r.get('/', async (req, res) => {
  const tokens = Object.fromEntries((await q('SELECT provider, expires_at, updated_at FROM integration_tokens')).map(t => [t.provider, t]));
  const lastLogs = Object.fromEntries((await q(`SELECT l.* FROM sync_logs l JOIN (SELECT provider, MAX(id) id FROM sync_logs GROUP BY provider) m ON m.id=l.id`)).map(l => [l.provider, l]));
  const row = (x, extra = {}) => ({ id: x.id, name: x.name, configured: x.configured(), env: ENV_KEYS[x.id] || [], last_log: lastLogs[x.id] || null, ...extra });
  res.json({
    channels: Object.values(channels).map(c => row(c, { kind: c.kind, oauth: !!c.oauth, connected: c.oauth ? !!tokens[c.id] : c.configured(), connected_at: tokens[c.id]?.updated_at || null })),
    crms: Object.values(crms).map(c => row(c, { pull: !!c.pull, connected: c.configured() })),
    services: [
      { id: 'fipe', name: 'Tabela FIPE', configured: true, connected: true, env: ENV_KEYS.fipe, note: has('FIPE_TOKEN') ? 'Com token (limite maior)' : 'Plano gratuito' },
      { id: 'plate', name: 'Consulta de placa', configured: has('PLATE_API_TOKEN'), connected: has('PLATE_API_TOKEN'), env: ENV_KEYS.plate },
      { id: 'smtp', name: 'E-mail (SMTP) / Contador', configured: has('SMTP_HOST'), connected: has('SMTP_HOST'), env: ENV_KEYS.smtp, note: env('ACCOUNTANT_EMAIL') },
      { id: 'whatsapp', name: 'WhatsApp Cloud API', configured: whatsappConfigured(), connected: whatsappConfigured(), env: ENV_KEYS.whatsapp,
        note: `Webhook: ${publicUrl()}/api/webhooks/whatsapp` },
    ].map(s => ({ ...s, last_log: lastLogs[s.id] || null })),
    webhooks: {
      mercadolivre: `${publicUrl()}/api/webhooks/mercadolivre`, olx: `${publicUrl()}/api/webhooks/olx`,
      whatsapp: `${publicUrl()}/api/webhooks/whatsapp`, site_leads: `${publicUrl()}/api/public/leads`, feed: `${publicUrl()}/api/public/feed.xml`,
    },
  });
});

r.get('/logs', async (req, res) => {
  const p = req.query.provider;
  res.json(await q(`SELECT * FROM sync_logs ${p ? 'WHERE provider=?' : ''} ORDER BY id DESC LIMIT ?`, [...(p ? [p] : []), Math.min(Number(req.query.limit) || 100, 500)]));
});

r.get('/:id/connect', (req, res) => {
  const c = channels[req.params.id];
  if (!c?.oauth) throw Object.assign(new Error('Integração sem OAuth'), { status: 400 });
  if (!c.configured()) throw Object.assign(new Error(`Preencha ${ENV_KEYS[c.id].join(', ')} no .env e reinicie a API`), { status: 400 });
  res.json({ url: c.oauth.url(signToken({ oauth: c.id, uid: req.user.id }, 600)) });
});

const crm = (id) => {
  const c = crms[id];
  if (!c) throw Object.assign(new Error('CRM inválido'), { status: 400 });
  if (!c.configured()) throw Object.assign(new Error(`${c.name} não configurado. Preencha ${ENV_KEYS[id].join(', ')} no .env`), { status: 400 });
  return c;
};

// Import leads/deals from a CRM into the local kanban.
r.post('/crm/:id/pull', async (req, res) => {
  const c = crm(req.params.id);
  if (!c.pull) throw Object.assign(new Error(`${c.name} só recebe leads (envio)`), { status: 400 });
  try { res.json(await importLeads(c.id, await c.pull())); }
  catch (e) { await log(c.id, 'pull', false, e.message); throw e; }
});

// Push every open lead to one CRM (test / initial load).
r.post('/crm/:id/push-all', async (req, res) => {
  const c = crm(req.params.id);
  const leads = await q(`SELECT * FROM leads WHERE stage NOT IN ('Perdido') ORDER BY id`);
  let ok = 0; const errors = [];
  for (const l of leads) {
    const refs = typeof l.crm_refs === 'string' ? JSON.parse(l.crm_refs) : l.crm_refs || {};
    try { refs[c.id] = await c.push(l, refs[c.id] || null); ok++; await q('UPDATE leads SET crm_refs=? WHERE id=?', [JSON.stringify(refs), l.id]); }
    catch (e) { errors.push(`#${l.id}: ${e.message}`); }
  }
  await log(c.id, 'push all', !errors.length, `${ok}/${leads.length}${errors.length ? ' — ' + errors[0] : ''}`);
  res.json({ ok, total: leads.length, errors });
});

// Mercado Livre unanswered questions → leads.
r.post('/mercadolivre/questions', async (req, res) => {
  if (!(await getToken('mercadolivre'))) throw Object.assign(new Error('Conecte o Mercado Livre primeiro'), { status: 400 });
  res.json(await importLeads('mercadolivre', await channels.mercadolivre.importLeads()));
});

r.delete('/:id/token', async (req, res) => {
  await q('DELETE FROM integration_tokens WHERE provider=?', [req.params.id]);
  await log(req.params.id, 'disconnect', true);
  res.json({ ok: true });
});

export default r;

// ---------------------------------------------------------------- Public: OAuth callback + webhooks
export const publicIntegrations = Router();

publicIntegrations.get('/integrations/:id/callback', async (req, res) => {
  const c = channels[req.params.id];
  const back = (qs) => res.redirect(`${publicUrl()}/integracoes?${qs}`);
  const st = verifyToken(req.query.state || '');
  if (!c?.oauth || !st || st.oauth !== c.id) return back('error=' + encodeURIComponent('Estado OAuth inválido ou expirado'));
  if (!req.query.code) return back('error=' + encodeURIComponent(String(req.query.error_description || req.query.error || 'Sem código')));
  try {
    await c.oauth.callback(String(req.query.code));
    await log(c.id, 'oauth connect', true);
    back(`connected=${c.id}`);
  } catch (e) {
    await log(c.id, 'oauth connect', false, e.message);
    back('error=' + encodeURIComponent(e.message));
  }
});

// Mercado Livre notifications (configure the URL in the ML app; topic "questions").
publicIntegrations.post('/webhooks/mercadolivre', async (req, res) => {
  res.sendStatus(200); // ML requires a fast 200
  const { topic, resource } = req.body || {};
  if (!['questions', 'messages'].includes(topic)) return;
  try { await importLeads('mercadolivre', await channels.mercadolivre.importLeads()); }
  catch (e) { await log('mercadolivre', `webhook ${topic} ${resource || ''}`, false, e.message); }
});

// OLX lead webhook (chat/contact on an ad). Accepts the common payload shapes.
publicIntegrations.post('/webhooks/olx', async (req, res) => {
  const b = req.body || {};
  if (has('OLX_WEBHOOK_TOKEN') && (req.query.token || req.headers['x-token']) !== env('OLX_WEBHOOK_TOKEN')) return res.sendStatus(401);
  const items = (Array.isArray(b) ? b : [b]).map(x => ({
    external: `olx-${x.leadId || x.id || x.chatId || Date.now()}`, name: x.name || x.buyer?.name || 'Interessado OLX',
    phone: x.phone || x.buyer?.phone, email: x.email || x.buyer?.email, interest: x.message || x.subject || 'Contato via OLX',
    item_id: x.adId || x.listId || x.ad_id,
  }));
  res.json(await importLeads('olx', items));
});

// Nuvemshop mandatory LGPD webhooks (store-redact, customers-redact, customers-data-request).
// We only push vehicles as products and keep no Nuvemshop customer data, so there is nothing to erase/export: ack + log.
// ponytail: no x-linkedstore-hmac-sha256 check since nothing is acted on; add it if these ever touch data.
publicIntegrations.post('/webhooks/nuvemshop/:topic', async (req, res) => {
  res.sendStatus(200);
  await log('nuvemshop', `lgpd ${req.params.topic} store ${req.body?.store_id ?? '?'}`, true);
});

// WhatsApp Cloud API: verification + incoming messages become leads.
publicIntegrations.get('/webhooks/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === env('WHATSAPP_VERIFY_TOKEN', 'autopainel')) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});
publicIntegrations.post('/webhooks/whatsapp', async (req, res) => {
  res.sendStatus(200);
  const items = [];
  for (const e of req.body?.entry || []) for (const ch of e.changes || []) {
    const v = ch.value || {};
    for (const m of v.messages || []) {
      const contact = (v.contacts || []).find(c => c.wa_id === m.from);
      items.push({ external: `wa-${m.from}`, name: contact?.profile?.name || `WhatsApp ${m.from}`, phone: m.from,
        interest: m.text?.body || 'Contato via WhatsApp', notes: m.text?.body });
    }
  }
  if (items.length) await importLeads('whatsapp', items).catch(e => log('whatsapp', 'webhook', false, e.message));
});
