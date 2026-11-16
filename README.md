# Edge Commerce CLI

Add cart, checkout and product detail pages to an existing [Adobe AEM Edge Delivery Services](https://www.aem.live/) storefront. The CLI copies source files into your project so you can customize them without a storefront runtime dependency on this package.

**Preview software:** this starter is not production-validated. Before going live, verify your merchant's Commerce API configuration, address and country support, and both PayPal checkout flows in the sandbox.

## Requirements

- Node.js 20.12 or later, with npm.
- An existing Edge Delivery Services storefront.
- For checkout, a configured Commerce API site and a public PayPal client ID. See [checkout setup](docs/commerce/checkout-setup.md) for server prerequisites.

## Quick start

From your storefront directory, preview an installation and then run the wizard to apply it:

```sh
cd /path/to/eds-storefront
npx --yes edge-commerce-cli@preview init --dry-run
npx --yes edge-commerce-cli@preview init
```

The wizard lets you choose cart and checkout, PDP only, or both, and shows the file plan before asking for confirmation. PDP-only installs offer **Sell online** or **Catalog only**, which omits prices and cart controls.

Use `@preview` or pin a published version. The npm `latest` tag still points to the bootstrap package, so an unversioned install does not select the current preview. See [releases](https://github.com/dylandepass/edge-commerce-cli/releases) for published versions.

## Configure an installation

For repeatable or non-interactive setup, copy an example, replace its placeholders, and save it as `commerce-setup.json`:

| Example | Installs |
| --- | --- |
| [Cart and checkout](examples/commerce-setup.json) | Cart and checkout widgets for an existing product page |
| [PDP with cart](examples/pdp-setup.json) | Product Pipeline PDP with prices and Add to cart, without checkout |
| [Catalog-only PDP](examples/pdp-catalog-setup.json) | Product Pipeline PDP without prices or cart |

To install both features, set `features` to `["cart-checkout", "pdp"]` and include the checkout settings. Setup files contain public configuration only. Never put PayPal server secrets in them. The optional PDP preview proxy key is also public in browser code.

```sh
npx --yes edge-commerce-cli@preview init --config ./commerce-setup.json --no-input --dry-run --json
npx --yes edge-commerce-cli@preview init --config ./commerce-setup.json --no-input --yes --json
```

`--dry-run` writes nothing. Applying without an interactive terminal requires `--yes`; `--json` returns one machine-readable result and disables prompts. Use `--target /path/to/eds-storefront` to operate on a different directory.

## Complete the storefront setup

Installing source files does not publish content pages or configure backend services. Review the integration checklist after installation:

```sh
npx --yes edge-commerce-cli@preview guide --mode manual
```

- **Cart and checkout:** connect existing product pages and the header cart UI, ensure the site supports widget links, and author the checkout pages. Follow [checkout setup](docs/commerce/checkout-setup.md).
- **PDP:** supported page loaders receive the required hooks in `scripts/scripts.js`. Custom or already integrated loaders need manual review. Follow the [product page guide](docs/commerce/pdp.md) for modes, preview configuration and local development.

If you use a coding agent, `guide --mode ai` prints an optional prompt to copy into it. The CLI does not run an AI model or require model credentials.

## Manage an installation

Use `npx --yes edge-commerce-cli@preview <command>` from your storefront directory:

| Command | Purpose |
| --- | --- |
| `init` | Preview or install selected features |
| `guide --mode manual` | Show the storefront integration checklist |
| `check` | Report missing or edited installed files and managed PDP hooks |
| `upgrade --config ./commerce-setup.json --dry-run` | Preview updates using your setup file |
| `remove --feature pdp --dry-run` | Preview removal of a feature; use `cart-checkout` to remove checkout instead |

After reviewing an upgrade or removal plan, rerun it without `--dry-run` and confirm, or pass `--yes`. Run `npx --yes edge-commerce-cli@preview --help` for all commands and flags.

Conflicts block the entire installation. Upgrades preserve customer-edited files for manual merging, and removal keeps edited files. PDP hooks are managed separately from the rest of `scripts.js`: unrelated edits are preserved, while changed or moved managed hooks block upgrade and removal until reviewed.

## Documentation

- [Storefront integration](docs/commerce/setup.md): configuration defaults, product-to-cart mapping and currency handling.
- [Checkout setup](docs/commerce/checkout-setup.md): widget pages, API routing, PayPal and launch requirements.
- [Product pages](docs/commerce/pdp.md): JSON-LD rendering, catalog mode and branch previews.
- [Architecture](docs/commerce/architecture.md): cart state and payment flows.

## Contributing

See [AGENTS.md](AGENTS.md) for development commands and repository guidelines, and [the release guide](docs/releasing.md) for publishing. Report bugs and request features in [GitHub Issues](https://github.com/dylandepass/edge-commerce-cli/issues).

## License

[Apache License 2.0](LICENSE).
