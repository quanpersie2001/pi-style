# ADR 0001: Layered plugin architecture

- Status: **Accepted**
- Date: 2026-08-01

## Context

`pi-powerline-footer` demonstrates valuable behavior but concentrates configuration, lifecycle, state, UI installation, providers, commands, Bash workflows, and rendering in a very large entry module. `pi-droid-styling` is more modular, but its folders reflect implementation history and extensive host patching rather than a strict dependency model.

The sibling `../pi-rules` project already establishes a useful package pattern with explicit source layers, strict TypeScript, tsup, Vitest, Biome, and dependency-cruiser.

pi-style intends to support status, editor, startup, message, tool, theme, configuration, diagnostics, and compatibility behavior. A flat or feature-entangled structure would become difficult to test and upgrade.

## Decision

Use the dependency direction:

```text
shared → domain → features → app → pi
```

- `shared` contains host-independent primitives.
- `domain` contains pure configuration, layout, style, theme, status, and snapshot contracts.
- `features` contains isolated UI surfaces and installers.
- `app` owns runtime state, providers, scheduling, configuration, and feature composition.
- `pi` adapts the concrete Pi lifecycle/APIs and compatibility capabilities.

Feature folders do not import sibling features. Cross-feature data is carried by app-built snapshots and provider interfaces. `pi/index.ts` remains a thin default extension factory.

Dependency-cruiser enforces the direction.

## Alternatives considered

### Single entry file

Rejected. It is quick initially but produces closure-spread state, difficult disposal, and high-cost tests as the feature set grows.

### Feature folders with unrestricted imports

Rejected. It encourages the editor to call status providers directly and themes to become feature-specific, making independent fallback difficult.

### Full clean architecture with ports/adapters per small function

Rejected as excessive. The selected layers are enough to isolate Pi and render logic without requiring an interface for every helper.

## Consequences

### Benefits

- pure layout/config/theme logic is easy to unit test;
- Pi compatibility logic is localized;
- features can be enabled, disabled, or fail independently;
- runtime state and disposal become explicit;
- sibling tooling/config can be reused.

### Costs

- more files and provider types;
- app-level snapshot design is required before UI implementation;
- small changes may touch a contract and an adapter.

These costs are accepted because pi-style's intended scope is larger than a minimal footer.

## Validation implications

- dependency-cruiser rules are a Phase 0 gate;
- unit tests must import domain code without constructing Pi;
- an integration fake host tests the `pi` adapter separately;
- architecture changes require a superseding ADR.
