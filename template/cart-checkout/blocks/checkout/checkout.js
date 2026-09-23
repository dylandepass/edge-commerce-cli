import site from '../../scripts/commerce/site-config.js';
import checkout from '../../scripts/commerce/checkout-config.js';
import { getCart } from '../../scripts/commerce/cart.js';
import { createCheckoutFlow } from '../../scripts/commerce/checkout-flow.js';

const fields = [
  ['firstName', 'First name', 'given-name'],
  ['lastName', 'Last name', 'family-name'],
  ['email', 'Email', 'email'],
  ['phone', 'Phone', 'tel'],
  ['address1', 'Street address', 'address-line1'],
  ['address2', 'Apartment or suite', 'address-line2'],
  ['city', 'City', 'address-level2'],
  ['state', 'State or region code', 'address-level1'],
  ['zip', 'Postal code', 'postal-code'],
];

function createButton(text, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.disabled = disabled;
  return button;
}

function createCheckoutForm() {
  const form = document.createElement('form');
  const heading = document.createElement('h2');
  heading.textContent = 'Guest checkout';
  form.append(heading);

  for (const [name, label, autocomplete] of fields) {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;

    const input = document.createElement('input');
    input.name = name;
    input.autocomplete = autocomplete;
    input.required = !['address2', 'phone'].includes(name);
    input.type = name === 'email' ? 'email' : 'text';

    wrapper.append(input);
    form.append(wrapper);
  }

  const methodLabel = document.createElement('label');
  methodLabel.textContent = 'Shipping method';
  const method = document.createElement('select');
  method.name = 'shippingMethod';
  method.required = true;
  method.disabled = true;
  methodLabel.append(method);

  const shippingButton = createButton('Get shipping methods');
  const previewButton = createButton('Review totals', true);
  const payButton = createButton('Continue to PayPal', true);
  const message = document.createElement('p');
  message.setAttribute('role', 'status');

  form.append(shippingButton, methodLabel, previewButton, payButton, message);
  return { form, method, shippingButton, previewButton, payButton, message };
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

export default function decorate(block) {
  const cart = getCart();
  if (!cart.count) {
    const empty = document.createElement('p');
    empty.textContent = 'Your cart is empty.';
    block.replaceChildren(empty);
    return;
  }

  const { form, method, shippingButton, previewButton, payButton, message } = createCheckoutForm();
  const draftKey = `edge-commerce:checkout-form:v1:${site.storeView}`;
  const flow = createCheckoutFlow();

  restoreDraft(form, draftKey);
  block.replaceChildren(form);

  const fail = () => {
    message.textContent = 'Unable to continue. Check the address and try again.';
  };

  // Any edited field invalidates the visible preview until the shopper reviews totals again.
  form.addEventListener('input', () => {
    payButton.disabled = true;
    message.textContent = '';
    saveDraft(form, draftKey);
  });
  form.addEventListener('change', () => {
    payButton.disabled = true;
    saveDraft(form, draftKey);
  });

  shippingButton.addEventListener('click', async () => {
    if (!form.reportValidity()) return;

    shippingButton.disabled = true;
    previewButton.disabled = true;
    payButton.disabled = true;

    try {
      const rates = await flow.shippingMethods(readShipping(form));
      method.replaceChildren();
      for (const rate of rates) {
        const option = document.createElement('option');
        option.value = rate.id;
        option.textContent = `${rate.label || rate.id} — ${rate.rate ?? ''} ${site.currency}`;
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
    if (!form.reportValidity()) return;
    previewButton.disabled = true;

    try {
      const quote = await flow.preview(readOrderInput(form, method));
      const total = new Intl.NumberFormat(site.locale, {
        style: 'currency',
        currency: site.currency,
      }).format(Number(quote.total));

      message.textContent = `Estimated total: ${total}. PayPal approval returns to order review.`;
      payButton.disabled = false;
    } catch {
      fail();
    } finally {
      previewButton.disabled = false;
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
