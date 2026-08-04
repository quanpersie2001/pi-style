# Changelog

## [Unreleased]

### Changed

- Removed the user-message `❯` prefix and its `messages.userPrefix` option entirely. The editor prompt glyph is also `❯`, so prefixing sent user messages made them look identical to the live input box. The `native-user-message` certified surface was removed (user messages render native and are never patched); the `--pi-style-message-user` flag and `messages.userPrefix` config leaf are gone. Assistant prefix is unchanged.

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

