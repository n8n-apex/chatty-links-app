export type AudioStatus = 'idle' | 'recording' | 'converting';

export const INCOMPLETE_DICTATION = 'Das Diktat ist nicht vollständig, deshalb wurde nichts gesendet. Bitte erneut versuchen oder den Text prüfen und selbst senden.';

/** A pending send holds intent only; the composer is read at completion. */
export class DictationSend {
  pending = false;
  private ready = false;

  constructor(private events: {
    changed: (pending: boolean) => void;
    send: () => void;
    incomplete: () => void;
  }) {}

  request(status: AudioStatus, stop: () => void) {
    if (this.pending) return;
    if (status === 'idle') {
      this.events.send();
      return;
    }
    this.pending = true;
    this.ready = false;
    this.events.changed(true);
    if (status === 'recording') stop();
  }

  cancel() {
    this.pending = false;
    this.ready = false;
    this.events.changed(false);
  }

  complete(failed: number) {
    if (!this.pending) return;
    if (failed > 0) {
      this.cancel();
      this.events.incomplete();
      return;
    }
    this.ready = true;
  }

  flush(blocked: boolean) {
    if (!this.pending || !this.ready || blocked) return;
    this.cancel();
    this.events.send();
  }
}