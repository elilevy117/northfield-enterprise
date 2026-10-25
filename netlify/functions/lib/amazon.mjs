// Amazon Seller Central (SP-API) orders. Switched off until these Netlify environment
// variables exist: AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, AMAZON_REFRESH_TOKEN
// Optional: AMAZON_MARKETPLACE_ID (default US: ATVPDKIKX0DER), AMAZON_REGION_ENDPOINT
import { store, getSettings, getSecure, setSecure, logEvent, nextRef, upsertContact } from './portal-store.mjs';

const env = k => String(process.env[k] || '').trim();
export const amazonConfigured = () => !!(env('AMAZON_LWA_CLIENT_ID') && env('AMAZON_LWA_CLIENT_SECRET') && env('AMAZON_REFRESH_TOKEN'));

const STATUS = { Pending: 'New', Unshipped: 'Processing', PartiallyShipped: 'Processing', Shipped: 'Shipped', InvoiceUnconfirmed: 'Shipped', Canceled: 'Cancelled', Unfulfillable: 'Cancelled', PendingAvailability: 'New' };

async function accessToken() {
  const r = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env('AMAZON_REFRESH_TOKEN'), client_id: env('AMAZON_LWA_CLIENT_ID'), client_secret: env('AMAZON_LWA_CLIENT_SECRET') })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('Amazon sign-in failed: ' + (d.error_description || d.error || r.status));
  return d.access_token;
}

export async function syncAmazon() {
  if (!amazonConfigured()) return { skipped: 'not configured' };
  const s = store();
  const settings = await getSettings(s);
  const state = (await getSecure(s, 'amazon-state')) || {};
  const since = state.lastUpdatedAfter || new Date(Date.now() - 30 * 864e5).toISOString();
  const endpoint = env('AMAZON_REGION_ENDPOINT') || 'https://sellingpartnerapi-na.amazon.com';
  const market = env('AMAZON_MARKETPLACE_ID') || 'ATVPDKIKX0DER';
  try {
    const token = await accessToken();
    let next = null, n = 0, newest = since, pages = 0;
    do {
      const q = next ? new URLSearchParams({ MarketplaceIds: market, NextToken: next }) : new URLSearchParams({ MarketplaceIds: market, LastUpdatedAfter: since, MaxResultsPerPage: '100' });
      const r = await fetch(endpoint + '/orders/v0/orders?' + q, { headers: { 'x-amz-access-token': token, accept: 'application/json' } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('Amazon orders error: ' + (d.errors?.[0]?.message || r.status));
      for (const o of d.payload?.Orders || []) {
        const key = 'orders/amz-' + o.AmazonOrderId;
        const cur = await s.get(key, { type: 'json', consistency: 'strong' });
        const now = new Date().toISOString();
        const rec = {
          ...(cur || {}),
          id: 'amz-' + o.AmazonOrderId, orderNumber: o.AmazonOrderId, date: String(o.PurchaseDate || now).slice(0, 10),
          company: cur?.company || settings.amazonCompany || settings.defaultCompany, channel: 'Amazon', source: 'Amazon',
          customerName: o.ShippingAddress?.Name || o.BuyerInfo?.BuyerName || cur?.customerName || 'Amazon customer',
          customerEmail: o.BuyerInfo?.BuyerEmail || cur?.customerEmail || '',
          amount: o.OrderTotal?.Amount != null ? Number(o.OrderTotal.Amount) : (cur?.amount || 0),
          units: (o.NumberOfItemsShipped || 0) + (o.NumberOfItemsUnshipped || 0),
          status: STATUS[o.OrderStatus] || cur?.status || 'New', fulfillment: o.FulfillmentChannel === 'AFN' ? 'FBA' : 'Merchant',
          ref: cur?.ref || await nextRef(s, 'orders'), createdAt: cur?.createdAt || now, createdBy: 'Amazon', updatedAt: now, updatedBy: 'Amazon'
        };
        await s.setJSON(key, rec);
        n++;
        if (o.LastUpdateDate && o.LastUpdateDate > newest) newest = o.LastUpdateDate;
      }
      next = d.payload?.NextToken || null; pages++;
    } while (next && pages < 5);
    await setSecure(s, 'amazon-state', { lastUpdatedAfter: newest });
    await logEvent(s, 'amazon', { ok: true, error: null, updated: n });
    return { updated: n };
  } catch (e) {
    await logEvent(s, 'amazon', { ok: false, error: String(e.message || e).slice(0, 200) });
    throw e;
  }
}
