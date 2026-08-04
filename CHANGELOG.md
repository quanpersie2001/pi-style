# Changelog

## [Unreleased]

### Bug Fixes

- **Fixed: boxed tool/message surfaces now survive in-app session switches (resume/new/fork).** Pi renders the restored chat (`renderBeforeBind`) *after* `session_shutdown` and *before* the next `session_start`; disposing the Tier C prototype patches at `session_shutdown` left every restored tool box and special-block message box permanently native (their boxed output is cached at `updateDisplay` time and never re-derived). The coordinator now retains the patches across `session_shutdown`; the next `session_start` restores the previous generation's exact native identities and reinstalls before any new chat render. On process exit the terminal is torn down right after, so retained patches are harmless.
- **Fixed: single-line assistant replies lost their `│` prefix.** `prefixNative` excluded the final line from `firstContentIndex` for multiline OSC133 envelopes, but the native assistant render puts a short reply's only body on that final line, so short assistant messages rendered unprefixed. The last line is now eligible as the content start when no earlier line carries content, and the prefix is inserted inside the envelope.

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

