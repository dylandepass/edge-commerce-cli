import { getCart } from '../../scripts/commerce/cart.js';
import site from '../../scripts/commerce/site-config.js';
import checkout from '../../scripts/commerce/checkout-config.js';
import { createExpressFlow } from '../../scripts/commerce/checkout-flow.js';
import { createExpressButton, loadPayPalSdk } from '../../scripts/commerce/payments/paypal.js';

const money = (amount) =>
  new Intl.NumberFormat(site.locale, { style: 'currency', currency: site.currency }).format(amount);

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

export default function decorate(block) {
  const cart = getCart();

  function render() {
    const container = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = 'Order summary';

    const subtotal = document.createElement('p');
    subtotal.textContent = `Subtotal: ${money(cart.subtotal)} (before shipping and tax)`;
    container.append(heading, subtotal);

    if (cart.count) {
      const checkoutLink = document.createElement('a');
      checkoutLink.href = checkout.routes.checkout;
      checkoutLink.textContent = 'Checkout';

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

      container.append(checkoutLink, paypalButton, message);
    }

    block.replaceChildren(container);
  }

  render();
  document.addEventListener('cart:change', render);
}
