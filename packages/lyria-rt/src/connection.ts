// One Lyria RealTime connection: one Play. Turns GAS state into model config and
// prompts through the connector's hooks, and decides when the model plays.

import type {
  Connection,
  ConnectorError,
  ConnectorTiming,
  ConnectorUpdate,
  ConnectorWarning,
  EffectiveState,
  MonotonicClock,
  MusicalPosition
} from '@luna-estelar/gas/protocol';
import type { LyriaRtConnectorConfig } from './config.js';
import { connectorError, hostCall, raceAbort } from './errors.js';
import type { WeightedPrompt } from './prompts.js';
import { classifyKey, type LyriaRtScale } from './scale.js';
import type { LyriaRtTransitionFactory, PromptTransition } from './transition.js';
import type { LyriaRtMusicGenerationConfig, LyriaRtSession } from './transport.js';

/** Turns an effective state into weighted prompts. Pure and synchronous. */
export type LyriaRtTranslate = (
  state: EffectiveState,
  config: LyriaRtConnectorConfig
) => readonly WeightedPrompt[];

export type LyriaRtWarningCode =
  'lyria-rt-tempo-clamped' | 'lyria-rt-prompt-filtered' | 'lyria-rt-provider-warning';

export const LYRIA_RT_WARNING_MESSAGE =
  'The Lyria RealTime connector reported an operational warning.';

type ModelContext = { readonly bpm: number; readonly scale?: LyriaRtScale };

export interface LyriaRtConnectionOptions {
  readonly session: LyriaRtSession;
  readonly config: LyriaRtConnectorConfig;
  readonly timing: ConnectorTiming;
  readonly clock: MonotonicClock;
  readonly translate: LyriaRtTranslate;
  readonly transition: LyriaRtTransitionFactory;
  onWarning(warning: ConnectorWarning): void;
  onError(error: ConnectorError): void;
}

function translateFailed(): ConnectorError {
  return connectorError('lyria-rt-translate-failed', 'internal', false);
}

function isWeightedPrompt(value: unknown): value is WeightedPrompt {
  if (value === null || typeof value !== 'object') return false;
  const { text, weight } = value as Record<string, unknown>;
  return (
    typeof text === 'string' &&
    text.trim() !== '' &&
    typeof weight === 'number' &&
    Number.isFinite(weight)
  );
}

export class LyriaRtConnection implements Connection {
  private readonly transition: PromptTransition;
  private readonly warnedTempos = new Set<number>();
  private lastContext: ModelContext | undefined;
  private promptsNonEmpty = false;
  private paused = false;
  private playing = false;
  private starting = true;
  private ended = false;
  /** Rejects with a failure during startup, so `start()` stops waiting. */
  private readonly startupFailure: Promise<never>;
  private failStartup: (error: ConnectorError) => void = () => undefined;

  constructor(private readonly options: LyriaRtConnectionOptions) {
    const { config, clock } = options;
    this.startupFailure = new Promise<never>((_, reject) => {
      this.failStartup = reject;
    });
    this.startupFailure.catch(() => undefined);
    this.transition = options.transition({
      clock,
      transitionDurationMs: config.prompt.transitionDurationMs,
      transitionSteps: config.prompt.transitionSteps,
      sender: {
        send: (prompts) => this.sendPrompts(prompts),
        requestPlay: async () => this.reconcilePlayback(),
        requestPause: async () => this.reconcilePlayback()
      },
      onFailure: (failure) => this.fail(failure)
    });
  }

  /**
   * Sends the model config and the first prompts. Empty prompts send nothing
   * and don't play, so a piece that opens with a rest connects and stays quiet.
   */
  async start(state: EffectiveState, signal: AbortSignal): Promise<void> {
    const step = <T>(promise: Promise<T>): Promise<T> =>
      raceAbort(signal, Promise.race([promise, this.startupFailure]));
    const context = this.modelContext(state);
    await step(this.sendModelConfig(context));
    this.lastContext = context;
    await step(this.transition.update(this.translate(state)));
    this.starting = false;
  }

  async update(update: ConnectorUpdate, requested: MusicalPosition): Promise<MusicalPosition> {
    if (this.ended) throw connectorError('lyria-rt-connection-closed', 'internal', false);
    const context = this.modelContext(update.state);
    const last = this.lastContext;
    if (last === undefined || context.bpm !== last.bpm || context.scale !== last.scale) {
      await this.sendModelConfig(context);
      this.options.session.resetContext();
      this.lastContext = context;
    }
    await this.transition.update(this.translate(update.state));
    return requested;
  }

  async pause(): Promise<void> {
    this.paused = true;
    this.reconcilePlayback();
  }

  async resume(): Promise<void> {
    this.paused = false;
    this.reconcilePlayback();
  }

  close(): Promise<void> {
    this.ended = true;
    this.transition.cancel();
    return this.options.session.close();
  }

  /**
   * Ends the connection after a failure: the transport closed, or a crossfade
   * step failed. Reported once, through `onError` after startup, or as the
   * startup's rejection before it.
   */
  fail(error: ConnectorError): void {
    if (this.ended) return;
    this.ended = true;
    this.transition.cancel();
    void this.options.session.close();
    if (this.starting) this.failStartup(error);
    else hostCall(() => this.options.onError(error));
  }

  private translate(state: EffectiveState): readonly WeightedPrompt[] {
    let prompts: unknown;
    try {
      prompts = this.options.translate(state, this.options.config);
    } catch {
      throw translateFailed();
    }
    if (!Array.isArray(prompts) || !prompts.every(isWeightedPrompt)) throw translateFailed();
    return prompts;
  }

  // `timing.tempo` and a state's tempo both count the meter's beat unit, and
  // Lyria RealTime's `bpm` counts quarter notes, 60-200. Scaling by
  // `quarterNoteTempo / tempo` converts without knowing the meter.
  private modelContext(state: EffectiveState): ModelContext {
    const { timing } = this.options;
    const requestedTempo = state.globals.tempo ?? timing.tempo;
    const quarterTempo = (requestedTempo * timing.quarterNoteTempo) / timing.tempo;
    const bpm = Math.min(200, Math.max(60, Math.round(quarterTempo)));
    // Warn on what is actually out of the model's range, keyed on what the author
    // wrote, so the warning fires once for the tempo they can see and change.
    if ((quarterTempo < 60 || quarterTempo > 200) && !this.warnedTempos.has(requestedTempo)) {
      this.warnedTempos.add(requestedTempo);
      this.warn('lyria-rt-tempo-clamped');
    }
    const key = state.globals.key ?? timing.key;
    if (key === undefined) return { bpm };
    const classification = classifyKey(key);
    return classification.nativeScale === 'none'
      ? { bpm }
      : { bpm, scale: classification.nativeScale };
  }

  private generationConfig(context: ModelContext): LyriaRtMusicGenerationConfig {
    const { generation } = this.options.config;
    return {
      temperature: generation.temperature,
      guidance: generation.guidance,
      topK: generation.topK,
      musicGenerationMode: generation.mode === 'diversity' ? 'DIVERSITY' : 'QUALITY',
      bpm: context.bpm,
      ...(context.scale !== undefined ? { scale: context.scale } : {}),
      ...(generation.muteBass !== undefined ? { muteBass: generation.muteBass } : {}),
      ...(generation.muteDrums !== undefined ? { muteDrums: generation.muteDrums } : {}),
      ...(generation.onlyBassAndDrums !== undefined
        ? { onlyBassAndDrums: generation.onlyBassAndDrums }
        : {}),
      ...(generation.seed !== undefined ? { seed: generation.seed } : {}),
      ...(generation.density !== undefined ? { density: generation.density } : {}),
      ...(generation.brightness !== undefined ? { brightness: generation.brightness } : {})
    };
  }

  private sendModelConfig(context: ModelContext): Promise<void> {
    return this.options.session.setMusicGenerationConfig(this.generationConfig(context));
  }

  private async sendPrompts(prompts: readonly WeightedPrompt[]): Promise<void> {
    // Lyria RealTime refuses an empty prompt set; an empty mixture pauses instead.
    if (prompts.length === 0) {
      this.promptsNonEmpty = false;
      return;
    }
    await this.options.session.setWeightedPrompts(prompts);
    this.promptsNonEmpty = true;
  }

  /** Plays only with prompts to play and no pause from GAS (rule 6). */
  private reconcilePlayback(): void {
    if (this.ended) return;
    const shouldPlay = this.promptsNonEmpty && !this.paused;
    if (shouldPlay === this.playing) return;
    if (shouldPlay) this.options.session.play();
    else this.options.session.pause();
    this.playing = shouldPlay;
  }

  warn(code: LyriaRtWarningCode): void {
    if (this.ended) return;
    hostCall(() => this.options.onWarning({ code, message: LYRIA_RT_WARNING_MESSAGE }));
  }
}
