# npm Publishing

This package will be published as `@entur/netex-typescript-model` on the public npmjs.com registry, matching other `@entur` packages (design-system, sdk, etc.).

## Prerequisites

### Personal access

1. Create an npm account if you don't have one: `npm adduser`
2. Ask an `entur` npm org admin to add you:
   ```bash
   npm org set entur <your-npm-username> developer
   ```
3. Org admin contacts: `enturas` (post@entur.org) or any existing maintainer with an @entur.org email.

### CI access (GitHub Actions)

1. Generate an automation token from the `enturas` org account (or your own npm account).
2. Store it as a GitHub Actions secret named `NPM_TOKEN`.
3. In the publish workflow step, configure auth:
   ```bash
   echo "//registry.npmjs.org/:_authtoken=${NPM_TOKEN}" > .npmrc
   ```

## package.json setup

Scoped packages default to restricted. Add this to `package.json` to publish publicly:

```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

## Publishing manually

```bash
npm run build
npm publish
```

The first publish registers `@entur/netex-typescript-model` under the org scope. Any org member with `developer` role can do this.

## How entur/design-system does it

For reference, the design-system monorepo (source of `@entur/utils`, `@entur/button`, etc.) publishes manually via Lerna:

- `yarn publish-packages` runs `lerna publish --conventional-commits`
- Lerna reads conventional commit messages to determine version bumps
- Updates `package.json`, generates `CHANGELOG.md`, creates git tags
- Publishes to npmjs.com (not a private registry)
- There is no CI-driven npm publish — it's a local-machine operation

This project is simpler (single package, not a monorepo), so `npm publish` is sufficient.

## Versioning

Tie versions to the NeTEx XSD version:

- `2.0.0-next.1` while tracking the upstream `next` branch
- `2.0.x` when NeTEx cuts a stable release

## Current org structure

The `entur` npm org has ~10 maintainers with shared access across all 41 `@entur` packages. Access is managed at the org level, not per-package.

## Distributing via GitHub Releases (.tgz)

Independent of npmjs.com publishing, every tagged release attaches per-assembly tarballs as GitHub Release assets. Each tarball is a self-contained npm package — no separate publish step is required.

```bash
# Install the base assembly directly from a release:
npm install https://github.com/entur/netex-typescript-model/releases/download/v2.0.0/netex-2.0-v2.0-base-v2.0.0.tgz

# Generate types from the bundled CLI:
npx netex-ts-gen --collapse-refs --collapse-collections --dest-dir ./gen Vehicle
```

The tarball ships:

- `<assembly>.schema.json` — the JSON Schema artifact
- `ts-gen.mjs` — the bundled CLI (esbuild bundle of `html-ts-gen/scripts/ts-gen.ts` + `fast-xml-parser`)
- `netex-schema.html` — offline schema viewer
- `package.json` — per-assembly name, with `typescript` as a runtime dependency
- `README.md` — usage instructions

Use this distribution channel for one-off integration projects or when private registry access isn't available.
