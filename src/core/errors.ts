export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppError'
  }
}

export class LimitError extends AppError {
  constructor(message: string) {
    super(message)
    this.name = 'LimitError'
  }
}

export class PauseError extends AppError {
  constructor(message: string) {
    super(message)
    this.name = 'PauseError'
  }
}

export class StopError extends AppError {
  constructor(message: string) {
    super(message)
    this.name = 'StopError'
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export type ProviderErrorKind =
  | 'auth'
  | 'credit'
  | 'context_limit'
  | 'unsupported_tools'
  | 'unsupported_stream'
  | 'unsupported_parameter'
  | 'transient'
  | 'cancelled'
  | 'unknown'

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly status?: number

  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
    this.status = status
  }
}

export class CrashError extends AppError {
  constructor() {
    super('Simulated crash')
    this.name = 'CrashError'
  }
}
