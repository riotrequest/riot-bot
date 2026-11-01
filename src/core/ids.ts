import { randomUUID } from 'crypto'

export const newId = (): string => randomUUID()

export function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{8,80}$/i.test(value)
}
