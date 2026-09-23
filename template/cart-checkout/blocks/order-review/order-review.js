import checkout from '../../scripts/commerce/checkout-config.js';
import site from '../../scripts/commerce/site-config.js';
import { createReviewFlow, paymentState } from '../../scripts/commerce/review-flow.js';

function createOrderDetails(order) {
  const heading = document.createElement('h2');
  heading.textContent = 'Review your order';

  const items = document.createElement('ul');
  for (const item of order.items || []) {
    const li = document.createElement('li');
    li.textContent = `${item.name || item.sku} × ${item.quantity}`;
    items.append(li);
  }

  const total = document.createElement('p');
  const amount = Number(order.total);
  const formattedTotal =
    order.total != null && Number.isFinite(amount)
      ? new Intl.NumberFormat(site.locale, { style: 'currency', currency: site.currency }).format(
          amount,
        )
      : 'See order details';
  total.textContent = `Order total: ${formattedTotal}`;

  const address = document.createElement('p');
  const addressParts = [
    order.shipping?.address1,
    order.shipping?.city,
    order.shipping?.state,
    order.shipping?.zip,
    order.shipping?.country,
  ];
  address.textContent = `Delivering to: ${addressParts.filter(Boolean).join(', ')}`;

  return [heading, items, total, address];
}

export default async function decorate(block) {
  const id = new URLSearchParams(window.location.search).get('orderId');
  const flow = createReviewFlow();
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = 'Loading order for review…';
  block.replaceChildren(status);

  try {
    const order = await flow.lookup(id);
    if (paymentState(order) !== 'review') {
      status.textContent = 'This order cannot be confirmed. Check its payment status.';
      return;
    }

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = 'Complete order';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel and return to cart';

    status.textContent = 'PayPal approved. Payment is not complete until you confirm.';
    block.replaceChildren(...createOrderDetails(order), status, confirm, cancel);

    const busy = (value) => {
      confirm.disabled = value;
      cancel.disabled = value;
    };

    confirm.addEventListener('click', async () => {
      busy(true);
      status.textContent = 'Confirming payment…';
      let settling = false;

      try {
        const outcome = await flow.confirm(id);
        if (outcome === 'completed') {
          window.location.assign(`${checkout.routes.complete}?orderId=${encodeURIComponent(id)}`);
        } else {
          settling = true;
          status.textContent = 'Payment is processing. Do not submit a new order.';

          const link = document.createElement('a');
          link.href = `${checkout.routes.complete}?orderId=${encodeURIComponent(id)}`;
          link.textContent = 'Check payment status';
          status.after(link);
        }
      } catch {
        status.textContent = 'Confirmation could not be verified. Retry with the same order.';
      } finally {
        if (!settling) busy(false);
      }
    });

    cancel.addEventListener('click', async () => {
      busy(true);
      try {
        await flow.cancel(id);
        window.location.assign(checkout.routes.cancel);
      } catch {
        status.textContent = 'Unable to cancel now. Try again or contact support.';
      } finally {
        busy(false);
      }
    });
  } catch {
    status.textContent = 'Order lookup failed. Return to checkout or try again.';
  }
}
