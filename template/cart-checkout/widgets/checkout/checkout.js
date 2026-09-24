import site from '../../scripts/commerce/site-config.js';
import checkout from '../../scripts/commerce/checkout-config.js';
import { getCart } from '../../scripts/commerce/cart.js';
import { createCheckoutFlow } from '../../scripts/commerce/checkout-flow.js';

const fields = [
  ['firstName', 'First name', 'given-name', 'text'],
  ['lastName', 'Last name', 'family-name', 'text'],
  ['email', 'Email', 'email', 'email'],
  ['phone', 'Phone (optional)', 'tel', 'tel'],
  ['address1', 'Street address', 'address-line1', 'text'],
  ['address2', 'Apartment or suite (optional)', 'address-line2', 'text'],
  ['city', 'City', 'address-level2', 'text'],
  ['state', 'State or region code', 'address-level1', 'text'],
  ['zip', 'Postal code', 'postal-code', 'text'],
];

const money = (amount) =>
  new Intl.NumberFormat(site.locale, { style: 'currency', currency: site.currency }).format(amount);

function createButton(text, className, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.disabled = disabled;
  return button;
}

function createSection(title, className) {
  const section = document.createElement('section');
  section.className = `checkout-section ${className}`;
  const heading = document.createElement('h2');
  heading.textContent = title;
  section.append(heading);
  return section;
}

function createCheckoutForm() {
  const form = document.createElement('form');
  form.className = 'checkout-form';
  const contact = createSection('Contact information', 'checkout-contact');
  const address = createSection('Shipping address', 'checkout-address');
  const contactFields = document.createElement('div');
  contactFields.className = 'checkout-fields';
  const addressFields = document.createElement('div');
  addressFields.className = 'checkout-fields';

  for (const [name, label, autocomplete, type] of fields) {
    const wrapper = document.createElement('label');
    wrapper.className = `checkout-field checkout-field-${name}`;
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.name = name;
    input.autocomplete = autocomplete;
    input.required = !['address2', 'phone'].includes(name);
    input.type = type;
    wrapper.append(text, input);
    (['firstName', 'lastName', 'email', 'phone'].includes(name)
      ? contactFields
      : addressFields
    ).append(wrapper);
  }

  contact.append(contactFields);
  const country = document.createElement('p');
  country.className = 'checkout-country';
  country.textContent = `Shipping to ${checkout.country.toUpperCase()}`;
  address.append(country, addressFields);

  const shipping = createSection('Shipping method', 'checkout-shipping');
  const shippingIntro = document.createElement('p');
  shippingIntro.textContent = 'Get available delivery options for your address.';
  const shippingButton = createButton('Get shipping methods', 'checkout-secondary-action');
  const methodLabel = document.createElement('label');
  methodLabel.className = 'checkout-field checkout-method';
  const methodText = document.createElement('span');
  methodText.textContent = 'Delivery option';
  const method = document.createElement('select');
  method.name = 'shippingMethod';
  method.required = true;
  method.disabled = true;
  methodLabel.append(methodText, method);
  const previewButton = createButton('Review totals', 'checkout-secondary-action', true);
  shipping.append(shippingIntro, shippingButton, methodLabel, previewButton);

  const payment = createSection('Payment', 'checkout-payment');
  const paymentIntro = document.createElement('p');
  paymentIntro.textContent = 'Pay securely with PayPal after reviewing your total.';
  const payButton = createButton('Continue to PayPal', 'checkout-primary-action', true);
  const message = document.createElement('p');
  message.className = 'checkout-message';
  message.setAttribute('role', 'status');
  payment.append(paymentIntro, payButton, message);
  form.append(contact, address, shipping, payment);
  return { form, method, shippingButton, previewButton, payButton, message };
}

function safeImageUrl(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    // Stored optional images may be missing or invalid.
  }
  return undefined;
}

function renderSummary(summary, cart, estimatedTotal) {
  const header = document.createElement('div');
  header.className = 'checkout-summary-header';
  const heading = document.createElement('h2');
  heading.textContent = 'Order summary';
  header.append(heading);

  const content = document.createElement('div');
  content.className = 'checkout-summary-content';
  const items = document.createElement('div');
  items.className = 'checkout-summary-items';
  for (const item of cart.items) {
    const row = document.createElement('div');
    row.className = 'checkout-summary-item';
    const media = document.createElement('div');
    media.className = 'checkout-summary-media';
    const imageUrl = safeImageUrl(item.imageUrl);
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.width = 64;
      image.height = 64;
      image.loading = 'lazy';
      media.append(image);
    }
    const details = document.createElement('div');
    details.className = 'checkout-summary-item-details';
    const name = document.createElement('strong');
    name.textContent = item.name;
    const quantity = document.createElement('span');
    quantity.textContent = `Qty ${item.quantity}`;
    details.append(name, quantity);
    const price = document.createElement('strong');
    price.textContent = money(item.quantity * Number(item.price.final));
    row.append(media, details, price);
    items.append(row);
  }

  const totals = document.createElement('div');
  totals.className = 'checkout-summary-totals';
  const subtotal = document.createElement('p');
  const subtotalLabel = document.createElement('span');
  subtotalLabel.textContent = 'Subtotal';
  const subtotalValue = document.createElement('strong');
  subtotalValue.textContent = money(cart.subtotal);
  subtotal.append(subtotalLabel, subtotalValue);
  const shipping = document.createElement('p');
  const shippingLabel = document.createElement('span');
  shippingLabel.textContent = 'Shipping & tax';
  const shippingValue = document.createElement('span');
  shippingValue.textContent =
    estimatedTotal == null ? 'Calculated at review' : 'See estimated total';
  shipping.append(shippingLabel, shippingValue);
  const total = document.createElement('p');
  total.className = 'checkout-summary-total';
  const totalLabel = document.createElement('span');
  totalLabel.textContent = 'Estimated total';
  const totalValue = document.createElement('strong');
  totalValue.textContent = estimatedTotal == null ? 'Review totals first' : money(estimatedTotal);
  total.append(totalLabel, totalValue);
  totals.append(subtotal, shipping, total);
  content.append(items, totals);
  summary.hidden = false;
  summary.replaceChildren(header, content);
}

function restoreDraft(form, key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || '{}');
    for (const input of form.querySelectorAll('input[name]')) {
      if (typeof saved[input.name] === 'string') input.value = saved[input.name];
    }
  } catch {
    // Storage is optional; never block checkout on a draft.
  }
}

function saveDraft(form, key) {
  try {
    sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(new FormData(form))));
  } catch {
    // No persistent draft available in this browser.
  }
}

function readShipping(form) {
  const data = new FormData(form);
  return {
    name: `${data.get('firstName')} ${data.get('lastName')}`.trim(),
    address1: data.get('address1'),
    address2: data.get('address2'),
    city: data.get('city'),
    state: data.get('state'),
    zip: data.get('zip'),
    country: checkout.country.toLowerCase(),
    phone: data.get('phone'),
    email: data.get('email'),
  };
}

function readOrderInput(form, method) {
  const data = new FormData(form);
  return {
    customer: Object.fromEntries(
      ['firstName', 'lastName', 'email', 'phone'].map((key) => [key, data.get(key)]),
    ),
    shipping: readShipping(form),
    shippingMethod: method.value,
  };
}

export default function decorate(widget) {
  const content = widget.querySelector('.commerce-checkout-content');
  const summary = widget.querySelector('.commerce-checkout-summary');
  const cart = getCart();
  if (!cart.count) {
    const empty = document.createElement('p');
    empty.className = 'checkout-empty';
    empty.textContent = 'Your cart is empty.';
    content.replaceChildren(empty);
    summary.hidden = true;
    return;
  }

  const { form, method, shippingButton, previewButton, payButton, message } = createCheckoutForm();
  const draftKey = `edge-commerce:checkout-form:v1:${site.storeView}`;
  const flow = createCheckoutFlow();

  restoreDraft(form, draftKey);
  content.replaceChildren(form);
  renderSummary(summary, cart);

  const fail = () => {
    message.textContent = 'Unable to continue. Check the address and try again.';
  };

  const invalidate = (event) => {
    payButton.disabled = true;
    renderSummary(summary, cart);
    message.textContent = '';
    if (event.target.name !== 'shippingMethod') {
      method.replaceChildren();
      method.disabled = true;
      previewButton.disabled = true;
    }
    saveDraft(form, draftKey);
  };
  form.addEventListener('input', invalidate);
  form.addEventListener('change', invalidate);
  document.addEventListener('cart:change', () => {
    payButton.disabled = true;
    method.replaceChildren();
    method.disabled = true;
    previewButton.disabled = true;
    if (!cart.count) {
      summary.hidden = true;
      message.textContent = 'Your cart is empty. Return to your cart before continuing.';
      return;
    }
    renderSummary(summary, cart);
    message.textContent = 'Your cart changed. Get shipping methods again.';
  });

  shippingButton.addEventListener('click', async () => {
    if (!form.reportValidity() || !cart.count) return;

    shippingButton.disabled = true;
    previewButton.disabled = true;
    payButton.disabled = true;
    const shipping = readShipping(form);
    const snapshot = cart.snapshot();
    try {
      const rates = await flow.shippingMethods(shipping);
      if (
        snapshot !== cart.snapshot() ||
        JSON.stringify(shipping) !== JSON.stringify(readShipping(form))
      ) {
        return;
      }
      method.replaceChildren();
      for (const rate of rates) {
        const option = document.createElement('option');
        option.value = rate.id;
        const amount = Number(rate.rate);
        const price =
          rate.rate != null && String(rate.rate).trim() !== '' && Number.isFinite(amount)
            ? ` — ${money(amount)}`
            : '';
        option.textContent = `${rate.label || rate.id}${price}`;
        method.append(option);
      }

      method.disabled = !rates.length;
      previewButton.disabled = !rates.length;
      message.textContent = rates.length
        ? 'Choose a shipping method, then review totals.'
        : 'No shipping methods available.';
    } catch {
      fail();
    } finally {
      shippingButton.disabled = false;
    }
  });

  previewButton.addEventListener('click', async () => {
    if (!form.reportValidity() || !cart.count) return;
    previewButton.disabled = true;
    payButton.disabled = true;
    const input = readOrderInput(form, method);
    const snapshot = cart.snapshot();

    try {
      const quote = await flow.preview(input);
      if (
        snapshot !== cart.snapshot() ||
        JSON.stringify(input) !== JSON.stringify(readOrderInput(form, method))
      ) {
        return;
      }
      const total = Number(quote.total);
      if (quote.total == null || String(quote.total).trim() === '' || !Number.isFinite(total)) {
        throw new Error('An estimated total is required before payment');
      }

      renderSummary(summary, cart, total);
      message.textContent = `Estimated total: ${money(total)}. PayPal approval returns to order review.`;
      payButton.disabled = false;
    } catch {
      fail();
    } finally {
      previewButton.disabled = method.disabled;
    }
  });

  payButton.addEventListener('click', async () => {
    payButton.disabled = true;

    try {
      const { redirectUrl } = await flow.place(readOrderInput(form, method));
      window.location.assign(redirectUrl);
    } catch {
      fail();
      payButton.disabled = false;
    }
  });
}
