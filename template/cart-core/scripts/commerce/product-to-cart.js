import { getCart } from './cart.js';

/** The storefront supplies a resolved catalog product/variant; price remains server-authoritative. */
export function productToCartItem(product, quantity = 1) {
  if (!product?.sku || !product.path || !product.name || product.price?.final == null) {
    throw new Error('A source-backed SKU, path, name and offer are required');
  }
  return {
    sku: product.sku,
    path: product.path,
    name: product.name,
    quantity,
    price: product.price,
    ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
    ...(product.productUrl ? { productUrl: product.productUrl } : {}),
    ...(product.selectedOptions?.length ? { selectedOptions: product.selectedOptions } : {}),
    ...(product.custom ? { custom: product.custom } : {}),
  };
}

export function addProductToCart(product, quantity = 1) {
  return getCart().add(productToCartItem(product, quantity));
}
