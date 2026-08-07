# Changelog

## [Unreleased]

### Features

- *(turn-summary)* Mutating tools (`edit`/`write`/`quick_edit`/`substitute_edit`/`target_edit`) are no longer collapsed into the turn summary by default: their blocks are the record of what was done to the user's files and stay visible as compact previews beside the summary line; the summary counts and elapsed cover only the collapsed read-only members. New leaf `tools.collapseMutatingTools: "off" | "on"` (default `off`; `on` restores full collapse), `/pi-style set` support (ADR 0007 amendment, SUM-006).

### Bug Fixes

- *(box)* Error results with embedded newlines (tool validation errors, JSON payloads) rendered as one overflowing "line", breaking the box frame (borders only on the first and last row); every fragment now renders as its own bordered, width-truncated row.
- *(tools)* Collapsed turn members that render through the no-native-renderer fallback (extension tools like TaskCreate/TaskUpdate/ask_user_question) were not hidden, leaving stray native placeholder rows after the turn collapse; the batch-member hide contract now applies to the fallback path too.
- *(turn-summary)* Failure marker pluralized "failed" into "faileds" (`· 3 faileds`); now `· 1 failure` / `· 3 failures`. Unknown tools phrase as `used 2 gh` instead of `ran 2 gh calls`.

## [0.1.7] - 2026-08-07

### Features

- *(turn-summary)* Collapse completed agent runs into one dim summary line

## [0.1.6] - 2026-08-06

### Features

- *(compat)* Identity-first certification, support Pi 0.84.0 without version pinning

## [0.1.5] - 2026-08-05

### Bug Fixes

- *(box)* Visible dim terminal-default frame borders (match omp)
- *(box)* Dim terminal-default for tree/divider/gutter lines (match omp)
- *(git,gh)* Dim terminal-default tree branches (match omp)
- *(box)* Rename find tool header label from Glob to Find

### Features

- Rounded dock editor frame with dim hint, zero-trace thinking collapse
- Add titanium dark/light themes ported from omp defaults
- *(box)* State-dynamic tool frame color mirroring omp borders
- Git and gh semantic renderers as bash presentation adapters (Phase 8)
- *(theme)* Auto-apply titanium theme at TUI session start
- *(box)* Render lone read calls as a single inline line
- *(editor,tools)* Bash-mode prompt icon, hidden bang, boxed bash execution

### Miscellaneous Tasks

- Biome format 7 boxed-tool files to pass npm run check
- *(assets)* Refresh demo screenshot

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

