# Changelog

## [0.2.7] - 2026-08-25

### Bug Fixes

- *(compat)* Support Pi 0.84.3 bundled runtime identities

## [0.2.5] - 2026-08-25

### Bug Fixes

- *(messages)* Preserve text in tool-calling messages

## [0.2.3] - 2026-08-22

### Documentation

- *(readme)* Document image features, herdr caveat, absolute demo URL

### Features

- *(status-line)* Pipe-delimited context block with token totals
- *(images)* User-prompt image previews and clipboard image input

## [0.2.2] - 2026-08-17

### Performance

- Fix audit findings C1-C5/H1-H4/M1-M7 across render hot paths

### Testing

- Widen perf-regression timing bounds for CI runners

## [0.2.1] - 2026-08-12

### Performance

- Optimize interactive rendering hot paths

## [0.2.0] - 2026-08-08

### Bug Fixes

- *(turn-summary,box)* Broken frames on collapse/expand, faileds plural, stray placeholder rows

### Features

- *(turn-summary)* Keep mutating tool blocks visible after the turn

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

