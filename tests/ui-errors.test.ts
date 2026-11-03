import { expect, it } from 'vitest'
import { messageOf } from '../src/renderer/src/ui'

it('keeps actionable error text while removing Electron’s internal IPC wrapper', () => {
  expect(messageOf(new Error("Error invoking remote method 'settings:update': Error: Choose a working folder first."))).toBe('Choose a working folder first.')
  expect(messageOf(new Error('Error invoking remote method "credentials:set": The key was rejected.'))).toBe('The key was rejected.')
  expect(messageOf(new Error('Access denied: C:\\Projects\\report.txt'))).toBe('Access denied: C:\\Projects\\report.txt')
  expect(messageOf(null, 'Could not show this file.')).toBe('Could not show this file.')
})
