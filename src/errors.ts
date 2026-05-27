export class KeepChillError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "KeepChillError";
    this.status = status;
    this.body = body;
  }
}
