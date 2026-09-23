import site from './site-config.js';

function validItem(item, currency) {
  if (!item || typeof item.sku !== 'string' || !item.sku) return false;
  if (typeof item.path !== 'string' || !item.path.startsWith('/') || item.path.startsWith('//')) {
    return false;
  }
  if (typeof item.name !== 'string' || !item.name) return false;
  if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) return false;

  const final = item.price?.final;
  return (
    final != null &&
    String(final).trim() !== '' &&
    Number.isFinite(Number(final)) &&
    Number(final) >= 0 &&
    (!item.price.currency || item.price.currency === currency)
  );
}

const canonical = (value) =>
  JSON.stringify(value, (_, entry) =>
    entry && !Array.isArray(entry) && typeof entry === 'object'
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );

export function lineId(item) {
  return canonical({
    sku: item.sku,
    path: item.path,
    selectedOptions: item.selectedOptions || [],
    custom: item.custom || {},
  });
}

export function toOrderItems(items, currency) {
  return items.map((item) => ({
    sku: item.sku,
    path: item.path,
    quantity: item.quantity,
    name: item.name,
    price: { final: String(item.price.final), currency },
    ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
    ...(item.productUrl ? { productUrl: item.productUrl } : {}),
    ...(item.selectedOptions?.length ? { selectedOptions: item.selectedOptions } : {}),
    ...(item.custom ? { custom: item.custom } : {}),
  }));
}

export function createCart({
  storage,
  storeView = site.storeView,
  currency = site.currency,
  events,
} = {}) {
  const key = `edge-commerce:cart:v1:${storeView}`;

  const notify = (action) => {
    events?.(action);
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('cart:change', { detail: { action } }));
    }
  };

  const read = () => {
    try {
      const parsed = JSON.parse(storage.getItem(key));
      return parsed?.version === 1 && Array.isArray(parsed.items)
        ? parsed.items.filter((item) => validItem(item, currency))
        : [];
    } catch {
      return [];
    }
  };

  let items = read();

  function update(next, action) {
    storage.setItem(key, JSON.stringify({ version: 1, items: next }));
    items = next;
    notify(action);
  }

  const api = {
    get items() {
      return items.map((item) => ({ ...item }));
    },

    get count() {
      return items.reduce((sum, item) => sum + item.quantity, 0);
    },

    get subtotal() {
      return items.reduce((sum, item) => sum + item.quantity * Number(item.price.final), 0);
    },

    getOrderItems() {
      return toOrderItems(items, currency);
    },

    snapshot() {
      return canonical(api.getOrderItems());
    },

    refresh() {
      items = read();
      notify('sync');
    },

    add(item) {
      if (!validItem(item, currency)) throw new Error('Invalid cart item');

      // Rebase each mutation on the latest cross-tab state.
      items = read();
      const normalized = { ...item, price: { final: String(item.price.final), currency } };
      const id = lineId(normalized);
      const existing = items.find((entry) => lineId(entry) === id);

      if (existing) {
        existing.quantity += item.quantity;
      } else {
        items.push(normalized);
      }

      update(items, 'add');
      return id;
    },

    setQuantity(id, quantity) {
      if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Invalid quantity');

      items = read();
      const index = items.findIndex((item) => lineId(item) === id);
      if (index < 0) throw new Error('Cart line not found');

      if (!quantity) {
        items.splice(index, 1);
      } else {
        items[index].quantity = quantity;
      }

      update(items, 'update');
    },

    remove(id) {
      api.setQuantity(id, 0);
    },

    clear() {
      update([], 'clear');
    },
  };

  return api;
}

let instance;
export function getCart() {
  if (!instance) {
    instance = createCart({ storage: localStorage });
    window.addEventListener('storage', (event) => {
      if (event.key === `edge-commerce:cart:v1:${site.storeView}`) instance.refresh();
    });
  }

  return instance;
}
