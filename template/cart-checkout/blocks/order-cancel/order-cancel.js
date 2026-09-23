import checkout from '../../scripts/commerce/checkout-config.js';

export default function decorate(block) {
  const title = document.createElement('h2');
  title.textContent = 'Payment not completed';
  const reason = new URLSearchParams(window.location.search).get('reason');
  const message = document.createElement('p');
  message.textContent =
    reason === 'customer_cancelled'
      ? 'You cancelled the payment. Your cart is still available.'
      : 'Payment could not be completed. Your cart is still available; please retry or contact the merchant.';
  const link = document.createElement('a');
  link.href = checkout.routes.cart;
  link.textContent = 'Return to cart';
  block.replaceChildren(title, message, link);
}
