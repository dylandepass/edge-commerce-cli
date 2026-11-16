# PDP block

- Data comes from the Product Pipeline page: Product JSON-LD (`offers` per variant) and the rendered heading and pictures. Do not fetch `{path}.json`; read the page with `scripts/commerce/pdp-page.js`.
- `buildPDPBlock(main)` (first in `buildAutoBlocks`) wraps the product summary in this block when `<meta name="sku">` is present; `await loadPDPPreview()` (first in `loadEager`) loads pipeline pages on branch previews. The CLI inserts these hooks in supported `scripts/scripts.js` loaders. Verify the install plan: custom or already integrated loaders need manual review. Do not duplicate existing hooks or edit the CLI-managed `edge-commerce:pdp` regions.
- Reuse the pipeline pictures and keep the first one eager; it is the LCP image. Do not re-create it from JSON-LD URLs.
- Product name, SKU, price, availability and media must come from the page. Do not invent merchandising or inventory claims; require a selected, in-stock offer in `site.currency` before Add to Cart.
- `scripts/commerce/pdp-config.js` sets `mode`: `catalog` renders no price, variant selector or cart and must not import cart modules. PDP-only must not import checkout or PayPal.
- As the block grows, keep `pdp.js` to page setup and composition, move named sections into renderer modules and shared DOM helpers into their own module, and keep data helpers pure (no DOM). Unit-test the pure helpers offline with `node --test` and representative JSON-LD; validate rendering against a real product page.
- Local development: product pages need `AEM_PAGES_URL` (or `aem up --url`) set to `https://main--{repo}--{owner}.aem.network`; authored pages need the `.aem.page` origin. Folder pages are served as `{folder}/index.plain.html`.

See the [PDP agent guide](https://github.com/dylandepass/edge-commerce-agent-guides/blob/main/templates/pdp/CLAUDE.md) for authoring/accessibility guidance (not runtime code).
