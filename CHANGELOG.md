# Changelog

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

