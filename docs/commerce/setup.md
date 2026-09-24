# Storefront setup

The installed `scripts/commerce/`, checkout `widgets/`, and optional PDP `blocks/` files belong to this storefront. Edit them locally; never import them from this CLI package at page runtime. `scripts/commerce/site-config.js` supplies a cart storage namespace (`storeView`), shopper locale, currency, cart behavior, and product source. The namespace defaults to `default` for single-store sites; it does not have to be a Commerce API store view. Choose distinct values when multiple storefronts share one domain. Locale defaults to `en-US` (US English) and should be changed for other markets. When upgrading an existing installation, keep its previous `storeView` value so stored carts and checkout forms remain accessible. The cart stores selected line IDs by SKU/path/options and emits `cart:change` on same-tab edits; storage events sync other tabs.

To connect an existing PDP/PLP, import `addProductToCart` from `/scripts/commerce/product-to-cart.js` in your storefront code and pass a *resolved source-backed* product with `sku`, `path`, `name`, `price: { final, currency }`, optional `selectedOptions`/`imageUrl`, and quantity. The price currency must be present and match `site.currency`; missing or mismatched amounts cannot be relabeled during checkout. Previously stored lines without a matching currency are ignored when the cart loads. Do not trust browser price as the amount charged; Commerce API preview is authoritative. Without an existing cart page, use `cartBehavior: "stay"` until checkout is installed. To add the optional PDP later, rerun the CLI with `--feature pdp`; the existing cart core is preserved.

If your site renders Product/Offer JSON-LD instead of using the optional Product Pipeline PDP adapter, you can opt into `/scripts/commerce/jsonld-adapter.js`. Pass the **selected** source-backed Offer when the product has multiple offers:

```js
import { mapJsonLdOffer } from '/scripts/commerce/jsonld-adapter.js';
import { addProductToCart } from '/scripts/commerce/product-to-cart.js';

const cartProduct = mapJsonLdOffer(productJsonLd, selectedOffer, {
  path: window.location.pathname,
});
addProductToCart(cartProduct, 1);
```

The adapter reads SKU/name from the selected Offer or Product, `price` and `priceCurrency` from the Offer, and the first usable Product/Offer image. It keeps the product route local and excludes large `custom` objects. A single `offers` object can be inferred; multiple offers require a selected Offer. Explicit non-stock availability is rejected; when availability is absent the storefront must validate purchasability itself. This adapter does not read the document head, select variants, create buttons, or establish the amount charged. Use your own adapter for other catalog schemas.

When cart-checkout is installed, author standalone widget links as described in the [checkout setup guide](checkout-setup.md); the optional PDP still uses an authored block named `pdp`. The CLI does not edit your `scripts/scripts.js`, navigation, DA pages, or root agent instructions. Ensure your site loads widget links and the optional PDP block, then publish their pages separately. Existing targeted `AGENTS.md` files cause a manual-merge conflict; reconcile them with your site-wide instructions.
