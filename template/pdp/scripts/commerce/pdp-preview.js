/*
 * Branch previews (*.aem.page, *.aem.live) do not serve Product Pipeline pages,
 * so product paths load the page from the main *.aem.network origin through a
 * CORS proxy. The proxy key is public: it is visible in browser code.
 */

const CORS_PROXY_ORIGIN = 'https://fcors.org/';

/**
 * The pipeline origin for a preview host: `{ref}--{repo}--{owner}.aem.page`
 * becomes `https://main--{repo}--{owner}.aem.network`.
 * @param {string} hostname preview hostname
 * @returns {string|null}
 */
export function pipelineOrigin(hostname) {
  const match = /^[a-z0-9-]+?--([a-z0-9-]+)--([a-z0-9-]+)\.aem\.(?:page|live)$/i.exec(hostname);
  return match ? `https://main--${match[1]}--${match[2]}.aem.network` : null;
}

/**
 * Builds a CORS proxy URL for a pipeline request.
 * @param {string|URL} url pipeline URL
 * @param {string} key public proxy key
 * @returns {string}
 */
export function corsProxyUrl(url, key) {
  const proxyUrl = new URL(CORS_PROXY_ORIGIN);
  proxyUrl.searchParams.set('url', String(url));
  proxyUrl.searchParams.set('key', key);
  return proxyUrl.href;
}

/**
 * Points the pipeline's relative `./media_` images at the pipeline origin.
 * @param {Element} root element to rewrite
 * @param {string} baseUrl folder URL of the pipeline page
 */
export function rewritePipelineMedia(root, baseUrl) {
  root.querySelectorAll('img, source').forEach((element) => {
    ['src', 'srcset'].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value?.includes('./media_')) {
        element.setAttribute(attribute, value.replaceAll('./media_', `${baseUrl}media_`));
      }
    });
  });
}

/**
 * Replaces the preview document with the pipeline-rendered product page.
 * Authored preview content is kept after the product content.
 * @param {{ proxyKey: string }} preview preview settings from pdp-config.js
 * @returns {Promise<boolean>} true when the page was replaced
 */
export async function simulatePDPPreview({ proxyKey }) {
  const origin = pipelineOrigin(window.location.hostname);
  if (!origin) {
    return false;
  }

  try {
    const sourceUrl = new URL(window.location.pathname, origin);
    const response = await fetch(corsProxyUrl(sourceUrl, proxyKey));
    if (!response.ok) {
      throw new Error(`Product page request failed: ${response.status}`);
    }

    const source = new DOMParser().parseFromString(await response.text(), 'text/html');
    const sourceMain = source.querySelector('main');
    if (!sourceMain || !source.querySelector('meta[name="sku"]')) {
      throw new Error('The pipeline page is not a product page');
    }

    rewritePipelineMedia(sourceMain, new URL('./', sourceUrl).href);
    sourceMain.append(...document.querySelector('main').children);
    document.head.innerHTML = source.head.innerHTML;
    document.body.innerHTML = source.body.innerHTML;
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('PDP preview simulation failed', error);
    return false;
  }
}
