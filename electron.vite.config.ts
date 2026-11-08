import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname,'src/main/index.ts'), 'browser-installer': resolve(__dirname,'src/main/browser-installer.ts') },
        external: ['electron', 'node:sqlite']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          notices: resolve(__dirname, 'src/preload/notices.ts')
        },
        external: ['electron']
      }
    }
  },
  renderer: {
    plugins: [react()]
  }
})
