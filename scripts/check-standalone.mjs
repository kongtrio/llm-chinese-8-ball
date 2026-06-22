import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const before = readFileSync('standalone.html', 'utf8')

execFileSync(npm, ['run', 'standalone'], { stdio: 'inherit' })

const after = readFileSync('standalone.html', 'utf8')
if (before !== after) {
  console.error('standalone.html was stale; regenerated file differs from the checked-in copy.')
  process.exit(1)
}
