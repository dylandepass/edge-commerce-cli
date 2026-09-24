# Cart and PayPal checkout setup

The CLI copies five self-contained EDS widgets into `widgets/`: `cart`, `checkout`, `order-review`, `order-complete`, and `order-cancel`. The cart widget includes its own item list, single order summary, checkout link, and optional PayPal Express action; there is no separate `cart-summary` block. Each widget owns its HTML shell, CSS, and JavaScript. The optional PDP remains a block because it decorates product content.

## Author the pages

Your storefront must support [AEM widgets](https://www.aem.live/docs/widgets): a standalone widget URL in an authored paragraph is auto-blocked, then its `.html`, `.css`, and `.js` are loaded. If your site does not already have a widget loader and link auto-blocking, integrate those before publishing these pages; copying the files alone does not edit `scripts/scripts.js` or make URLs into widgets. Verify `/widgets/cart/cart.html` resolves from your code origin. For example, author a **single link** on the cart page:

```text
https://main--your-repo--your-org.aem.page/widgets/cart/cart.html
```

Author and publish one page for each route in `scripts/commerce/checkout-config.js`, changing the widget filename and folder to match:

| Route setting | Widget link path |
| --- | --- |
| `routes.cart` | `/widgets/cart/cart.html` |
| `routes.checkout` | `/widgets/checkout/checkout.html` |
| `routes.review` | `/widgets/order-review/order-review.html` |
| `routes.complete` | `/widgets/order-complete/order-complete.html` |
| `routes.cancel` | `/widgets/order-cancel/order-cancel.html` |

Use your storefront's code origin/branch in the authored URLs. Keep each widget link alone in its paragraph so the site's widget auto-blocking recognizes it. Widget HTML already contains the page heading; avoid authoring a second heading or legacy Cart/Cart Summary block on the same page. Existing authored pages must be changed manually; the CLI does not publish or rewrite content. Link your existing PDP to `addProductToCart`.

The default cart and checkout use responsive product, form, and order-summary cards. The checkout summary shows the cart subtotal until the Commerce API returns a previewed total; it does not estimate tax or shipping in the browser. To match your storefront, optionally load `styles/commerce-tokens.css` from your global stylesheet and override `--commerce-color-primary`, `--commerce-color-border`, `--commerce-radius-card`, `--commerce-summary-width`, and other `--commerce-*` properties. The widgets also have standalone CSS fallbacks when that stylesheet is not loaded.

## Configure payment and validate

Set the API org, site, country, and **public** PayPal client ID in `checkout-config.js`. The API origin is chosen at runtime: `*.aem.page`, `*.aem.live`, and localhost use `https://api-stage.adobecommerce.live`; custom domains use `https://api.adobecommerce.live`. If you use a custom staging domain or API proxy, set a public `api.origin` override in the setup JSON or edit the customer-owned `checkout-config.js`; existing explicit origins remain in effect. Check that this routing matches your merchant server configuration. Keep `paypal.environment: "sandbox"` until your own sandbox testing is complete. Configure the Commerce API PayPal secret server-side with `orderReview.checkout` and `orderReview.express` enabled and published HTTPS success/cancel/review URLs. No PayPal client secret belongs in site code or CLI input. The Commerce API must be reachable with the storefront's CORS settings, and the merchant must supply allowed shipping methods for its country. The default form asks for a region and postal code; adapt its address fields and validate shipping/tax/payment in the merchant's country before enabling a locale beyond the unit-test fixture. Guest preview/create may require a site-provided `window.edgeCommerceRecaptchaToken(action)` function that returns a browser reCAPTCHA token; if enforced by your API configuration, connect this before enabling checkout. The CLI does not provision provider settings or publish pages.

Standard checkout gathers guest email and shipping, estimates shipping, previews totals, creates an order with its estimate token, and redirects to PayPal; the Commerce API returns to review after approval. Cart PayPal Express uses SDK v6 and the Commerce API's PayPal session endpoints; shipping changes always preview a matching order before approval. Review calls confirm/cancel, reuses a confirmation idempotency key, and checks the fetched API order state. Completion shows thanks only for `payment_completed` and clears the cart only then. Sandbox-test *both* payment journeys, initial and changed shipping methods, pending/failed confirmation, and return URLs before production. PayPal v6 public setup documentation has inconsistent client-token examples; this starter uses its recommended public client ID for one-time PayPal payments pending sandbox verification.

Do not install a widget over an existing file with the same name without a manual integration pass. `edge-commerce check` compares installed files to the manifest; locally edited config will be reported, not overwritten.
