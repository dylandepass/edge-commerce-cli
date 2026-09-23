export class CliError extends Error {
  constructor(code, message, fields = []) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}

const featureNames = new Set(['cart-checkout', 'pdp']);
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const routePattern = /^\/[a-zA-Z0-9/_-]*$/;

export function validateSetup(input) {
  const fields = [];
  const fail = (path, message) => fields.push({ path, message });

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CliError('INVALID_INPUT', 'Expected a JSON setup object.', [
      { path: '$', message: 'Expected an object' },
    ]);
  }

  // No secrets are accepted, even in fields we do not otherwise recognize.
  function rejectSecrets(value, prefix = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (/(secret|password|privatekey|accesstoken|apikey)/i.test(key)) {
        fail(name, 'Server credentials are not accepted in CLI setup');
      } else {
        rejectSecrets(item, name);
      }
    }
  }
  rejectSecrets(input);

  const unknown = (object, keys, prefix) => {
    if (object && typeof object === 'object' && !Array.isArray(object)) {
      for (const key of Object.keys(object)) {
        if (!keys.includes(key) && !/(secret|password|privatekey|accesstoken|apikey)/i.test(key)) {
          fail(`${prefix}${key}`, 'Unknown setup field');
        }
      }
    }
  };
  unknown(input, ['version', 'features', 'site', 'productSource', 'api', 'routes', 'paypal'], '');
  unknown(
    input.site,
    ['storeView', 'locale', 'currency', 'country', 'cartDestination', 'cartBehavior'],
    'site.',
  );
  unknown(input.api, ['origin', 'org', 'site'], 'api.');
  unknown(input.routes, ['cart', 'checkout', 'review', 'complete', 'cancel'], 'routes.');
  unknown(input.paypal, ['clientId', 'environment'], 'paypal.');

  if (input.version !== 1) fail('version', 'Supported setup version is 1');

  const features = input.features ?? ['cart-checkout'];
  if (
    !Array.isArray(features) ||
    !features.length ||
    features.some((item) => !featureNames.has(item)) ||
    new Set(features).size !== features.length
  ) {
    fail('features', 'Choose cart-checkout, pdp, or both without duplicates');
  }
  const checkout = Array.isArray(features) && features.includes('cart-checkout');

  // Store-view and cart input is shared by PDP and checkout installs.
  const site = input.site ?? {};
  if (!site || typeof site !== 'object' || Array.isArray(site)) {
    fail('site', 'Expected a site object');
  }
  for (const key of ['storeView', 'locale', 'currency']) {
    if (typeof site?.[key] !== 'string' || !site[key].trim()) fail(`site.${key}`, 'Required');
  }
  if (typeof site?.storeView === 'string' && !identifier.test(site.storeView)) {
    fail('site.storeView', 'Use a store view code');
  }
  if (typeof site?.locale === 'string' && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(site.locale)) {
    fail('site.locale', 'Use a locale such as en-US');
  }
  if (typeof site?.currency === 'string' && !/^[A-Z]{3}$/.test(site.currency)) {
    fail('site.currency', 'Use a three-letter currency code');
  }
  if (
    typeof input.productSource !== 'string' ||
    !['existing-pdp', 'starter-pdp'].includes(input.productSource)
  )
    fail('productSource', 'Choose existing-pdp or starter-pdp');
  if (
    Array.isArray(features) &&
    features.includes('pdp') &&
    !checkout &&
    !site?.cartDestination &&
    site?.cartBehavior !== 'stay'
  ) {
    fail('site.cartDestination', 'Provide an existing cart route or site.cartBehavior: "stay"');
  }
  if (site?.cartDestination !== undefined && !routePattern.test(site.cartDestination)) {
    fail('site.cartDestination', 'Use a same-site path');
  }
  if (site?.cartBehavior !== undefined && !['stay', 'navigate'].includes(site.cartBehavior)) {
    fail('site.cartBehavior', 'Use stay or navigate');
  }
  if (checkout) {
    // Payment and routes are required only for the cart-checkout feature.
    if (!/^[A-Z]{2}$/.test(site?.country ?? '')) {
      fail('site.country', 'Use a two-letter country code');
    }

    const api = input.api ?? {};
    for (const key of ['org', 'site']) {
      if (typeof api?.[key] !== 'string' || !identifier.test(api[key])) {
        fail(`api.${key}`, 'Use a nonempty identifier');
      }
    }
    try {
      const url = new URL(api?.origin);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      )
        throw new Error('invalid origin');
    } catch {
      fail(
        'api.origin',
        'Provide an HTTPS origin (HTTP only for localhost) without path or credentials',
      );
    }

    const routes = input.routes ?? {};
    const used = new Set();
    for (const key of ['cart', 'checkout', 'review', 'complete', 'cancel']) {
      const route = routes?.[key];
      if (
        typeof route !== 'string' ||
        !routePattern.test(route) ||
        route.includes('//') ||
        route.split('/').includes('..')
      ) {
        fail(`routes.${key}`, 'Use a same-site path without query or fragment');
      } else if (used.has(route)) {
        fail(`routes.${key}`, 'Routes must be distinct');
      } else {
        used.add(route);
      }
    }
    if (typeof input.paypal?.clientId !== 'string' || !input.paypal.clientId.trim()) {
      fail('paypal.clientId', 'Provide a public browser client ID');
    }
    if (
      input.paypal?.environment !== undefined &&
      !['sandbox', 'live'].includes(input.paypal.environment)
    ) {
      fail('paypal.environment', 'Use sandbox or live');
    }
  } else {
    if (input.api !== undefined) {
      fail('api', 'PDP-only setup does not accept checkout API settings');
    }
    if (input.paypal !== undefined) {
      fail('paypal', 'PDP-only setup does not accept PayPal settings');
    }
  }
  if (fields.length) throw new CliError('INVALID_INPUT', 'Invalid setup input.', fields);

  return {
    version: 1,
    features: [...features].sort(),
    site: {
      storeView: site.storeView,
      locale: site.locale,
      currency: site.currency,
      ...(checkout ? { country: site.country } : {}),
      ...(site.cartDestination ? { cartDestination: site.cartDestination } : {}),
      ...(site.cartBehavior ? { cartBehavior: site.cartBehavior } : {}),
    },
    productSource: input.productSource,
    ...(checkout
      ? {
          api: { origin: input.api.origin, org: input.api.org, site: input.api.site },
          routes: Object.fromEntries(
            ['cart', 'checkout', 'review', 'complete', 'cancel'].map((key) => [
              key,
              input.routes[key],
            ]),
          ),
          paypal: {
            clientId: input.paypal.clientId,
            environment: input.paypal.environment || 'sandbox',
          },
        }
      : {}),
  };
}
