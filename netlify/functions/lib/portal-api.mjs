// Team portal data: support tickets, orders, contacts, tasks, company reports, settings.
// Stored in Netlify Blobs (store "northfield-portal"), one record per key: "<collection>/<id>".
//   GET    /.netlify/functions/portal?c=tickets          -> list records
//   GET    /.netlify/functions/portal?c=all              -> every collection at once
//   POST   /.netlify/functions/portal?c=tickets          -> create (body = record)
//   PUT    /.netlify/functions/portal?c=tickets&id=ID    -> update (body = changed fields)
//   DELETE /.netlify/functions/portal?c=tickets&id=ID    -> delete (admins only)
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { requireUser } from '../_guard.mjs';

const COLLECTIONS = ['tickets', 'orders', 'contacts', 'tasks', 'reports', 'settings', 'signups'];
const READONLY = ['signups'];
const ADMIN_WRITE = ['settings'];
const MAX_BYTES = 200 * 1024;

const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const isAdmin = u => (u.roles || u.appMetadata?.roles || u.app_metadata?.roles || []).includes('logo-admin');
const who = u => u.email || u.id || 'unknown';

// Keep values plain and bounded: strings, numbers, booleans, and arrays/objects of those.
function clean(v, depth = 0) {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 20000);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (depth > 4) return null;
  if (Array.isArray(v)) return v.slice(0, 500).map(x => clean(x, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 80)) {
      if (/^[A-Za-z0-9_]{1,40}$/.test(k)) o[k] = clean(x, depth + 1);
    }
    return o;
  }
  return null;
}
const PROTECTED = ['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'ref'];

async function list(store, c) {
  const { blobs } = await store.list({ prefix: c + '/' });
  const rows = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json', consistency: 'strong' }).catch(() => null)));
  return rows.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// Short, human-friendly reference numbers per collection (T-1001, O-1001 ...)
async function nextRef(store, c) {
  const prefix = { tickets: 'T', orders: 'O', contacts: 'C', tasks: 'K', reports: 'R' }[c];
  if (!prefix) return null;
  const key = 'counters/' + c;
  for (let i = 0; i < 5; i++) {
    const cur = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    const n = (cur?.data?.n || 1000) + 1;
    const res = cur
      ? await store.setJSON(key, { n }, { onlyIfMatch: cur.etag })
      : await store.setJSON(key, { n }, { onlyIfNew: true });
    if (res?.modified !== false) return prefix + '-' + n;
  }
  return prefix + '-' + Date.now().toString(36).toUpperCase();
}

export default async (req) => {
  const g = await requireUser(false);
  if (g.error) return g.error;
  const user = g.user;
  const admin = isAdmin(user);
  const url = new URL(req.url);
  const c = url.searchParams.get('c');
  const id = url.searchParams.get('id');
  const store = getStore('northfield-portal');

  if (req.method === 'GET' && c === 'all') {
    const out = {};
    await Promise.all(COLLECTIONS.map(async k => { out[k] = await list(store, k); }));
    return json({ ...out, me: { email: user.email, name: user.userMetadata?.full_name || user.user_metadata?.full_name || '', admin } });
  }
  if (!COLLECTIONS.includes(c)) return json({ error: 'Unknown section.' }, 400);
  if (req.method === 'GET') return json(await list(store, c));

  if (READONLY.includes(c) && req.method !== 'DELETE') return json({ error: 'This list fills in automatically.' }, 400);
  if (ADMIN_WRITE.includes(c) && !admin) return json({ error: 'Only admins can change this.' }, 403);

  if (req.method === 'DELETE') {
    if (!admin) return json({ error: 'Only admins can delete records.' }, 403);
    if (!id) return json({ error: 'Missing id.' }, 400);
    await store.delete(c + '/' + id);
    return json({ ok: true });
  }

  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ error: 'That record is too large.' }, 413);
  let body;
  try { body = clean(JSON.parse(text || '{}')); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
  for (const k of PROTECTED) delete body[k];
  const now = new Date().toISOString();

  if (req.method === 'POST') {
    const newId = Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex');
    const rec = { ...body, id: newId, ref: await nextRef(store, c), createdAt: now, createdBy: who(user), updatedAt: now, updatedBy: who(user) };
    await store.setJSON(c + '/' + newId, rec, { onlyIfNew: true });
    if (c === 'tickets' && rec.ref) await store.set('idx/ref/' + rec.ref, newId);
    return json(rec, 201);
  }

  if (req.method === 'PUT') {
    if (!id) return json({ error: 'Missing id.' }, 400);
    const key = c + '/' + id;
    for (let i = 0; i < 5; i++) {
      const cur = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
      if (!cur) return json({ error: 'That record no longer exists.' }, 404);
      const rec = { ...cur.data, ...body, id, ref: cur.data.ref, createdAt: cur.data.createdAt, createdBy: cur.data.createdBy, updatedAt: now, updatedBy: who(user) };
      // Notes are append-only from the client: merge so two people adding notes at once both keep theirs.
      if (Array.isArray(body.notesAdd)) {
        rec.notes = [...(cur.data.notes || []), ...body.notesAdd.slice(0, 5).map(n => ({ text: String(n?.text || '').slice(0, 5000), by: who(user), at: now }))];
        delete rec.notesAdd;
      }
      const res = await store.setJSON(key, rec, { onlyIfMatch: cur.etag });
      if (res?.modified !== false) return json(rec);
    }
    return json({ error: 'Someone else is editing this right now. Try again.' }, 409);
  }

  return json({ error: 'Method not allowed.' }, 405);
};
