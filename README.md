# pi-style

A native-layout, cohesive visual style package for [Pi](https://pi.dev/).

> Phase 5's exact certified messages/tools subset and Phase 6 full configurability/control-plane scope are accepted after independent Peer acceptance and Root validation. Phase 7 hardening, platform validation, and v1 release work remains blocked/not started pending Supervisor/program acceptance. See [`ROADMAP.md`](ROADMAP.md) and [`docs/PHASE-5-EVIDENCE.md`](docs/PHASE-5-EVIDENCE.md).

## Development

```bash
npm ci
npm run check
```

The Pi extension bundle is built to `dist/extensions/pi-style.js` and is declared through the `pi` package manifest. The current extension is intentionally inert until `session_start`; it performs no terminal work in print/json modes. The repositories under `references/` are local research inputs and are not runtime dependencies.

## Documentation

Start with [`docs/README.md`](docs/README.md), then read the product, architecture, reference-adoption, and testing contracts.
