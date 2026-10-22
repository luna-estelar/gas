"""Bridge tests against a fake engine. Run with `python -m pytest` in this directory."""

import asyncio
import json

import numpy as np
import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

import gas_magenta_bridge as bridge

CONTROL = {
    'type': 'control',
    'prompts': [{'text': 'soft felt piano', 'weight': 1.0}],
    'pitches': None,
    'drums': 'auto',
    'temperature': 1.0,
    'topK': 100,
    'styleGuidance': 3.0,
    'notesGuidance': 5.0,
}


class FakeEngine:
  model_name = 'fake'

  def __init__(self):
    self.embedded = []
    self.calls = []

  def embed(self, text):
    self.embedded.append(text)
    vector = np.zeros(4, dtype=np.float32)
    vector[len(text) % 4] = 1.0
    return vector

  def tokenize(self, embedding):
    return [int(round(value * 100)) for value in embedding] + list(range(8))

  def generate(self, conditioning, cfg_scales, temperature, top_k, frames, state):
    self.calls.append({
        'conditioning': conditioning,
        'cfg_scales': cfg_scales,
        'temperature': temperature,
        'top_k': top_k,
        'frames': frames,
        'state': state,
    })
    samples = np.full((frames * bridge.SAMPLES_PER_FRAME, 2), 7, dtype=np.int16)
    return samples, (state or 0) + 1


async def start(engine, **options):
  loop = asyncio.get_running_loop()
  ready = loop.create_future()
  task = asyncio.create_task(
      bridge.serve(engine, '127.0.0.1', 0, bridge.BridgeOptions(**options), ready)
  )
  port = await ready
  return task, f'ws://127.0.0.1:{port}'


async def stop(task):
  task.cancel()
  with pytest.raises(asyncio.CancelledError):
    await task


async def hello(ws, **extra):
  await ws.send(json.dumps({'type': 'hello', 'protocol': 1, **extra}))
  return json.loads(await ws.recv())


@pytest.mark.asyncio
async def test_handshake_reports_the_stream_format():
  task, url = await start(FakeEngine(), chunk_frames=5)
  try:
    async with connect(url) as ws:
      assert await hello(ws) == {
          'type': 'ready', 'protocol': 1, 'model': 'fake', 'sampleRate': 48000,
          'channels': 2, 'frameRate': 25, 'chunkFrames': 5,
      }
  finally:
    await stop(task)


@pytest.mark.asyncio
async def test_streams_pcm_only_while_playing_with_prompts():
  engine = FakeEngine()
  task, url = await start(engine, chunk_frames=5)
  try:
    async with connect(url) as ws:
      await hello(ws)
      await ws.send(json.dumps({'type': 'play'}))
      with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(ws.recv(), timeout=0.2)
      await ws.send(json.dumps(CONTROL))
      chunk = await asyncio.wait_for(ws.recv(), timeout=2)
      assert isinstance(chunk, bytes)
      assert len(chunk) == 5 * bridge.SAMPLES_PER_FRAME * 2 * 2
      assert np.frombuffer(chunk, dtype='<i2')[0] == 7
      await ws.send(json.dumps({'type': 'pause'}))
  finally:
    await stop(task)
  call = engine.calls[0]
  assert call['frames'] == 5
  assert call['temperature'] == 1.0 and call['top_k'] == 100
  assert call['cfg_scales'] == {'musiccoca': 3.0, 'notes': 5.0, 'drums': 1.0}
  assert call['conditioning']['pianoroll_with_onsets_tokens'] == [-1] * 128
  assert call['conditioning']['drum_pianoroll_tokens'] == [-1]


@pytest.mark.asyncio
async def test_keeps_the_coarse_style_levels_and_masks_the_tail():
  engine = FakeEngine()
  task, url = await start(engine, chunk_frames=1, musiccoca_kept_levels=6)
  try:
    async with connect(url) as ws:
      await hello(ws)
      await ws.send(json.dumps(CONTROL))
      await ws.send(json.dumps({'type': 'play'}))
      await asyncio.wait_for(ws.recv(), timeout=2)
  finally:
    await stop(task)
  style = engine.calls[0]['conditioning']['mulan_tokens_25hz']
  assert len(style) == 12
  assert style[6:] == [-1] * 6
  assert style[:6] != [-1] * 6


def test_blends_prompts_by_normalized_weight():
  engine = FakeEngine()
  blender = bridge.StyleBlender(engine, 12)
  one = bridge.WeightedPrompt('abcd', 3.0)  # len 4 -> slot 0
  two = bridge.WeightedPrompt('abcde', 1.0)  # len 5 -> slot 1
  assert blender.tokens([one, two])[:4] == [75, 25, 0, 0]
  blender.tokens([one, two])
  assert engine.embedded == ['abcd', 'abcde']


def test_pianoroll_marks_chosen_pitches_free_and_masks_the_rest():
  roll = bridge.pianoroll((60, 64, 67))
  assert [roll[p] for p in (60, 64, 67)] == [3, 3, 3]
  assert roll.count(-1) == 125
  assert bridge.drum_token('off') == [0] and bridge.drum_token('on') == [1]


@pytest.mark.asyncio
async def test_controls_apply_at_the_next_chunk_and_reset_clears_state():
  engine = FakeEngine()
  task, url = await start(engine, chunk_frames=1)
  try:
    async with connect(url) as ws:
      await hello(ws)
      await ws.send(json.dumps(CONTROL))
      await ws.send(json.dumps({'type': 'play'}))
      await asyncio.wait_for(ws.recv(), timeout=2)
      await ws.send(json.dumps({
          **CONTROL, 'pitches': [64, 60, 60], 'drums': 'off', 'reset': True,
      }))
      for _ in range(50):
        await asyncio.wait_for(ws.recv(), timeout=2)
        last = engine.calls[-1]
        if last['conditioning']['drum_pianoroll_tokens'] == [0]:
          break
      await ws.send(json.dumps({'type': 'pause'}))
  finally:
    await stop(task)
  roll = last['conditioning']['pianoroll_with_onsets_tokens']
  assert roll[60] == 3 and roll[64] == 3
  assert any(call['state'] is None for call in engine.calls[1:])


@pytest.mark.asyncio
async def test_a_wrong_token_closes_with_policy_violation():
  task, url = await start(FakeEngine(), token='secret')
  try:
    async with connect(url) as ws:
      await ws.send(json.dumps({'type': 'hello', 'protocol': 1, 'token': 'wrong'}))
      with pytest.raises(ConnectionClosed) as closed:
        await ws.recv()
      assert closed.value.rcvd.code == 1008
    async with connect(url) as ws:
      assert (await hello(ws, token='secret'))['type'] == 'ready'
  finally:
    await stop(task)


@pytest.mark.asyncio
@pytest.mark.parametrize('message', [
    {**CONTROL, 'extra': 1},
    {**CONTROL, 'temperature': float('nan')},
    {**CONTROL, 'topK': 0},
    {**CONTROL, 'pitches': [128]},
    {**CONTROL, 'drums': 'loud'},
    {**CONTROL, 'prompts': [{'text': ' ', 'weight': 1}]},
    {**CONTROL, 'prompts': [{'text': 'a', 'weight': 0}]},
    {'type': 'seek'},
])
async def test_a_malformed_message_closes_with_protocol_error(message):
  task, url = await start(FakeEngine())
  try:
    async with connect(url) as ws:
      await hello(ws)
      await ws.send(json.dumps(message, allow_nan=True))
      with pytest.raises(ConnectionClosed) as closed:
        await ws.recv()
      assert closed.value.rcvd.code == 1002
  finally:
    await stop(task)


@pytest.mark.asyncio
async def test_browser_origins_must_be_allowed():
  task, url = await start(FakeEngine())
  try:
    with pytest.raises(InvalidStatus) as rejected:
      async with connect(url, origin='https://evil.example'):
        pass
    assert rejected.value.response.status_code == 403
    async with connect(url, origin='http://localhost:4321') as ws:
      assert (await hello(ws))['type'] == 'ready'
  finally:
    await stop(task)


@pytest.mark.asyncio
async def test_a_model_failure_is_reported_with_a_fixed_code():
  class FailingEngine(FakeEngine):
    def generate(self, *args, **kwargs):
      raise RuntimeError('private detail')

  task, url = await start(FailingEngine())
  try:
    async with connect(url) as ws:
      await hello(ws)
      await ws.send(json.dumps(CONTROL))
      await ws.send(json.dumps({'type': 'play'}))
      assert json.loads(await ws.recv()) == {'type': 'error', 'code': 'generation-failed'}
      with pytest.raises(ConnectionClosed) as closed:
        await ws.recv()
      assert closed.value.rcvd.code == 1011
  finally:
    await stop(task)
