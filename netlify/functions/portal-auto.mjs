// Runs by itself every 10 minutes: closes quiet tickets,
// and (once Amazon keys are added) pulls Amazon orders about once an hour.
import { store, getSettings, getSecure, updateRecord, logEvent } from './lib/portal-store.mjs';
import { syncAmazon, amazonConfigured } from './lib/amazon.mjs';

export async function runAll({ force = false } = {}) {
  const s = store();
  const out = {};
  // Inbox reading is off: tickets only come from the website forms. Mail is used to send replies.
  // auto-close: waiting on the customer with no reply for N days
  try {
    const settings = await getSettings(s);
    const days = Number(settings.autoCloseDays) || 0;
    if (days > 0) {
      const { blobs } = await s.list({ prefix: 'tickets/' });
      let closed = 0;
      for (const b of blobs) {
        const t = await s.get(b.key, { type: 'json' });
        if (t?.status === 'Waiting on customer' && t.lastOutboundAt && Date.now() - new Date(t.lastOutboundAt) > days * 864e5 && (!t.lastInboundAt || t.lastInboundAt < t.lastOutboundAt)) {
          await updateRecord(s, 'tickets', t.id, r => { r.status = 'Resolved'; r.resolvedAt = new Date().toISOString(); r.autoClosed = true; return r; });
          closed++;
        }
      }
      out.autoClosed = closed;
    }
  } catch (e) { out.autoClose = { error: String(e.message || e) }; }
  if (amazonConfigured()) {
    const st = (await getSecure(s, 'status')) || {};
    if (force || !st.amazon?.at || Date.now() - new Date(st.amazon.at) > 55 * 60e3) {
      try { out.amazon = await syncAmazon(); } catch (e) { out.amazon = { error: String(e.message || e) }; }
    }
  }
  await logEvent(s, 'auto', { ok: true });
  return out;
}

export default async () => { await runAll(); return new Response('ok'); };
export const config = { schedule: '*/10 * * * *' };
