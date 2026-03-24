# Publishing Guide

## Step 1: Login to npm

```bash
npm login
```

## Step 2: Verify everything is ready

```bash
# Clean build
npm run clean
npm run build

# Run all checks
npm run check
npm run typecheck
npm test

# Preview what will be published
npm pack
```

## Step 3: Publish

### Semi-automated release (recommended)

These scripts run checks/tests, bump version, create tag, push commits+tags, and publish:

```bash
npm run release:patch  # 0.1.0 -> 0.1.1
npm run release:minor  # 0.1.1 -> 0.2.0
npm run release:major  # 0.2.0 -> 1.0.0
```

Optional preview first:

```bash
npm run release:dry-run
```

### Manual publish (fallback)

```bash
# Publish (for first time)
npm publish --access public

# Or publish a new version manually
npm version patch  # or minor, or major
npm publish
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
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.1 → 0.2.0
npm version major   # 0.2.0 → 1.0.0
```

## Troubleshooting

### Package name already taken?

Choose a different name in `package.json`:
```json
"name": "@yourusername/structalign"
```

Then publish with:
```bash
npm publish --access public
```

### Build errors?

Make sure you have the latest dependencies:
```bash
rm -rf node_modules package-lock.json
npm install
```

### Tests failing?

```bash
npm run build:tests
npm test
```
