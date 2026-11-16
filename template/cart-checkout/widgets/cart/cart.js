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
  const row = document.createElement('article');
  row.className = 'cart-line';

  const product = document.createElement('div');
  product.className = 'cart-line-product';
  const media = document.createElement('div');
  media.className = 'cart-line-media';
  const imageUrl = safeImageUrl(item.imageUrl);
  if (imageUrl) {
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = '';
    image.width = 88;
    image.height = 88;
    image.loading = 'lazy';
    media.append(image);
  }

  const details = document.createElement('div');
  details.className = 'cart-line-details';
  const name = document.createElement('a');
  name.href = sameSiteProductUrl(item);
  name.textContent = item.name;
  const unit = document.createElement('p');
  unit.className = 'cart-line-unit';
  unit.textContent = `${money(Number(item.price.final))} each`;
  details.append(name);
  if (Array.isArray(item.selectedOptions)) {
    for (const option of item.selectedOptions) {
      if (typeof option?.value !== 'string' || !option.value) continue;
      const detail = document.createElement('p');
      detail.className = 'cart-line-option';
      detail.textContent =
        typeof option.id === 'string' ? `${option.id}: ${option.value}` : option.value;
      details.append(detail);
    }
  }
  details.append(unit);
  product.append(media, details);

  const controls = document.createElement('div');
  controls.className = 'cart-line-controls';
  const quantityLabel = document.createElement('span');
  quantityLabel.className = 'cart-line-quantity-label';
  quantityLabel.textContent = 'Quantity';
  const stepper = document.createElement('div');
  stepper.className = 'cart-line-stepper';
  const decrease = document.createElement('button');
  decrease.type = 'button';
  decrease.textContent = '−';
  decrease.setAttribute('aria-label', `Decrease quantity for ${item.name}`);
  decrease.disabled = item.quantity <= 1;
  decrease.addEventListener('click', () => cart.setQuantity(lineId(item), item.quantity - 1));

  const quantity = document.createElement('input');
  quantity.type = 'number';
  quantity.min = '1';
  quantity.step = '1';
  quantity.inputMode = 'numeric';
  quantity.value = String(item.quantity);
  quantity.setAttribute('aria-label', `Quantity for ${item.name}`);
  quantity.addEventListener('change', () => {
    try {
      if (Number(quantity.value) < 1) throw new Error('Quantity must be positive');
      cart.setQuantity(lineId(item), Number(quantity.value));
    } catch {
      quantity.value = String(item.quantity);
    }
  });

  const increase = document.createElement('button');
  increase.type = 'button';
  increase.textContent = '+';
  increase.setAttribute('aria-label', `Increase quantity for ${item.name}`);
  increase.addEventListener('click', () => cart.setQuantity(lineId(item), item.quantity + 1));
  stepper.append(decrease, quantity, increase);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'cart-line-remove';
  remove.textContent = 'Remove';
  remove.setAttribute('aria-label', `Remove ${item.name}`);
  remove.addEventListener('click', () => cart.remove(lineId(item)));
  controls.append(quantityLabel, stepper, remove);

  const total = document.createElement('strong');
  total.className = 'cart-line-total';
  total.textContent = money(item.quantity * Number(item.price.final));
  row.append(product, controls, total);
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
  const count = widget.querySelector('.commerce-cart-count');

  function render() {
    count.textContent = `${cart.count} ${cart.count === 1 ? 'item' : 'items'}`;
    if (!cart.count) {
      const empty = document.createElement('div');
      empty.className = 'commerce-cart-empty';
      const heading = document.createElement('h2');
      heading.textContent = 'Your cart is empty.';
      const detail = document.createElement('p');
      detail.textContent = 'Add a product to see it here.';
      empty.append(heading, detail);
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
    const header = document.createElement('div');
    header.className = 'commerce-summary-heading';
    header.append(heading);
    const content = document.createElement('div');
    content.className = 'commerce-summary-content';

    // A placeholder is not a usable PayPal client ID. The merchant must configure
    // a public sandbox client ID before the express action is offered.
    const paypalId = checkout.paypal.clientId?.trim();
    if (paypalId && paypalId !== 'none' && !paypalId.startsWith('your-')) {
      const express = document.createElement('div');
      express.className = 'commerce-cart-express';
      const label = document.createElement('p');
      label.textContent = 'Express checkout';
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
      express.append(label, paypalButton, message);
      content.append(express);
    }

    const totals = document.createElement('div');
    totals.className = 'commerce-cart-totals';
    const subtotal = document.createElement('p');
    subtotal.className = 'commerce-cart-subtotal';
    const subtotalLabel = document.createElement('span');
    subtotalLabel.textContent = 'Subtotal: ';
    const subtotalValue = document.createElement('strong');
    subtotalValue.textContent = money(cart.subtotal);
    subtotal.append(subtotalLabel, subtotalValue);
    const note = document.createElement('p');
    note.className = 'commerce-cart-note';
    note.textContent = 'Shipping and tax calculated at checkout.';
    totals.append(subtotal, note);

    const checkoutLink = document.createElement('a');
    checkoutLink.href = checkout.routes.checkout;
    checkoutLink.textContent = 'Continue to checkout';
    checkoutLink.className = 'cart-checkout-link';
    content.append(totals, checkoutLink);
    summary.hidden = false;
    summary.replaceChildren(header, content);
  }

  render();
  document.addEventListener('cart:change', render);
}
