---
'@luna-estelar/gas-connector-lyria': minor
---

Connector settings are now `{ apiKey, endpoint? }`. How an application obtains a key is the
application's own concern, so the hosted arm of the old settings union leaves with its sentinel key
and its private close-code table. An `endpoint` is any HTTPS origin that speaks the Lyria WebSocket
protocol; it is reduced to its origin and refused if it carries userinfo, a query, a fragment or a
path, so a credential cannot hide in one.

Close-code classification covers the standard codes only, and every failure now carries the raw
number through as `closeCode`. Google closes with 1007 for a malformed key and 1008 for a rejected
one, both before setup completes, so both are authentication failures there and transport noise
afterwards; 1002 and 1011 are provider failures. Everything else, including the application range
4000-4999, is reported as a network failure with the number attached for the host to interpret. One
consequence worth knowing: no close code maps to `reason: 'quota'` any more, so 4429 arrives as a
retryable network failure carrying 4429 rather than as `lyria-quota-exhausted`.

`validateConfig` implements the Protocol's optional connector-owned validation, so the Renderer can
check a configuration edit without compiling a schema. It reports every problem at once rather than
stopping at the first, since which one a caller hears should not depend on the order the members
happen to be in, and names each by JSON Pointer with one of the codes `wrong-type`, `out-of-range`,
`not-allowed` or `unknown-member`.
