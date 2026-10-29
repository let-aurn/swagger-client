# Contributing

[Back to README](README.md)

Requires Node.js 20 or newer for local development.

## Local development

```sh
npm ci
npm test
node dist/cli/index.js generate
npm pack --dry-run
```

`npm test` builds the generator and runs the tests, including compilation and
runtime checks of generated clients. The default configuration reads
`test/fixtures` and writes examples to `generated/`. `npm pack` builds `dist/`
through the `prepack` script.

Dependencies, build output, generated examples, and temporary test files are
ignored by Git and can be recreated from the tracked source, lockfile, and
fixtures.


## Publishing from GitHub

The `Publish to npm` workflow (`.github/workflows/publish.yml`) runs when a GitHub
Release is **published**. It tests and builds the tagged source, then publishes
`@let-aurn/swagger-client` to the public npm registry with provenance. It uses
npm trusted publishing (GitHub OIDC), so no `NPM_TOKEN` secret is required.

### One-time npm setup

An npm package owner must open the package's settings at
<https://www.npmjs.com/package/@let-aurn/swagger-client/access>, find **Trusted
Publisher**, select **GitHub Actions**, and enter:

| Setting | Value |
| --- | --- |
| Organization or user | `let-aurn` |
| Repository | `swagger-client` |
| Workflow filename | `publish.yml` |
| Environment name | Leave empty (this workflow does not use an environment) |

Save that trusted publisher before the first automated publication. The workflow
uses a GitHub-hosted runner, Node.js 24, npm 11 (which supports trusted
publishing), and `id-token: write` permission. Repository metadata in
`package.json` identifies the source repository for provenance. If the package
does not exist yet, an npm owner must publish it once before configuring its
trusted publisher.

### Publish a version

1. Update both version files in a PR, for example:
   `npm version 0.8.0 --no-git-tag-version`. For a prerelease use a version such
   as `0.8.0-beta.1`. Commit `package.json` and `package-lock.json` and merge the PR.
2. In GitHub, open **Releases → Draft a new release**. Create a tag matching the
   merged package version exactly, such as `v0.8.0`, targeting the intended commit
   on `main`.
3. Publish the release. For a version containing a prerelease suffix, check
   **Set as a pre-release** as well. Stable versions publish under npm's `latest`
   tag; prerelease versions or GitHub prereleases publish under `next`.
4. Follow the **Publish to npm** run in the repository's **Actions** tab.

Drafting a release, pushing a tag alone, or merging a PR does not publish to npm.
The workflow rejects release tags that do not match `package.json`, installs from
the lockfile, and runs the build/test suite before publishing. npm versions are
immutable: use a new version for another publication. A failed run can be rerun
after fixing npm trusted-publisher setup, provided that version was not already
published. Concurrent publish runs are serialized without cancelling an active
publication.
