# Publishing Guide

## Step 1: Login to pnpm

```bash
pnpm login
```

## Step 2: Verify everything is ready

```bash
# Clean build
pnpm run clean
pnpm run build

# Run all checks
pnpm run check
pnpm run typecheck
pnpm test

# Preview what will be published
pnpm pack
```

## Step 3: Publish

### Semi-automated release (recommended)

These scripts run checks/tests, bump version, create tag, push commits+tags, and publish:

```bash
pnpm run release:patch  # 0.1.0 -> 0.1.1
pnpm run release:minor  # 0.1.1 -> 0.2.0
pnpm run release:major  # 0.2.0 -> 1.0.0
```

Optional preview first:

```bash
pnpm run release:dry-run
```

### Manual publish (fallback)

```bash
# Publish (for first time)
pnpm publish --access public

# Or publish a new version manually
pnpm version patch  # or minor, or major
pnpm publish
```

## Step 4: Create GitHub Release (optional but recommended)

1. Go to your GitHub repository
2. Click "Releases" → "Draft a new release"
3. Choose the tag (e.g., v0.1.0)
4. Add release notes
5. Publish release

## Version Numbers

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (x.0.0) - Breaking changes
- **MINOR** (0.x.0) - New features, backwards compatible
- **PATCH** (0.0.x) - Bug fixes, backwards compatible

```bash
pnpm version patch   # 0.1.0 → 0.1.1
pnpm version minor   # 0.1.1 → 0.2.0
pnpm version major   # 0.2.0 → 1.0.0
```

## Troubleshooting

### Package name already taken?

Choose a different name in `package.json`:

```json
"name": "@yourusername/structalign"
```

Then publish with:

```bash
pnpm publish --access public
```

### Build errors?

Make sure you have the latest dependencies:

```bash
rm -rf node_modules package-lock.json
pnpm install
```

### Tests failing?

```bash
pnpm run build:tests
pnpm test
```
