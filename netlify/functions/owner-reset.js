// Emergency owner sign-in fix, for when reset emails aren't arriving.
// OFF unless the Netlify environment variable OWNER_RESET_KEY is set (24+ characters).
// Sets a new password for an existing account, activates it, and can make it an admin.
// Remove OWNER_RESET_KEY in Netlify once you're back in.
const crypto = require('crypto');
const out = (code, data) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });
const fails = new Map();

exports.handler = async (event, context) => {
  const KEY = String(process.env.OWNER_RESET_KEY || process.env.owner_reset_key || '').trim();
  if (KEY.length < 24) return out(404, { error: 'Not available.', code: KEY ? 'short' : 'off' });
  if (event.httpMethod !== 'POST') return out(405, { error: 'Method not allowed' });

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'x';
  const f = fails.get(ip) || { n: 0, t: 0 };
  if (f.n >= 5 && Date.now() - f.t < 15 * 60 * 1000) return out(429, { error: 'Too many attempts. Try again later.' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return out(400, { error: 'Invalid request' }); }
  const given = Buffer.from(String(b.key || '').trim()), real = Buffer.from(KEY);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    fails.set(ip, { n: f.n + 1, t: Date.now() });
    return out(403, { error: 'Those details couldn\u2019t be verified.' });
  }
  fails.delete(ip);

  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) return out(400, { error: 'Enter a valid email.' });
  if (password.length < 10) return out(400, { error: 'Use at least 10 characters.' });

  const identity = context.clientContext && context.clientContext.identity;
  if (!identity || !identity.url || !identity.token) return out(500, { error: 'Something went wrong. Try again later.' });
  const call = (path, method = 'GET', body) => fetch(identity.url + path, { method, headers: { Authorization: 'Bearer ' + identity.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  const r = await call('/admin/users?per_page=1000');
  if (!r.ok) return out(500, { error: 'Something went wrong. Try again later.' });
  const users = (await r.json()).users || [];
  const u = users.find(x => String(x.email).toLowerCase() === email);
  if (!u) return out(404, { error: 'Those details couldn\u2019t be verified.', code: 'no-user' });

  const roles = new Set((u.app_metadata && u.app_metadata.roles) || []);
  if (b.makeAdmin) roles.add('logo-admin');
  if (!roles.size) roles.add('logo-user');
  const up = await call('/admin/users/' + encodeURIComponent(u.id), 'PUT', { password, confirm: true, app_metadata: { ...(u.app_metadata || {}), roles: [...roles] } });
  if (!up.ok) return out(500, { error: 'Something went wrong. Try again later.' });
  return out(200, { ok: true, roles: [...roles] });
};
