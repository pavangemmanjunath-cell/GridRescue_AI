// Copies the MediaPipe vision WASM runtime from node_modules into public/mediapipe so the hands-free page works
// offline from the same origin (no CDN). Runs on `npm install` (postinstall) and from START.bat / start.sh.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const dst = join(root, 'public', 'mediapipe')
if (!existsSync(src)) { console.log('mediapipe: @mediapipe/tasks-vision not installed yet — skipped'); process.exit(0) }
mkdirSync(dst, { recursive: true })
cpSync(src, dst, { recursive: true })
console.log('mediapipe: wasm runtime copied to public/mediapipe')
