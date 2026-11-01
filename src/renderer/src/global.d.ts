import type { RiotBridge } from '../../shared/types'

declare global {
  interface Window {
    riot?: RiotBridge
  }
}

export {}
