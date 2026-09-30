---
'@luna-estelar/gas-browser': minor
---

`Access` is now `{ credentials, endpoint? }` rather than a choice between a BYOK mode and a hosted
mode. The connector no longer has a keyless hosted path — a key is always what it needs, and an
endpoint only says where to send it — so the two modes collapsed into one. How a site obtains the
key is the site's own business: one it asks the person for and one it fetches from its own endpoint
arrive here the same way.
