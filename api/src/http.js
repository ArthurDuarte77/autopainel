// fetch wrapper: JSON in/out, throws readable errors.
export async function http(url, { method = 'GET', headers = {}, body, form, timeout = 20000 } = {}) {
  const opts = { method, headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) };
  if (form) {
    opts.body = new URLSearchParams(form).toString();
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = typeof data === 'object' && data ? (data.message || data.error_description || data.error || JSON.stringify(data)) : text;
    const err = new Error(`${method} ${url} → ${res.status}: ${String(msg).slice(0, 500)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Client-entered credentials (settings k=cred:KEY, loaded on boot) override .env.
export const creds = {};
export const env = (k, d = '') => creds[k] || process.env[k] || d;
export const has = (...keys) => keys.every(k => !!(creds[k] || process.env[k]));
export const publicUrl = () => env('PUBLIC_URL', 'http://localhost:8080').replace(/\/$/, '');
