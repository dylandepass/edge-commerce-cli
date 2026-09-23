import site from '../../scripts/commerce/site-config.js';
import { addProductToCart } from '../../scripts/commerce/product-to-cart.js';
import { mapProduct } from '../../scripts/commerce/pdp-adapter.js';

export default async function decorate(block) {
  const authoredUrl = block.querySelector('a[href$=".json"]')?.href;
  const sourceUrl = new URL(
    authoredUrl || `${window.location.pathname}.json`,
    window.location.href,
  );
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = 'Loading product…';
  block.replaceChildren(status);

  if (sourceUrl.origin !== window.location.origin) {
    status.textContent = 'Product source must be on this site.';
    return;
  }

  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error('Product unavailable');
    const product = await response.json();
    if (!product?.name || !product?.sku) throw new Error('Product data missing');

    const title = document.createElement('h1');
    title.textContent = product.name;

    const price = document.createElement('p');
    const image = document.createElement('img');
    image.alt = product.name;
    image.loading = 'lazy';

    const selector = document.createElement('select');
    selector.setAttribute('aria-label', 'Product variant');
    const variants = product.variants?.length ? product.variants : [product];
    if (product.variants?.length) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose a variant';
      selector.append(placeholder);
    }
    variants.forEach((variant, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent =
        variant.name || variant.options?.map((item) => item.value).join(', ') || variant.sku;
      selector.append(option);
    });

    const quantity = document.createElement('input');
    quantity.type = 'number';
    quantity.min = '1';
    quantity.value = '1';
    quantity.setAttribute('aria-label', 'Quantity');

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Add to cart';

    const show = () => {
      const variant = selector.value === '' ? null : variants[Number(selector.value)];
      price.textContent = '';
      image.hidden = true;
      button.disabled = !variant;
      if (!variant) return;

      try {
        const item = mapProduct(product, variant, window.location.pathname);
        price.textContent = new Intl.NumberFormat(site.locale, {
          style: 'currency',
          currency: site.currency,
        }).format(Number(item.price.final));
        if (item.imageUrl) {
          image.src = item.imageUrl;
          image.hidden = false;
        }
      } catch {
        button.disabled = true;
        status.textContent = 'This product or variant is unavailable.';
      }
    };

    selector.addEventListener('change', () => {
      status.textContent = '';
      show();
    });

    button.addEventListener('click', () => {
      try {
        const selected = selector.value === '' ? null : variants[Number(selector.value)];
        if (!selected) throw new Error('Select a variant');
        addProductToCart(
          mapProduct(product, selected, window.location.pathname),
          Number(quantity.value),
        );
        status.textContent = 'Added to cart.';
        if (site.cartBehavior !== 'stay' && site.cartDestination) {
          window.location.assign(site.cartDestination);
        }
      } catch {
        status.textContent = 'Unable to add this product. Check variant and quantity.';
      }
    });

    block.replaceChildren(title, image, selector, price, quantity, button, status);
    status.textContent = product.variants?.length ? 'Choose a variant.' : '';
    show();
  } catch {
    status.textContent = 'Product details are unavailable.';
  }
}
