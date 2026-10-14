// CRM connectors. Each: { id, name, configured(), push(lead, ref) -> ref, pull?() -> leads[] }
// push() creates the contact + deal the first time (ref null) and updates the deal stage afterwards.
import { http, env, has } from '../http.js';
import { getToken, saveToken } from '../db.js';

const dealTitle = (l) => `${l.name} — ${l.interest}`;
const value = (l) => Number(l.price_max || 0);
const won = (l) => l.stage === 'Fechado';
const lost = (l) => l.stage === 'Perdido';

// ---------------------------------------------------------------- RD Station CRM
const rdBase = 'https://crm.rdstation.com/api/v1';
const rdstation = {
  id: 'rdstation', name: 'RD Station CRM', configured: () => has('RDSTATION_CRM_TOKEN'),
  async push(l, ref) {
    const tk = `token=${env('RDSTATION_CRM_TOKEN')}`;
    if (ref) {
      await http(`${rdBase}/deals/${ref.deal}?${tk}`, { method: 'PUT', body: { deal: { name: dealTitle(l), win: won(l) ? true : lost(l) ? false : null } } });
      return ref;
    }
    const d = await http(`${rdBase}/deals?${tk}`, { method: 'POST', body: {
      deal: { name: dealTitle(l), amount_total: value(l) },
      contacts: [{ name: l.name, emails: l.email ? [{ email: l.email }] : [], phones: l.phone ? [{ phone: l.phone }] : [] }],
    } });
    return { deal: d._id || d.id };
  },
  async pull() {
    const r = await http(`${rdBase}/deals?token=${env('RDSTATION_CRM_TOKEN')}&limit=50`);
    return (r.deals || []).map(d => ({ external: `rd-${d._id}`, name: d.contacts?.[0]?.name || d.name, interest: d.name,
      email: d.contacts?.[0]?.emails?.[0]?.email, phone: d.contacts?.[0]?.phones?.[0]?.phone }));
  },
};

// RD Station Marketing: register a conversion (lead enters automation flows).
const rdmarketing = {
  id: 'rdmarketing', name: 'RD Station Marketing', configured: () => has('RDSTATION_MARKETING_API_KEY'),
  async push(l, ref) {
    if (ref || !l.email) return ref || { skipped: 'sem e-mail' };
    await http(`https://api.rd.services/platform/conversions?api_key=${env('RDSTATION_MARKETING_API_KEY')}`, { method: 'POST', body: {
      event_type: 'CONVERSION', event_family: 'CDP',
      payload: { conversion_identifier: 'autopainel-interesse', name: l.name, email: l.email, mobile_phone: l.phone, cf_interesse: l.interest } } });
    return { conversion: true };
  },
};

// ---------------------------------------------------------------- HubSpot
const hsBase = 'https://api.hubapi.com/crm/v3/objects';
const hsH = () => ({ Authorization: `Bearer ${env('HUBSPOT_ACCESS_TOKEN')}` });
const hsStage = (l) => ({ 'Novo': 'appointmentscheduled', 'Em contato': 'qualifiedtobuy', 'Proposta': 'presentationscheduled',
  'Negociação': 'decisionmakerboughtin', 'Fechado': 'closedwon', 'Perdido': 'closedlost' }[l.stage]);
const hubspot = {
  id: 'hubspot', name: 'HubSpot', configured: () => has('HUBSPOT_ACCESS_TOKEN'),
  async push(l, ref) {
    if (ref) {
      await http(`${hsBase}/deals/${ref.deal}`, { method: 'PATCH', headers: hsH(), body: { properties: { dealname: dealTitle(l), dealstage: hsStage(l) } } });
      return ref;
    }
    const [firstname, ...rest] = l.name.split(' ');
    const c = await http(`${hsBase}/contacts`, { method: 'POST', headers: hsH(), body: { properties: { firstname, lastname: rest.join(' '), email: l.email || undefined, phone: l.phone || undefined } } });
    const d = await http(`${hsBase}/deals`, { method: 'POST', headers: hsH(), body: {
      properties: { dealname: dealTitle(l), pipeline: 'default', dealstage: hsStage(l), amount: value(l) || undefined },
      associations: [{ to: { id: c.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }] } });
    return { contact: c.id, deal: d.id };
  },
  async pull() {
    const r = await http(`${hsBase}/contacts?limit=50&properties=firstname,lastname,email,phone`, { headers: hsH() });
    return (r.results || []).map(c => ({ external: `hs-${c.id}`, name: `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim() || c.properties.email,
      email: c.properties.email, phone: c.properties.phone, interest: 'Contato HubSpot' }));
  },
};

// ---------------------------------------------------------------- Pipedrive
const pdBase = () => `https://${env('PIPEDRIVE_COMPANY_DOMAIN', 'api')}.pipedrive.com/api/v1`;
const pdQ = () => `api_token=${env('PIPEDRIVE_API_TOKEN')}`;
const pipedrive = {
  id: 'pipedrive', name: 'Pipedrive', configured: () => has('PIPEDRIVE_API_TOKEN'),
  async push(l, ref) {
    const status = won(l) ? 'won' : lost(l) ? 'lost' : 'open';
    if (ref) {
      await http(`${pdBase()}/deals/${ref.deal}?${pdQ()}`, { method: 'PUT', body: { title: dealTitle(l), status } });
      return ref;
    }
    const p = await http(`${pdBase()}/persons?${pdQ()}`, { method: 'POST', body: { name: l.name, email: l.email ? [l.email] : undefined, phone: l.phone ? [l.phone] : undefined } });
    const d = await http(`${pdBase()}/deals?${pdQ()}`, { method: 'POST', body: { title: dealTitle(l), person_id: p.data.id, value: value(l) || undefined, currency: 'BRL', status } });
    return { person: p.data.id, deal: d.data.id };
  },
  async pull() {
    const r = await http(`${pdBase()}/deals?${pdQ()}&status=open&limit=50`);
    return (r.data || []).map(d => ({ external: `pd-${d.id}`, name: d.person_name || d.title, interest: d.title,
      email: d.person_id?.email?.[0]?.value, phone: d.person_id?.phone?.[0]?.value }));
  },
};

// ---------------------------------------------------------------- Salesforce (username-password OAuth)
async function sfAuth() {
  const t = await getToken('salesforce');
  if (t?.access_token && t.expires_at && new Date(t.expires_at) > new Date()) return { token: t.access_token, url: JSON.parse(t.data || '{}').instance_url };
  const r = await http(`${env('SALESFORCE_LOGIN_URL', 'https://login.salesforce.com')}/services/oauth2/token`, { method: 'POST', form: {
    grant_type: 'password', client_id: env('SALESFORCE_CLIENT_ID'), client_secret: env('SALESFORCE_CLIENT_SECRET'),
    username: env('SALESFORCE_USERNAME'), password: env('SALESFORCE_PASSWORD') + env('SALESFORCE_SECURITY_TOKEN') } });
  await saveToken('salesforce', { access_token: r.access_token, expires_in: 3600, data: { instance_url: r.instance_url } });
  return { token: r.access_token, url: r.instance_url };
}
const sfStatus = (l) => (won(l) ? 'Closed - Converted' : lost(l) ? 'Closed - Not Converted' : l.stage === 'Novo' ? 'Open - Not Contacted' : 'Working - Contacted');
const salesforce = {
  id: 'salesforce', name: 'Salesforce', configured: () => has('SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_USERNAME', 'SALESFORCE_PASSWORD'),
  async push(l, ref) {
    const { token, url } = await sfAuth();
    const h = { Authorization: `Bearer ${token}` };
    const [first, ...rest] = l.name.split(' ');
    const body = { FirstName: first, LastName: rest.join(' ') || first, Company: 'Pessoa Física', Email: l.email || null, Phone: l.phone || null,
      Description: l.interest, LeadSource: 'AutoPainel', Status: sfStatus(l) };
    if (ref) { await http(`${url}/services/data/v60.0/sobjects/Lead/${ref.lead}`, { method: 'PATCH', headers: h, body }); return ref; }
    const r = await http(`${url}/services/data/v60.0/sobjects/Lead`, { method: 'POST', headers: h, body });
    return { lead: r.id };
  },
};

// ---------------------------------------------------------------- Bitrix24 (inbound webhook)
const bxUrl = (m) => `${env('BITRIX24_WEBHOOK_URL').replace(/\/?$/, '/')}${m}.json`;
const bitrix24 = {
  id: 'bitrix24', name: 'Bitrix24', configured: () => has('BITRIX24_WEBHOOK_URL'),
  async push(l, ref) {
    const fields = { TITLE: dealTitle(l), NAME: l.name, COMMENTS: l.interest, OPPORTUNITY: value(l) || undefined, CURRENCY_ID: 'BRL',
      STATUS_ID: won(l) ? 'CONVERTED' : lost(l) ? 'JUNK' : l.stage === 'Novo' ? 'NEW' : 'IN_PROCESS',
      EMAIL: l.email ? [{ VALUE: l.email, VALUE_TYPE: 'WORK' }] : undefined, PHONE: l.phone ? [{ VALUE: l.phone, VALUE_TYPE: 'MOBILE' }] : undefined };
    if (ref) { await http(bxUrl('crm.lead.update'), { method: 'POST', body: { id: ref.lead, fields } }); return ref; }
    const r = await http(bxUrl('crm.lead.add'), { method: 'POST', body: { fields } });
    return { lead: r.result };
  },
  async pull() {
    const r = await http(bxUrl('crm.lead.list'), { method: 'POST', body: { select: ['ID', 'TITLE', 'NAME', 'EMAIL', 'PHONE', 'COMMENTS'] } });
    return (r.result || []).map(x => ({ external: `bx-${x.ID}`, name: x.NAME || x.TITLE, interest: x.COMMENTS || x.TITLE,
      email: x.EMAIL?.[0]?.VALUE, phone: x.PHONE?.[0]?.VALUE }));
  },
};

// ---------------------------------------------------------------- Zoho CRM (refresh-token flow)
async function zohoToken() {
  const t = await getToken('zoho');
  if (t?.access_token && t.expires_at && new Date(t.expires_at) > new Date()) return t.access_token;
  const r = await http(`${env('ZOHO_ACCOUNTS_URL', 'https://accounts.zoho.com')}/oauth/v2/token`, { method: 'POST', form: {
    refresh_token: env('ZOHO_REFRESH_TOKEN'), client_id: env('ZOHO_CLIENT_ID'), client_secret: env('ZOHO_CLIENT_SECRET'), grant_type: 'refresh_token' } });
  await saveToken('zoho', r);
  return r.access_token;
}
const zoho = {
  id: 'zoho', name: 'Zoho CRM', configured: () => has('ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'),
  async push(l, ref) {
    const h = { Authorization: `Zoho-oauthtoken ${await zohoToken()}` };
    const base = `${env('ZOHO_API_DOMAIN', 'https://www.zohoapis.com')}/crm/v5/Leads`;
    const [first, ...rest] = l.name.split(' ');
    const rec = { First_Name: first, Last_Name: rest.join(' ') || first, Email: l.email, Phone: l.phone, Description: l.interest,
      Lead_Source: 'AutoPainel', Lead_Status: won(l) ? 'Contacted' : lost(l) ? 'Lost Lead' : l.stage === 'Novo' ? 'Not Contacted' : 'Contact in Future' };
    if (ref) { await http(`${base}/${ref.lead}`, { method: 'PUT', headers: h, body: { data: [rec] } }); return ref; }
    const r = await http(base, { method: 'POST', headers: h, body: { data: [rec] } });
    return { lead: r.data?.[0]?.details?.id };
  },
};

// ---------------------------------------------------------------- Ploomes
const ploomes = {
  id: 'ploomes', name: 'Ploomes', configured: () => has('PLOOMES_USER_KEY'),
  async push(l, ref) {
    const h = { 'User-Key': env('PLOOMES_USER_KEY') };
    if (ref) { await http(`https://api2.ploomes.com/Deals(${ref.deal})`, { method: 'PATCH', headers: h, body: { Title: dealTitle(l) } }); return ref; }
    const c = await http('https://api2.ploomes.com/Contacts', { method: 'POST', headers: h, body: { Name: l.name, Email: l.email, TypeId: 2 } });
    const cid = c.value?.[0]?.Id;
    const d = await http('https://api2.ploomes.com/Deals', { method: 'POST', headers: h, body: { Title: dealTitle(l), ContactId: cid, Amount: value(l) } });
    return { contact: cid, deal: d.value?.[0]?.Id };
  },
};

// ---------------------------------------------------------------- Agendor
const agendor = {
  id: 'agendor', name: 'Agendor', configured: () => has('AGENDOR_API_TOKEN'),
  async push(l, ref) {
    const h = { Authorization: `Token ${env('AGENDOR_API_TOKEN')}` };
    const base = 'https://api.agendor.com.br/v3';
    if (ref) {
      if (won(l) || lost(l)) await http(`${base}/deals/${ref.deal}/status`, { method: 'PUT', headers: h, body: { dealStatusText: won(l) ? 'won' : 'lost' } });
      return ref;
    }
    const p = await http(`${base}/people`, { method: 'POST', headers: h, body: { name: l.name, contact: { email: l.email, mobile: l.phone } } });
    const d = await http(`${base}/people/${p.data.id}/deals`, { method: 'POST', headers: h, body: { title: dealTitle(l), value: value(l) || undefined } });
    return { person: p.data.id, deal: d.data.id };
  },
};

export const crms = { rdstation, rdmarketing, hubspot, pipedrive, salesforce, bitrix24, zoho, ploomes, agendor };
