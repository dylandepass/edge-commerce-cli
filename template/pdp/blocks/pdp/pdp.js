import site from '../../scripts/commerce/site-config.js';
import pdpConfig from '../../scripts/commerce/pdp-config.js';
import { readProduct } from '../../scripts/commerce/pdp-page.js';

/*
 * Product page built from the Product Pipeline page: Product JSON-LD supplies the
 * offers; the rendered heading and pictures are reused. In catalog mode there is no
 * price or cart. See scripts/commerce/pdp-page.js for the auto-block hook.
 */

/**
 * Label for an offer in the variant selector.
 * @param {object} offer JSON-LD offer
 * @returns {string}
 */
function offerLabel(offer) {
  const options = Array.isArray(offer.options)
    ? offer.options.map((option) => option?.value).filter(Boolean)
    : [];
  return offer.name || options.join(', ') || offer.sku || '';
}

/**
 * Moves the pipeline pictures into a media column; the first one is the LCP image.
 * @param {Element[]} pictures pipeline pictures
 * @returns {HTMLDivElement}
 */
function createMedia(pictures) {
  const media = document.createElement('div');
  media.className = 'pdp-media';
  pictures.forEach((picture, index) => {
    const img = picture.querySelector('img');
    if (img && index === 0) {
      img.loading = 'eager';
      img.setAttribute('fetchpriority', 'high');
    }
    media.append(picture);
  });
  return media;
}

/**
 * Adds the variant selector, price, quantity and Add to cart button.
 * @param {object} options product, offers, info column and media column
 */
async function createBuyBox({ product, offers, info, media }) {
  const [{ addProductToCart }, { mapJsonLdOffer }] = await Promise.all([
    import('../../scripts/commerce/product-to-cart.js'),
    import('../../scripts/commerce/jsonld-adapter.js'),
  ]);

  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const price = document.createElement('p');
  price.className = 'pdp-price';
  const variantImage = document.createElement('img');
  variantImage.alt = product.name || '';
  variantImage.hidden = true;
  media.prepend(variantImage);

  const selector = document.createElement('select');
  selector.setAttribute('aria-label', 'Product variant');
  if (offers.length > 1) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a variant';
    selector.append(placeholder);
  }
  offers.forEach((offer, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = offerLabel(offer);
    selector.append(option);
  });
  selector.hidden = offers.length < 2;

  const quantity = document.createElement('input');
  quantity.type = 'number';
  quantity.min = '1';
  quantity.value = '1';
  quantity.setAttribute('aria-label', 'Quantity');

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Add to cart';

  // Only a source-backed, in-stock offer in the store currency can be added.
  const cartItem = () => {
    const offer = selector.value === '' ? null : offers[Number(selector.value)];
    if (!offer || !String(offer.availability || '').endsWith('InStock')) {
      return null;
    }
    try {
      return { offer, item: mapJsonLdOffer(product, offer) };
    } catch {
      return null;
    }
  };

  const show = () => {
    const selected = cartItem();
    price.textContent = '';
    button.disabled = !selected;
    variantImage.hidden = true;
    if (!selected) {
      if (selector.value !== '') {
        status.textContent = 'This product or variant is unavailable.';
      }
      return;
    }

    price.textContent = new Intl.NumberFormat(site.locale, {
      style: 'currency',
      currency: site.currency,
    }).format(Number(selected.item.price.final));
    const image = [].concat(selected.offer.image || [])[0];
    if (offers.length > 1 && image) {
      variantImage.src = image;
      variantImage.hidden = false;
    }
  };

  selector.addEventListener('change', () => {
    status.textContent = '';
    show();
  });

  button.addEventListener('click', () => {
    const selected = cartItem();
    if (!selected) {
      status.textContent = 'Unable to add this product. Check variant and quantity.';
      return;
    }
    try {
      addProductToCart(selected.item, Number(quantity.value));
      status.textContent = 'Added to cart.';
      if (site.cartBehavior !== 'stay' && site.cartDestination) {
        window.location.assign(site.cartDestination);
      }
    } catch {
      status.textContent = 'Unable to add this product. Check variant and quantity.';
    }
  });

  info.append(selector, price, quantity, button, status);
  status.textContent = offers.length > 1 ? 'Choose a variant.' : '';
  show();
}

/**
 * Decorates the PDP block.
 * @param {Element} block the pdp block
 */
export default async function decorate(block) {
  const product = readProduct();
  if (!product) {
    // Not a pipeline product page: leave the authored content as it is.
    return;
  }

  // The pipeline's summary: heading, a formatted price and the product pictures.
  const heading = block.querySelector('h1');
  const pictures = [...block.querySelectorAll('picture')];
  const info = document.createElement('div');
  info.className = 'pdp-info';
  if (heading) {
    info.append(heading);
  } else if (product.name) {
    const title = document.createElement('h1');
    title.textContent = product.name;
    info.append(title);
  }
  const media = createMedia(pictures);
  block.replaceChildren(media, info);

  if (pdpConfig.mode === 'catalog') {
    return;
  }

  const offers = []
    .concat(product.offers || [])
    .filter((offer) => offer && typeof offer === 'object');
  if (!offers.length) {
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'This product is unavailable.';
    info.append(status);
    return;
  }
  await createBuyBox({ product, offers, info, media });
}
