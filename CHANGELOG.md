# Changelog

## [Unreleased]

### Changed

- Removed the user-message `❯` prefix and its `messages.userPrefix` option entirely. The editor prompt glyph is also `❯`, so prefixing sent user messages made them look identical to the live input box. The `native-user-message` certified surface was removed (user messages render native and are never patched); the `--pi-style-message-user` flag and `messages.userPrefix` config leaf are gone. Assistant prefix is unchanged.
- Boxed tool cards now follow a strict state machine instead of showing the result frame early. While a tool runs, the call renders a single card with a `◌ Running` footer (live elapsed via a 1s re-render ticker) and `No output received yet` instead of a `✓` title, a `Response` divider, `∅ (no output)`, or a frozen `0.00s` footer. Partial output streams into the same open card under an `Output` divider with no `Response` divider until the tool settles; the first partial result renders nothing so the running card is never duplicated. Terminal results show a `Response` divider and a status footer: `Exit 0 · 3.21s · ~45 words`, `Exit 2 · …`, `Terminated after 300.0s` (timeout), or `Cancelled` — with state-specific empty text (`Command completed without producing output`, `No output was received before the timeout`, …) instead of `∅ (no output)`. The elapsed shown on completion is real (elapsed is computed live and only freezes when the result is terminal; it no longer caches at the first render), and the static `timeout 300s` footer part is dropped. Silent commands whose base command is interactive (`pi`, `vim`, `less`, `top`, …) gain a `The process may be waiting for terminal input` hint after ~1s.

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

