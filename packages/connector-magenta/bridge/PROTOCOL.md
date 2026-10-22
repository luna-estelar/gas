# Magenta bridge protocol 1

One WebSocket per run. Text frames carry JSON objects; binary frames carry audio.

## Client to bridge

The first message must be `hello`. The bridge answers `ready` or closes with 1008.

```json
{ "type": "hello", "protocol": 1, "token": "optional shared token" }
```

`control` replaces everything the model generates from, at the next chunk boundary. Every member
except `reset` is required.

```json
{
  "type": "control",
  "prompts": [{ "text": "soft felt piano", "weight": 1 }],
  "pitches": [60, 64, 67],
  "drums": "auto",
  "temperature": 1,
  "topK": 100,
  "styleGuidance": 3,
  "notesGuidance": 5,
  "reset": false
}
```

| Member          | Rule                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| `prompts`       | 0-16 objects of `text` (1-1000 characters) and `weight` (0-1000, sum > 0) |
| `pitches`       | `null`, or up to 128 MIDI pitches 0-127; the model places the onsets      |
| `drums`         | `auto`, `on` or `off`                                                     |
| `temperature`   | 0-4                                                                       |
| `topK`          | integer 1-1024                                                            |
| `styleGuidance` | -1 to 7, classifier-free guidance for the prompts                         |
| `notesGuidance` | -1 to 7, classifier-free guidance for the pitches                         |
| `reset`         | optional boolean; `true` drops the model's context before the next chunk  |

The bridge blends prompt embeddings by normalized weight. With no prompts it generates nothing.

`{ "type": "play" }` and `{ "type": "pause" }` start and hold generation. The model keeps its
context across a pause.

## Bridge to client

```json
{
  "type": "ready",
  "protocol": 1,
  "model": "mrt2_small",
  "sampleRate": 48000,
  "channels": 2,
  "frameRate": 25,
  "chunkFrames": 10
}
```

Each binary frame is `chunkFrames × 1920` stereo frames of signed 16-bit little-endian PCM at
48 kHz, interleaved left then right.

`{ "type": "warning", "code": "behind-real-time" }` is sent once, when a chunk took longer to
generate than to play. `{ "type": "error", "code": "generation-failed" }` precedes a 1011 close.

## Close codes

| Code | When                                                  |
| ---- | ----------------------------------------------------- |
| 1008 | `hello` was missing, malformed or had the wrong token |
| 1002 | Any later message broke this protocol                 |
| 1009 | A message was larger than 64 KiB                      |
| 1011 | The model failed                                      |

A browser `Origin` that is not allowed is refused with HTTP 403 before the WebSocket opens.
