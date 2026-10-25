// Company mailbox view: reads iCloud Mail on demand and shows ONLY mail to/from your own
// domain addresses (the "Send from" list), never personal mail. Nothing is moved or deleted.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { ICLOUD } from './mail.mjs';

const lower = x => String(x || '').toLowerCase();
export function domainsOf(cfg) {
  const ds = new Set((cfg.senders || []).map(x => lower(x.address).split('@')[1]).filter(d => d && !/^(icloud|me|mac)\.com$/.test(d)));
  return [...ds];
}
const addrs = list => (list || []).map(a => ({ name: a.name || '', address: lower(a.address) }));
const ours = (list, domains) => list.some(a => domains.some(d => a.address.endsWith('@' + d)));

async function open(cfg, folder) {
  const users = [...new Set([cfg.imapUser, cfg.user, lower(cfg.user).split('@')[0]].filter(Boolean))];
  let last;
  for (const u of users) {
    const c = new ImapFlow({ host: ICLOUD.imap.host, port: ICLOUD.imap.port, secure: true, auth: { user: u, pass: cfg.pass }, logger: false, socketTimeout: 20000 });
    try {
      await c.connect();
      let path = 'INBOX';
      if (folder === 'sent') {
        const boxes = await c.list();
        path = (boxes.find(b => b.specialUse === '\\Sent') || boxes.find(b => /sent/i.test(b.path)) || { path: 'Sent Messages' }).path;
      }
      await c.mailboxOpen(path);
      return c;
    } catch (e) { last = e; try { await c.close(); } catch {} }
  }
  throw last;
}

export async function listMail(cfg, { folder = 'inbox', limit = 150 } = {}) {
  const domains = domainsOf(cfg);
  if (!domains.length) return { domains, messages: [], note: 'Add an address on your own domain under Settings → iCloud Mail → Addresses.' };
  const c = await open(cfg, folder);
  try {
    const total = c.mailbox.exists || 0;
    if (!total) return { domains, messages: [] };
    const start = Math.max(1, total - limit + 1);
    const out = [];
    for await (const m of c.fetch(start + ':*', { uid: true, envelope: true, flags: true, bodyStructure: false })) {
      const e = m.envelope || {};
      const to = addrs([...(e.to || []), ...(e.cc || [])]), from = addrs(e.from);
      const mine = folder === 'sent' ? ours(from, domains) : ours(to, domains);
      if (!mine) continue;
      out.push({ uid: m.uid, subject: e.subject || '(no subject)', from: from[0] || {}, to, date: e.date ? new Date(e.date).toISOString() : null, seen: m.flags?.has('\\Seen') || false, messageId: e.messageId || null });
    }
    out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { domains, messages: out };
  } finally { try { await c.logout(); } catch {} }
}

export async function readMail(cfg, { folder = 'inbox', uid }) {
  const c = await open(cfg, folder);
  try {
    const m = await c.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
    if (!m?.source) throw new Error('That email no longer exists.');
    const p = await simpleParser(m.source);
    if (folder === 'inbox' && !m.flags?.has('\\Seen')) { try { await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }); } catch {} }
    const refs = p.references ? (Array.isArray(p.references) ? p.references : [p.references]) : [];
    return {
      uid, subject: p.subject || '(no subject)', date: (p.date || new Date()).toISOString(),
      from: addrs(p.from?.value)[0] || {}, to: addrs(p.to?.value), cc: addrs(p.cc?.value),
      text: p.text || '', html: p.html || '', messageId: p.messageId || null, references: refs,
      attachments: (p.attachments || []).map(a => ({ name: a.filename || 'attachment', size: a.size || 0 }))
    };
  } finally { try { await c.logout(); } catch {} }
}

export async function sendMail(cfg, { from, to, cc, subject, text, inReplyTo, references }) {
  const senders = cfg.senders?.length ? cfg.senders : [{ address: cfg.from || cfg.user, name: cfg.fromName || '' }];
  const sender = senders.find(x => lower(x.address) === lower(from)) || senders[0];
  const domain = sender.address.split('@')[1] || 'northfieldenterprise.com';
  const t = nodemailer.createTransport({ host: ICLOUD.smtp.host, port: ICLOUD.smtp.port, secure: false, requireTLS: true, auth: { user: cfg.smtpUser || cfg.user, pass: cfg.pass } });
  const messageId = '<' + crypto.randomBytes(12).toString('hex') + '@' + domain + '>';
  await t.sendMail({ from: sender.name ? { name: sender.name, address: sender.address } : sender.address, to, cc: cc || undefined, subject, text, messageId, inReplyTo: inReplyTo || undefined, references: references?.length ? references : undefined });
  return { ok: true, messageId };
}
