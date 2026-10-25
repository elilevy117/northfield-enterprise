// Team accounts (Netlify Identity admin). Admins only.
//   GET  -> list team members
//   POST {action:'invite', email}            -> send an account invitation
//   POST {action:'role', id, role}           -> role: 'admin' | 'member'
//   POST {action:'remove', id}               -> delete the account
//   POST {action:'reset', email}             -> send that person a password reset email
const ROLE = { admin: ['logo-admin'], member: ['logo-user'] };
const out = (code, data) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });

exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  const roles = (user && user.app_metadata && user.app_metadata.roles) || [];
  if (!user) return out(401, { error: 'Please sign in again.' });
  if (!roles.includes('logo-admin')) return out(403, { error: 'Admin access required.' });
  const identity = context.clientContext.identity;
  if (!identity || !identity.url || !identity.token) return out(500, { error: 'Netlify Identity admin access is unavailable.' });
  const call = (path, method = 'GET', body) => fetch(identity.url + path, {
    method, headers: { Authorization: 'Bearer ' + identity.token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });

  if (event.httpMethod === 'GET') {
    const r = await call('/admin/users?per_page=500');
    if (!r.ok) return out(r.status, { error: 'Could not load team: ' + (await r.text()).slice(0, 200) });
    const d = await r.json();
    const users = (d.users || []).map(u => ({
      id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.full_name) || '',
      roles: (u.app_metadata && u.app_metadata.roles) || [],
      status: u.confirmed_at ? 'Active' : (u.invited_at ? 'Invited' : 'Pending'),
      createdAt: u.created_at, lastSignIn: u.last_sign_in_at || null, me: u.id === user.sub
    })).sort((a, b) => a.email.localeCompare(b.email));
    return out(200, users);
  }
  if (event.httpMethod !== 'POST') return out(405, { error: 'Method not allowed' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return out(400, { error: 'Invalid request' }); }

  if (b.action === 'invite') {
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return out(400, { error: 'Enter a valid email.' });
    const r = await call('/invite', 'POST', { email });
    if (!r.ok) return out(r.status, { error: 'Could not send invitation: ' + (await r.text()).slice(0, 200) });
    return out(200, { ok: true });
  }
  if (b.action === 'reset') {
    const email = String(b.email || '').trim().toLowerCase();
    const r = await fetch(identity.url + '/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    if (!r.ok) return out(r.status, { error: 'Netlify could not send the reset email: ' + (await r.text()).slice(0, 200) });
    return out(200, { ok: true });
  }
  if (!b.id) return out(400, { error: 'Missing user.' });
  if (b.id === user.sub) return out(400, { error: 'You can’t change or remove your own account here.' });

  if (b.action === 'role') {
    if (!ROLE[b.role]) return out(400, { error: 'Unknown role.' });
    const r = await call('/admin/users/' + encodeURIComponent(b.id), 'PUT', { app_metadata: { roles: ROLE[b.role] } });
    if (!r.ok) return out(r.status, { error: 'Could not change role: ' + (await r.text()).slice(0, 200) });
    return out(200, { ok: true });
  }
  if (b.action === 'remove') {
    const r = await call('/admin/users/' + encodeURIComponent(b.id), 'DELETE');
    if (!r.ok) return out(r.status, { error: 'Could not remove account: ' + (await r.text()).slice(0, 200) });
    return out(200, { ok: true });
  }
  return out(400, { error: 'Unknown action.' });
};
