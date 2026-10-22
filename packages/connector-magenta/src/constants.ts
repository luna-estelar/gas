export const MAGENTA_BRIDGE_PROTOCOL = 1;
export const MAGENTA_DEFAULT_ENDPOINT = 'ws://127.0.0.1:8765';
export const MAGENTA_MODEL_ID = 'magenta-realtime-2';

export const PCM_SAMPLE_RATE = 48_000;
export const PCM_CHANNELS = 2;
export const PCM_BYTES_PER_SAMPLE = 2;
export const PCM_BYTES_PER_FRAME = PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * PCM_BYTES_PER_FRAME;

/** Model frames per second; one frame is 40 ms of audio. */
export const MAGENTA_FRAME_RATE = 25;
