# Storefront setup

The installed `scripts/commerce/` and optional `blocks/` files belong to this storefront. Edit them locally; never import them from this CLI package at page runtime. `scripts/commerce/site-config.js` supplies store view, locale, currency, cart behavior, and product source. The cart stores selected line IDs by SKU/path/options and emits `cart:change` on same-tab edits; storage events sync other tabs.

To connect an existing PDP/PLP, import `addProductToCart` from `/scripts/commerce/product-to-cart.js` in your storefront code and pass a *resolved source-backed* product with `sku`, `path`, `name`, `price: { final, currency }`, optional `selectedOptions`/`imageUrl`, and quantity. Do not trust browser price as the amount charged; Commerce API preview is authoritative. Without an existing cart page, use `cartBehavior: "stay"` until checkout is installed. To add the optional PDP later, rerun the CLI with `--feature pdp`; the existing cart core is preserved.

For EDS, author each block as a one-cell table or DA block named exactly after its block directory. The CLI does not edit your `scripts/scripts.js`, navigation, DA pages, or root agent instructions. Ensure your EDS block loader decorates the copied blocks and publish their pages separately. Existing targeted `AGENTS.md` files cause a manual-merge conflict; reconcile them with your site-wide instructions.
