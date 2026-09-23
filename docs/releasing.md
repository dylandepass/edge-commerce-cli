# Releasing Edge Commerce CLI

`main` is the release branch. `.github/workflows/ci.yml` validates pushes and pull requests. After a push to `main`, `.github/workflows/release.yml` validates the same source, runs a semantic-release dry run, and then publishes **only if qualifying commits exist** since the last version tag. Semantic-release calculates the version, creates the `v<version>` tag, and publishes to npm's `preview` dist-tag. The workflow then verifies the npm version is visible and creates a GitHub **prerelease**. Tag pushes alone do not trigger a release workflow.

This starter has unit and fixture tests but has **not** passed merchant PayPal sandbox validation. Never promote an unvalidated version to npm's `latest` or describe it as production-ready solely because CI passed. Use a pinned version such as `npx --yes edge-commerce-cli@0.1.0 --version`, or explicitly request `@preview`.

## One-time setup (already completed)

The initial `0.0.0-bootstrap.0` package was published manually, enabling npm trusted publishing. npm also assigned the bootstrap version the **`latest`** dist-tag on that first publication, despite `--tag bootstrap`. The first GitHub prerelease and npm preview, `v0.1.0`, were published from the tagged commit. Do not repeat the bootstrap or reuse the `v0.1.0` tag: published npm versions are immutable. Unversioned `npm install edge-commerce-cli` and `npx edge-commerce-cli` currently resolve to the bootstrap version.

The npm trusted publisher is configured for GitHub owner `dylandepass`, repository `edge-commerce-cli`, workflow filename `release.yml`, environment `npm-release`, with `npm publish` allowed. The workflow retains that filename and environment. GitHub's built-in token creates Git tags and prereleases, and npm uses short-lived OpenID Connect (OIDC) credentials; no `NPM_TOKEN` GitHub secret is needed. Protect `main` so only reviewed changes can initiate a release. Optional required reviewers on the `npm-release` environment can add an approval gate.

## Subsequent preview releases

1. Write or merge commits with [Conventional Commit](https://www.conventionalcommits.org/) messages. For squash merges, use a conventional PR title. For example, `fix: handle an empty cart` releases a patch; `feat: add a cart option` releases a minor; a `BREAKING CHANGE:` footer releases a major. Docs-only and `chore:` commits normally do not release. A breaking change can increment the major version even before production readiness, but publishing still stays on `preview`.
2. Review the diff and let CI pass. Merging to `main` triggers the release workflow, which runs lint, tests, a packaged-CLI smoke test, and a semantic-release **dry run** before any real publication. If the `npm-release` environment requires reviewers, the publication job waits for approval.
3. Confirm the resulting npm version is tagged `preview` and the GitHub release is marked **prerelease**. Test the exact published version with `npx --yes edge-commerce-cli@<version> --version` and a dry-run against a disposable EDS storefront. A passing workflow is not a substitute for PayPal sandbox validation.

**Do not manually bump the checked-in `package.json` or `package-lock.json` for each release, create a release tag, or use `npm publish` locally.** Semantic-release reads the existing `v0.1.0` tag, computes the new version, and updates the package metadata in the workflow checkout for publication. The repository's checked-in version is a baseline and may lag published versions. For local release tooling, use Node 22.14+ or 24.10+; the workflow pins Node 24.21.0. Customers running the installed CLI can still use Node 20.12+.

If the npm publish succeeds but GitHub release creation fails, rerun the failed release job. It checks for the tagged version on npm before creating the prerelease. If publishing fails **after a Git tag is created**, stop and diagnose the partial release; do not reuse or move a published version or tag blindly.

## Production promotion

The workflow never assigns npm's `latest`, and GitHub prereleases are explicitly not marked Latest. The bootstrap version still owns npm's `latest` tag. Changing this requires a separate deliberate decision after merchant sandbox validation, including an update to npm's dist-tag and customer-facing installation guidance. It is **not** part of an automatic merge release.

## Sources

- [semantic-release configuration](https://semantic-release.org/usage/configuration/): existing tags, commit analysis, branches, and channels.
- [semantic-release GitHub Actions recipe](https://semantic-release.org/recipes/ci-configurations/github-actions/): OIDC authentication and full tag history.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): trusted-publisher filename and environment matching.
- [npm dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/): `preview` versus `latest` distribution.
