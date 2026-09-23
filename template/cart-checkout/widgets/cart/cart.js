import { getCart, lineId } from '../../scripts/commerce/cart.js';
import site from '../../scripts/commerce/site-config.js';
import checkout from '../../scripts/commerce/checkout-config.js';
import { createExpressFlow } from '../../scripts/commerce/checkout-flow.js';
import { createExpressButton, loadPayPalSdk } from '../../scripts/commerce/payments/paypal.js';

const money = (amount) =>
  new Intl.NumberFormat(site.locale, { style: 'currency', currency: site.currency }).format(amount);

function sameSiteProductUrl(item) {
  try {
    const url = new URL(item.productUrl || item.path, window.location.href);
    if (url.origin === window.location.origin && ['http:', 'https:'].includes(url.protocol)) {
      return url.href;
    }
  } catch {
    // Stored optional product URLs may be missing or invalid.
  }
  return item.path;
}

function safeImageUrl(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    // Do not render malformed media URLs from storage.
  }
  return undefined;
}

function createCartLine(item, cart) {
  const row = document.createElement('div');
  row.className = 'cart-line';

  const product = document.createElement('div');
  product.className = 'cart-line-product';
  const imageUrl = safeImageUrl(item.imageUrl);
  if (imageUrl) {
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = '';
    image.width = 64;
    image.height = 64;
    image.loading = 'lazy';
    product.append(image);
  }
  const name = document.createElement('a');
  name.href = sameSiteProductUrl(item);
  name.textContent = item.name;
  product.append(name);

  const quantity = document.createElement('input');
  quantity.type = 'number';
  quantity.min = '0';
  quantity.step = '1';
  quantity.value = String(item.quantity);
  quantity.setAttribute('aria-label', `Quantity for ${item.name}`);
  quantity.addEventListener('change', () => {
    try {
      cart.setQuantity(lineId(item), Number(quantity.value));
    } catch {
      quantity.value = String(item.quantity);
    }
  });

  const total = document.createElement('span');
  total.className = 'cart-line-total';
  total.textContent = money(item.quantity * Number(item.price.final));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.setAttribute('aria-label', `Remove ${item.name}`);
  remove.addEventListener('click', () => cart.remove(lineId(item)));

  row.append(product, quantity, total, remove);
  return row;
}

function preparePayPal(message) {
  const prepared = loadPayPalSdk().then((sdk) =>
    createExpressButton({
      sdk,
      flow: createExpressFlow(),
      onReview: (url) => window.location.assign(url),
      onError: () => {
        message.textContent = 'PayPal encountered an error. Please try again.';
      },
    }),
  );

  // SDK v6 may redirect on mobile; re-register callbacks on the return page.
  prepared
    .then((start) => {
      if (start.hasReturned()) return start.resume();
      return undefined;
    })
    .catch(() => {
      message.textContent = 'PayPal is unavailable. Use checkout or try again.';
    });

  return prepared;
}

export default function decorate(widget) {
  const cart = getCart();
  const lines = widget.querySelector('.commerce-cart-lines');
  const summary = widget.querySelector('.commerce-cart-summary');

  function render() {
    if (!cart.count) {
      const empty = document.createElement('p');
      empty.textContent = 'Your cart is empty.';
      lines.replaceChildren(empty);
      summary.replaceChildren();
      summary.hidden = true;
      return;
    }

    const list = document.createElement('div');
    list.className = 'cart-lines';
    for (const item of cart.items) list.append(createCartLine(item, cart));
    lines.replaceChildren(list);

    const heading = document.createElement('h2');
    heading.textContent = 'Order summary';
    const subtotal = document.createElement('p');
    subtotal.textContent = `Subtotal: ${money(cart.subtotal)} (before shipping and tax)`;
    const checkoutLink = document.createElement('a');
    checkoutLink.href = checkout.routes.checkout;
    checkoutLink.textContent = 'Checkout';
    checkoutLink.className = 'cart-checkout-link';
    summary.hidden = false;
    summary.replaceChildren(heading, subtotal, checkoutLink);

    // A placeholder is not a usable PayPal client ID. The merchant must configure
    // a public sandbox client ID before the express action is offered.
    if (!checkout.paypal.clientId || checkout.paypal.clientId === 'none') return;

    const paypalButton = document.createElement('button');
    paypalButton.type = 'button';
    paypalButton.textContent = 'PayPal Express';
    const message = document.createElement('p');
    message.setAttribute('role', 'status');
    const prepared = preparePayPal(message);
    paypalButton.addEventListener('click', async () => {
      paypalButton.disabled = true;
      try {
        const start = await prepared;
        await start();
      } catch {
        message.textContent = 'PayPal could not start. Please try again or use checkout.';
      } finally {
        paypalButton.disabled = false;
      }
    });
    summary.append(paypalButton, message);
  }

  render();
  document.addEventListener('cart:change', render);
}
