---
'@luna-estelar/gas-connector-lyria': minor
'@luna-estelar/gas': minor
---

Add a `stable-identity` prompt strategy. It sends each track's description as its own prompt whose
text never changes while the track plays, and its flavor and timbre as a second prompt at half the
track's weight. A flavor or timbre change then re-steers the part without dropping the instrument
from the mix. The default stays `global-plus-tracks`.
