import site from './site-config.js';

function imageUrl(images, baseUrl) {
  const candidates = Array.isArray(images) ? images : [images];
  for (const image of candidates) {
    const value = typeof image === 'string' ? image : image?.url || image?.contentUrl;
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const url = new URL(value, baseUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch {
      // Ignore incomplete image metadata rather than guessing a media URL.
    }
  }
  return undefined;
}

/**
 * Adapt a resolved Product and its selected Offer from page JSON-LD to the cart
 * input. For multiple offers, pass the selected source-backed offer explicitly.
 * This does not copy Product.custom or infer inventory when availability is absent.
 */
export function mapJsonLdOffer(
  product,
  offer,
  {
    path = typeof window === 'undefined' ? undefined : window.location.pathname,
    baseUrl = typeof window === 'undefined' ? undefined : window.location.href,
    currency = site.currency,
  } = {},
) {
  const offers = Array.isArray(product?.offers) ? product.offers : [product?.offers];
  const selected = offer || (offers.length === 1 ? offers[0] : undefined);
  if (!selected || typeof selected !== 'object') {
    throw new Error('Select a source-backed product offer');
  }

  const sku = selected.sku || product?.sku;
  const name = selected.name || product?.name;
  const final = selected.price;
  if (
    typeof sku !== 'string' ||
    !sku.trim() ||
    typeof name !== 'string' ||
    !name.trim() ||
    final == null ||
    String(final).trim() === '' ||
    !Number.isFinite(Number(final)) ||
    Number(final) < 0 ||
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[?#\\]/.test(path)
  ) {
    throw new Error('A source-backed SKU, path, name and offer are required');
  }
  if (selected.priceCurrency !== currency) {
    throw new Error(`This cart only supports ${currency} offers`);
  }
  if (selected.availability) {
    const state =
      typeof selected.availability === 'string'
        ? selected.availability.split(/[/#]/).at(-1)
        : undefined;
    if (state !== 'InStock') throw new Error('The selected offer is not in stock');
  }

  const image = imageUrl(
    [
      ...(Array.isArray(selected.image) ? selected.image : [selected.image]),
      ...(Array.isArray(product?.image) ? product.image : [product?.image]),
    ],
    baseUrl,
  );
  return {
    sku,
    path,
    name,
    price: { final: String(final), currency: selected.priceCurrency },
    ...(image ? { imageUrl: image } : {}),
    productUrl: path,
  };
}
