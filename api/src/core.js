// Domain workflows shared by routes and webhooks: publishing, sales, lead matching, CRM sync, lead import.
import { q, one, log } from './db.js';
import { channels } from './integrations/channels.js';
import { crms } from './integrations/crms.js';
import { matches, sendWhatsApp, whatsappConfigured } from './services.js';
import { env } from './http.js';

export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: env('TZ', 'America/Sao_Paulo') });
export const label = (v) => (v ? `${v.brand} ${v.model} ${v.version || ''} ${v.year}`.replace(/\s+/g, ' ').trim() : null);
const json = (x, d) => (x == null ? d : typeof x === 'string' ? JSON.parse(x) : x);

// ---------------------------------------------------------------- Publications
export async function syncPublication(vehicleId, channel) {
  const v = await one('SELECT * FROM vehicles WHERE id=?', [vehicleId]);
  const pub = await one('SELECT * FROM publications WHERE vehicle_id=? AND channel=?', [vehicleId, channel]);
  const a = channels[channel];
  if (!v || !pub || !a) return null;
  const live = pub.active && v.status !== 'Vendido';
  const set = (f) => q('UPDATE publications SET status=?, last_error=?, external_id=?, external_url=?, last_sync_at=NOW() WHERE id=?',
    [f.status, f.error || null, 'external_id' in f ? f.external_id : pub.external_id, 'external_url' in f ? f.external_url : pub.external_url, pub.id]);

  if (!a.configured()) {
    await set({ status: live ? 'pendente' : 'inativo', error: live ? `${a.name} não configurado (.env)` : null });
  } else {
    try {
      if (live) {
        const r = await a.publish(v, pub);
        await set({ status: 'publicado', ...r });
        await log(channel, `publish #${v.id}`, true, r.external_url || r.external_id);
      } else {
        const keep = pub.external_id ? await a.unpublish(v, pub) : true;
        await set(keep ? { status: 'inativo' } : { status: 'inativo', external_id: null, external_url: null });
        if (pub.external_id) await log(channel, `unpublish #${v.id}`, true);
      }
    } catch (e) {
      await set({ status: 'erro', error: e.message });
      await log(channel, `${live ? 'publish' : 'unpublish'} #${v.id}`, false, e.message);
    }
  }
  return one('SELECT * FROM publications WHERE id=?', [pub.id]);
}

export async function syncVehicle(vehicleId) {
  const pubs = await q('SELECT channel FROM publications WHERE vehicle_id=? AND (active=1 OR external_id IS NOT NULL OR status<>"inativo")', [vehicleId]);
  for (const p of pubs) await syncPublication(vehicleId, p.channel);
}

// ---------------------------------------------------------------- Sale
export async function markSold(id, { sold_price, sold_at, seller_id, lead_id } = {}) {
  const v = await one('SELECT * FROM vehicles WHERE id=?', [id]);
  if (!v) throw Object.assign(new Error('Veículo não encontrado'), { status: 404 });
  const price = Number(sold_price || v.price);
  const date = sold_at || today();
  const seller = seller_id || v.seller_id || null;
  await q('UPDATE vehicles SET status="Vendido", sold_price=?, sold_at=?, seller_id=? WHERE id=?', [price, date, seller, id]);
  await q('INSERT INTO transactions SET ?', [{ date, description: `Venda ${label(v)}`, type: 'Receber', category: 'venda', amount: price, status: 'Pago', vehicle_id: id, seller_id: seller }]);
  if (seller) {
    const s = await one('SELECT * FROM sellers WHERE id=?', [seller]);
    if (s && Number(s.commission_pct) > 0) {
      await q('INSERT INTO transactions SET ?', [{ date, description: `Comissão ${s.name} — ${v.model}`, type: 'Pagar', category: 'comissao',
        amount: Math.round(price * Number(s.commission_pct)) / 100, status: 'Pendente', vehicle_id: id, seller_id: seller }]);
    }
  }
  if (lead_id) {
    await q('UPDATE leads SET stage="Fechado", vehicle_id=? WHERE id=?', [id, lead_id]);
    pushLeadToCrms(lead_id).catch(() => {});
  }
  await syncVehicle(id); // closes every listing
  return one('SELECT * FROM vehicles WHERE id=?', [id]);
}

// ---------------------------------------------------------------- Lead ↔ stock
export const OPEN_STAGES = ['Novo', 'Em contato', 'Proposta', 'Negociação'];

export async function opportunities() {
  const leads = await q(`SELECT * FROM leads WHERE stage IN (?) ORDER BY created_at DESC`, [OPEN_STAGES]);
  const stock = await q(`SELECT * FROM vehicles WHERE status IN ('Disponível','Em preparação')`);
  return leads.map(l => ({ lead: l, vehicles: stock.filter(v => matches(l, v)) })).filter(x => x.vehicles.length);
}

// Notify open leads that a matching vehicle arrived (WhatsApp when configured) — once per lead/vehicle.
export async function notifyMatches(vehicleId) {
  const v = await one('SELECT * FROM vehicles WHERE id=?', [vehicleId]);
  if (!v) return 0;
  const leads = (await q('SELECT * FROM leads WHERE stage IN (?)', [OPEN_STAGES])).filter(l => matches(l, v));
  let sent = 0;
  for (const l of leads) {
    const done = json(l.notified_vehicle_ids, []);
    if (done.includes(v.id)) continue;
    if (whatsappConfigured() && l.phone) {
      try {
        await sendWhatsApp(l.phone, `Olá ${l.name.split(' ')[0]}! Chegou na ${env('STORE_NAME', 'loja')} um ${label(v)} por ${Number(v.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, do jeito que você procurava. Quer agendar uma visita?`);
        sent++;
        await log('whatsapp', `match lead #${l.id} veículo #${v.id}`, true);
      } catch (e) { await log('whatsapp', `match lead #${l.id}`, false, e.message); }
    }
    await q('UPDATE leads SET notified_vehicle_ids=? WHERE id=?', [JSON.stringify([...done, v.id]), l.id]);
  }
  return sent;
}

// ---------------------------------------------------------------- CRM sync
export async function pushLeadToCrms(leadId) {
  const l = await one('SELECT * FROM leads WHERE id=?', [leadId]);
  if (!l) return {};
  const refs = json(l.crm_refs, {});
  const out = {};
  for (const c of Object.values(crms)) {
    if (!c.configured()) continue;
    if (!refs[c.id] && l.source === c.id) continue; // lead came from this CRM
    try {
      refs[c.id] = await c.push(l, refs[c.id] || null);
      out[c.id] = { ok: true };
      await log(c.id, `push lead #${l.id}`, true, JSON.stringify(refs[c.id]));
    } catch (e) {
      out[c.id] = { ok: false, error: e.message };
      await log(c.id, `push lead #${l.id}`, false, e.message);
    }
  }
  await q('UPDATE leads SET crm_refs=? WHERE id=?', [JSON.stringify(refs), l.id]);
  return out;
}

// Import external leads (CRM pull / marketplace questions / webhooks); dedupe by crm_refs.imported.
export async function importLeads(source, items) {
  let created = 0;
  for (const it of items) {
    if (it.external && await one(`SELECT id FROM leads WHERE JSON_UNQUOTE(JSON_EXTRACT(crm_refs,'$.imported'))=?`, [it.external])) continue;
    let vehicle_id = it.vehicle_id || null;
    if (!vehicle_id && it.item_id) vehicle_id = (await one('SELECT vehicle_id FROM publications WHERE external_id=?', [String(it.item_id)]))?.vehicle_id || null;
    const v = vehicle_id ? await one('SELECT * FROM vehicles WHERE id=?', [vehicle_id]) : null;
    await q('INSERT INTO leads SET ?', [{
      name: String(it.name || 'Sem nome').slice(0, 120), phone: it.phone || null, email: it.email || null,
      interest: String(v ? `${label(v)} — ${it.interest || ''}` : it.interest || 'Contato').slice(0, 255),
      brand: v?.brand || null, model: v?.model || null, vehicle_id, source, notes: it.notes || null,
      crm_refs: JSON.stringify(it.external ? { imported: it.external } : {}),
    }]);
    created++;
  }
  await log(source, 'import leads', true, `${created} novo(s) de ${items.length}`);
  return { created, total: items.length };
}
