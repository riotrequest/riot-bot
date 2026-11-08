import type { NoticeBridge, RiotBridge } from '../../shared/types'

declare global {
  interface Window {
    riot?: RiotBridge
    riotNotices?: NoticeBridge
  }
}

export {}
