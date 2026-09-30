export const LYRIA_MODEL_ID = 'models/lyria-realtime-exp';
export const LYRIA_API_VERSION = 'v1alpha';
export const LYRIA_PATH =
  '/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic';
export const LYRIA_SDK_PATH = `/${LYRIA_PATH}`;

export const PCM_SAMPLE_RATE = 48_000;
export const PCM_CHANNELS = 2;
export const PCM_BYTES_PER_SAMPLE = 2;
export const PCM_BYTES_PER_FRAME = PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * PCM_BYTES_PER_FRAME;
