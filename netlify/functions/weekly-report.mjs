// Emails a short weekly summary every Monday morning (to the addresses in Settings).
import { store, getSettings } from './lib/portal-store.mjs';
import { sendEmail, getMailConfig } from './lib/mail.mjs';

async function all(s, c) { const { blobs } = await s.list({ prefix: c + '/' }); return (await Promise.all(blobs.map(b => s.get(b.key, { type: 'json' })))).filter(Boolean); }

export async function buildReport() {
  const s = store();
  const settings = await getSettings(s);
  const since = Date.now() - 7 * 864e5, inWeek = d => d && new Date(d).getTime() >= since;
  const [tickets, orders, signups] = await Promise.all([all(s, 'tickets'), all(s, 'orders'), all(s, 'signups')]);
  const live = orders.filter(o => inWeek(o.date) && !['Cancelled', 'Refunded'].includes(o.status));
  const money = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.currency || 'USD', maximumFractionDigits: 0 }).format(v);
  const rev = live.reduce((a, o) => a + (Number(o.amount) || 0), 0);
  const open = tickets.filter(t => !['Resolved', 'Closed'].includes(t.status));
  const lines = [
    'Northfield Enterprise – weekly summary',
    '',
    'Orders: ' + live.length + ' (' + money(rev) + ')',
    'New support tickets: ' + tickets.filter(t => inWeek(t.createdAt)).length,
    'Resolved: ' + tickets.filter(t => inWeek(t.resolvedAt)).length,
    'Still open: ' + open.length + (open.filter(t => t.priority === 'Urgent').length ? ' (' + open.filter(t => t.priority === 'Urgent').length + ' urgent)' : ''),
    'New sign-ups: ' + signups.filter(x => inWeek(x.createdAt)).length,
    '',
    'By company:'
  ];
  for (const c of settings.companies) {
    const o = live.filter(x => x.company === c.name), t = tickets.filter(x => x.company === c.name && inWeek(x.createdAt));
    if (o.length || t.length) lines.push('  ' + c.name + ': ' + o.length + ' orders, ' + money(o.reduce((a, x) => a + (Number(x.amount) || 0), 0)) + ', ' + t.length + ' tickets');
  }
  lines.push('', 'Open the portal: ' + (process.env.URL || '') + '/private/portal.html#reports');
  return { settings, text: lines.join('\n') };
}

export default async () => {
  const s = store();
  if (!(await getMailConfig(s))) return new Response('mail not connected');
  const { settings, text } = await buildReport();
  const to = String(settings.reportRecipients || '').split(/[,\s]+/).filter(x => /@/.test(x));
  if (to.length) await sendEmail({ to, subject: 'Weekly summary – Northfield Enterprise', text });
  return new Response('ok');
};
export const config = { schedule: '0 12 * * 1' };
