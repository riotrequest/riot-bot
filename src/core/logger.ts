import { redact as redactText } from './redact'

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

export class RedactingLogger implements Logger {
  constructor(
    private readonly sink: Logger,
    private readonly secrets: () => string[]
  ) {}

  info(message: string, meta?: Record<string, unknown>): void {
    this.sink.info(this.clean(message), this.cleanMeta(meta))
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.sink.error(this.clean(message), this.cleanMeta(meta))
  }

  private clean(message: string): string {
    return redactText(message, this.secrets())
  }

  private cleanMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!meta) return undefined
    return JSON.parse(redactText(JSON.stringify(meta), this.secrets())) as Record<string, unknown>
  }
}

export class MemoryLogger implements Logger {
  lines: string[] = []

  info(message: string, meta?: Record<string, unknown>): void {
    this.lines.push(`info ${message} ${meta ? JSON.stringify(meta) : ''}`)
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.lines.push(`error ${message} ${meta ? JSON.stringify(meta) : ''}`)
  }
}

export const silentLogger: Logger = {
  info() {},
  error() {}
}
