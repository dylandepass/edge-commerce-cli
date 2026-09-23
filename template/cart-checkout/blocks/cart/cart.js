import { getCart, lineId } from '../../scripts/commerce/cart.js';

function createCartLine(item, cart) {
  const row = document.createElement('div');
  row.className = 'cart-line';

  const name = document.createElement('span');
  name.textContent = item.name;

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

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.setAttribute('aria-label', `Remove ${item.name}`);
  remove.addEventListener('click', () => cart.remove(lineId(item)));

  row.append(name, quantity, remove);
  return row;
}

export default function decorate(block) {
  const cart = getCart();

  function render() {
    const container = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = 'Cart';
    container.append(title);

    if (!cart.count) {
      const empty = document.createElement('p');
      empty.textContent = 'Your cart is empty.';
      container.append(empty);
    }

    for (const item of cart.items) {
      container.append(createCartLine(item, cart));
    }

    block.replaceChildren(container);
  }

  render();
  document.addEventListener('cart:change', render);
}
