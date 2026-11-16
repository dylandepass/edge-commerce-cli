# Product page

The optional PDP renders Product Pipeline pages from what is already on the page. The pipeline writes `<meta name="sku">`, a Product JSON-LD script with one offer per variant, and a summary section with the product heading, a formatted price and the product pictures, followed by the description and one section per variant. The block never fetches `${pathname}.json`.

## Connect it to the page loader

For a supported page loader, `init` and `upgrade` insert the import and two hooks below into the existing `scripts/scripts.js`. Review the diff with `--dry-run` before applying with `--yes` (or approving the interactive plan). A JavaScript parser locates one top-level `buildAutoBlocks(main)` and one async `loadEager(doc)` with simple single parameters. The CLI inserts text without reformatting the rest of the file or running customer code.

Missing, unparseable, ambiguous or unsupported loaders, and files with existing PDP imports, detection or hooks, are left unchanged. The plan gives a manual-integration next step, and the template files can still be installed. Inspect existing product behavior before adding these calls manually:

```js
import { buildPDPBlock, loadPDPPreview } from './commerce/pdp-page.js';

function buildAutoBlocks(main) {
  buildPDPBlock(main);
  // existing auto-blocks
}

async function loadEager(doc) {
  await loadPDPPreview();
  // existing decorateTemplateAndTheme, decorateMain, ...
}
```

`buildPDPBlock(main)` wraps the pipeline summary in a `pdp` block when `<meta name="sku">` is present and removes the variant sections, whose data is in the JSON-LD offers. The description and any authored content stay as normal sections after the block. The block reuses the pipeline pictures and keeps the first one eager as the LCP image.

### Upgrade, check and removal

The inserted import and calls are enclosed by `edge-commerce:pdp` start/end comments. The manifest tracks those regions, not the entire `scripts.js`, so unrelated storefront edits do not prevent upgrades or appear as drift. Repeat installs do not duplicate the hooks. Keep the managed regions intact.

`remove --feature pdp` previews a diff and removes only the unchanged managed regions, preserving surrounding customer code. If a region is edited or a hook is moved after other work in its function, `check` reports it and upgrade/removal stop for manual review before changing dependent files. Restore the regions, or remove all managed hooks and their import manually before retrying removal. Existing manually integrated code is never adopted or removed by the CLI.

## Modes

`scripts/commerce/pdp-config.js` is generated from the setup's `pdp` settings.

- `cart` (default): shows the variant selector, the price of the selected offer and Add to Cart. Only a source-backed, in-stock offer priced in `site.currency` can be added; the cart item is mapped with the copied `scripts/commerce/jsonld-adapter.js`. No offer, inventory or price is manufactured when data is missing.
- `catalog`: shows the product pictures and heading only, with no price, variant selector or cart. Choose it in the wizard (PDP only, **Catalog only**) or with `"pdp": { "mode": "catalog" }`. The cart core is not installed and `site.currency` is optional. Catalog mode cannot be combined with cart-checkout.

## Branch previews

Branch previews (`*.aem.page`, `*.aem.live`) serve authored content, not Product Pipeline pages. With `pdp.previewProxyKey` set, `loadPDPPreview()` loads the product page from `https://main--{repo}--{owner}.aem.network` through the `fcors.org` CORS proxy on paths containing `pdp.previewProductPath` (default `/products/`). It rewrites the pipeline's relative `./media_` images to that origin and keeps the preview's authored content after the product content. Without a key it does nothing.

The proxy key is public: it is written to `pdp-config.js` and visible in browser code. Use a key restricted to the site's preview origins.

## Local development

Product pages exist only on the pipeline origin, so run the local server against it:

```sh
AEM_PAGES_URL=https://main--{repo}--{owner}.aem.network npx -y @adobe/aem-cli up
```

Authored pages (for example category pages) are served from `https://main--{repo}--{owner}.aem.page`; folder pages are `{folder}/index.plain.html`. Run a second server with `--url` when you need both.

Copying this block does not decide your page routes, merchandising, SEO metadata or product publishing workflow. Validate it against a real product page before launch.
