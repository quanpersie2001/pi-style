# Compatibility policy

> Status: **Phase 2 public-widget compatibility implemented; full conflict/patch matrix planned**

## Principles

pi-style modifies UI owned by a fast-moving host and may coexist with other UI extensions. Compatibility is therefore a product feature, not cleanup work.

- Public Pi APIs are preferred even when an internal patch could produce a more exact imitation.
- A compatibility-sensitive feature is optional and independently degradable.
- Unknown capability means “use the safe fallback,” not “assume the current reference implementation shape.”
- Terminal mutation must be reversible.

## Compatibility tiers

| Tier | Technique | Default policy |
| --- | --- | --- |
| **A — Public** | Pi events, commands, widgets, header, custom editor/footer, working indicator, theme APIs | Enabled |
| **B — Reflective composition** | Capability-checked instance methods/providers not guaranteed by the minimum API | Enabled when detected; fall back quietly |
| **C — Core patch** | Prototype/component patching or built-in renderer replacement | Disabled unless allowed and version/capability tested |
| **D — Terminal ownership** | Scroll regions, physical-buffer interception, fixed-zone compositor | Unsupported in v1 |

## Tier A surfaces

Expected stable integrations:

- lifecycle events;
- `thinking_level_select` and `model_select`;
- `ctx.ui.setWidget()`;
- `ctx.ui.setHeader()` when available;
- `ctx.ui.setEditorComponent()` and `CustomEditor`;
- `ctx.ui.setFooter()` when explicitly selected;
- `ctx.ui.setWorkingIndicator()`;
- active theme access;
- commands and settings UI components.

Tier A features still need cleanup and singleton-conflict handling.

## Tier B surfaces

Examples:

- reading an existing editor factory;
- preserving an internal autocomplete provider when no public composition API exists;
- footer data provider methods or invalidation hooks exposed in some host versions;
- optional context/settings manager helpers.

Tier B code must check method existence, validate returned shapes, and keep a public-API fallback.

## Tier C surfaces

Planned Tier C candidates:

- assistant/user message render patches;
- compaction, skill, branch-summary, or custom message component patches;
- built-in tool presentation replacement when renderer-only public integration is insufficient.

A Tier C feature is accepted only when it has:

1. a documented user-visible requirement;
2. a known Pi version/capability range;
3. idempotent installation;
4. identity-safe restoration;
5. shape mismatch tests;
6. another-extension conflict behavior;
7. native fallback;
8. doctor diagnostics;
9. no change to core execution semantics.

## Pi version policy

The package will declare an explicit peer dependency range based on tested versions. Capability detection remains required inside that range because optional APIs may differ by build or extension load order.

A compatibility matrix should record:

| Capability | Minimum tested version | Detection | Fallback |
| --- | --- | --- | --- |
| widgets with placement | To be recorded in Phase 7 | public method/options | disable/move row |
| editor getter/composition | To be recorded in Phase 7 | method existence | prefer existing/native editor |
| footer data branch/status | To be recorded in Phase 7 | provider methods | hide affected segments |
| header API | To be recorded in Phase 7 | method existence | startup widget or off |
| message component shape | To be recorded in Phase 7 | version + prototype shape | native messages |
| built-in renderer integration | To be recorded in Phase 7 | API/shape check | native tools |

Version numbers are filled in from actual implementation tests, not copied blindly from the references.

## Coexistence with other extensions

### Existing editor

Default: preserve an existing custom editor when full safe composition is unavailable. The user may explicitly prefer pi-style, but doctor output must show that a replacement occurred.

### Existing footer

Default: preserve it. Status widgets should not require footer ownership. If branch or extension-status data is unavailable, hide those segments instead of silently replacing another footer.

### Existing widget IDs

Use namespaced IDs. Never use generic keys such as `status`, `footer`, or `top`.

### Existing message/tool patches

Detect wrapper markers and target identity. If ownership cannot be determined, leave the existing renderer in place and disable the pi-style surface.

### Extension statuses

Treat status values as opaque styled strings unless a configured custom item explicitly extracts a known semantic value. Never remove another extension's status merely because it is displayed in pi-style.

## Terminal compatibility

Target validation matrix:

- Ghostty;
- iTerm2;
- Kitty;
- WezTerm;
- a common Linux terminal (for example GNOME Terminal or Konsole);
- Windows Terminal native and WSL;
- SSH/tmux scenarios where environment detection may be incomplete.

### Width and Unicode

All lines use ANSI-aware visible width. Ambiguous-width and private-use glyphs are optional. ASCII mode avoids powerline private-use separators.

### Nerd Font detection

Detection order:

1. explicit `PI_STYLE_NERD_FONTS=1|0`;
2. explicit config `on|off`;
3. known environment signals such as `GHOSTTY_RESOURCES_DIR`;
4. conservative terminal-name heuristic;
5. fallback to Unicode/ASCII.

Terminal brand does not guarantee the configured font. The explicit override remains authoritative.

### `NO_COLOR`

When `NO_COLOR` is present and not explicitly overridden, pi-style removes decorative color while preserving text, borders/glyph fallbacks, spacing, labels, and error/state markers.

### ANSI reset

Every independently rendered line must be self-contained. Styling cannot rely on color state carrying across lines. Truncation must preserve/reset ANSI state safely.

## Terminal background policy

Default behavior is explicit cell background painting through theme callbacks when needed.

OSC policy:

- do not use OSC 10 for foreground;
- OSC 11 may set the terminal background only when configuration/platform policy permits it;
- record whether pi-style changed the background;
- restore with OSC 111 or the documented prior-state strategy on shutdown;
- disable automatically on unverified Windows paths unless explicitly forced;
- no continuous polling of terminal background during render.

## Graceful fallback table

| Problem | Fallback |
| --- | --- |
| Unknown Pi version | Tier A only; compatibility surfaces disabled. |
| Missing widget placement support | Use supported placement or disable secondary row. |
| Existing custom editor | Preserve it by default; status/theme remain active. |
| Missing footer data | Hide branch/extension-status-dependent segments. |
| No Nerd Font | Unicode/ASCII glyphs and separators. |
| `NO_COLOR` | Structural monochrome rendering. |
| Tool/message patch mismatch | Native tool/message rendering. |
| OSC unsupported | No terminal-global background change. |
| Git unavailable/not a repo | Hide Git segment. |
| Very narrow width | Keep essential text, hide optional segments, never overflow. |

## Doctor output

`/pi-style doctor` should report:

- Pi version and declared support range;
- detected public/reflective capabilities;
- terminal, color, glyph, and OSC assumptions;
- active preset and effective config sources;
- active, disabled, conflicted, and failed surfaces;
- current editor/footer ownership decision;
- installed Tier C patches and their target identities;
- provider errors such as repeated Git failures;
- actionable recovery commands.

It must not print secrets, full settings files, API keys, or arbitrary extension data.

## Phase 2 implementation notes

Status widgets use Tier A public APIs, namespaced IDs, component factories, guarded placement, and identity-safe removal. Missing widget behavior is contained to the status feature; footer ownership is preserved by default, and print/json modes perform no terminal widget work. Tier C patches and broader editor/message/tool conflict behavior remain planned.

## Compatibility requirements

- **COMPAT-001:** Tier A features work independently of Tier C.
- **COMPAT-002:** a Tier C failure disables only its feature.
- **COMPAT-003:** reload never stacks the same patch.
- **COMPAT-004:** cleanup never overwrites a later owner's replacement.
- **COMPAT-005:** existing editor/footer ownership follows documented preference settings.
- **COMPAT-006:** unknown font support uses fallback glyphs.
- **COMPAT-007:** terminal mutations are restored.
- **COMPAT-008:** unsupported headless modes perform no terminal work.

## Post-v1 boundary

Fixed-zone compositing, terminal scroll-region management, custom fixed-zone selection, chat virtualization, and physical-buffer self-healing are Tier D research. They require a separate ADR, product contract, and terminal test plan before entering implementation.

## Roadmap coverage

- Capability detection and diagnostic foundation: Phase 1A (implemented).
- Singleton/editor/footer behavior: Phases 2–3.
- Singleton/editor/footer behavior: Phases 2–3.
- Tier C surfaces: Phase 5.
- Full conflict/doctor behavior: Phase 6.
- Terminal and version proof: Phase 7.
