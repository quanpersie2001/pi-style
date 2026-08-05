# ADR 0003: Semantic themes and code-defined style presets

- Status: **Accepted**
- Date: 2026-08-01

## Context

UI styling can be split in two directions: preset-driven layouts that define segment groups and colors, and code-defined styles that define layout, glyphs, padding, frame, and semantic token names. Pi also has a complete active theme system.

If users can define arbitrary render structures in JSON, validation, migrations, and compatibility become difficult. If colors are hardcoded in each feature, the product will not work coherently with custom Pi themes.

## Decision

Separate two concepts:

### Style presets

Code-defined, versioned structures controlling:

- enabled surfaces;
- spacing and frames;
- status segment groups/priorities;
- editor style and metadata ownership;
- startup mode;
- message/tool density.

Users select a preset and apply documented overrides.

### Semantic themes

A shared resolver controlling:

- colors;
- glyphs and separators;
- background behavior;
- thinking/status state semantics.

Resolution starts from the active Pi theme, then applies optional pi-style theme metadata and explicit configuration overrides.

No configuration field accepts executable render code.

> **Update (0.2.0):** the `theme.autoApply` leaf (default `"titanium"`) applies a theme at TUI session start when the active theme differs, configurable per scope and disabled with `"off"` (also the `native` preset default). This stays consistent with the decision above: the palette is not hardcoded — it is a documented, overridable leaf, and the switch never passes an unresolvable name to Pi (whose `setTheme` would fall back to the dark theme).

## Alternatives considered

### Hardcode one palette and layout

Rejected. It would fight user themes and make light/no-color modes poor.

### Fully user-defined JSON layout/render DSL

Rejected. It creates a second UI framework, weak validation, and unstable migrations.

### Ship only a Pi theme JSON

Rejected. Theme files cannot implement live status layout or editor structure.

## Consequences

### Benefits

- coherent appearance across surfaces;
- custom Pi themes remain usable;
- presets can evolve through migrations;
- no-color/ASCII fallbacks are centralized;
- render code stays typed and testable.

### Costs

- adding a new preset requires code/release work;
- users cannot invent arbitrary renderer structures from settings;
- semantic mapping must handle incomplete/custom themes.

## Migration policy

Preset/token renames require documented aliases for at least one minor release. Invalid values fall back safely and appear in diagnostics.

## Validation implications

- theme resolver unit tests cover precedence and missing tokens;
- every feature render test runs with more than one theme plus no-color;
- config schema rejects executable/dynamic values;
- style/palette behavior is documented separately.
