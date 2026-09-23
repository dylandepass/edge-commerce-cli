# Edge Commerce CLI

Copies customer-owned EDS cart/checkout and optional PDP source into an existing storefront. Node 20+ runs the installer; copied browser modules use no npm runtime dependency. This is an initial sandbox-oriented starter. PayPal v6 compatibility, country/address coverage, and server setup need merchant validation before production use.

## Local use

```sh
npm install
node bin/edge-commerce.mjs init --target /path/to/eds-storefront --config examples/commerce-setup.json --no-input --dry-run --json
node bin/edge-commerce.mjs init --target /path/to/eds-storefront --config examples/commerce-setup.json --no-input --yes --json
node bin/edge-commerce.mjs check --target /path/to/eds-storefront --json
node bin/edge-commerce.mjs init --feature pdp --target /path/to/eds-storefront --config examples/pdp-setup.json --no-input --dry-run --json
node bin/edge-commerce.mjs upgrade --target /path/to/eds-storefront --config examples/commerce-setup.json --no-input --dry-run --json
node bin/edge-commerce.mjs remove --feature cart-checkout --target /path/to/eds-storefront --no-input --dry-run --json
```

Omit `--config` on a TTY for the wizard. `init` defaults to cart/checkout; `--feature pdp` installs the PDP plus cart core without checkout. Repeat `--feature` for both (and list both in your config). `upgrade` shows per-file diffs and requires `--yes` to apply only when installed files still match their recorded hashes. `remove` removes unchanged files for the chosen profile; edited files stay with the customer. Conflicts block the entire install, including generated configuration. No `postinstall` mutates the storefront. See copied `docs/commerce/setup.md` for authored page and integration steps. The CLI never accepts PayPal server secrets.

`npm run format` formats JS and CSS; `npm run lint` checks syntax and Prettier formatting. `npm test` runs unit and fixture tests; `npm run verify:package` checks and installs the npm tarball in a disposable directory. No live checkout or browser acceptance tests are included yet.

## Distribution

After the npm bootstrap and a successful tag-driven release, customers can run a pinned preview version without a storefront runtime dependency:

```sh
cd /path/to/eds-storefront
npx --yes edge-commerce-cli@0.1.0 init --dry-run
npx --yes edge-commerce-cli@0.1.0 init
```

The current package is **not published**; the commands above are examples for a future preview release, not an instruction to use it for production checkout. A push to `main` runs CI but does not publish. See [the release procedure](docs/releasing.md) for one-time npm setup, preview tag releases, and sandbox requirements.
