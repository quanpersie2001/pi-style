# pi-style

A native-layout, cohesive visual style package for [Pi](https://pi.dev/).

> Phase 0 is complete: the package scaffold, lifecycle harness, architecture gate, build, and package smoke validation are in place. UI features remain planned according to [`ROADMAP.md`](ROADMAP.md).

## Development

```bash
npm ci
npm run check
```

The Pi extension bundle is built to `dist/extensions/pi-style.js` and is declared through the `pi` package manifest. The current extension is intentionally inert until `session_start`; it performs no terminal work in print/json modes. The repositories under `references/` are local research inputs and are not runtime dependencies.

## Documentation

Start with [`docs/README.md`](docs/README.md), then read the product, architecture, reference-adoption, and testing contracts.
