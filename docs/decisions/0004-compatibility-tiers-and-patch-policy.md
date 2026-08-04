# ADR 0004: Compatibility tiers and patch policy

- Status: **Accepted**
- Date: 2026-08-01

## Context

The desired product includes surfaces that Pi exposes through public APIs—widgets, editor, header, footer—and surfaces that reach through internal component prototypes—assistant messages, special blocks, and some built-in tool rendering.

Treating all techniques as equally safe would make upgrades unpredictable. Refusing every compatibility patch would exclude important parts of the desired compact message/tool UI.

## Decision

Classify integration techniques:

- **Tier A:** public Pi extension/TUI APIs; enabled by default.
- **Tier B:** reflective capability-checked composition; enabled only when capability exists.
- **Tier C:** Pi core/component patch or built-in renderer replacement; conservative, configurable, version/capability gated.
- **Tier D:** terminal layout ownership such as scroll regions/fixed compositor; unsupported in v1.

A Tier C feature must be isolated, idempotent, reversible, identity-safe, tested against shape mismatch/conflict, and have a native fallback. It may not alter built-in execution semantics merely for styling.

### Accepted Phase 5 decision

Human-authorized compact-style Tier C compatibility is accepted only for exact Pi `0.83.0` within `>=0.83.0 <0.84.0`. It is explicit default-deny: the core flag plus the relevant assistant/tools surface flag is required, and flags are session-only. Certified adapters cover the assistant prefix and tool call/result selectors with exact certified state markers. Compaction/branch/skill/custom blocks, unreliable generic cancelled/truncated distinction, and image-specific decoration remain approved native-preserved fallbacks. The boundary is renderer-only: no broad compositor, tool registration, execution, prompt, filesystem, or process mutation.

## Alternatives considered

### Never patch internals

Rejected as an absolute rule because some message/tool visual surfaces may have no adequate public hook. Public API remains the preference, and such features are later-phase/optional.

### Patch current Pi internals freely

Rejected. It would couple the whole extension to one host shape and make reload conflicts unsafe.

### Fork Pi or bundle host components

Rejected. pi-style is an extension/package, not a Pi distribution.

## Consequences

### Benefits

- stable status/editor/theme foundation can ship independently;
- message/tool styling has explicit risk and proof requirements;
- `/pi-style doctor` can explain active fallbacks;
- one patch failure does not remove unrelated surfaces.

### Costs

- exact compact-style coverage depends on tested Pi versions;
- some users will see native message/tool rendering;
- patch registry/disposal tests add implementation work.

## Patch acceptance checklist

Before adding a Tier C patch:

1. identify the owning requirement;
2. document target Pi versions/capabilities;
3. prefer a renderer-only/public API alternative;
4. mark installed targets to prevent duplicate wrapping;
5. preserve original identity and restore conditionally;
6. handle another extension before and after pi-style;
7. test partial/final render states;
8. expose status in doctor output;
9. provide user-configurable disable/fallback;
10. update this ADR or add a new one if risk materially changes.

## Validation implications

- compatibility tests are mandatory before Phase 5 completion;
- CI tests supported and unsupported shapes;
- release notes call out Tier C changes;
- unknown Pi versions use Tier A/B conservative behavior unless explicitly overridden.
