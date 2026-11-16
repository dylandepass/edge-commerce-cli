export class CliError extends Error {
  constructor(code, message, fields = []) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}

const featureNames = new Set(['cart-checkout', 'pdp']);
const pdpModes = ['cart', 'catalog'];
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const routePattern = /^\/[a-zA-Z0-9/_-]*$/;
const pathSegment = /^\/(?:[a-zA-Z0-9_-]+\/)+$/;
const proxyKeyPattern = /^[a-zA-Z0-9_-]{8,128}$/;
export const siteDefaults = Object.freeze({ storeView: 'default', locale: 'en-US' });
export const pdpDefaults = Object.freeze({ mode: 'cart', previewProductPath: '/products/' });

const useDefaultIfBlank = (value, fallback) =>
  value === undefined || (typeof value === 'string' && !value.trim()) ? fallback : value;

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
  unknown(
    input,
    ['version', 'features', 'site', 'productSource', 'api', 'routes', 'paypal', 'pdp'],
    '',
  );
  unknown(
    input.site,
    ['storeView', 'locale', 'currency', 'country', 'cartDestination', 'cartBehavior'],
    'site.',
  );
  unknown(input.api, ['origin', 'org', 'site'], 'api.');
  unknown(input.routes, ['cart', 'checkout', 'review', 'complete', 'cancel'], 'routes.');
  unknown(input.paypal, ['clientId', 'environment'], 'paypal.');
  unknown(input.pdp, ['mode', 'previewProxyKey', 'previewProductPath'], 'pdp.');

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

  // PDP settings: catalog-only mode has no prices or cart; preview loads pipeline pages.
  const pdpFeature = Array.isArray(features) && features.includes('pdp');
  const pdp = input.pdp ?? {};
  if (input.pdp !== undefined && !pdpFeature) {
    fail('pdp', 'PDP settings require the pdp feature');
  }
  if (!pdp || typeof pdp !== 'object' || Array.isArray(pdp)) {
    fail('pdp', 'Expected a PDP object');
  }
  const pdpMode = useDefaultIfBlank(pdp?.mode, pdpDefaults.mode);
  if (!pdpModes.includes(pdpMode)) {
    fail('pdp.mode', 'Use cart or catalog');
  }
  const catalog = pdpFeature && pdpMode === 'catalog';
  if (catalog && checkout) {
    fail('pdp.mode', 'Catalog-only PDPs cannot be combined with cart-checkout');
  }
  const previewProxyKey = useDefaultIfBlank(pdp?.previewProxyKey, undefined);
  const previewProductPath = useDefaultIfBlank(pdp?.previewProductPath, undefined);
  if (
    previewProxyKey !== undefined &&
    (typeof previewProxyKey !== 'string' || !proxyKeyPattern.test(previewProxyKey))
  ) {
    fail('pdp.previewProxyKey', 'Use the public CORS proxy key: letters, numbers, - or _');
  }
  if (previewProductPath !== undefined) {
    if (typeof previewProductPath !== 'string' || !pathSegment.test(previewProductPath)) {
      fail('pdp.previewProductPath', 'Use a path segment such as /products/');
    } else if (previewProxyKey === undefined) {
      fail('pdp.previewProductPath', 'Set pdp.previewProxyKey to enable preview simulation');
    }
  }

  // Store-view and cart input is shared by PDP and checkout installs.
  const site = input.site ?? {};
  if (!site || typeof site !== 'object' || Array.isArray(site)) {
    fail('site', 'Expected a site object');
  }
  const storeView = useDefaultIfBlank(site?.storeView, siteDefaults.storeView);
  const locale = useDefaultIfBlank(site?.locale, siteDefaults.locale);
  if (typeof storeView !== 'string') {
    fail('site.storeView', 'Use a cart storage namespace such as default');
  } else if (!identifier.test(storeView)) {
    fail('site.storeView', 'Use letters, numbers, hyphens, or underscores');
  }
  if (typeof locale !== 'string') {
    fail('site.locale', 'Use a shopper locale such as en-US');
  } else if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) {
    fail('site.locale', 'Use a locale such as en-US');
  }
  if (catalog) {
    // Catalog-only PDPs show no prices, so a currency is optional.
    if (site?.currency !== undefined && !/^[A-Z]{3}$/.test(site.currency)) {
      fail('site.currency', 'Use a three-letter currency code');
    }
  } else {
    if (typeof site?.currency !== 'string' || !site.currency.trim())
      fail('site.currency', 'Required');
    if (typeof site?.currency === 'string' && !/^[A-Z]{3}$/.test(site.currency)) {
      fail('site.currency', 'Use a three-letter currency code');
    }
  }
  if (
    typeof input.productSource !== 'string' ||
    !['existing-pdp', 'starter-pdp'].includes(input.productSource)
  )
    fail('productSource', 'Choose existing-pdp or starter-pdp');
  if (
    pdpFeature &&
    !checkout &&
    !catalog &&
    !site?.cartDestination &&
    site?.cartBehavior !== 'stay'
  ) {
    fail('site.cartDestination', 'Provide an existing cart route or site.cartBehavior: "stay"');
  }
  if (
    site?.cartDestination !== undefined &&
    (typeof site.cartDestination !== 'string' ||
      !routePattern.test(site.cartDestination) ||
      site.cartDestination.startsWith('//'))
  ) {
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
    if (api?.origin !== undefined) {
      try {
        const url = new URL(api.origin);
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
      storeView,
      locale,
      ...(site.currency ? { currency: site.currency } : {}),
      ...(checkout ? { country: site.country } : {}),
      ...(site.cartDestination ? { cartDestination: site.cartDestination } : {}),
      ...(site.cartBehavior ? { cartBehavior: site.cartBehavior } : {}),
    },
    productSource: input.productSource,
    ...(pdpFeature
      ? {
          pdp: {
            mode: pdpMode,
            ...(previewProxyKey
              ? {
                  previewProxyKey,
                  previewProductPath: previewProductPath || pdpDefaults.previewProductPath,
                }
              : {}),
          },
        }
      : {}),
    ...(checkout
      ? {
          api: {
            ...(input.api.origin === undefined ? {} : { origin: input.api.origin }),
            org: input.api.org,
            site: input.api.site,
          },
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
