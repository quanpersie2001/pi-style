# Compatibility policy

> Status: **Phase 7 verified**

## Principles

pi-style modifies UI owned by a fast-moving host and may coexist with other UI extensions. Compatibility is therefore a product feature, not cleanup work.

- Public Pi APIs are preferred even when an internal patch could produce a more exact imitation.
- A compatibility-sensitive feature is optional and independently degradable.
- Unknown capability means "use the safe fallback," not "assume the current implementation shape."
- Terminal mutation must be reversible.

## Compatibility tiers

| Tier | Technique | Default policy |
| --- | --- | --- |
| **A — Public** | Pi events, commands, widgets, header, custom editor/footer, working indicator, theme APIs | Enabled |
| **B — Reflective composition** | Capability-checked instance methods/providers not guaranteed by the minimum API | Enabled when detected; fall back quietly |
| **C — Core patch** | Prototype/component patching or built-in renderer replacement | Disabled unless allowed and version/capability tested |
| **D — Terminal ownership** | Scroll regions, physical-buffer interception, fixed-zone compositor | Unsupported in v1 |

## Tier A surfaces

Expected stable integrations: lifecycle events, `thinking_level_select`/`model_select`, `ctx.ui.setWidget()`, `ctx.ui.setHeader()` when available, `ctx.ui.setEditorComponent()` + `CustomEditor`, `ctx.ui.setFooter()` when explicitly selected, `ctx.ui.setWorkingIndicator()`, active theme access, commands, and settings UI. Tier A features still need cleanup and singleton-conflict handling.

## Tier B surfaces

Examples: reading an existing editor factory, preserving an internal autocomplete provider without a public composition API, footer data provider methods in some host versions, optional context/settings helpers. Tier B code checks method existence, validates returned shapes, and keeps a public-API fallback.

## Tier C surfaces

Certification is identity-first, never version-pinned: each surface is certified when the runtime method (or class constructor, for additive installs) matches a recorded name/arity/source-fingerprint identity in the immutable identity registry. The registry documents which supported Pi versions (`0.83.0`–`0.84.3`) carry each identity, but the version string is informational only — it never gates installation. Identities are recorded per artifact family: through Pi `0.84.2` the Node CLI ran the modular `dist/` build, and `0.84.3` switches the CLI entrypoint to a minified bundled runtime (`dist/bundle/chunks/*`) whose jiti virtual-module map serves extensions the in-bundle class objects — minification rewrites every method's `Function.prototype.toString()` text while behavior is unchanged, so each surface records both the modular (`0.83.0`–`0.84.2`) and the bundled (`0.84.3`) identities. Installation requires own-descriptor shape and writable/configurable ownership gates; cleanup restores the exact captured descriptor only while pi-style still owns the installed identity. An unrecorded or drifted identity degrades that single surface to its native fallback while every other surface keeps running.

Certified surfaces: assistant-message render, assistant-message `updateContent` (thinking-label collapse), tool call renderer, tool result renderer, the four special message blocks (compaction, branch, skill, custom/MCP), and the additive bash-execution box. The core/message/tool surface flags are default-on (`default: true`) — patches are identity-verified per surface, with native fallback for any surface whose runtime identity is not recorded — and non-persistent. The OFF switch is `compatibility.allowCorePatches: false` (or `enabled: false`). ASCII changes markers only on an authorized surface.

Lifecycle: installs at interactive `session_start`, retains incomplete probes when exact restoration is rejected, retries before a new generation, preserves later owners, and exposes frozen runtime/final diagnostics. New Pi builds are supported automatically when their native identities still match a recorded fingerprint; identities that change simply fall back natively per surface until a new identity is recorded.

Approved native fallbacks: special blocks without a certified adapter, generic cancelled/truncated tool distinction without reliable host state, images without decoration claim, malformed/unsafe shapes, disabled surfaces, and surfaces whose runtime identity matches no recorded fingerprint (including future Pi builds).

A Tier C feature is accepted only when it has: a documented user-visible requirement; a known Pi version/capability range; idempotent installation; identity-safe restoration; shape mismatch tests; another-extension conflict behavior; native fallback; doctor diagnostics; and no change to core execution semantics.

## Pi version policy

The package declares an explicit peer dependency range based on tested versions; certification itself is decided per surface by recorded identities, so builds outside the tested range keep working (or degrade per surface) instead of failing wholesale.

| Capability | Minimum tested | Detection | Fallback |
| --- | --- | --- | --- |
| Widgets with placement | Phase 7 verified | public method/options | disable/move row |
| Editor getter/composition | Phase 7 verified | method existence | prefer existing/native editor |
| Footer data branch/status | Phase 6 verified | injected capability-safe provider | hide affected segments; no footer takeover |
| Header API | Phase 7 verified | method existence | startup widget or off |
| Message component shape | 0.83.0 – 0.84.3 | recorded identity (name/arity/fingerprint) | native messages |
| Built-in renderer integration | 0.83.0 – 0.84.3 | recorded identity (name/arity/fingerprint) | native tools |

## Coexistence with other extensions

| Conflict | Default behavior |
| --- | --- |
| Existing editor | Preserve it when full safe composition is unavailable; explicit preference is allowed with doctor visibility. |
| Existing footer | Replace with an empty pi-style-owned component while the status line is enabled; `setFooter(undefined)` restores native. Hide branch/status segments when data is unavailable. |
| Existing widget IDs | Use namespaced IDs; never generic keys such as `status`, `footer`, `top`. |
| Existing message/tool patches | Detect wrapper markers and target identity; if ownership is unclear, keep the existing renderer and disable the pi-style surface. |
| Extension statuses | Treat as opaque styled strings unless a configured custom item extracts a known semantic value; never remove another extension's status. |

## Terminal compatibility

Target validation matrix: Ghostty, iTerm2, Kitty, WezTerm, a common Linux terminal, Windows Terminal native and WSL, and SSH/tmux where detection is incomplete.

**Width and Unicode** — all lines use ANSI-aware visible width; ambiguous-width and private-use glyphs are optional; ASCII mode avoids private-use separators.

**Nerd Font detection** — order: explicit `PI_STYLE_NERD_FONTS=1|0` → explicit config `on|off` → strong signals like `GHOSTTY_RESOURCES_DIR` → conservative terminal-name heuristic → Unicode/ASCII fallback. Terminal brand never guarantees the configured font; the explicit override is authoritative.

**`NO_COLOR`** — pi-style removes decorative color while preserving text, borders/glyph fallbacks, spacing, labels, and error/state markers.

**ANSI reset** — every independently rendered line is self-contained; styling never relies on color carrying across lines; truncation preserves/resets ANSI state safely.

## Terminal background policy

Default is explicit cell background painting through theme callbacks when needed.

Terminal-global background synchronization is unsupported/off for technical v1: production emits no OSC 10/11/111, performs no terminal query or polling, installs no terminal-background widget, and claims no terminal-global ownership. Explicit cell backgrounds and Pi theme APIs remain supported; physical terminal/platform/color synchronization stays unclaimed unless mandatory platform evidence requires a future decision.

## Graceful fallback table

| Problem | Fallback |
| --- | --- |
| Unknown Pi version | Identity-certified surfaces still install when fingerprints match; unrecorded identities degrade per-surface. |
| Missing widget placement support | Supported placement or no secondary row. |
| Existing custom editor | Preserve it by default; status/theme remain active. |
| Missing footer data | Hide branch/extension-status segments. |
| No Nerd Font | Unicode/ASCII glyphs and separators. |
| `NO_COLOR` | Structural monochrome rendering. |
| Tool/message patch mismatch | Native tool/message rendering for the affected surface only. |
| Terminal-global background sync unsupported/off | No OSC output, query/polling, widget, or ownership. |
| Git unavailable / not a repo | Hide Git segment. |
| Very narrow width | Keep essential text, hide optional segments, never overflow. |

## Doctor output

`/pi-style doctor` reports: Pi version and declared support range; detected public/reflective capabilities; terminal/color/glyph/OSC assumptions; active preset and effective config sources; active/disabled/conflicted/failed surfaces; current editor/footer ownership decision; installed Tier C patches and target identities; provider errors; and actionable recovery commands. It never prints secrets, full settings files, API keys, or arbitrary extension data.

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

Fixed-zone compositing, terminal scroll-region management, custom fixed-zone selection, chat virtualization, and physical-buffer self-healing are Tier D research. They require a separate ADR, product contract, and terminal test plan before implementation.

## Roadmap coverage

- Capability detection and diagnostics foundation: Phase 1A.
- Singleton/editor/footer behavior: Phases 2–3.
- Tier C surfaces: Phase 5.
- Full conflict/doctor behavior: Phase 6.
- Terminal and version proof: Phase 7; manual evidence pending.
- Requirement IDs: `COMPAT-001` through `COMPAT-008`.
