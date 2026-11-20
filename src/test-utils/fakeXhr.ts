/**
 * Minimal XMLHttpRequest stand-in for tests of code that uses
 * api/nativeTimeoutRequest.ts. Each `send()` is recorded; the test drives
 * the outcome with respond() / fail() / timeOut().
 */
export class FakeXhr {
  static sent: FakeXhr[] = [];
  /** Auto-respond to every send with this body (null: leave it pending). */
  static autoRespond: unknown = null;

  static install(): void {
    FakeXhr.sent = [];
    FakeXhr.autoRespond = null;
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  }

  static get last(): FakeXhr | undefined {
    return FakeXhr.sent[FakeXhr.sent.length - 1];
  }

  method = '';
  url = '';
  timeout = 0;
  status = 0;
  responseText = '';
  body: string | null = null;
  aborted = false;
  onload: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(): void {}

  send(body: string | null): void {
    this.body = body;
    FakeXhr.sent.push(this);
    if (FakeXhr.autoRespond !== null) {
      const response = FakeXhr.autoRespond;
      Promise.resolve().then(() => this.respond(response));
    }
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  respond(json: unknown, status = 200): void {
    this.status = status;
    this.responseText = JSON.stringify(json);
    this.onload?.();
  }

  fail(): void {
    this.onerror?.();
  }

  timeOut(): void {
    this.ontimeout?.();
  }

  get jsonBody(): unknown {
    return this.body ? JSON.parse(this.body) : null;
  }
}

export const TTS_OK = { audioContent: 'AAEC' };
