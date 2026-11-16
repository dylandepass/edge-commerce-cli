import config from './checkout-config.js';

const stageOrigin = 'https://api-stage.adobecommerce.live';
const productionOrigin = 'https://api.adobecommerce.live';

export function resolveApiOrigin(hostname, override) {
  if (override) return override;
  if (!hostname) throw new Error('Storefront hostname is required to select a Commerce API origin');

  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (
    ['localhost', '127.0.0.1', '[::1]', '::1', 'aem.page', 'aem.live'].includes(host) ||
    host.endsWith('.aem.page') ||
    host.endsWith('.aem.live')
  ) {
    return stageOrigin;
  }
  return productionOrigin;
}

export class CommerceError extends Error {
  constructor(status, body) {
    super(body?.message || `Commerce API request failed (${status})`);
    this.status = status;
    this.code = body?.code;
  }
}

/**
 * Header carrying the PayPal session capability returned by createSession. The
 * Commerce API requires it on PayPal session PATCH/GET calls.
 */
const PAYPAL_SESSION_HEADER = 'x-paypal-session';
const paypalSessionHeaders = (sessionToken) =>
  sessionToken ? { [PAYPAL_SESSION_HEADER]: sessionToken } : {};

/** Guest calls may require site-provided reCAPTCHA; never place a server credential here. */
export function createApi({
  fetcher = fetch,
  settings = config,
  getRecaptchaToken,
  hostname = globalThis.location?.hostname,
} = {}) {
  const origin = resolveApiOrigin(hostname, settings.api.origin);
  const base = `${origin.replace(/\/$/, '')}/${encodeURIComponent(settings.api.org)}/sites/${encodeURIComponent(settings.api.site)}`;

  async function request(method, route, data, recaptchaAction, extraHeaders = {}) {
    const headers = {
      ...extraHeaders,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    };

    if (recaptchaAction && getRecaptchaToken) {
      const token = await getRecaptchaToken(recaptchaAction);
      if (token) headers['X-Recaptcha-Token'] = token;
    }

    const response = await fetcher(`${base}${route}`, {
      method,
      headers,
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });

    let body;
    try {
      body = await response.json();
    } catch {
      throw new CommerceError(response.status, { message: 'Invalid Commerce API response' });
    }
    if (!response.ok) throw new CommerceError(response.status, body);
    return body;
  }

  const orderPath = (id) => `/orders/${encodeURIComponent(id)}`;

  return {
    estimateShipping: (shipping, items, context) =>
      request('POST', '/estimate/shipping', {
        country: shipping.country,
        locale: context.locale,
        shipping,
        items,
      }),
    preview: (body) => request('POST', '/orders/preview', body, 'orders_preview'),
    createOrder: (body) => request('POST', '/orders', body, 'orders_create'),
    initiate: (id, body) => request('POST', `${orderPath(id)}/payments`, body),
    confirm: (id, key) =>
      request('POST', `${orderPath(id)}/payments/confirm`, { idempotencyKey: key }),
    cancel: (id, key) =>
      request('POST', `${orderPath(id)}/payments/cancel`, { idempotencyKey: key }),
    order: (email, id) =>
      request('GET', `/customers/${encodeURIComponent(email)}/orders/${encodeURIComponent(id)}`),
    createSession: (body) => request('POST', '/payments/paypal/session', body),
    patchSession: (id, body, sessionToken) =>
      request(
        'PATCH',
        `/payments/paypal/session/${encodeURIComponent(id)}`,
        body,
        undefined,
        paypalSessionHeaders(sessionToken),
      ),
    getSession: (id, country, locale, sessionToken) =>
      request(
        'GET',
        `/payments/paypal/session/${encodeURIComponent(id)}?${new URLSearchParams({ country, locale })}`,
        undefined,
        undefined,
        paypalSessionHeaders(sessionToken),
      ),
  };
}

let singleton;
export function getApi() {
  if (!singleton) {
    singleton = createApi({
      getRecaptchaToken: (action) => window.edgeCommerceRecaptchaToken?.(action),
    });
  }

  return singleton;
}
