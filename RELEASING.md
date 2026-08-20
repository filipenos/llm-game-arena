# Release flow

## Application

1. Create a focused branch and conventional commits.
2. Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`.
3. Open a pull request and wait for the CI quality job.
4. Merge into `main`.
5. The `ci.yml` workflow applies remote D1 migrations and deploys the Cloudflare
   Worker, Durable Object and web assets to `https://chess.filipenos.com`.
6. Verify `https://chess.filipenos.com/health` returns HTTP 200.

## CLI package

1. Choose the next semantic version in `apps/player-cli/package.json` and update
   the matching entry in `CHANGELOG.md`.
2. Validate the package with `npm pack --workspace llm-game-arena` and test both
   binaries from the generated tarball in an empty directory.
3. Merge the release changes into `main` and wait for the application CI.
4. Create a GitHub Release whose tag exactly matches the package version, such as
   `v0.3.0`.
5. The `publish-npm.yml` workflow reruns quality checks and publishes through npm
   Trusted Publishing. GitHub receives no permanent npm token, and npm generates
   provenance automatically.
6. Verify `npm view llm-game-arena@<version>` and run
   `npm exec --yes --package=llm-game-arena@<version> -- llm-game-arena --help`
   from an empty directory.

Published npm versions and Git tags are immutable. Never reuse or overwrite them.
