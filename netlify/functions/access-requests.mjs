// Thin wrapper: if anything in the real handler fails (including a missing package),
// the portal gets a readable error instead of a bare 502.
export default async (req, context) => {
  try {
    const mod = await import('./lib/access-requests-api.mjs');
    return await mod.default(req, context);
  } catch (e) {
    console.error('access-requests failed:', e);
    const msg = String(e && e.message || e);
    const hint = /Cannot find (package|module)/i.test(msg) ? ' (the site was deployed without its npm packages)' : '';
    return Response.json({ error: 'Server error: ' + msg.slice(0, 200) + hint }, { status: 500 });
  }
};
