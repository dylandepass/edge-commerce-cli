import site from './site-config.js';

/** Maps the Product Pipeline's .json product/variant fields; override for other catalogs. */
export function mapProduct(product, variant = null, pagePath = location.pathname) {
  const selected = variant || product;
  const price = selected?.price;
  if (
    !selected?.sku ||
    !product?.name ||
    price?.final == null ||
    String(price.final).trim() === '' ||
    !Number.isFinite(Number(price.final)) ||
    Number(price.final) < 0 ||
    price.currency !== site.currency
  ) {
    throw new Error('This product has no source-backed SKU or offer for this store');
  }
  if (!['InStock', 'in_stock'].includes(selected.availability))
    throw new Error('Availability must be source-backed and in stock');
  return {
    sku: selected.sku,
    path: pagePath,
    name: selected.name || product.name,
    price: { final: price.final, currency: price.currency },
    ...(selected.images?.[0]?.url
      ? { imageUrl: new URL(selected.images[0].url, location.href).href }
      : {}),
    productUrl: location.href,
  };
}
