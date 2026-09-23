# Releasing Edge Commerce CLI

The repository has two workflows:

- `.github/workflows/ci.yml` tests pushes to `main` and pull requests.
- `.github/workflows/release.yml` validates a pushed `v<package-version>` tag, publishes to **npm's `preview` dist-tag**, then creates a GitHub **prerelease**. A branch push alone never publishes anything. The release job uses npm trusted publishing (OIDC), not an `NPM_TOKEN` repository secret. A failed publish does not create a GitHub release.

This starter has unit and fixture tests but has **not** passed merchant PayPal sandbox validation. Do not promote a version to npm's `latest` or describe it as production-ready solely because CI passed. The workflow intentionally publishes preview versions only, including tags without a prerelease suffix. Customers can run a specific tested version with `npx --yes edge-commerce-cli@0.1.0 init --dry-run` after it is published.

## One-time npm bootstrap

npm requires a package to exist before you can configure its trusted publisher. This step is **manual**, performed by an npm account authorized to own `edge-commerce-cli`; do not run it from the main checkout and do not push the bootstrap version or create a tag for it.

1. Commit and push the source, verify the GitHub repository is public, and verify ownership/availability of the npm name. A registry 404 is a hint, not a reservation.
2. In a **disposable clone** of the source, run `npm ci`, `npm run lint`, and `npm test`. Sign in with `npm login` on your own machine.
3. In that disposable clone, run `npm pkg set version=0.0.0-bootstrap.0`, then `npm run verify:package` and `npm publish --access public --tag bootstrap`. This publishes working starter code under a bootstrap-only version without changing the main checkout's `0.1.0` version or assigning the `latest` dist-tag. If the name is already owned, choose another package name and update the repository metadata, workflows, examples, and npm settings before proceeding.
4. On npmjs.com, open the `edge-commerce-cli` package's **Trusted Publisher** settings. Select GitHub Actions, owner `dylandepass`, repository `edge-commerce-cli`, workflow filename `release.yml`, environment name `npm-release`, and allow `npm publish`. Match the casing and filename exactly. The package must already exist. Do not place an npm write token in GitHub secrets.
5. On GitHub, create the `npm-release` environment. Consider requiring approval and protect `v*` tags so only maintainers can initiate a publish. The workflow's environment name must match the npm trusted publisher setting. Ensure Actions has permission to create releases (repository Actions workflow setting or repository policy).

The first **tag-driven** release can then be `v0.1.0`: the bootstrap version is separate, so CI publishes a version that does not yet exist on npm. Never reuse a version that was already published—npm package versions are immutable.

## Each preview release

1. Update `package.json` and `package-lock.json` to the same **new** version (for example `npm version patch --no-git-tag-version`), unless the prepared version already matches. Do not run `npm version`'s automatic commit/tag flow; review and commit the actual changes separately.
2. Review the diff. Run `npm ci`, `npm run lint`, `npm test`, and `npm run verify:package`. Check that the tarball contains `bin/`, `src/`, `template/`, `examples/`, `README.md`, and `LICENSE`, not `.env` files or tests. Obtain sandbox sign-off before making customer-facing claims.
3. After the version change is committed and pushed to the intended branch, create an annotated tag `v<package.json version>` **at that commit**, and push the tag. The tag push runs release validation and, if the GitHub environment requires it, waits for approval. No CLI invocation on a customer storefront happens as part of the release workflow.
4. Confirm the workflow published the exact npm version with the `preview` dist-tag and created a GitHub prerelease. Test the published package explicitly: `npx --yes edge-commerce-cli@<version> --version` and a dry-run against a disposable EDS storefront.

The tag must match `package.json` exactly. Failed validation or npm publication leaves no new GitHub release. If only the **GitHub release** job fails after npm succeeds, rerun just the failed job; do not rerun the publish job, because npm will refuse to republish the same version. Keep the old version and tag immutable; fix a broken npm publication by releasing a new version.

## Production promotion

Only after the payment journeys, server return/review URLs, merchant setup, and supported geographies have been validated in a real sandbox should maintainers choose a public production release policy. This preview workflow never assigns `latest` automatically. Promoting an audited version requires a separate, deliberate change to npm's dist-tags and release documentation; that action is not part of this setup.

## Sources

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): required Node/npm versions, npm package settings, GitHub environment matching, and OIDC provenance.
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/): public source and registry requirements.
- [npm dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/): preview versus `latest` distribution.
