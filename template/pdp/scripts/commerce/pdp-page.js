import config from './pdp-config.js';

/*
 * Product Pipeline pages render the product heading, price and pictures, the
 * description, one section per variant, `<meta name="sku">` and Product JSON-LD.
 * The PDP reads that page; it never fetches product JSON.
 *
 * Call both hooks from scripts/scripts.js:
 *   await loadPDPPreview();   // first line of loadEager, before decorateMain
 *   buildPDPBlock(main);      // first line of buildAutoBlocks
 */

/**
 * Finds the schema.org Product in JSON-LD (an object, an array or `@graph`).
 * @param {*} value parsed JSON-LD
 * @returns {object|null}
 */
export function findProduct(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const product = findProduct(item);
      if (product) {
        return product;
      }
    }
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }

  const types = [].concat(value['@type'] || []);
  if (types.includes('Product')) {
    return value;
  }
  return value['@graph'] ? findProduct(value['@graph']) : null;
}

/**
 * Reads the Product from the page's JSON-LD scripts.
 * @param {Document} doc document to read
 * @returns {object|null}
 */
export function readProduct(doc = document) {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const product = findProduct(JSON.parse(script.textContent));
      if (product) {
        return product;
      }
    } catch {
      // Ignore other invalid JSON-LD on the page.
    }
  }
  return null;
}

/**
 * True for pages rendered by the Product Pipeline.
 * @param {Document} doc document to read
 * @returns {boolean}
 */
export function isProductPage(doc = document) {
  return Boolean(doc.querySelector('meta[name="sku"]'));
}

/**
 * Wraps the pipeline's product summary (heading, price and pictures) in a `pdp` block.
 * Variant sections are removed because their data is in the JSON-LD offers; the
 * description and authored content stay as normal sections after the block.
 * @param {Element} main the main element
 */
export function buildPDPBlock(main) {
  const doc = main.ownerDocument;
  // Fragments also run through decorateMain, but the SKU meta is page-wide.
  if (main !== doc.querySelector('main') || !isProductPage(doc) || main.querySelector('.pdp')) {
    return;
  }

  const [summary, ...sections] = main.querySelectorAll(':scope > div');
  if (!summary) {
    return;
  }

  const block = doc.createElement('div');
  block.className = 'pdp';
  const row = doc.createElement('div');
  const cell = doc.createElement('div');
  cell.append(...summary.children);
  row.append(cell);
  block.append(row);
  summary.append(block);

  sections.filter((section) => section.dataset.sku).forEach((section) => section.remove());
}

/**
 * On branch previews, loads the pipeline-rendered page for product paths.
 * Does nothing unless `preview` is configured in pdp-config.js.
 * @returns {Promise<boolean>} true when the page was replaced
 */
export async function loadPDPPreview() {
  const { hostname, pathname } = window.location;
  const { preview } = config;
  if (
    !preview?.proxyKey ||
    !/\.aem\.(page|live)$/.test(hostname) ||
    !pathname.includes(preview.productPath) ||
    isProductPage()
  ) {
    return false;
  }

  const { simulatePDPPreview } = await import('./pdp-preview.js');
  return simulatePDPPreview(preview);
}
