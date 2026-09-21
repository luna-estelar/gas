# Security policy

## Supported versions

GAS is at `0.1.0`. Security fixes land on the latest minor release; there are no
maintained older lines yet. Before 1.0, security fixes may accompany other breaking
changes in a minor release and will be identified in the changelog.

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/luna-estelar/gas/security/advisories/new)
rather than opening a public issue.

Include what you did, what happened, and which package and version you were on. A minimal
reproduction — a GAS document, a timeline, or a short script — helps more than anything
else.

Expect an acknowledgement within a week. If a report turns out to be valid, you will be
credited in the advisory unless you prefer otherwise.

## Scope

Most of GAS is deterministic computation over plain values: parsing text, deriving state,
encoding MIDI. The parts worth looking hardest at are:

- **`@luna-estelar/gas-language`** parses untrusted text. A document that hangs the
  compiler, exhausts memory, or escapes its diagnostics is in scope.
- **`@luna-estelar/gas-protocol`** validates timelines against JSON Schema. A payload that
  passes validation and then breaks an invariant downstream is in scope.
- **`@luna-estelar/gas-connector-lyria`** is the only package that takes credentials and
  opens a network connection. Anything that leaks an API key — into a diagnostic, an
  error message, a log line, or a prompt — is in scope and is the thing to look for first.
- **`@luna-estelar/gas-browser`** composes credentials and playback in a page.

A GAS document is _input_, not a sandbox boundary: it has no imports, no file access and
no evaluation, and compiling one is expected to be safe. If you find a way to make
compiling a document do anything beyond producing a timeline and diagnostics, that is
exactly the kind of report wanted here.
