import { getApi } from './api.js';
import { getCart } from './cart.js';

export function paymentState(order) {
  if (order?.state === 'payment_completed') return 'completed';
  if (order?.state === 'payment_requires_confirmation') return 'review';
  if (order?.state === 'payment_cancelled') return 'cancelled';
  return 'pending';
}

export function createReviewFlow({
  api = getApi(),
  cart = getCart(),
  storage = sessionStorage,
  id = () => crypto.randomUUID(),
} = {}) {
  const reference = (orderId) => {
    let value;
    try {
      value = JSON.parse(storage.getItem('edge-commerce:order'));
    } catch {
      /* no proof */
    }
    if (!orderId || value?.orderId !== orderId || !value.email)
      throw new Error('Order proof is missing for this browser tab');
    return value;
  };
  const clearIfMatched = (orderId) => {
    const { cartSnapshot } = reference(orderId);
    if (cartSnapshot && cart.snapshot() === cartSnapshot) {
      cart.clear();
      return true;
    }
    return false;
  };
  const lookup = async (orderId) => {
    const { email } = reference(orderId);
    const response = await api.order(email, orderId);
    if (!response.order || response.order.id !== orderId)
      throw new Error('Order lookup did not match');
    return response.order;
  };
  return {
    lookup,
    clearIfMatched,
    async confirm(orderId) {
      const before = paymentState(await lookup(orderId));
      if (before === 'completed') {
        clearIfMatched(orderId);
        return 'completed';
      }
      if (before !== 'review') throw new Error('Order is not ready for confirmation');
      const keyName = `edge-commerce:confirm:${orderId}`;
      let key = storage.getItem(keyName);
      if (!key) {
        key = id();
        storage.setItem(keyName, key);
      }
      const response = await api.confirm(orderId, key);
      if (response.status === 'completed') {
        // Do not clear on a successful HTTP response alone; verify the authoritative order.
        if (paymentState(await lookup(orderId)) !== 'completed') return 'pending';
        clearIfMatched(orderId);
        return 'completed';
      }
      return 'pending';
    },
    async cancel(orderId) {
      if (paymentState(await lookup(orderId)) !== 'review')
        throw new Error('Order is not cancellable');
      const keyName = `edge-commerce:cancel:${orderId}`;
      let key = storage.getItem(keyName);
      if (!key) {
        key = id();
        storage.setItem(keyName, key);
      }
      await api.cancel(orderId, key);
      return 'cancelled';
    },
    async completion(orderId) {
      const order = await lookup(orderId);
      return { order, state: paymentState(order) };
    },
  };
}
