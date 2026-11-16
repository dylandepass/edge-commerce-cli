# Edge Commerce CLI maintainers

## Working safely

- Use `edge-commerce init --config <file> --no-input --dry-run --json` to plan before writing. `--yes` applies only conflict-free changes.
- Never prompt on non-TTY stdin, overwrite storefront files (except the reviewed, marker-managed PDP hook insertion in `scripts/scripts.js`), copy merchant secrets, replace a customer root `AGENTS.md`, or publish DA content.
- Keep integration guidance read-only. It must not run an AI model, read `.env` files, import or execute customer JavaScript, edit customer files, or collect model or merchant tokens. AI guidance is a copyable prompt for the user's own agent.

## Code and templates

- Keep `template/` browser-ready with relative ES module imports; copied files must not require npm packages at storefront runtime.
- Keep one statement per line and separate setup, validation, rendering, and event handlers with blank lines. Extract helpers when a block decorator or flow becomes difficult to scan.
- Keep `README.md` focused on users: purpose, requirements, installation, common commands and documentation links. Put agent and maintainer instructions here, and detailed storefront behavior in `docs/commerce/`.

## Local development and validation

Install dependencies with `npm ci`. Run the local CLI with `node bin/edge-commerce.mjs` instead of the published package, for example:

```sh
node bin/edge-commerce.mjs init --target /path/to/eds-storefront --config examples/commerce-setup.json --no-input --dry-run --json
```

Run these after implementation changes:

```sh
npm run format
npm run lint
npm test
npm run verify:package
```

- `format` formats JavaScript and CSS. `lint` checks syntax and Prettier formatting.
- `test` runs unit and fixture tests. Live checkout and browser acceptance tests are not included.
- `verify:package` builds and installs the npm tarball in a disposable directory to check the distributed CLI; it does not publish.
- Both payment flows must enter review before completion. Unit tests do not establish live PayPal compatibility; sandbox validation is required before production claims.

## Releases

- Merging qualifying Conventional Commits to `main` automatically releases on npm's `preview` dist-tag. Docs-only and `chore:` commits normally do not release.
- Do not manually bump package versions, create a release tag, publish or promote a version without an explicit request. See [the release guide](docs/releasing.md) for the release process, tooling requirements and sandbox validation.
