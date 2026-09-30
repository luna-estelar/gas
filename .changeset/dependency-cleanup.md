---
'@luna-estelar/gas-cli': patch
'@luna-estelar/gas-highlight': patch
---

Unused dependencies removed. The CLI no longer depends on Protocol or Core, and the highlight
helpers declare their own token types instead of depending on the language package, so installing
either no longer pulls in the parser, Langium or Chevrotain.
