interface MicrophonePort {
  setEnabled: (enabled: boolean) => Promise<unknown>;
  silence: () => void;
  stop: () => void;
  changed: (enabled: boolean, available: boolean) => void;
}

/** Serializes local mic intent across asynchronous device/publication operations. */
export class MicrophoneController {
  private desired = false;
  private disposed = false;
  private available = true;
  private queue = Promise.resolve();

  constructor(private readonly port: MicrophonePort) {}

  // Re-read after asynchronous device operations; disposal can happen while awaiting.
  private isDisposed(): boolean {
    return this.disposed;
  }

  setEnabled(enabled: boolean): Promise<void> {
    if (this.isDisposed()) return Promise.resolve();
    this.desired = enabled;
    if (!enabled) {
      this.port.silence();
      this.port.changed(false, this.available);
    }
    this.queue = this.queue.then(async () => {
      if (this.isDisposed()) return;
      // Never skip a queued mute: direct silencing must reach the SDK's mute
      // state before a later unmute (which may otherwise be an SDK no-op).
      const requested = enabled && this.desired;
      try {
        await this.port.setEnabled(requested);
        if (requested) this.available = true;
        if (this.isDisposed()) {
          this.port.stop();
          await this.port.setEnabled(false);
        } else if (!this.desired) {
          // A mute may have arrived while an enable was waiting for permission.
          this.port.silence();
          if (requested) await this.port.setEnabled(false);
          if (!this.isDisposed()) this.port.changed(false, this.available);
        } else if (requested) this.port.changed(true, true);
      } catch {
        this.port.stop();
        if (!this.isDisposed()) {
          this.desired = false;
          this.available = false;
          this.port.changed(false, false);
        }
      }
    });
    return this.queue;
  }

  dispose(): void {
    this.disposed = true;
    this.desired = false;
    this.port.stop();
  }
}
