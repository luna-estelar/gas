---
'@luna-estelar/gas-connector-magenta': minor
'@luna-estelar/gas': minor
---

Add the Magenta RealTime 2 connector. It drives Google's open-weights live music model through a
local Python bridge (shipped in `bridge/`), blends GAS intent into weighted style prompts, and
renders the pitches of `notes` and `motif`, which Lyria cannot. The umbrella exposes it as
`@luna-estelar/gas/magenta`.
