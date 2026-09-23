import site from './site-config.js';
import checkout from './checkout-config.js';
import { getApi } from './api.js';
import { getCart } from './cart.js';

const context = (flow, entryPoint) => ({ paymentMethod: 'paypal', checkoutFlow: flow, entryPoint });
const country = () => checkout.country.toLowerCase();
const uuid = () => crypto.randomUUID();
const orderId = (response) => response?.order?.id || response?.id;

function saveOrderReference(storage, idValue, email, cartSnapshot) {
  storage.setItem('edge-commerce:order', JSON.stringify({ orderId: idValue, email, cartSnapshot }));
}

export function createCheckoutFlow({
  api = getApi(),
  cart = getCart(),
  storage = sessionStorage,
  id = uuid,
} = {}) {
  let quote = null;
  let pending = null;

  const snapshot = () => cart.snapshot();

  function base({ customer, shipping, shippingMethod }) {
    if (
      !customer?.email ||
      !customer.firstName ||
      !customer.lastName ||
      !shipping?.address1 ||
      !shipping?.city ||
      !shipping?.zip ||
      !shippingMethod
    ) {
      throw new Error('Complete your address, email, and shipping selection');
    }

    return {
      customer,
      shipping,
      billing: shipping,
      items: cart.getOrderItems(),
      shippingMethod: { id: String(shippingMethod) },
      country: country(),
      locale: site.locale,
      ...context('standard', 'checkout'),
    };
  }

  return {
    async shippingMethods(shipping) {
      quote = null;
      if (!cart.count || !shipping?.country || !shipping?.state) {
        throw new Error('Select a shipping country and region');
      }

      const result = await api.estimateShipping(
        { country: shipping.country, state: shipping.state },
        cart.getOrderItems(),
        { locale: site.locale },
      );
      return result.rates || result.shippingMethods || [];
    },

    async preview(input) {
      const payload = base(input);
      const cartSnapshot = snapshot();
      const response = await api.preview(payload);
      if (!response.estimateToken) throw new Error('Commerce API returned no estimate token');

      quote = { payload, token: response.estimateToken, snapshot: cartSnapshot, response };
      return response;
    },

    async place(input) {
      const payload = base(input);
      if (
        !quote ||
        quote.snapshot !== snapshot() ||
        JSON.stringify(payload) !== JSON.stringify(quote.payload)
      ) {
        throw new Error('Checkout changed; preview the order again');
      }

      if (!pending || pending.snapshot !== quote.snapshot || pending.token !== quote.token) {
        const created = await api.createOrder({ ...quote.payload, estimateToken: quote.token });
        const idValue = orderId(created);
        if (!idValue) throw new Error('Commerce API returned no order ID');
        pending = { orderId: idValue, snapshot: quote.snapshot, token: quote.token, key: id() };
      }
      if (quote.snapshot !== snapshot()) {
        throw new Error('Checkout changed; preview the order again');
      }

      saveOrderReference(storage, pending.orderId, payload.customer.email, quote.snapshot);
      const payment = await api.initiate(pending.orderId, {
        provider: 'paypal',
        paymentMethod: 'paypal',
        idempotencyKey: pending.key,
      });
      if (
        payment.action !== 'redirect' ||
        !payment.redirectUrl ||
        new URL(payment.redirectUrl).protocol !== 'https:'
      ) {
        throw new Error('PayPal review redirect is not configured');
      }

      return { orderId: pending.orderId, redirectUrl: payment.redirectUrl };
    },
  };
}

export function createExpressFlow({
  api = getApi(),
  cart = getCart(),
  storage = sessionStorage,
  id = uuid,
} = {}) {
  const draftKey = 'edge-commerce:express-session';
  let restored = {};
  try {
    restored = JSON.parse(storage.getItem(draftKey) || '{}') || {};
  } catch {
    /* Start a new session. */
  }
  if (typeof restored !== 'object' || Array.isArray(restored)) restored = {};

  let sessionId = restored.sessionId;
  let address = restored.address;
  let methods = restored.methods || [];
  let selected = restored.selected;
  let quote = restored.quote;
  let pending = restored.pending;

  const persist = () =>
    storage.setItem(
      draftKey,
      JSON.stringify({ sessionId, address, methods, selected, quote, pending }),
    );

  async function previewFor(method) {
    const payload = {
      items: cart.getOrderItems(),
      country: (address.countryCode || address.country).toLowerCase(),
      locale: site.locale,
      shipping: {
        country: (address.countryCode || address.country).toLowerCase(),
        state: address.state || '',
        zip: address.postalCode || address.zip || '',
      },
      shippingMethod: { id: String(method.id) },
      ...context('express', 'cart'),
    };
    const cartSnapshot = cart.snapshot();
    const response = await api.preview(payload);
    if (!response.estimateToken) throw new Error('No express estimate token');

    quote = { payload, token: response.estimateToken, snapshot: cartSnapshot, response };
    selected = method;
    persist();
    return response;
  }

  return {
    async start() {
      if (!cart.count) throw new Error('Cart is empty');
      const response = await api.createSession({
        items: cart.getOrderItems(),
        currency: site.currency,
        country: country(),
        locale: site.locale,
      });
      if (!response.paypalOrderId) throw new Error('No PayPal order ID');

      sessionId = response.paypalOrderId;
      address = null;
      methods = [];
      selected = null;
      quote = null;
      pending = null;
      persist();
      return { orderId: sessionId };
    },

    async setAddress(value) {
      if (!sessionId) throw new Error('PayPal session is missing');

      address = value;
      quote = null;
      selected = null;
      methods = [];
      persist();
      const response = await api.patchSession(sessionId, {
        type: 'address',
        country: country(),
        locale: site.locale,
        currency: site.currency,
        address: {
          country: value.countryCode || value.country,
          state: value.state,
          zip: value.postalCode || value.zip,
        },
        items: cart.getOrderItems(),
      });
      methods = response.shippingMethods || [];
      if (!methods.length) throw new Error('No shipping methods for this address');

      // The default option needs a preview even when the shopper does not change it.
      await previewFor(methods[0]);
      return response;
    },

    async setShippingOption(optionId) {
      const method = methods.find((item) => String(item.id) === String(optionId));
      if (!method) throw new Error('Shipping method is not available');

      quote = null;
      selected = null;
      persist();
      await api.patchSession(sessionId, {
        type: 'option',
        country: country(),
        locale: site.locale,
        currency: site.currency,
        selectedOptionId: method.id,
        total: method.total,
        taxAmount: method.taxAmount,
        shippingRate: method.rate,
      });
      return previewFor(method);
    },

    async approve(approvedId) {
      if (
        !sessionId ||
        sessionId !== approvedId ||
        !quote ||
        !selected ||
        quote.snapshot !== cart.snapshot()
      ) {
        throw new Error('Cart or PayPal session changed; restart checkout');
      }

      const result = await api.getSession(sessionId, country(), site.locale);
      if (!result?.payer?.email || !result?.shippingAddress) {
        throw new Error('PayPal did not provide buyer details');
      }
      if (result.selectedOptionId && String(result.selectedOptionId) !== String(selected.id)) {
        throw new Error('PayPal shipping option changed; preview again');
      }
      if (quote.snapshot !== cart.snapshot()) {
        throw new Error('Cart changed during PayPal approval');
      }

      const customer = {
        firstName: result.payer.firstName || '',
        lastName: result.payer.lastName || '',
        email: result.payer.email,
        phone: '',
      };
      const shipping = {
        ...result.shippingAddress,
        ...quote.payload.shipping,
        name: `${customer.firstName} ${customer.lastName}`.trim(),
        email: customer.email,
      };
      if (!pending) {
        const created = await api.createOrder({
          ...quote.payload,
          customer,
          shipping,
          billing: shipping,
          estimateToken: quote.token,
        });
        const idValue = orderId(created);
        if (!idValue) throw new Error('Commerce API returned no order ID');
        pending = { orderId: idValue, key: id() };
      }
      if (quote.snapshot !== cart.snapshot()) {
        throw new Error('Cart changed during PayPal approval');
      }

      persist();
      saveOrderReference(storage, pending.orderId, customer.email, quote.snapshot);
      const payment = await api.initiate(pending.orderId, {
        provider: 'paypal-express',
        paymentMethod: 'paypal',
        idempotencyKey: pending.key,
        paypalOrderId: sessionId,
      });
      if (payment.action !== 'review') throw new Error('PayPal Express must enter order review');

      storage.removeItem(draftKey);
      return {
        orderId: pending.orderId,
        reviewUrl: `${checkout.routes.review}?orderId=${encodeURIComponent(pending.orderId)}`,
      };
    },

    cancel() {
      storage.removeItem(draftKey);
    },
  };
}
