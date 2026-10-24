# Security policy

## Supported versions

All GAS packages are pre-1.0. Fixes go into each package's latest minor release, and a fix may
ship alongside breaking changes. The package's changelog says when it does.

## Reporting a vulnerability

Report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/luna-estelar/gas/security/advisories/new),
not in a public issue.

Say what you did, what happened, and which package and version you used. A small reproduction (a
GAS document, a timeline or a short script) helps most. You'll hear back within a week, and valid
reports are credited in the advisory unless you'd rather not be.

## Where to look

- `@luna-estelar/gas/language` parses untrusted text. A document that hangs the compiler, exhausts
  memory or escapes its diagnostics is in scope.
- `@luna-estelar/gas/protocol/validation` validates timelines. A payload that passes validation and
  then breaks something downstream is in scope.
- `@luna-estelar/gas-lyria-rt` holds a Gemini API key and opens network connections. Any way the
  key ends up in a diagnostic, error, log line or prompt is in scope.
- `@luna-estelar/gas/browser` handles credentials and playback in a page.

Compiling a GAS document should be safe: the language has no imports, file access or evaluation.
If compiling one can do anything besides produce a timeline and diagnostics, please report it.
