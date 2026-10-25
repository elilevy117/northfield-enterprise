// Portal connections: iCloud Mail, Amazon status, "sync now", and sending replies.
import { requireUser } from '../_guard.mjs';
import { store, getSecure, setSecure, updateRecord, getSettings, ingestSubmission, logEvent } from './portal-store.mjs';
const mail = () => import('./mail.mjs');
const friendly = e => String(e && e.message || e);
import { amazonConfigured } from './amazon.mjs';
const auto = () => import('../portal-auto.mjs');

const json = (d, status = 200) => Response.json(d, { status, headers: { 'cache-control': 'no-store' } });
const isAdmin = u => (u.roles || u.appMetadata?.roles || u.app_metadata?.roles || []).includes('logo-admin');

export default async (req, context) => {
  const g = await requireUser(false);
  if (g.error) return g.error;
  const user = g.user, admin = isAdmin(user);
  const s = store();
  const a = new URL(req.url).searchParams.get('a') || 'status';

  if (req.method === 'GET' && a === 'status') {
    const mail = await getSecure(s, 'mail');
    const st = (await getSecure(s, 'status')) || {};
    return json({
      mail: mail ? { connected: true, address: (mail.senders?.[0]?.address) || mail.from || mail.user, senders: mail.senders || [{ address: mail.from || mail.user, name: mail.fromName || '' }], since: mail.connectedAt } : { connected: false },
      amazon: { configured: amazonConfigured(), last: st.amazon || null },
      forms: { tokenSaved: !!(await getSecure(s, 'netlify-token')), last: st.import || null },
      auto: st.auto || null
    });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const b = await req.json().catch(() => ({}));

  if (a === 'connect-mail') {
    if (!admin) return json({ error: 'Only admins can connect mail.' }, 403);
    const user0 = String(b.user || '').trim().toLowerCase();
    const senders = (Array.isArray(b.senders) ? b.senders : []).map(x => ({ address: String(x.address || '').trim().toLowerCase(), name: String(x.name || '').trim() })).filter(x => /^\S+@\S+\.\S+$/.test(x.address)).slice(0, 10);
    if (!senders.length) senders.push({ address: user0, name: String(b.fromName || '').trim() });
    const cfg = { user: user0, pass: String(b.pass || '').trim(), senders, from: senders[0].address, fromName: senders[0].name };
    if (!/@/.test(cfg.user) || cfg.pass.replace(/[\s-]/g, '').length < 12) return json({ error: 'Enter the iCloud email and the app-specific password.' }, 400);
    if (!/@(icloud|me|mac)\.com$/.test(cfg.user)) return json({ error: 'The sign-in has to be your @icloud.com address (custom-domain addresses can\u2019t sign in). Put your own addresses under \u201cSend from\u201d.' }, 400);
    let ok; try { const m = await mail(); try { ok = await m.testConnection(cfg); } catch (e) { console.error('mail test', e?.stage, e?.message); return json({ error: m.friendlyMailError(e) }, 400); } } catch (e) { return json({ error: 'Mail isn\u2019t available on this deploy: ' + friendly(e) }, 500); }
    await setSecure(s, 'mail', { ...cfg, ...ok, connectedBy: user.email, connectedAt: new Date().toISOString() });
    await setSecure(s, 'mail-state', {});
    return json({ ok: true });
  }
  if (a === 'import-forms') {
    if (!admin) return json({ error: 'Only admins can import.' }, 403);
    const siteId = context?.site?.id || process.env.SITE_ID;
    if (b.token) await setSecure(s, 'netlify-token', { token: String(b.token).trim(), by: user.email, at: new Date().toISOString() });
    const token = (await getSecure(s, 'netlify-token'))?.token;
    if (!token) return json({ error: 'Paste a Netlify access token first.', needToken: true }, 400);
    const nf = async path => {
      const r = await fetch('https://api.netlify.com/api/v1' + path, { headers: { Authorization: 'Bearer ' + token } });
      if (r.status === 401 || r.status === 403) { await s.delete('secure/netlify-token'); const e = new Error('Netlify didn\u2019t accept that token. Create a new one and try again.'); e.needToken = true; throw e; }
      if (!r.ok) throw new Error('Netlify error ' + r.status);
      return r.json();
    };
    try {
      if (!b.formId) {
        const forms = await nf('/sites/' + siteId + '/forms');
        return json({ forms: forms.map(f => ({ id: f.id, name: f.name, count: f.submission_count || 0 })) });
      }
      const per = 40, page = Math.max(1, Number(b.page) || 1);
      const list = await nf('/forms/' + encodeURIComponent(b.formId) + '/submissions?per_page=' + per + '&page=' + page);
      const settings = await getSettings(s);
      const counts = { ticket: 0, signup: 0, dup: 0, skip: 0 };
      for (const sub of list) {
        const r = await ingestSubmission(s, { ...sub, form_name: b.formName || sub.form_name }, settings);
        counts[r] = (counts[r] || 0) + 1;
      }
      await logEvent(s, 'import', { ok: true, form: b.formName || b.formId });
      return json({ counts, done: list.length < per });
    } catch (e) { return json({ error: String(e.message || e), needToken: !!e.needToken }, 400); }
  }
  if (['inbox', 'read', 'send', 'to-ticket'].includes(a)) {
    const cfg = await getSecure(s, 'mail');
    if (!cfg) return json({ error: 'Connect iCloud Mail in Settings first.', notConnected: true }, 400);
    let ib; try { ib = await import('./inbox.mjs'); } catch (e) { return json({ error: 'Mail isn\u2019t available on this deploy: ' + friendly(e) }, 500); }
    try {
      if (a === 'inbox') return json(await ib.listMail(cfg, { folder: b.folder === 'sent' ? 'sent' : 'inbox' }));
      if (a === 'read') return json(await ib.readMail(cfg, { folder: b.folder === 'sent' ? 'sent' : 'inbox', uid: Number(b.uid) }));
      if (a === 'send') {
        const to = String(b.to || '').trim();
        if (!/^\S+@\S+\.\S+/.test(to)) return json({ error: 'Add who it\u2019s to.' }, 400);
        if (!String(b.text || '').trim()) return json({ error: 'Write a message first.' }, 400);
        return json(await ib.sendMail(cfg, { from: b.from, to, cc: b.cc, subject: String(b.subject || '').slice(0, 300), text: String(b.text).slice(0, 50000), inReplyTo: b.inReplyTo, references: b.references }));
      }
      if (a === 'to-ticket') {
        const m = await ib.readMail(cfg, { folder: 'inbox', uid: Number(b.uid) });
        const { ingestMessage, getSettings } = await import('./portal-store.mjs');
        const r = await ingestMessage(s, { from: m.from.address, fromName: m.from.name, subject: m.subject, text: m.text || String(m.html).replace(/<[^>]+>/g, ' '), date: m.date, messageId: m.messageId, inReplyTo: null, references: [], source: 'Email' }, await getSettings(s));
        return json(r.ticket ? { ticket: r.ticket } : { error: 'This email is already a ticket.' }, r.ticket ? 200 : 400);
      }
    } catch (e) {
      const msg = friendly(e);
      return json({ error: /auth|login|credential|invalid/i.test(msg) ? 'iCloud refused the sign-in. Reconnect iCloud Mail in Settings.' : 'Couldn\u2019t reach iCloud Mail: ' + msg.slice(0, 160) }, 400);
    }
  }
  if (a === 'senders') {
    if (!admin) return json({ error: 'Only admins can do this.' }, 403);
    const cur = await getSecure(s, 'mail');
    if (!cur) return json({ error: 'Connect iCloud Mail first.' }, 400);
    const senders = (Array.isArray(b.senders) ? b.senders : []).map(x => ({ address: String(x.address || '').trim().toLowerCase(), name: String(x.name || '').trim() })).filter(x => /^\S+@\S+\.\S+$/.test(x.address)).slice(0, 10);
    if (!senders.length) return json({ error: 'Add at least one address.' }, 400);
    await setSecure(s, 'mail', { ...cur, senders, from: senders[0].address, fromName: senders[0].name });
    return json({ ok: true, senders });
  }
  if (a === 'disconnect-mail') {
    if (!admin) return json({ error: 'Only admins can do this.' }, 403);
    await s.delete('secure/mail');
    return json({ ok: true });
  }
  if (a === 'sync') {
    try { return json(await (await auto()).runAll({ force: true })); } catch (e) { return json({ error: String(e.message || e) }, 500); }
  }
  if (a === 'reply') {
    const t = await s.get('tickets/' + b.id, { type: 'json', consistency: 'strong' });
    if (!t) return json({ error: 'Ticket not found.' }, 404);
    const text = String(b.text || '').trim();
    if (!text) return json({ error: 'Write a reply first.' }, 400);
    try {
      const m = await mail();
      let r = await m.sendReply(t, text.slice(0, 20000), user.email, b.from);
      if (b.resolve) r = await updateRecord(s, 'tickets', t.id, x => { x.status = 'Resolved'; x.resolvedAt = new Date().toISOString(); return x; }, user.email);
      return json(r);
    } catch (e) { return json({ error: (/iCloud|Connect|customer email/.test(friendly(e)) ? friendly(e) : 'Couldn\u2019t send: ' + friendly(e)).slice(0, 220) }, 400); }
  }
  return json({ error: 'Unknown action.' }, 400);
};
