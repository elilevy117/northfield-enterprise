// Shared helpers for the Team Portal: storage, reference numbers, automatic sorting of
// incoming messages (company / category / priority), contacts and settings.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const store = () => getStore('northfield-portal');
export const newId = () => Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex');

export const DEFAULT_SETTINGS = {
  currency: 'USD',
  companies: [
    { name: 'Northfield Enterprise', color: '#11345D', keywords: 'northfield enterprise' },
    { name: 'Northfield Mills', color: '#7A2E2A', keywords: 'northfield mills, pancake, waffle, mix' },
    { name: 'NorthTek Industries', color: '#2F6FB2', keywords: 'northtek' },
    { name: 'Kinderlac', color: '#C27A1A', keywords: 'kinderlac, formula, baby' },
    { name: 'London Bros', color: '#5B4B8A', keywords: 'london bros' },
    { name: 'Leighs of London', color: '#1E7A62', keywords: 'leighs' },
    { name: 'Leabridge Associates', color: '#6B6440', keywords: 'leabridge' }
  ],
  channels: ['Amazon', 'Website', 'Wholesale', 'Retail', 'Distributor', 'Other'],
  defaultCompany: 'Northfield Enterprise',
  amazonCompany: 'Northfield Mills',
  autoCloseDays: 7,
  reportRecipients: ''
};

export async function getSettings(s = store()) {
  const { blobs } = await s.list({ prefix: 'settings/' });
  const rec = blobs.length ? await s.get(blobs[0].key, { type: 'json' }) : null;
  return { ...DEFAULT_SETTINGS, ...(rec || {}) };
}

export async function nextRef(s, c) {
  const prefix = { tickets: 'T', orders: 'O', contacts: 'C', tasks: 'K', reports: 'R' }[c];
  if (!prefix) return null;
  const key = 'counters/' + c;
  for (let i = 0; i < 6; i++) {
    const cur = await s.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    const n = (cur?.data?.n || 1000) + 1;
    const res = cur ? await s.setJSON(key, { n }, { onlyIfMatch: cur.etag }) : await s.setJSON(key, { n }, { onlyIfNew: true });
    if (res?.modified !== false) return prefix + '-' + n;
  }
  return prefix + '-' + Date.now().toString(36).toUpperCase();
}

export async function createRecord(s, c, data, by = 'automatic', id = newId()) {
  const now = new Date().toISOString();
  const rec = { ...data, id, ref: await nextRef(s, c), createdAt: data.createdAt || now, createdBy: by, updatedAt: now, updatedBy: by };
  await s.setJSON(c + '/' + id, rec);
  return rec;
}

// Read-modify-write with a retry if two things change the same record at once.
export async function updateRecord(s, c, id, fn, by = 'automatic') {
  const key = c + '/' + id;
  for (let i = 0; i < 6; i++) {
    const cur = await s.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (!cur) return null;
    const next = fn({ ...cur.data });
    if (!next) return cur.data;
    next.updatedAt = new Date().toISOString(); next.updatedBy = by;
    const res = await s.setJSON(key, next, { onlyIfMatch: cur.etag });
    if (res?.modified !== false) return next;
  }
  throw new Error('Busy, try again');
}

// ---------- automatic sorting ----------
const CATS = [
  ['Return / refund', /\b(refund|return|money back|chargeback|reimburse)/i],
  ['Damaged item', /\b(damaged|broken|crushed|leak(ed|ing)?|smashed|torn|expired|mou?ld)/i],
  ['Shipping / delivery', /\b(where is my|tracking|deliver(y|ed)?|shipping|shipment|not arrived|hasn'?t arrived|late|lost package)/i],
  ['Wholesale enquiry', /\b(wholesale|distribut(or|ion)|stockist|bulk order|retailer|buyer|line review|po\b|purchase order)/i],
  ['Product question', /\b(allergen|ingredient|gluten|nut|dairy|kosher|halal|vegan|nutrition|recipe|how (do|to))/i],
  ['Billing', /\b(invoice|payment|charged|billing|receipt|overcharg)/i],
  ['Complaint', /\b(complain|disappointed|terrible|unacceptable|worst)/i]
];
export function classify(text, settings) {
  const t = String(text || '');
  const low = t.toLowerCase();
  let company = '';
  for (const c of settings.companies || []) {
    const words = String(c.keywords || c.name).split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 2);
    if (words.some(w => low.includes(w))) { company = c.name; break; }
  }
  const category = (CATS.find(([, re]) => re.test(t)) || ['Other'])[0];
  let priority = 'Normal';
  if (/\b(urgent|asap|immediately|allergic reaction|hospital|sick|ill after|food poisoning|lawyer|legal action)/i.test(t)) priority = 'Urgent';
  else if (['Return / refund', 'Damaged item', 'Complaint'].includes(category)) priority = 'High';
  return { company: company || settings.defaultCompany || 'Northfield Enterprise', category, priority };
}

// Strip quoted replies and signatures so the conversation stays readable.
export function cleanBody(text) {
  let t = String(text || '').replace(/\r/g, '');
  const cut = t.search(/\n(On .{5,120} wrote:|-{2,} ?Original Message|From: .+\nSent: |Sent from my iPhone)/i);
  if (cut > 0) t = t.slice(0, cut);
  t = t.split('\n').filter(l => !/^\s*>/.test(l)).join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim().slice(0, 12000);
}

// Customers who write in or order become contacts automatically (matched by email).
export async function upsertContact(s, { email, name, company, type = 'Customer', source }) {
  email = String(email || '').trim().toLowerCase();
  if (!email || !/@/.test(email)) return null;
  const idxKey = 'idx/contact/' + email;
  const id = await s.get(idxKey, { type: 'text' });
  if (id) {
    return updateRecord(s, 'contacts', id, r => {
      if (!r.name && name) r.name = name;
      r.lastContactAt = new Date().toISOString();
      return r;
    });
  }
  const rec = await createRecord(s, 'contacts', { name: name || email.split('@')[0], email, type, company, source, lastContactAt: new Date().toISOString(), auto: true });
  await s.set(idxKey, rec.id);
  return rec;
}

// Create a support ticket from an incoming message, or add to the existing conversation.
export async function ingestMessage(s, msg, settings) {
  // msg: {from, fromName, subject, text, date, messageId, inReplyTo, references[], source, extra}
  // Already have this exact message (re-sync or re-import)? Skip it.
  if (msg.messageId && await s.get('idx/msg/' + msg.messageId, { type: 'text' })) return { ticket: null, created: false, dup: true };
  const ticketRef = (String(msg.subject || '').match(/\[(T-\d+)\]/) || [])[1];
  let ticketId = null;
  for (const mid of [msg.inReplyTo, ...(msg.references || [])].filter(Boolean)) {
    ticketId = await s.get('idx/msg/' + mid, { type: 'text' });
    if (ticketId) break;
  }
  if (!ticketId && ticketRef) ticketId = await s.get('idx/ref/' + ticketRef, { type: 'text' });

  const body = cleanBody(msg.text);
  const message = { dir: 'in', from: msg.from, name: msg.fromName || '', at: msg.date || new Date().toISOString(), text: body, messageId: msg.messageId || null };

  if (ticketId) {
    const t = await updateRecord(s, 'tickets', ticketId, r => {
      if (msg.messageId && (r.messages || []).some(m => m.messageId === msg.messageId)) return null;
      r.messages = [...(r.messages || []), message].slice(-200);
      r.lastInboundAt = message.at;
      if (['Resolved', 'Closed', 'Waiting on customer'].includes(r.status)) { r.status = 'Open'; r.resolvedAt = null; }
      return r;
    });
    if (t && msg.messageId) await s.set('idx/msg/' + msg.messageId, ticketId);
    return { ticket: t, created: false };
  }

  const auto = classify(msg.subject + '\n' + body, settings);
  const old = msg.date && Date.now() - new Date(msg.date) > 14 * 864e5;
  const t = await createRecord(s, 'tickets', {
    createdAt: msg.date || undefined, ...(old ? { resolvedAt: msg.date, imported: true } : {}),
    subject: String(msg.subject || '(no subject)').replace(/^(re|fw|fwd):\s*/i, '').slice(0, 200),
    company: auto.company, category: auto.category, priority: old ? 'Normal' : auto.priority, status: old ? 'Resolved' : 'Open',
    customerName: msg.fromName || '', customerEmail: msg.from || '', source: msg.source,
    channel: msg.source, description: body.slice(0, 4000), messages: [message], lastInboundAt: message.at,
    ...(msg.extra || {})
  });
  await s.set('idx/ref/' + t.ref, t.id);
  if (msg.messageId) await s.set('idx/msg/' + msg.messageId, t.id);
  await upsertContact(s, { email: msg.from, name: msg.fromName, company: auto.company, source: msg.source });
  return { ticket: t, created: true };
}

export async function getSecure(s, name) { return (await s.get('secure/' + name, { type: 'json', consistency: 'strong' })) || null; }
export async function setSecure(s, name, val) { await s.setJSON('secure/' + name, val); }
export async function logEvent(s, name, info) {
  const cur = (await getSecure(s, 'status')) || {};
  cur[name] = { ...(cur[name] || {}), ...info, at: new Date().toISOString() };
  await setSecure(s, 'status', cur);
}

// Launch sign-ups, one per email.
export async function addSignup(s, { email, name, date, source = 'Website', page = '' }, settings) {
  email = String(email || '').trim().toLowerCase();
  if (!/@/.test(email)) return null;
  if (await s.get('idx/signup/' + email, { type: 'text' })) return null;
  const rec = await createRecord(s, 'signups', { email, name: name || '', source, page, createdAt: date || undefined }, source);
  await s.set('idx/signup/' + email, rec.id);
  await upsertContact(s, { email, name, company: settings.defaultCompany, type: 'Subscriber', source: 'Website sign-up' });
  return rec;
}

// Turn one Netlify Forms submission into portal data.
export async function ingestSubmission(s, p, settings) {
  const form = p.form_name || p.data?.['form-name'] || '';
  const d = p.data || {};
  const email = String(d.email || p.email || '').trim().toLowerCase();
  const name = String(d.name || p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || '').trim();
  const date = p.created_at || new Date().toISOString();
  if (/launch|update|signup|sign-up|newsletter|notify/i.test(form)) {
    return (await addSignup(s, { email, name, date, page: p.site_url || '' }, settings)) ? 'signup' : 'dup';
  }
  const message = String(d.message || d.comments || d.body || p.body || '').trim();
  if (!email && !message) return 'skip';
  const topic = String(d.topic || d.subject || '').trim();
  const r = await ingestMessage(s, {
    from: email, fromName: name, subject: (topic ? topic + ': ' : '') + (message.split('\n')[0].slice(0, 80) || 'Website message'),
    text: message || JSON.stringify(d), date, messageId: 'form-' + (p.id || date), source: 'Website form', extra: topic ? { topic } : {}
  }, settings);
  return r.dup ? 'dup' : 'ticket';
}
