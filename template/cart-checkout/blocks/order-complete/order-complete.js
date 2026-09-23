import { createReviewFlow } from '../../scripts/commerce/review-flow.js';
import site from '../../scripts/commerce/site-config.js';

export default async function decorate(block) {
  const id = new URLSearchParams(window.location.search).get('orderId');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = 'Checking payment status…';
  block.replaceChildren(status);
  try {
    const flow = createReviewFlow();
    const { order, state } = await flow.completion(id);
    if (state !== 'completed') {
      status.textContent =
        state === 'pending'
          ? 'Payment is processing. Check back later.'
          : 'Payment is not completed.';
      return;
    }
    flow.clearIfMatched(id);
    try {
      sessionStorage.removeItem(`edge-commerce:checkout-form:v1:${site.storeView}`);
    } catch {
      /* Optional draft. */
    }
    const title = document.createElement('h2');
    title.textContent = 'Thank you for your order';
    status.textContent = `Order ${order.id} is complete.`;
    block.replaceChildren(title, status);
  } catch {
    status.textContent =
      'Could not verify the payment. Please try again later; do not place another order yet.';
  }
}
