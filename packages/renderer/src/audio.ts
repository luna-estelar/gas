export interface AudioAccounting {
  readonly receivedSeconds: number;
  readonly deliveredSeconds: number;
  readonly rejectedSeconds: number;
  readonly heldSeconds: number;
}

export class BufferLedger {
  private received = 0;
  private delivered = 0;
  private rejected = 0;
  private held = 0;

  receive(durationSeconds: number): void {
    assertDuration(durationSeconds);
    this.received += durationSeconds;
    this.held += durationSeconds;
  }

  deliver(durationSeconds: number): void {
    this.moveHeld(durationSeconds, 'delivered');
  }

  reject(durationSeconds: number): void {
    this.moveHeld(durationSeconds, 'rejected');
  }

  snapshot(): AudioAccounting {
    return Object.freeze({
      receivedSeconds: this.received,
      deliveredSeconds: this.delivered,
      rejectedSeconds: this.rejected,
      heldSeconds: this.held
    });
  }

  private moveHeld(durationSeconds: number, destination: 'delivered' | 'rejected'): void {
    assertDuration(durationSeconds);
    if (durationSeconds > this.held + Number.EPSILON) {
      throw new RangeError('Audio accounting cannot consume more than it holds.');
    }
    this.held = Math.max(0, this.held - durationSeconds);
    if (destination === 'delivered') this.delivered += durationSeconds;
    else this.rejected += durationSeconds;
  }
}

export function applyS16leGain(bytes: Uint8Array, gain: number): Uint8Array {
  if (!Number.isFinite(gain)) throw new RangeError('Global gain must be finite.');
  const attenuation = Math.max(0, Math.min(1, gain));
  if (bytes.byteLength % 2 !== 0) {
    throw new RangeError('Signed 16-bit PCM needs an even byte length.');
  }
  const output = new Uint8Array(bytes.byteLength);
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const target = new DataView(output.buffer);
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    const sample = source.getInt16(offset, true);
    const scaled = Math.max(-32_768, Math.min(32_767, Math.round(sample * attenuation)));
    target.setInt16(offset, scaled, true);
  }
  return output;
}

function assertDuration(durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new RangeError('Audio chunk duration must be finite and greater than zero.');
  }
}
