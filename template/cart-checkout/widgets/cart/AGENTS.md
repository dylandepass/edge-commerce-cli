# Cart widget

Render each line using its stable line ID, not SKU alone. Keep quantity/removal accessible. The cart and API order projection live in `scripts/commerce/cart.js`. Cart-origin PayPal Express previews shipping and rejects stale cart snapshots; approval routes to review and does not clear the cart. See `docs/commerce/architecture.md` and cart/flow tests.
