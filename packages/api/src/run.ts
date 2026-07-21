// Track the accepted renderer run and reject audio or position events from older runs.

export class AcceptedRun {
  private current: string | undefined;

  accept(runId: string): void {
    this.current = runId;
  }

  clear(): void {
    this.current = undefined;
  }

  get id(): string | undefined {
    return this.current;
  }

  accepts(runId: string): boolean {
    return this.current !== undefined && runId === this.current;
  }
}
