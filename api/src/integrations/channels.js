// Publication channels: marketplaces + own-site e-commerce platforms.
// Each adapter: { id, name, kind, configured(), oauth?, publish(v, pub), unpublish(v, pub), importLeads?() }
// publish() returns { external_id, external_url } and is idempotent (update when pub.external_id exists).
import crypto from 'node:crypto';
import { http, env, has, publicUrl } from '../http.js';
import { getToken, saveToken, log } from '../db.js';
import { title, description, photos, sku } from './format.js';

const redirect = (id) => `${publicUrl()}/api/integrations/${id}/callback`;

async function accessToken(provider, refresh) {
  const t = await getToken(provider);
  if (!t?.access_token) throw new Error(`${provider}: conta não conectada (faça o login OAuth em Integrações)`);
  if (t.expires_at && new Date(t.expires_at) < new Date() && refresh) {
    const n = await refresh(t);
    await saveToken(provider, n);
    return { ...t, ...n };
  }
  return t;
}

// ---------------------------------------------------------------- Mercado Livre
const ML_API = 'https://api.mercadolibre.com';
const mlRefresh = (t) => http(`${ML_API}/oauth/token`, { method: 'POST', form: {
  grant_type: 'refresh_token', client_id: env('ML_CLIENT_ID'), client_secret: env('ML_CLIENT_SECRET'), refresh_token: t.refresh_token } });

const mercadolivre = {
  id: 'mercadolivre', name: 'Mercado Livre', kind: 'marketplace',
  configured: () => has('ML_CLIENT_ID', 'ML_CLIENT_SECRET'),
  oauth: {
    url: (state) => `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${env('ML_CLIENT_ID')}&redirect_uri=${encodeURIComponent(redirect('mercadolivre'))}&state=${state}`,
    async callback(code) {
      const t = await http(`${ML_API}/oauth/token`, { method: 'POST', form: {
        grant_type: 'authorization_code', client_id: env('ML_CLIENT_ID'), client_secret: env('ML_CLIENT_SECRET'),
        code, redirect_uri: redirect('mercadolivre') } });
      await saveToken('mercadolivre', { ...t, data: { user_id: t.user_id } });
    },
  },
  async publish(v, pub) {
    const t = await accessToken('mercadolivre', mlRefresh);
    const headers = { Authorization: `Bearer ${t.access_token}` };
    if (pub.external_id) {
      await http(`${ML_API}/items/${pub.external_id}`, { method: 'PUT', headers, body: { price: Number(v.price), status: 'active' } });
      return { external_id: pub.external_id, external_url: pub.external_url };
    }
    const attr = (id, value_name) => (value_name ? { id, value_name: String(value_name) } : null);
    const item = await http(`${ML_API}/items`, { method: 'POST', headers, body: {
      title: title(v, 60),
      category_id: env('ML_CATEGORY_ID', 'MLB1744'),
      price: Number(v.price), currency_id: 'BRL', available_quantity: 1,
      buying_mode: 'classified', listing_type_id: env('ML_LISTING_TYPE', 'gold_premium'), condition: 'used',
      pictures: photos(v).map(source => ({ source })),
      attributes: [
        attr('BRAND', v.brand), attr('MODEL', v.model), attr('TRIM', v.version), attr('VEHICLE_YEAR', v.year),
        attr('KILOMETERS', `${v.km} km`), attr('FUEL_TYPE', v.fuel), attr('TRANSMISSION', v.transmission),
        attr('DOORS', v.doors), attr('COLOR', v.color), attr('LICENSE_PLATE', v.plate),
      ].filter(Boolean),
    } });
    await http(`${ML_API}/items/${item.id}/description`, { method: 'POST', headers, body: { plain_text: description(v) } })
      .catch(e => log('mercadolivre', 'description', false, e.message));
    return { external_id: item.id, external_url: item.permalink };
  },
  async unpublish(v, pub) {
    if (!pub.external_id) return;
    const t = await accessToken('mercadolivre', mlRefresh);
    await http(`${ML_API}/items/${pub.external_id}`, { method: 'PUT', headers: { Authorization: `Bearer ${t.access_token}` }, body: { status: 'closed' } });
  },
  // Unanswered questions on listings become CRM leads.
  async importLeads() {
    const t = await accessToken('mercadolivre', mlRefresh);
    const sellerId = (typeof t.data === 'string' ? JSON.parse(t.data) : t.data)?.user_id;
    const r = await http(`${ML_API}/questions/search?seller_id=${sellerId}&status=UNANSWERED&api_version=4`, {
      headers: { Authorization: `Bearer ${t.access_token}` } });
    return (r.questions || []).map(qn => ({
      external: `ml-q-${qn.id}`, name: `Comprador ML #${qn.from?.id}`, interest: qn.text, item_id: qn.item_id }));
  },
};

// ---------------------------------------------------------------- OLX (Autoupload)
const OLX_AUTH = () => env('OLX_AUTH_URL', 'https://auth.olx.com.br');
const olxImport = async (ad) => {
  const t = await accessToken('olx');
  return http(`${env('OLX_API_URL', 'https://apps.olx.com.br')}/autoupload/import`, { method: 'PUT',
    body: { access_token: t.access_token, ad_list: [ad] } });
};
const olx = {
  id: 'olx', name: 'OLX', kind: 'marketplace',
  configured: () => has('OLX_CLIENT_ID', 'OLX_CLIENT_SECRET'),
  oauth: {
    url: (state) => `${OLX_AUTH()}/oauth?client_id=${env('OLX_CLIENT_ID')}&response_type=code&scope=${encodeURIComponent('autoupload basic_user_info')}&redirect_uri=${encodeURIComponent(redirect('olx'))}&state=${state}`,
    async callback(code) {
      const t = await http(`${OLX_AUTH()}/oauth/token`, { method: 'POST', form: {
        code, client_id: env('OLX_CLIENT_ID'), client_secret: env('OLX_CLIENT_SECRET'),
        redirect_uri: redirect('olx'), grant_type: 'authorization_code' } });
      await saveToken('olx', t); // OLX tokens do not expire
    },
  },
  async publish(v, pub) {
    const id = pub.external_id || sku(v);
    const r = await olxImport({
      id, operation: 'insert', category: 2020, type: 's',
      subject: title(v, 90), body: description(v),
      phone: Number(env('STORE_PHONE').replace(/\D/g, '')) || undefined,
      price: Math.round(Number(v.price)), zipcode: env('STORE_ZIPCODE').replace(/\D/g, ''),
      params: {
        vehicle_brand: v.brand, vehicle_model: v.model, vehicle_version: v.version || '',
        regdate: String(v.year), mileage: String(v.km), gearbox: v.transmission === 'Manual' ? '1' : '2',
        fuel: v.fuel, car_color: v.color || '', doors: String(v.doors || 4),
      },
      images: photos(v),
    });
    if (r?.statusCode && r.statusCode < 0) throw new Error(`OLX: ${r.statusMessage || JSON.stringify(r)}`);
    return { external_id: id, external_url: pub.external_url || null };
  },
  async unpublish(v, pub) {
    if (pub.external_id) await olxImport({ id: pub.external_id, operation: 'delete' });
  },
};

// ---------------------------------------------------------------- Tray
const trayApi = () => env('TRAY_API_ADDRESS').replace(/\/$/, '');
const trayRefresh = async (t) => {
  const r = await http(`${trayApi()}/auth?refresh_token=${t.refresh_token}`);
  return { access_token: r.access_token, refresh_token: r.refresh_token,
    expires_in: Math.floor((new Date(r.date_expiration_access_token) - Date.now()) / 1000) };
};
async function trayToken() {
  const t = await getToken('tray');
  if (t?.access_token) return accessToken('tray', trayRefresh);
  if (!has('TRAY_CODE')) throw new Error('Tray: defina TRAY_CODE no .env');
  const r = await http(`${trayApi()}/auth`, { method: 'POST', form: {
    consumer_key: env('TRAY_CONSUMER_KEY'), consumer_secret: env('TRAY_CONSUMER_SECRET'), code: env('TRAY_CODE') } });
  const n = { access_token: r.access_token, refresh_token: r.refresh_token,
    expires_in: Math.floor((new Date(r.date_expiration_access_token) - Date.now()) / 1000) };
  await saveToken('tray', n);
  return n;
}
const tray = {
  id: 'tray', name: 'Tray', kind: 'ecommerce',
  configured: () => has('TRAY_CONSUMER_KEY', 'TRAY_CONSUMER_SECRET', 'TRAY_API_ADDRESS'),
  async publish(v, pub) {
    const { access_token } = await trayToken();
    const Product = {
      name: title(v, 120), description: description(v).replace(/\n/g, '<br>'), price: Number(v.price),
      cost_price: Number(v.cost), stock: 1, available: 1, reference: sku(v), brand: v.brand, model: v.model, weight: 1,
      ...Object.fromEntries(photos(v).slice(0, 6).map((p, i) => [`picture_source_${i + 1}`, p])),
    };
    if (pub.external_id) {
      await http(`${trayApi()}/products/${pub.external_id}?access_token=${access_token}`, { method: 'PUT', body: { Product } });
      return { external_id: pub.external_id, external_url: pub.external_url };
    }
    const r = await http(`${trayApi()}/products?access_token=${access_token}`, { method: 'POST', body: { Product } });
    return { external_id: String(r.id), external_url: null };
  },
  async unpublish(v, pub) {
    if (!pub.external_id) return;
    const { access_token } = await trayToken();
    await http(`${trayApi()}/products/${pub.external_id}?access_token=${access_token}`, { method: 'DELETE' });
  },
};

// ---------------------------------------------------------------- Nuvemshop
const nsBase = () => `https://api.tiendanube.com/v1/${env('NUVEMSHOP_STORE_ID')}`;
const nsHeaders = () => ({ Authentication: `bearer ${env('NUVEMSHOP_ACCESS_TOKEN')}`, 'User-Agent': 'AutoPainel (suporte@autopainel.local)' });
const nuvemshop = {
  id: 'nuvemshop', name: 'Nuvemshop', kind: 'ecommerce',
  configured: () => has('NUVEMSHOP_STORE_ID', 'NUVEMSHOP_ACCESS_TOKEN'),
  async publish(v, pub) {
    const body = { name: { pt: title(v, 120) }, description: { pt: description(v).replace(/\n/g, '<br>') }, brand: v.brand };
    if (pub.external_id) {
      const [pid, vid] = pub.external_id.split(':');
      await http(`${nsBase()}/products/${pid}`, { method: 'PUT', headers: nsHeaders(), body });
      await http(`${nsBase()}/products/${pid}/variants/${vid}`, { method: 'PUT', headers: nsHeaders(), body: { price: String(v.price), stock: 1 } });
      return { external_id: pub.external_id, external_url: pub.external_url };
    }
    const r = await http(`${nsBase()}/products`, { method: 'POST', headers: nsHeaders(), body: {
      ...body, variants: [{ price: String(v.price), stock: 1, sku: sku(v) }], images: photos(v).map(src => ({ src })) } });
    return { external_id: `${r.id}:${r.variants?.[0]?.id}`, external_url: r.canonical_url || null };
  },
  async unpublish(v, pub) {
    if (pub.external_id) await http(`${nsBase()}/products/${pub.external_id.split(':')[0]}`, { method: 'DELETE', headers: nsHeaders() });
  },
};

// ---------------------------------------------------------------- Shopify
const shBase = () => `https://${env('SHOPIFY_SHOP')}/admin/api/${env('SHOPIFY_API_VERSION', '2025-01')}`;
const shHeaders = () => ({ 'X-Shopify-Access-Token': env('SHOPIFY_ACCESS_TOKEN') });
const shopify = {
  id: 'shopify', name: 'Shopify', kind: 'ecommerce',
  configured: () => has('SHOPIFY_SHOP', 'SHOPIFY_ACCESS_TOKEN'),
  async publish(v, pub) {
    if (pub.external_id) {
      const [pid, vid] = pub.external_id.split(':');
      await http(`${shBase()}/products/${pid}.json`, { method: 'PUT', headers: shHeaders(), body: { product: {
        id: Number(pid), title: title(v, 120), body_html: description(v).replace(/\n/g, '<br>'),
        variants: [{ id: Number(vid), price: String(v.price) }] } } });
      return { external_id: pub.external_id, external_url: pub.external_url };
    }
    const { product } = await http(`${shBase()}/products.json`, { method: 'POST', headers: shHeaders(), body: { product: {
      title: title(v, 120), body_html: description(v).replace(/\n/g, '<br>'), vendor: v.brand, product_type: 'Veículo',
      variants: [{ price: String(v.price), sku: sku(v) }], images: photos(v).map(src => ({ src })) } } });
    return { external_id: `${product.id}:${product.variants[0].id}`, external_url: `https://${env('SHOPIFY_SHOP')}/products/${product.handle}` };
  },
  async unpublish(v, pub) {
    if (pub.external_id) await http(`${shBase()}/products/${pub.external_id.split(':')[0]}.json`, { method: 'DELETE', headers: shHeaders() });
  },
};

// ---------------------------------------------------------------- WooCommerce
const wcBase = () => `${env('WOOCOMMERCE_URL').replace(/\/$/, '')}/wp-json/wc/v3`;
const wcHeaders = () => ({ Authorization: `Basic ${Buffer.from(`${env('WOOCOMMERCE_CONSUMER_KEY')}:${env('WOOCOMMERCE_CONSUMER_SECRET')}`).toString('base64')}` });
const woocommerce = {
  id: 'woocommerce', name: 'WooCommerce', kind: 'ecommerce',
  configured: () => has('WOOCOMMERCE_URL', 'WOOCOMMERCE_CONSUMER_KEY', 'WOOCOMMERCE_CONSUMER_SECRET'),
  async publish(v, pub) {
    const body = { name: title(v, 120), type: 'simple', status: 'publish', regular_price: String(v.price),
      description: description(v).replace(/\n/g, '<br>'), sku: sku(v), manage_stock: true, stock_quantity: 1 };
    if (pub.external_id) {
      const r = await http(`${wcBase()}/products/${pub.external_id}`, { method: 'PUT', headers: wcHeaders(), body });
      return { external_id: pub.external_id, external_url: r.permalink };
    }
    const r = await http(`${wcBase()}/products`, { method: 'POST', headers: wcHeaders(), body: { ...body, images: photos(v).map(src => ({ src })) } });
    return { external_id: String(r.id), external_url: r.permalink };
  },
  async unpublish(v, pub) {
    if (pub.external_id) await http(`${wcBase()}/products/${pub.external_id}?force=true`, { method: 'DELETE', headers: wcHeaders() });
  },
};

// ---------------------------------------------------------------- Loja Integrada
const liBase = 'https://api.awsli.com.br/v1';
const liHeaders = () => ({ Authorization: `chave_api ${env('LOJA_INTEGRADA_API_KEY')} aplicacao ${env('LOJA_INTEGRADA_APP_KEY')}` });
const lojaintegrada = {
  id: 'lojaintegrada', name: 'Loja Integrada', kind: 'ecommerce',
  configured: () => has('LOJA_INTEGRADA_API_KEY', 'LOJA_INTEGRADA_APP_KEY'),
  async publish(v, pub) {
    let id = pub.external_id;
    const body = { sku: sku(v), nome: title(v, 120), descricao_completa: description(v).replace(/\n/g, '<br>'), ativo: true, tipo: 'normal' };
    if (id) await http(`${liBase}/produto/${id}`, { method: 'PUT', headers: liHeaders(), body });
    else id = String((await http(`${liBase}/produto/`, { method: 'POST', headers: liHeaders(), body })).id);
    await http(`${liBase}/produto_preco/${id}`, { method: 'PUT', headers: liHeaders(), body: { cheio: Number(v.price), custo: Number(v.cost) } });
    await http(`${liBase}/produto_estoque/${id}`, { method: 'PUT', headers: liHeaders(), body: { gerenciado: true, situacao_em_estoque: 0, quantidade: 1 } });
    return { external_id: id, external_url: pub.external_url };
  },
  async unpublish(v, pub) {
    if (pub.external_id) await http(`${liBase}/produto/${pub.external_id}`, { method: 'PUT', headers: liHeaders(), body: { ativo: false } });
    return true; // product only deactivated: keep id so it is reactivated, not duplicated
  },
};

// ---------------------------------------------------------------- Site próprio
// Always available: the vehicle appears in the public feed (/api/public/vehicles, /api/public/feed.xml).
// When SITE_WEBHOOK_URL is set, changes are also pushed (HMAC-SHA256 in X-AutoPainel-Signature).
async function siteHook(event, v) {
  if (!has('SITE_WEBHOOK_URL')) return;
  const body = JSON.stringify({ event, vehicle: { ...v, cost: undefined, prep_cost: undefined, title: title(v, 120), description_text: description(v), photos: photos(v) } });
  const sig = crypto.createHmac('sha256', env('SITE_WEBHOOK_SECRET', '')).update(body).digest('hex');
  const res = await fetch(env('SITE_WEBHOOK_URL'), { method: 'POST', body, signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'X-AutoPainel-Signature': sig } });
  if (!res.ok) throw new Error(`Site webhook → ${res.status}`);
}
const site = {
  id: 'site', name: 'Site', kind: 'ecommerce',
  configured: () => true,
  async publish(v) {
    await siteHook('vehicle.upsert', v);
    return { external_id: String(v.id), external_url: `${publicUrl()}/api/public/vehicles/${v.id}` };
  },
  async unpublish(v) { await siteHook('vehicle.remove', v); },
};

export const channels = { olx, mercadolivre, site, tray, nuvemshop, shopify, woocommerce, lojaintegrada };
