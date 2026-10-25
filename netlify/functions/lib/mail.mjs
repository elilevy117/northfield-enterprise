// iCloud Mail connection (IMAP to read, SMTP to send). Uses an Apple app-specific password.
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import crypto from 'node:crypto';
import { store, getSettings, getSecure, setSecure, logEvent, ingestMessage, updateRecord } from './portal-store.mjs';

export const ICLOUD = { imap: { host: 'imap.mail.me.com', port: 993 }, smtp: { host: 'smtp.mail.me.com', port: 587 } };

export async function getMailConfig(s = store()) {
  return getSecure(s, 'mail'); // { user, pass, from, connectedBy, connectedAt }
}

function imapClient(cfg) {
  return new ImapFlow({ host: ICLOUD.imap.host, port: ICLOUD.imap.port, secure: true, auth: { user: cfg.imapUser || cfg.user, pass: cfg.pass }, logger: false, socketTimeout: 20000 });
}
function smtp(cfg) {
  return nodemailer.createTransport({ host: ICLOUD.smtp.host, port: ICLOUD.smtp.port, secure: false, requireTLS: true, auth: { user: cfg.smtpUser || cfg.user, pass: cfg.pass } });
}

// iCloud is picky about the exact login. Try the usual variations and keep the one that works:
// full address or just the part before @, and the app password with or without dashes.
// Send-only: we only check that iCloud lets us send. The inbox is never read.
export async function testConnection(input) {
  const user = String(input.user || '').trim().toLowerCase();
  const raw = String(input.pass || '').trim();
  const passes = [...new Set([raw, raw.replace(/[\s-]/g, '')])].filter(Boolean);
  let lastErr = null;
  for (const pass of passes) {
    try {
      await smtp({ smtpUser: user, pass }).verify();
      // Also find the login that works for reading (for the Email tab). Not required for sending.
      let imapUser = null;
      for (const u of [user, user.split('@')[0]]) {
        const c = imapClient({ imapUser: u, pass });
        try { await c.connect(); await c.logout(); imapUser = u; break; } catch { try { await c.close(); } catch {} }
      }
      return { ...input, user, smtpUser: user, pass, imapUser };
    }
    catch (e) { lastErr = e; }
  }
  const err = new Error(lastErr?.response || lastErr?.message || 'SMTP login failed'); err.stage = 'smtp'; throw err;
}

const SKIP_FROM = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|newsletter|marketing@|bounce)/i;

// Pull new inbox mail into support tickets. Never marks or moves anything in the mailbox.
export async function syncInbox({ max = 25 } = {}) {
  const s = store();
  const cfg = await getMailConfig(s);
  if (!cfg) return { skipped: 'not connected' };
  const settings = await getSettings(s);
  const state = (await getSecure(s, 'mail-state')) || {};
  const c = imapClient(cfg);
  let created = 0, added = 0, seen = 0;
  try {
    await c.connect();
    const box = await c.mailboxOpen('INBOX', { readOnly: true });
    const validity = String(box.uidValidity);
    let fromUid = state.uidValidity === validity ? (state.lastUid || 0) + 1 : null;
    let uids;
    if (fromUid) uids = await c.search({ uid: fromUid + ':*' }, { uid: true });
    else uids = await c.search({ since: new Date(Date.now() - 3 * 864e5) }, { uid: true }); // first run: last 3 days
    uids = (uids || []).filter(u => !fromUid || u >= fromUid).sort((a, b) => a - b).slice(0, max);
    let last = state.uidValidity === validity ? (state.lastUid || 0) : 0;
    for (const uid of uids) {
      const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
      last = Math.max(last, uid); seen++;
      if (!m?.source) continue;
      const p = await simpleParser(m.source);
      const from = p.from?.value?.[0] || {};
      const addr = String(from.address || '').toLowerCase();
      if (!addr || addr === String(cfg.user).toLowerCase() || addr === String(cfg.from || '').toLowerCase() || SKIP_FROM.test(addr)) continue;
      if (p.headers.get('auto-submitted') && p.headers.get('auto-submitted') !== 'no') continue;
      const refs = p.references ? (Array.isArray(p.references) ? p.references : [p.references]) : [];
      const r = await ingestMessage(s, {
        from: addr, fromName: from.name || '', subject: p.subject || '', text: p.text || (p.html ? String(p.html).replace(/<[^>]+>/g, ' ') : ''),
        date: (p.date || new Date()).toISOString(), messageId: p.messageId || null, inReplyTo: p.inReplyTo || null, references: refs, source: 'Email'
      }, settings);
      if (r.created) created++; else if (r.ticket) added++;
    }
    await setSecure(s, 'mail-state', { uidValidity: validity, lastUid: last });
    await c.logout();
    await logEvent(s, 'mail', { ok: true, error: null, created, added });
    return { created, added, seen };
  } catch (e) {
    try { await c.logout(); } catch {}
    await logEvent(s, 'mail', { ok: false, error: friendlyMailError(e) });
    throw e;
  }
}

export function friendlyMailError(e) {
  const m = String(e?.responseText || e?.message || e);
  if (/auth|login|credentials|535|invalid/i.test(m)) return 'iCloud rejected the sign-in. The Apple ID email must be your @icloud.com (or @me.com) address \u2013 not a Gmail or own-domain address \u2013 and the password must be a new app-specific password.';
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(m)) return 'Couldn’t reach iCloud Mail. It will retry automatically.';
  return 'Mail error: ' + m.slice(0, 160);
}

// Send a reply from the portal. Keeps the email in the same conversation for the customer
// and tags the subject with the ticket number so their answer lands back on the ticket.
export async function sendReply(ticket, text, by, fromAddr) {
  const s = store();
  const cfg = await getMailConfig(s);
  if (!cfg) throw new Error('Connect iCloud Mail in Settings to send replies.');
  if (!ticket.customerEmail) throw new Error('This ticket has no customer email.');
  const lastIn = [...(ticket.messages || [])].reverse().find(m => m.dir === 'in' && m.messageId);
  const senders = cfg.senders?.length ? cfg.senders : [{ address: cfg.from || cfg.user, name: cfg.fromName || '' }];
  const sender = senders.find(x => x.address.toLowerCase() === String(fromAddr || '').toLowerCase()) || senders[0];
  const domain = String(sender.address).split('@')[1] || 'northfieldenterprise.com';
  const messageId = '<' + crypto.randomBytes(12).toString('hex') + '@' + domain + '>';
  const base = String(ticket.subject || 'Your message').replace(/\s*\[T-\d+\]\s*/g, ' ').trim();
  const subject = 'Re: ' + base + ' [' + ticket.ref + ']';
  const t = smtp(cfg);
  const settings = await getSettings(s);
  const sig = settings.signature ? '\n\n' + settings.signature : '';
  await t.sendMail({
    from: sender.name ? { name: sender.name, address: sender.address } : sender.address,
    to: ticket.customerName ? { name: ticket.customerName, address: ticket.customerEmail } : ticket.customerEmail,
    subject, text: text + sig, messageId,
    inReplyTo: lastIn?.messageId || undefined,
    references: (ticket.messages || []).map(m => m.messageId).filter(Boolean).slice(-10)
  });
  await s.set('idx/msg/' + messageId, ticket.id);
  return updateRecord(s, 'tickets', ticket.id, r => {
    r.messages = [...(r.messages || []), { dir: 'out', from: sender.address, name: by, at: new Date().toISOString(), text, messageId }].slice(-200);
    if (!['Resolved', 'Closed'].includes(r.status)) r.status = 'Waiting on customer';
    r.lastOutboundAt = new Date().toISOString();
    if (!r.firstResponseAt) r.firstResponseAt = r.lastOutboundAt;
    return r;
  }, by);
}

export async function sendEmail({ to, subject, text, html }) {
  const s = store();
  const cfg = await getMailConfig(s);
  if (!cfg) throw new Error('Mail not connected');
  const t = smtp(cfg);
  const sd = cfg.senders?.[0] || { address: cfg.from || cfg.user, name: cfg.fromName || '' };
  await t.sendMail({ from: sd.name ? { name: sd.name, address: sd.address } : sd.address, to, subject, text, html });
}
