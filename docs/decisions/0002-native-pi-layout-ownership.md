# ADR 0002: Native Pi layout ownership

- Status: **Accepted**
- Date: 2026-08-01

## Context

The references use two different layout strategies:

- `pi-powerline-footer` places status through Pi widgets/editor/footer APIs and lets Pi own the feed, scrolling, selection, and terminal layout.
- `pi-droid-styling` can create a fixed bottom zone through terminal scroll regions and adds custom selection, background, physical-buffer, and virtualization logic.

The fixed-zone approach offers stronger visual control but materially changes terminal ownership and multiplies platform, selection, copy, resize, and compatibility responsibilities.

## Decision

For v1, pi-style uses native Pi layout ownership:

- startup through header/overlay APIs;
- status through named widgets;
- editor through `CustomEditor` installation;
- footer only as an optional compatible data bridge;
- native conversation feed, scrolling, selection, and resize behavior.

The fixed-zone compositor, scroll-region management, terminal split, custom fixed-zone selection/copy, chat virtualization, and physical-buffer self-heal are excluded from v1.

## Alternatives considered

### Adopt the Droid fixed zone immediately

Rejected for v1. It would make platform/terminal correctness the first dependency of every visual feature and conflict with the request to keep implementation maintainable.

### Support both native and fixed layouts as equal modes

Rejected. Two layout architectures would double feature integration and testing before the native product is stable.

### Status/footer only, no custom editor

Rejected. It would not absorb enough of the desired Droid visual identity.

## Consequences

### Benefits

- native scrolling, selection, and resize remain intact;
- status/editor can use documented Pi APIs;
- fewer terminal escape mutations;
- easier composition and reload safety;
- status and editor can ship before compatibility-sensitive message/tool styling.

### Costs

- the editor/status area cannot be guaranteed physically fixed independent of Pi layout behavior;
- footer data access may be limited by ownership conflicts;
- some exact Droid screenshots cannot be reproduced.

The product values behavior stability over exact imitation.

## Revisit conditions

A fixed-zone research project may begin only when:

1. a concrete user problem cannot be solved with native Pi APIs;
2. v1 is stable;
3. a new product contract and ADR are accepted;
4. terminal/OS/selection/copy/resize tests are designed first;
5. the mode is experimental and opt-in until proven.

## Validation implications

- Phase 2 status tests use widgets.
- Phase 3 editor tests retain native feed behavior.
- Tier D terminal ownership remains absent from v1 code.
