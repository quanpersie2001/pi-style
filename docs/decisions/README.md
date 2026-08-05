# Architecture decisions

Decision records capture durable choices that should not be rediscovered during implementation.

## Status values

- **Proposed** — under review.
- **Accepted** — current decision.
- **Superseded** — replaced by a later record.
- **Rejected** — considered and intentionally not selected.

## Current decisions

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-layered-plugin-architecture.md) | Accepted | Use `shared → domain → features → app → pi`. |
| [0002](0002-native-pi-layout-ownership.md) | Accepted | Keep native Pi layout ownership for v1. |
| [0003](0003-semantic-theme-and-style-presets.md) | Accepted | Separate code-defined layout presets from semantic themes. |
| [0004](0004-compatibility-tiers-and-patch-policy.md) | Accepted | Classify integrations by compatibility tier and restrict core patches. |
| [0006](0006-file-anchored-output-trees.md) | Accepted | File-anchored output trees for Grep / List / Glob. |

## When a new ADR is required

Create or supersede a decision when changing:

- dependency direction or source layers;
- configuration storage/precedence;
- public preset or semantic token contracts;
- native layout ownership;
- editor/footer conflict policy;
- introduction of a new Pi-core prototype patch;
- fixed-zone/scroll-region/terminal compositor behavior;
- package entry points or public API;
- validation requirements that weaken an existing release gate.

## ADR structure

1. Title, status, date.
2. Context/problem.
3. Decision.
4. Alternatives considered.
5. Consequences and trade-offs.
6. Validation implications.
7. Supersedes/superseded-by links where applicable.
