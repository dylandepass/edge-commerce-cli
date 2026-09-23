# Edge Commerce CLI maintainers

- Use `edge-commerce init --config <file> --no-input --dry-run --json` to plan before writing. `--yes` applies only conflict-free changes.
- Never prompt on non-TTY stdin, overwrite storefront files, copy merchant secrets, replace a customer root `AGENTS.md`, or publish DA content.
- Keep `template/` browser-ready with relative ES module imports; copied files must not require npm packages at storefront runtime.
- Keep one statement per line and separate setup, validation, rendering, and event handlers with blank lines. Extract helpers when a block decorator or flow becomes difficult to scan. Run `npm run format` after editing and `npm run lint` to enforce formatting and syntax checks.
- Run `npm test` and `npm run verify:package` before releasing. The tag-triggered workflow publishes only to npm's `preview` dist-tag; see `docs/releasing.md`. Never create a release tag or publish without an explicit request. Both payment flows must enter review before completion. Unit tests do not establish live PayPal compatibility; sandbox validation is required before production claims.
