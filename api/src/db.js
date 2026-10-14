import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  timezone: '-03:00',
  dateStrings: true,
  decimalNumbers: true,
  connectionLimit: 10,
});

export async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function one(sql, params = []) {
  return (await q(sql, params))[0] || null;
}

export async function log(provider, action, ok, message = '') {
  await q('INSERT INTO sync_logs (provider, action, ok, message) VALUES (?,?,?,?)',
    [provider, action, ok ? 1 : 0, String(message).slice(0, 4000)]).catch(() => {});
}

export async function getToken(provider) {
  return one('SELECT * FROM integration_tokens WHERE provider = ?', [provider]);
}

export async function saveToken(provider, { access_token, refresh_token, expires_in, data }) {
  const expires = expires_in ? new Date(Date.now() + (expires_in - 60) * 1000) : null;
  await q(`INSERT INTO integration_tokens (provider, access_token, refresh_token, expires_at, data)
           VALUES (?,?,?,?,?)
           ON DUPLICATE KEY UPDATE access_token=VALUES(access_token),
             refresh_token=COALESCE(VALUES(refresh_token), refresh_token),
             expires_at=VALUES(expires_at), data=COALESCE(VALUES(data), data)`,
    [provider, access_token, refresh_token || null, expires, data ? JSON.stringify(data) : null]);
}

// Wait for MySQL on boot (container may still be starting).
export async function waitDb(tries = 30) {
  for (let i = 0; i < tries; i++) {
    try { await pool.query('SELECT 1'); return; } catch { await new Promise(r => setTimeout(r, 2000)); }
  }
  throw new Error('MySQL indisponível');
}
