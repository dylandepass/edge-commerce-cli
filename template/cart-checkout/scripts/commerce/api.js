import config from './checkout-config.js';

export class CommerceError extends Error {
  constructor(status, body) {
    super(body?.message || `Commerce API request failed (${status})`);
    this.status = status;
    this.code = body?.code;
  }
}

/** Guest calls may require site-provided reCAPTCHA; never place a server credential here. */
export function createApi({ fetcher = fetch, settings = config, getRecaptchaToken } = {}) {
  const base = `${settings.api.origin}/${encodeURIComponent(settings.api.org)}/sites/${encodeURIComponent(settings.api.site)}`;

  async function request(method, route, data, recaptchaAction) {
    const headers = { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) };

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
    patchSession: (id, body) =>
      request('PATCH', `/payments/paypal/session/${encodeURIComponent(id)}`, body),
    getSession: (id, country, locale) =>
      request(
        'GET',
        `/payments/paypal/session/${encodeURIComponent(id)}?${new URLSearchParams({ country, locale })}`,
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
