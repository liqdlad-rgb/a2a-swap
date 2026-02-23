# Release Guide

Step-by-step instructions for publishing A2A-Swap packages and creating a GitHub release.

---

## Pre-flight checklist

Run these checks before starting any publish step.

```bash
# 1. Confirm clean build
cargo build --release -p a2a-swap-cli   # CLI binary
cargo build -p a2a-swap-sdk             # Rust SDK
cd sdk-ts && npm run build && cd ..     # TypeScript SDK

# 2. Confirm all tests pass
anchor test --skip-local-validator --skip-deploy

# 3. Confirm TypeScript types are clean
cd sdk-ts && npm run typecheck && cd ..

# 4. Check versions are consistent
grep '^version' cli/Cargo.toml sdk/Cargo.toml
cat sdk-ts/package.json | grep '"version"'
# All three should show the same version (e.g. "0.1.0")

# 5. Make sure git is clean
git status
# Should show nothing uncommitted (or only untracked files you intend to keep out)
```

---

## Step 1 — Publish the Rust SDK to crates.io

The SDK (`sdk/`) is published as `a2a-swap-sdk`. It has no path dependencies so
it can be published independently.

```bash
# Log in to crates.io (one-time — needs a crates.io account and API token)
cargo login
# Paste your API token from https://crates.io/me when prompted

# Dry run first — checks metadata, resolves dependencies, no upload
cargo publish -p a2a-swap-sdk --dry-run

# Publish (takes ~30 seconds to process on crates.io)
cargo publish -p a2a-swap-sdk

# Verify it appeared
open https://crates.io/crates/a2a-swap-sdk
```

**After publishing**, update the README.md `[dependencies]` example if you pinned a
specific version. The latest semver-compatible version will be resolved automatically.

> **Note:** Once published, a crate version cannot be deleted — only yanked. Make sure
> the dry run passes before publishing.

---

## Step 2 — Publish the TypeScript SDK to npm

The TypeScript SDK (`sdk-ts/`) is published as `@a2a-swap/sdk` (scoped, public).

```bash
cd sdk-ts

# Log in to npm (one-time — needs an npmjs.com account)
npm login
# Verify you are logged in
npm whoami

# Build the distributable (TypeScript → JavaScript + .d.ts)
npm run build

# Preview what will be included in the package
npm pack --dry-run
# Should list only: dist/** and README.md

# Publish (--access public is required for scoped packages on free accounts)
npm publish --access public

# Verify it appeared
open https://www.npmjs.com/package/@a2a-swap/sdk

cd ..
```

**If the package already exists** and you are bumping a version, update
`sdk-ts/package.json` → `"version"` first, then re-run `npm run build && npm publish`.

---

## Step 3 — Create a GitHub release with CLI binaries

### 3a. Tag the release

```bash
# Make sure you are on the main branch with a clean working tree
git checkout main
git pull

# Create an annotated tag (replace 0.1.0 with your version)
git tag -a v0.1.0 -m "Release v0.1.0"

# Push the tag — this triggers the GitHub Actions release workflow
git push origin v0.1.0
```

The `release.yml` workflow will automatically:
1. Build the CLI for **5 targets**: Linux x86_64, Linux aarch64, macOS x86_64, macOS aarch64, Windows x86_64
2. Package each binary with `README.md` and `LICENSE` into a `.tar.gz` / `.zip`
3. Attach all archives to the GitHub release

> The build takes ~10–15 minutes. Monitor progress at:
> `https://github.com/a2a-swap/a2a-swap/actions`

### 3b. (Optional) Build and upload manually

If you prefer to build locally instead of using CI:

```bash
# Linux x86_64 (from any Linux host)
cargo build --release -p a2a-swap-cli --target x86_64-unknown-linux-gnu
tar czf a2a-swap-v0.1.0-x86_64-linux.tar.gz \
  -C target/x86_64-unknown-linux-gnu/release a2a-swap

# macOS aarch64 (from an Apple Silicon Mac)
cargo build --release -p a2a-swap-cli --target aarch64-apple-darwin
tar czf a2a-swap-v0.1.0-aarch64-macos.tar.gz \
  -C target/aarch64-apple-darwin/release a2a-swap

# Create the release with gh CLI
gh release create v0.1.0 \
  --title "A2A-Swap v0.1.0" \
  --notes-file RELEASE_NOTES.md \
  a2a-swap-v0.1.0-*.tar.gz
```

### 3c. Edit the release notes

After CI finishes, visit the release page on GitHub and add human-friendly notes:

```
https://github.com/a2a-swap/a2a-swap/releases/tag/v0.1.0
```

Suggested template:

```markdown
## A2A-Swap v0.1.0

Lightweight constant-product AMM for autonomous AI agents on Solana.

### What's included
- On-chain program (`8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`)
- CLI binary (`a2a-swap`) — Linux, macOS, Windows
- TypeScript SDK (`@a2a-swap/sdk`)
- Rust SDK (`a2a-swap-sdk`)
- ElizaOS plugin

### Install the CLI
\`\`\`bash
# Linux / macOS
curl -Lo a2a-swap.tar.gz <ASSET_URL>
tar xzf a2a-swap.tar.gz
sudo mv a2a-swap /usr/local/bin/

# Or via cargo
cargo install a2a-swap-cli
\`\`\`

### Full documentation
See [README.md](https://github.com/a2a-swap/a2a-swap#readme).
```

---

## Step 4 — Post-release verification

```bash
# Verify the CLI installs from crates.io
cargo install a2a-swap-cli
a2a-swap --version

# Verify the npm package installs
npm install @a2a-swap/sdk
node -e "const sdk = require('@a2a-swap/sdk'); console.log(Object.keys(sdk))"

# Verify the Rust SDK is importable
# (add a2a-swap-sdk = "0.1" to a test Cargo.toml and cargo build)
```

---

## Version bump checklist (for future releases)

When cutting a new version (e.g. v0.2.0):

1. Update `cli/Cargo.toml` → `version = "0.2.0"`
2. Update `sdk/Cargo.toml` → `version = "0.2.0"`
3. Update `sdk-ts/package.json` → `"version": "0.2.0"`
4. Update the `Roadmap` section of `README.md`
5. Commit: `git commit -m "chore: bump to v0.2.0"`
6. Tag and push: `git tag -a v0.2.0 -m "Release v0.2.0" && git push origin v0.2.0`
7. Publish SDK packages (Steps 1–2 above)

---

## Mainnet deployment

When you have a funded Solana keypair on mainnet-beta (5+ SOL needed for the 388 KB binary):

```bash
# Check balance
solana balance --url mainnet-beta

# Deploy
anchor deploy --provider.cluster mainnet

# Verify program is live
solana program show 8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq --url mainnet-beta

# View on Solscan
open https://solscan.io/account/8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq
```

**Deployer wallet:** `36mRf9zkPpzFWeAaFtYgEutpTXWeK26k4fGNPh94G6AU`
**Program keypair:** `target/deploy/a2a_swap-keypair.json` (keep secret — controls upgrades)

To fund the deployer on mainnet-beta, transfer 5+ SOL to:
`36mRf9zkPpzFWeAaFtYgEutpTXWeK26k4fGNPh94G6AU`
