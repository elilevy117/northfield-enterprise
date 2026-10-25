import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed',{status:405});
  let b; try { b=await req.json(); } catch { return Response.json({error:'Invalid request.'},{status:400}); }
  const name=String(b.name||'').trim().slice(0,120), email=String(b.email||'').trim().toLowerCase().slice(0,254), reason=String(b.reason||'').trim().slice(0,1200);
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !reason) return Response.json({error:'Name, valid email and reason are required.'},{status:400});
  const id=Date.now().toString(36)+'-'+crypto.randomBytes(6).toString('hex');
  await getStore('northfield-access-requests').setJSON('pending/'+id,{id,name,email,reason,createdAt:new Date().toISOString()},{onlyIfNew:true});
  return Response.json({ok:true});
};
