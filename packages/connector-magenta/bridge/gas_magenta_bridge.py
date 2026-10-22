"""Serve Magenta RealTime 2 to GAS over a local WebSocket.

Magenta RealTime 2 (MRT2) runs on the listener's own machine and has no network
interface of its own. This bridge loads a model once, then streams PCM to the
GAS Magenta connector and applies its control messages between chunks.

    python gas_magenta_bridge.py --model mrt2_small

The wire protocol is documented in PROTOCOL.md next to this file. Everything a
client sends is checked here, so a page that reaches the port can steer the
model but cannot make the bridge read files, run code or leave loopback.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import fnmatch
import hmac
import json
import logging
import math
import platform
import sys
import time
from typing import Any, Protocol, Sequence

import numpy as np

PROTOCOL_VERSION = 1
SAMPLE_RATE = 48_000
CHANNELS = 2
FRAME_RATE = 25
SAMPLES_PER_FRAME = SAMPLE_RATE // FRAME_RATE

NUM_PITCHES = 128
MUSICCOCA_LEVELS = 12
# The official MRT2 apps condition on the six coarsest MusicCoCa levels and mask
# the finer six (kMusicCoCaMaskedTailLevels in magentart::core). Following the
# prompt that closely is what they were tuned for.
DEFAULT_MUSICCOCA_KEPT_LEVELS = 6

MAX_MESSAGE_BYTES = 64 * 1024
MAX_PROMPTS = 16
MAX_PROMPT_CHARS = 1_000

DEFAULT_ALLOWED_ORIGINS = (
    'http://localhost',
    'http://localhost:*',
    'http://127.0.0.1',
    'http://127.0.0.1:*',
    'https://localhost',
    'https://localhost:*',
)

# Close codes. The connector classifies the standard ones itself.
CLOSE_POLICY = 1008  # bad hello or token: an auth verdict before ready
CLOSE_PROTOCOL = 1002  # a message that breaks this protocol
CLOSE_INTERNAL = 1011  # the model failed
CLOSE_TOO_BIG = 1009

DRUM_MODES = ('auto', 'on', 'off')

logger = logging.getLogger('gas_magenta_bridge')


# ---------------------------------------------------------------------------
# Engine boundary
# ---------------------------------------------------------------------------


class Engine(Protocol):
  """What the bridge needs from a model: style embeddings and PCM frames."""

  model_name: str

  def embed(self, text: str) -> np.ndarray:
    """A MusicCoCa style embedding for one text prompt."""
    ...

  def tokenize(self, embedding: np.ndarray) -> list[int]:
    """The MusicCoCa tokens for an embedding, all levels."""
    ...

  def generate(
      self,
      conditioning: dict[str, list[int]],
      cfg_scales: dict[str, float],
      temperature: float,
      top_k: int,
      frames: int,
      state: Any,
  ) -> tuple[np.ndarray, Any]:
    """Interleaved int16 stereo samples for `frames` frames, and the next state."""
    ...


class MagentaEngine:
  """Adapts a magenta_rt system (JAX, MLX or exported MLX) to `Engine`."""

  def __init__(self, system: Any, model_name: str):
    self._system = system
    self.model_name = model_name

  def embed(self, text: str) -> np.ndarray:
    return np.asarray(self._system.embed_style(text, use_mapper=True), dtype=np.float32)

  def tokenize(self, embedding: np.ndarray) -> list[int]:
    return [int(token) for token in np.asarray(self._system.tokenize_style(embedding)).tolist()]

  def generate(self, conditioning, cfg_scales, temperature, top_k, frames, state):
    waveform, next_state = self._system.generate(
        conditioning=conditioning,
        cfg_scales=cfg_scales,
        temperature=temperature,
        top_k=top_k,
        frames=frames,
        state=state,
    )
    samples = np.asarray(waveform.samples, dtype=np.float32)
    pcm = np.clip(np.round(samples * 32768.0), -32768, 32767).astype('<i2')
    return pcm, next_state


def load_engine(backend: str, model: str, checkpoint: str | None) -> MagentaEngine:
  """Load a model the way the magenta_rt CLI does, choosing a backend for this machine."""
  if backend == 'auto':
    apple_silicon = sys.platform == 'darwin' and platform.machine() == 'arm64'
    backend = 'mlx' if apple_silicon else 'jax'
  logger.info('Loading %s with the %s backend', model, backend)
  if backend == 'mlx':
    from magenta_rt import MagentaRT2StdMlxfn

    system = MagentaRT2StdMlxfn(size=model)
  elif backend == 'mlx-python':
    from magenta_rt import MagentaRT2Mlx

    system = MagentaRT2Mlx(size=model, checkpoint=checkpoint)
  elif backend == 'jax':
    from magenta_rt import MagentaRT2Jax

    system = MagentaRT2Jax(size=model, checkpoint=checkpoint)
  else:
    raise ValueError(f'Unknown backend {backend!r}')
  return MagentaEngine(system, model)


# ---------------------------------------------------------------------------
# Controls
# ---------------------------------------------------------------------------


class ProtocolViolation(Exception):
  """A client message that this protocol does not allow."""


@dataclasses.dataclass(frozen=True)
class WeightedPrompt:
  text: str
  weight: float


@dataclasses.dataclass(frozen=True)
class Controls:
  prompts: tuple[WeightedPrompt, ...] = ()
  pitches: tuple[int, ...] | None = None
  drums: str = 'auto'
  temperature: float = 1.0
  top_k: int = 100
  style_guidance: float = 3.0
  notes_guidance: float = 5.0


def _number(value: Any, low: float, high: float) -> float:
  if isinstance(value, bool) or not isinstance(value, (int, float)):
    raise ProtocolViolation('number')
  if not math.isfinite(value) or value < low or value > high:
    raise ProtocolViolation('range')
  return float(value)


def _integer(value: Any, low: int, high: int) -> int:
  if isinstance(value, bool) or not isinstance(value, int):
    raise ProtocolViolation('integer')
  if value < low or value > high:
    raise ProtocolViolation('range')
  return value


def parse_controls(message: dict[str, Any]) -> tuple[Controls, bool]:
  """Read a `control` message. Every member is required: controls replace, never merge."""
  allowed = {
      'type', 'prompts', 'pitches', 'drums', 'temperature', 'topK',
      'styleGuidance', 'notesGuidance', 'reset',
  }
  if set(message) - allowed:
    raise ProtocolViolation('unknown member')

  raw_prompts = message.get('prompts')
  if not isinstance(raw_prompts, list) or len(raw_prompts) > MAX_PROMPTS:
    raise ProtocolViolation('prompts')
  prompts = []
  for raw in raw_prompts:
    if not isinstance(raw, dict) or set(raw) != {'text', 'weight'}:
      raise ProtocolViolation('prompt')
    text = raw['text']
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_PROMPT_CHARS:
      raise ProtocolViolation('prompt text')
    prompts.append(WeightedPrompt(text, _number(raw['weight'], 0.0, 1_000.0)))
  if prompts and sum(prompt.weight for prompt in prompts) <= 0:
    raise ProtocolViolation('weights')

  raw_pitches = message.get('pitches')
  pitches = None
  if raw_pitches is not None:
    if not isinstance(raw_pitches, list) or len(raw_pitches) > NUM_PITCHES:
      raise ProtocolViolation('pitches')
    pitches = tuple(sorted({_integer(pitch, 0, NUM_PITCHES - 1) for pitch in raw_pitches}))

  drums = message.get('drums')
  if drums not in DRUM_MODES:
    raise ProtocolViolation('drums')

  reset = message.get('reset', False)
  if not isinstance(reset, bool):
    raise ProtocolViolation('reset')

  controls = Controls(
      prompts=tuple(prompts),
      pitches=pitches,
      drums=drums,
      temperature=_number(message.get('temperature'), 0.0, 4.0),
      top_k=_integer(message.get('topK'), 1, 1024),
      style_guidance=_number(message.get('styleGuidance'), -1.0, 7.0),
      notes_guidance=_number(message.get('notesGuidance'), -1.0, 7.0),
  )
  return controls, reset


class StyleBlender:
  """Weighted MusicCoCa blends, as the official engine forms them, with a text cache."""

  def __init__(self, engine: Engine, kept_levels: int):
    self._engine = engine
    self._kept_levels = kept_levels
    self._embeddings: dict[str, np.ndarray] = {}

  def embedding(self, text: str) -> np.ndarray:
    cached = self._embeddings.get(text)
    if cached is None:
      if len(self._embeddings) >= 256:
        self._embeddings.clear()
      cached = self._engine.embed(text)
      self._embeddings[text] = cached
    return cached

  def tokens(self, prompts: Sequence[WeightedPrompt]) -> list[int]:
    total = sum(prompt.weight for prompt in prompts)
    blend = sum(
        (prompt.weight / total) * self.embedding(prompt.text) for prompt in prompts
    )
    tokens = self._engine.tokenize(np.asarray(blend, dtype=np.float32))[:MUSICCOCA_LEVELS]
    tokens += [-1] * (MUSICCOCA_LEVELS - len(tokens))
    return tokens[: self._kept_levels] + [-1] * (MUSICCOCA_LEVELS - self._kept_levels)


def pianoroll(pitches: tuple[int, ...] | None) -> list[int]:
  """Notes conditioning: chosen pitches free to sound (3), everything else masked (-1).

  This is the engine's default auto-strum: GAS gives the pitches and the model
  places the onsets. With no pitches the whole roll is masked and the model
  chooses its own harmony.
  """
  roll = [-1] * NUM_PITCHES
  for pitch in pitches or ():
    roll[pitch] = 3
  return roll


def drum_token(mode: str) -> list[int]:
  return {'auto': [-1], 'on': [1], 'off': [0]}[mode]


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class BridgeOptions:
  chunk_frames: int = 10
  musiccoca_kept_levels: int = DEFAULT_MUSICCOCA_KEPT_LEVELS
  token: str | None = None
  allowed_origins: tuple[str, ...] = DEFAULT_ALLOWED_ORIGINS


def origin_allowed(origin: str | None, allowed: Sequence[str]) -> bool:
  """No Origin header means a non-browser client; a browser must be on the list."""
  if origin is None:
    return True
  return any(fnmatch.fnmatchcase(origin, pattern) for pattern in allowed)


class Session:
  """One client. Generation runs on a worker thread so control stays responsive."""

  def __init__(self, websocket: Any, engine: Engine, model_lock: asyncio.Lock,
               options: BridgeOptions):
    self._ws = websocket
    self._engine = engine
    self._model_lock = model_lock
    self._options = options
    self._blender = StyleBlender(engine, options.musiccoca_kept_levels)
    self._controls: Controls | None = None
    self._style: list[int] | None = None
    self._state: Any = None
    # Bumped by a reset, so a chunk already in flight cannot restore old context.
    self._context_epoch = 0
    self._playing = False
    self._wake = asyncio.Event()
    self._warned_slow = False

  async def run(self) -> None:
    try:
      await self._handshake()
    except ProtocolViolation:
      await self._ws.close(CLOSE_POLICY, 'hello rejected')
      return
    generator = asyncio.create_task(self._generate_forever())
    try:
      async for raw in self._ws:
        try:
          await self._handle(raw)
        except ProtocolViolation:
          await self._ws.close(CLOSE_PROTOCOL, 'protocol violation')
          return
    finally:
      generator.cancel()
      try:
        await generator
      except asyncio.CancelledError:
        pass
      except Exception:  # noqa: BLE001 - already reported as an error frame
        pass

  async def _handshake(self) -> None:
    raw = await asyncio.wait_for(self._ws.recv(), timeout=10)
    message = _decode(raw)
    if message.get('type') != 'hello' or message.get('protocol') != PROTOCOL_VERSION:
      raise ProtocolViolation('hello')
    if set(message) - {'type', 'protocol', 'token'}:
      raise ProtocolViolation('hello members')
    expected = self._options.token
    supplied = message.get('token')
    if expected is not None and (
        not isinstance(supplied, str)
        or not hmac.compare_digest(supplied.encode(), expected.encode())
    ):
      raise ProtocolViolation('token')
    await self._ws.send(json.dumps({
        'type': 'ready',
        'protocol': PROTOCOL_VERSION,
        'model': self._engine.model_name,
        'sampleRate': SAMPLE_RATE,
        'channels': CHANNELS,
        'frameRate': FRAME_RATE,
        'chunkFrames': self._options.chunk_frames,
    }))

  async def _handle(self, raw: Any) -> None:
    message = _decode(raw)
    kind = message.get('type')
    if kind == 'control':
      controls, reset = parse_controls(message)
      if reset:
        self._state = None
        self._context_epoch += 1
      if self._controls is None or controls.prompts != self._controls.prompts:
        self._style = (
            await asyncio.to_thread(self._blender.tokens, controls.prompts)
            if controls.prompts else None
        )
      self._controls = controls
      self._wake.set()
    elif kind in ('play', 'pause'):
      if set(message) != {'type'}:
        raise ProtocolViolation('members')
      self._playing = kind == 'play'
      self._wake.set()
    else:
      raise ProtocolViolation('type')

  def _ready_to_generate(self) -> bool:
    return self._playing and self._controls is not None and self._style is not None

  async def _generate_forever(self) -> None:
    chunk_seconds = self._options.chunk_frames / FRAME_RATE
    while True:
      if not self._ready_to_generate():
        self._wake.clear()
        await self._wake.wait()
        continue
      controls = self._controls
      style = self._style
      assert controls is not None and style is not None
      conditioning = {
          'mulan_tokens_25hz': style,
          'pianoroll_with_onsets_tokens': pianoroll(controls.pitches),
          'drum_pianoroll_tokens': drum_token(controls.drums),
      }
      cfg_scales = {
          'musiccoca': controls.style_guidance,
          'notes': controls.notes_guidance,
          'drums': 1.0,
      }
      epoch = self._context_epoch
      started = time.monotonic()
      try:
        async with self._model_lock:
          pcm, state = await asyncio.to_thread(
              self._engine.generate, conditioning, cfg_scales, controls.temperature,
              controls.top_k, self._options.chunk_frames, self._state,
          )
      except Exception:  # noqa: BLE001 - the client gets a fixed code, the log gets detail
        logger.exception('Generation failed')
        await self._send_quietly(json.dumps({'type': 'error', 'code': 'generation-failed'}))
        await self._ws.close(CLOSE_INTERNAL, 'generation failed')
        raise
      if epoch == self._context_epoch:
        self._state = state
      elapsed = time.monotonic() - started
      if elapsed > chunk_seconds and not self._warned_slow:
        self._warned_slow = True
        await self._send_quietly(json.dumps({'type': 'warning', 'code': 'behind-real-time'}))
      await self._send_quietly(np.ascontiguousarray(pcm, dtype='<i2').tobytes())

  async def _send_quietly(self, payload: str | bytes) -> None:
    try:
      await self._ws.send(payload)
    except Exception:  # noqa: BLE001 - a closed socket ends the session in run()
      pass


def _decode(raw: Any) -> dict[str, Any]:
  if not isinstance(raw, str):
    raise ProtocolViolation('binary')
  try:
    message = json.loads(raw)
  except ValueError as error:
    raise ProtocolViolation('json') from error
  if not isinstance(message, dict):
    raise ProtocolViolation('object')
  return message


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------


async def serve(engine: Engine, host: str, port: int, options: BridgeOptions,
                ready: asyncio.Future | None = None) -> None:
  from websockets.asyncio.server import serve as ws_serve
  from websockets.http11 import Response
  from websockets.datastructures import Headers

  model_lock = asyncio.Lock()

  def check_origin(connection: Any, request: Any) -> Any:
    origin = request.headers.get('Origin')
    if origin_allowed(origin, options.allowed_origins):
      return None
    return Response(403, 'Forbidden', Headers(), b'Origin not allowed\n')

  async def handler(websocket: Any) -> None:
    await Session(websocket, engine, model_lock, options).run()

  async with ws_serve(handler, host, port, process_request=check_origin,
                      max_size=MAX_MESSAGE_BYTES, compression=None) as server:
    bound = server.sockets[0].getsockname()
    logger.info('GAS Magenta bridge listening on ws://%s:%d', bound[0], bound[1])
    if ready is not None:
      ready.set_result(bound[1])
    await asyncio.Future()


def main(argv: Sequence[str] | None = None) -> None:
  parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
  parser.add_argument('--model', default='mrt2_small',
                      help="Model name, e.g. 'mrt2_small' or 'mrt2_base'.")
  parser.add_argument('--backend', default='auto',
                      choices=['auto', 'mlx', 'mlx-python', 'jax'],
                      help='auto picks exported MLX on Apple Silicon and JAX elsewhere.')
  parser.add_argument('--checkpoint', default=None,
                      help='Checkpoint file for the jax and mlx-python backends.')
  parser.add_argument('--host', default='127.0.0.1',
                      help='Interface to listen on. Keep it on loopback.')
  parser.add_argument('--port', type=int, default=8765)
  parser.add_argument('--chunk-frames', type=int, default=10,
                      help='Frames per audio message; 25 frames is one second.')
  parser.add_argument('--musiccoca-levels', type=int, default=DEFAULT_MUSICCOCA_KEPT_LEVELS,
                      help='Coarse MusicCoCa levels to condition on (1-12).')
  parser.add_argument('--allow-origin', action='append', default=None,
                      help='A browser origin allowed to connect (glob). Repeatable.')
  parser.add_argument('--token-env', default=None,
                      help='Name of an environment variable holding a shared token.')
  args = parser.parse_args(argv)

  if not 1 <= args.chunk_frames <= 250:
    parser.error('--chunk-frames must be between 1 and 250')
  if not 1 <= args.musiccoca_levels <= MUSICCOCA_LEVELS:
    parser.error('--musiccoca-levels must be between 1 and 12')

  token = None
  if args.token_env is not None:
    import os

    token = os.environ.get(args.token_env)
    if not token:
      parser.error(f'{args.token_env} is not set')

  logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
  options = BridgeOptions(
      chunk_frames=args.chunk_frames,
      musiccoca_kept_levels=args.musiccoca_levels,
      token=token,
      allowed_origins=tuple(args.allow_origin or DEFAULT_ALLOWED_ORIGINS),
  )
  engine = load_engine(args.backend, args.model, args.checkpoint)
  try:
    asyncio.run(serve(engine, args.host, args.port, options))
  except KeyboardInterrupt:
    pass


if __name__ == '__main__':
  main()
