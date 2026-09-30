---
'@luna-estelar/gas-cli': patch
'@luna-estelar/gas-highlight': patch
---

Unused direct dependencies removed. The CLI no longer declares Protocol or Core, neither of which
it imported; it still depends on the language package for compilation, so installing it still
brings the parser. The highlight helpers declare their own token types instead of depending on the
language package, so installing them pulls in neither the parser, Langium, nor Chevrotain.
