const { getStore } = require('@netlify/blobs');
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return {statusCode:405,body:JSON.stringify({error:'Method not allowed'})};
  const user=context.clientContext&&context.clientContext.user;
  const roles=(user&&user.app_metadata&&user.app_metadata.roles)||[];
  if(!user) return {statusCode:401,body:JSON.stringify({error:'Unauthorized'})};
  if(!roles.includes('logo-admin')) return {statusCode:403,body:JSON.stringify({error:'Admin access required'})};
  let b;try{b=JSON.parse(event.body||'{}')}catch{return {statusCode:400,body:JSON.stringify({error:'Invalid request'})}};
  if(!b.id||!['approve','decline'].includes(b.action))return {statusCode:400,body:JSON.stringify({error:'Invalid action'})};
  const store=getStore('northfield-access-requests');const key='pending/'+b.id;const req=await store.get(key,{type:'json',consistency:'strong'});if(!req)return {statusCode:404,body:JSON.stringify({error:'Request not found'})};
  if(b.action==='approve'){
    const identity=context.clientContext&&context.clientContext.identity;
    if(!identity||!identity.url||!identity.token)return {statusCode:500,body:JSON.stringify({error:'Netlify Identity admin context is unavailable.'})};
    const r=await fetch(identity.url+'/invite',{method:'POST',headers:{Authorization:'Bearer '+identity.token,'Content-Type':'application/json'},body:JSON.stringify({email:req.email})});
    if(!r.ok){const t=await r.text();return {statusCode:r.status,body:JSON.stringify({error:'Could not send invitation: '+t.slice(0,300)})};}
  }
  await store.delete(key);await store.setJSON((b.action==='approve'?'approved/':'declined/')+b.id,{...req,status:b.action==='approve'?'approved':'declined',reviewedAt:new Date().toISOString(),reviewedBy:user.email||user.sub});
  return {statusCode:200,headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:true})};
};
