// Runs automatically every time a website form is submitted (Netlify Forms, spam already filtered).
//   contact          -> new support ticket (+ contact)
//   launch-updates   -> sign-up counted in the portal (+ contact)
import { connectLambda } from '@netlify/blobs';
import { store, getSettings, ingestSubmission } from './lib/portal-store.mjs';

export const handler = async (event) => {
  connectLambda(event);
  let p; try { p = JSON.parse(event.body || '{}').payload || {}; } catch { return { statusCode: 200 }; }
  try { const s = store(); await ingestSubmission(s, p, await getSettings(s)); } catch (e) { console.error('submission-created', e); }
  return { statusCode: 200 };
};
