# Changelog

## [Unreleased]

### Features

- New `theme.autoApply` config leaf (default `"titanium"`): the configured Pi theme is applied at TUI session start when the active theme differs, so a fresh install renders with the `titanium` palette. `"off"` keeps the active Pi theme (also the `native` preset default), `PI_STYLE_THEME=<name|off>` overrides via environment, and Pi's `light/dark` auto syntax is supported (e.g. `"titanium-light/titanium"`). The switch is failure-safe: the target is resolved with `getTheme` first because Pi's `setTheme` falls back to the dark theme when a name cannot be loaded, which would clobber the user's theme; a manually chosen theme is only re-applied on the next session start while the setting remains.

- Bash `git` results render as boxless semantic cards (ADR 0005, Phase 8A): `git status` (long and `--short`/`--porcelain`) shows grouped counts with `M`/`?` file rows and a branch ahead/behind line when it affects the result; `git diff --stat` shows the exact per-file change counts plus `N files changed · +A -D` from the summary line; short `git log`/`--oneline` shows recent commits with refs on the HEAD row. Git classification shares the strict bash gate (no pipes/redirects/`&&`/`;`), parsers are fail-closed (any ambiguity falls back to the raw boxed Bash shell), and `git -C`, `-z`/`--porcelain=v2`, plumbing, and format-changing flags stay raw. Execution is never changed; diff-stat bars are scaled by git so per-file rows show the exact `| N` count rather than a guessed +/− split.
- `git commit`/`push`/`pull`/`fetch` render as boxless state-change cards (ADR 0005, Phase 8C-1): a successful commit shows `Git commit · <short-hash> · <subject>` with the `N files changed · +A` summary; `push`/`fetch` show the `To`/`From` remote (dim) plus normalized ref rows (`* [new branch] …`, `<a>..<b> …`); a fast-forward `pull` shows the hash range, `Fast-forward`, and the per-file stat rows. No-op states render a single line (`Everything up-to-date`, `Already up to date.`, `nothing to commit`, `no new refs`). Classification rejects format-changing flags (`-v`/`--verbose`, `--porcelain`, `--dry-run`, `--rebase`, `-p`/`--patch`, `-i`/`--interactive`); `git commit` also parses the exit-1 nothing-to-commit shape, while rejected pushes/hook failures stay raw (fail-closed).
- `git switch`/`checkout`/`add`/`restore`/`reset`/`merge`/`rebase` render as boxless state-change cards (ADR 0005, Phase 8C-2): `switch`/`checkout` put the target branch in the header (`Git switch · feature`), silent `add`/`restore`/`checkout -- <file>` show `completed, no output`, `reset` renders the `Unstaged changes after reset:` rows or `HEAD is now at <hash> <subject>`, `merge` shows `Already up to date.` or the range + `Fast-forward`/`Merge made by the '…' strategy.` + stat rows, and `rebase` shows `Successfully rebased and updated refs/heads/<branch>.` (trailing period stripped) or `Current branch … is up to date.`. Conflicts, interactive modes (`-i`/`-p`/`--orphan`/`--exec`), and unrecognized output stay raw (fail-closed).
- `git show --stat` renders as a compact boxless card: a `Git show · <short-hash> · <subject>` header (parsed from the full-format commit block) above the same per-file summary and `├─/└─` rows as `git diff --stat`. A plain `git show` (patch output) still renders as the boxed per-file adaptive diff; `--stat` combined with any patch/format flag (`-p`, `--numstat`, `--format=…`, …) falls back raw.
- Bash `gh` results render as boxless semantic cards (ADR 0005, Phase 8D): `gh pr list`/`issue list` show state-colored `#<number>  <title>  <branch>` rows; `gh pr view`/`issue view` show a `PR #<n> · <title>` header with state · base→head, `+A −D · N files`, author, reviewers, and a capped body preview; `gh pr checks` colors each check pass/fail/pending/skipping with its duration; `gh pr create` shows the new PR URL; `gh run list`/`run view` show ✓/✗/◌ run glyphs with workflow, branch, jobs, and annotations. `gh run view --job=<id>` renders the job log in a boxed result (`Log · <id>` divider) like `git diff`. `gh run watch`, `gh api`, and other subcommands stay raw. Classification shares the strict bash gate (no pipes/redirects/`&&`), `--json` output is auto-detected, and every parser is fail-closed (any ambiguity falls back to the raw boxed Bash shell).
- New `editor.frame: "rounded"` mode for the editor input: a rounded box (`╭─╮ / │ text │ / ╰─╯`) with vertical side borders around the input and the autocomplete dropdown. Requires `editor.style: "dock"`; side borders reserve two columns and the cursor stays aligned inside the box (`outline` keeps the previous square-corner look without side borders).
- New `editor.hint` config leaf: a dim placeholder (semantic `hint` token, `theme.colors.hint`, default muted gray) shown after the prompt while the input is empty — e.g. `"Ask Pi anything"`. Any typed character hides it.
- The editor input now reflects Pi's bash mode (`!` prefix): the prompt glyph becomes the bash icon (`` Nerd Font, `$` fallback; `theme.glyphs.bashPrompt`), the leading `!`/`!!` is hidden from the displayed text (cursor stays aligned; a cursor on the `!` keeps its block), and the whole frame switches to the `bashMode` border color. Emptying the input returns to the normal `❯` prompt. Display-only: the real editor text keeps the prefix, so submit/history/undo and execution are unchanged.
- Submitting a bare bang (`!` / `!!` with no command) is now dropped instead of being sent to the agent as a literal message: the editor is already reset by Pi's submit path, so the input returns to the normal prompt without sending anything. Real bash commands and rpc/extension input sources are unaffected.
- Direct bash execution (`!command` / `!!command`) now renders in the same rounded box as the boxed tools instead of plain full-width bars: `╭─ ➔ Bash ◌/✓/✗ ─╮`, boxed `$ command` + streamed output, `╰─ ◌ Running · Ns / Exit 0 / Exit N / Cancelled ─╯`. A fingerprint-certified additive `render` patch on `BashExecutionComponent` (exact 0.83.0) is active from the first frame and falls back to native bars without a session theme or on other Pi builds; the `bashPromptColor` theme extra / `bashMode` color drive the title.

### Changed

- Grep / List / Glob output trees are now file-anchored (ADR 0006): each result leads with a standalone per-file header; `grep` matches render as `*line: content` rows with adjacent context as ` line:` rows (kept from the raw `file:line-` output instead of discarded) and a dim `...` gap between non-adjacent lines; `find` path entries group under their directory while single-directory `ls` stays flat. The previous `├─/└─` summary tree is dropped in favor of clean indented rows. `git`/`gh` semantic views and the Read path panel keep their existing layout.

- The default editor frame is now the rounded input box (`editor.style: "dock"` + `editor.frame: "rounded"`) with vertical side borders. `frame: "outline"` restores the previous square-corner box without side borders; the `compact`, `minimal`, and `native` presets keep their explicit compact/native editor and are unaffected.

### Bug Fixes

- `messages.hideThinkingLabel` now truly leaves zero trace: Pi wraps even an empty label in ANSI codes, so its `Text` still rendered one invisible full-width row, and the native layout added a trailing spacer — together the visible "gap" where the `Thinking...` label used to sit. A certified `AssistantMessageComponent.updateContent` patch (fingerprint-verified for 0.83.0) drops the invisible label row and its trailing spacer, leaving the same single top padding as a text-only assistant message. Disabling the option restores the native label/layout; on any other Pi build the surface falls back native.

## [0.1.4] - 2026-08-05

### Features

- Strict boxed tool-card state machine with live running/streaming/terminal states

## [0.1.3] - 2026-08-04

### Bug Fixes

- *(test)* Drop timing-dependent 0.00s assertion in batch header

### Features

- Group consecutive quiet-tool calls into a boxless batch panel

### Refactor

- Render lone read/ls/find calls with the same boxless tree
- Boxless output trees, readonly tool activation, drop user prefix

### Bug Fixes

- `messages.hideThinkingLabel` now truly leaves zero trace: Pi wraps even an empty label in ANSI codes, so its `Text` still rendered one invisible full-width row, and the native layout added a trailing spacer — together the visible "gap" where the `Thinking...` label used to sit. A certified `AssistantMessageComponent.updateContent` patch (fingerprint-verified for 0.83.0) drops the invisible label row and its trailing spacer, leaving the same single top padding as a text-only assistant message. Disabling the option restores the native label/layout; on any other Pi build the surface falls back native.

## [0.1.2] - 2026-08-04

### Bug Fixes

- Re-decorate tool/message boxes after session resume

### Features

- Adaptive unified/split diffs and rounded boxed tool surfaces

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

