# Changelog

## [Unreleased]

### Bug Fixes

- **Style: edit diffs are now adaptive (unified/split) with collapsed context.** Diff boxes previously always used a side-by-side split layout, so an additions-only change (e.g. two new changelog bullets) rendered an almost-empty `old` column that stole half the width and forced heavy wrapping. The edit/quick-edit/substitute-edit/target-edit renderers now pick the layout per render width: split only for short corresponding changes on wide terminals (`pickDiffMode`: needs both `+` and `-`, content width ≥ ~114, and no changed line longer than half the width), unified otherwise (additions/removals-only, narrow terminals, long lines). Long runs of unchanged context collapse into a single `⋯ N unchanged lines hidden` row instead of `rows.slice(0, maxRows)` arbitrary truncation; diffs still over budget show `⋯ N lines omitted · Ctrl+O to show full diff` with a `Ctrl+O more` hint on the divider's right side. The divider now reads `Diff · +3 -0` (change stats, replacing the old `↳ diff +3 -0 split [meter]` summary line + `Response` divider — the progress bar is gone), the path moved into the top-border title (`╭─ ➔ Edit ✓ · CHANGELOG.md ╮` instead of a `Path:` body line), and the footer shows `1 file · +3 -0` (elapsed time first when known) instead of `~N words`.

- **Style: failed tool calls now color the whole title.** Previously only the `✗` was error-colored while `➔ Bash` kept its normal identity color. On failure the entire `➔ Bash ✗` title now renders in the error color (bold), so a failed tool reads instantly; on success the tool keeps its `bashPromptColor`/`bashMode` identity color and only the `✓` is success-colored.

- **Fixed: boxed borders now render with uniform brightness.** Embedded border labels (tool titles, the `Response` divider, footer metrics, expand hints) wrap their text in foreground escapes that end in `\x1b[39m` — a reset to the *terminal default* color. Since the whole border line was previously wrapped in a single border-color escape, every `─` dash after a label fell back to the default foreground, so one border rendered faint (border color) on one side of the label and bright (default) on the other. `boxLabeledBorder` now applies the border style per segment, re-establishing the border color after every label (corners, dashes, and right-side hint all stay in the theme's border color), and each segment also re-asserts normal intensity so a bold label can never leak weight into the frame.

- **Style: boxed tool/skill surfaces moved to rounded, border-embedded labels.** Tool boxes and special message blocks (skill/compaction/branch/custom) now use rounded corners (`╭╮╰╯`) with the title embedded in the top border (`╭─ ➔ Bash ✓ ──────╮`), a single labeled divider between the call and the result (`├─ Response ────┤`), the metrics footer embedded in the bottom border (`╰─ 0.00s · timeout 300s · ~45 words ── Ctrl+O for more ───╯`), and blank-row padding instead of inset divider lines. The old title line + inset dividers are gone, removing the extra `|`/`─` rules. Compact (summary) tools render `╭─ ➔ Read ✓ · Path: … ────╮ / ╰─ 0.00s · ~10k words ────╯`. Expand hints moved from content lines into the bottom-border right slot; footer icons (`◷`, `⏹`, `✎`) were dropped in favor of plain `0.00s · timeout 300s · ~45 words`. Startup panels use rounded corners to match.

- **Fixed: boxed tool/message surfaces now survive in-app session switches (resume/new/fork).** Pi renders the restored chat (`renderBeforeBind`) *after* `session_shutdown` and *before* the next `session_start`; disposing the Tier C prototype patches at `session_shutdown` left every restored tool box and special-block message box permanently native (their boxed output is cached at `updateDisplay` time and never re-derived). The coordinator now retains the patches across `session_shutdown`; the next `session_start` restores the previous generation's exact native identities and reinstalls before any new chat render. On process exit the terminal is torn down right after, so retained patches are harmless.
- **Fixed: single-line assistant replies lost their `│` prefix.** `prefixNative` excluded the final line from `firstContentIndex` for multiline OSC133 envelopes, but the native assistant render puts a short reply's only body on that final line, so short assistant messages rendered unprefixed. The last line is now eligible as the content start when no earlier line carries content, and the prefix is inserted inside the envelope.
- **Fixed: user-message prompt row no longer shifts the background band.** The `❯` prefix/continuation indent was prepended *outside* the native `userMessageBg` wrap (`bgAnsi … \x1b[49m`) while the native render ran at `width − prefixWidth`, so the content row's background started at `containerX + prefixWidth` yet still spanned the full container width (indented left, overflowing right) while the padding rows above/below stayed short — a staircase box. Decorated lines now rebuild inside the background wrap: the prompt and continuation indent sit inside the band, every row (padding rows included) spans the full container width, and plain unwrapped lines (assistant messages) are padded to the full width too. `stripAnsi` also no longer counts the OSC133 terminator (`\x07`) as a visible cell.

## [0.1.1] - 2026-08-03

### Documentation

- Add demo screenshot to README

### Features

- Implement phase 1A foundation
- Implement phase 2 status line foundation
- Complete phase 2 status line
- Complete phase 3 styled editor
- Complete phase 4 startup presentation
- Complete phase 5 messages and tools
- Complete phase 6 configuration and composition
- Boxed tool/message presentation ported from pi-droid-styling

### Miscellaneous Tasks

- Complete phase 0 foundation
- Add CI and release workflows with git-cliff changelog
- Point changelog repo links at quanpersie2001/pi-style
- Use npm ci for deterministic installs
- Use npm install like pi-rules to tolerate cross-platform lockfile gaps

### Styling

- More breathing room inside boxed surfaces

### Testing

- Close phase 2 status line gaps

