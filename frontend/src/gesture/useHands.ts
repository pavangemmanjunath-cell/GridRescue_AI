/**
 * Hands-free input: webcam → MediaPipe GestureRecognizer (a trained hand-landmark + gesture model running as WASM in
 * the browser, no server, no GPU needed) → one stable "intent" per frame for the page to act on.
 *
 * Two ML layers:
 *   1. MediaPipe's own model: 21 landmarks per hand and a gesture class (Open_Palm, Closed_Fist, Pointing_Up,
 *      Thumb_Up, Victory, ILoveYou) with a confidence score.
 *   2. Ours, on top: exponential smoothing of the landmarks, a majority vote over the last N gesture classes so a
 *      single mis-read frame never fires an action, and geometric signals the stock classes do not give — pinch
 *      (thumb–index distance), hand openness (how far the fingers are from the palm) and a two-hand span for zoom.
 *
 * No camera (or permission refused)? `mouseFallback` turns the pointer into the hand: move = point, hold = pinch,
 * wheel = openness, so every page that uses this still works on any laptop.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GestureRecognizer as GR } from '@mediapipe/tasks-vision'

export type Intent = 'none' | 'point' | 'pinch' | 'open' | 'fist' | 'thumbs_up' | 'peace' | 'two_hands'
export interface HandState {
  /** index-finger tip in page coordinates (0–1, mirrored so it follows the user) */
  x: number; y: number
  present: boolean; hands: number
  intent: Intent; confidence: number
  pinch: number          // 0 apart … 1 touching
  openness: number       // 0 fist … 1 flat open hand
  span: number           // two-hand distance (0–1 of frame width)
  roll: number           // hand roll in degrees (index knuckle vs little knuckle)
  raw: string            // MediaPipe's class for the HUD
  fps: number
}

const EMPTY: HandState = { x: 0.5, y: 0.5, present: false, hands: 0, intent: 'none', confidence: 0, pinch: 0, openness: 0.5, span: 0, roll: 0, raw: '—', fps: 0 }
const VOTE = 6          // frames in the majority vote
const EMA = 0.35        // landmark smoothing (higher = snappier)

export const GESTURES: { intent: Intent; label: string; does: string; icon: string }[] = [
  { intent: 'point', label: 'Point', does: 'move the cursor · hover a site, a band or a component to read it', icon: '☝️' },
  { intent: 'pinch', label: 'Pinch', does: 'grab a component and carry it; let go to drop it on a pad', icon: '🤏' },
  { intent: 'open', label: 'Open hand', does: 'hand openness dials a value · fully open explodes the site to look inside', icon: '🖐️' },
  { intent: 'fist', label: 'Fist', does: 'assemble the site again', icon: '✊' },
  { intent: 'thumbs_up', label: 'Thumbs up', does: 'confirm and go to the next step', icon: '👍' },
  { intent: 'peace', label: 'Peace', does: 'back one step', icon: '✌️' },
  { intent: 'two_hands', label: 'Two hands', does: 'apart / together — zoom the site', icon: '🙌' },
]

export function useHands(video: React.RefObject<HTMLVideoElement | null>, enabled: boolean) {
  const [state, setState] = useState<HandState>(EMPTY)
  const [status, setStatus] = useState<'idle' | 'loading' | 'camera' | 'running' | 'no-camera' | 'no-model' | 'mouse'>('idle')
  const recog = useRef<GR | null>(null)
  const raf = useRef(0)
  const sm = useRef({ x: 0.5, y: 0.5, pinch: 0, open: 0.5, span: 0, roll: 0 })
  const votes = useRef<Intent[]>([])
  const frames = useRef({ n: 0, t: performance.now(), fps: 0 })
  const mouse = useRef({ down: false, wheel: 0.5 })
  const manual = useRef(false)   // the user chose the mouse: any loader still running must not change the mode

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    const v = video.current
    const s = v?.srcObject as MediaStream | null
    s?.getTracks().forEach((t) => t.stop())
    if (v) v.srcObject = null
    recog.current?.close(); recog.current = null
  }, [video])

  // ── mouse fallback: the pointer is the hand ──
  useEffect(() => {
    if (status !== 'mouse') return
    const move = (e: PointerEvent) => setState((s) => ({ ...s, present: true, hands: 1, x: e.clientX / innerWidth, y: e.clientY / innerHeight, intent: mouse.current.down ? 'pinch' : 'point', pinch: mouse.current.down ? 1 : 0, openness: mouse.current.wheel, confidence: 1, raw: 'mouse' }))
    const down = () => { mouse.current.down = true }
    const up = () => { mouse.current.down = false }
    const wheel = (e: WheelEvent) => { mouse.current.wheel = Math.max(0, Math.min(1, mouse.current.wheel - e.deltaY / 1200)); setState((s) => ({ ...s, openness: mouse.current.wheel, intent: 'open' })) }
    const key = (e: KeyboardEvent) => {
      const map: Record<string, Intent> = { Enter: 'thumbs_up', Backspace: 'peace', o: 'open', f: 'fist' }
      if (map[e.key]) { setState((s) => ({ ...s, intent: map[e.key], confidence: 1, openness: e.key === 'o' ? 1 : e.key === 'f' ? 0 : s.openness })); setTimeout(() => setState((s) => ({ ...s, intent: 'point' })), 400) }
    }
    addEventListener('pointermove', move); addEventListener('pointerdown', down); addEventListener('pointerup', up); addEventListener('wheel', wheel); addEventListener('keydown', key)
    return () => { removeEventListener('pointermove', move); removeEventListener('pointerdown', down); removeEventListener('pointerup', up); removeEventListener('wheel', wheel); removeEventListener('keydown', key) }
  }, [status])

  useEffect(() => {
    if (!enabled) { stop(); setStatus('idle'); setState(EMPTY); return }
    manual.current = false
    let cancelled = false
    const gone = () => cancelled || manual.current
    ;(async () => {
      setStatus('loading')
      let GestureRecognizer: typeof GR, FilesetResolver: any
      try {
        ;({ GestureRecognizer, FilesetResolver } = await import('@mediapipe/tasks-vision'))
        const head = await fetch('/models/gesture_recognizer.task', { method: 'HEAD' })
        if (!head.ok) throw new Error('model missing')
        const files = await FilesetResolver.forVisionTasks('/mediapipe')
        recog.current = await GestureRecognizer.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/models/gesture_recognizer.task', delegate: 'GPU' },
          runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
        })
      } catch { if (!gone()) setStatus('no-model'); return }
      if (gone()) return
      setStatus('camera')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 540, facingMode: 'user' }, audio: false })
        const v = video.current!
        v.srcObject = stream
        await v.play()
      } catch { if (!gone()) setStatus('no-camera'); return }
      if (gone()) return
      setStatus('running')
      let last = -1
      const loop = () => {
        const v = video.current, r = recog.current
        if (!v || !r) return
        if (v.currentTime !== last && v.videoWidth > 0) {
          last = v.currentTime
          const res = r.recognizeForVideo(v, performance.now())
          const f = frames.current; f.n++
          if (performance.now() - f.t > 1000) { f.fps = f.n; f.n = 0; f.t = performance.now() }
          const lms = res.landmarks
          if (!lms.length) { votes.current = []; setState((s) => ({ ...s, present: false, hands: 0, intent: 'none', confidence: 0, raw: '—', fps: f.fps })) }
          else {
            const h = lms[0]
            const d = (a: number, b: number) => Math.hypot(h[a].x - h[b].x, h[a].y - h[b].y)
            const size = Math.max(d(0, 9), 0.02)                                  // wrist → middle knuckle = hand scale
            const pinchRaw = 1 - Math.min(1, d(4, 8) / (size * 0.9))
            const tips = [8, 12, 16, 20].map((t) => d(0, t) / size)               // fingertip distance from the wrist
            const openRaw = Math.max(0, Math.min(1, (tips.reduce((a, b) => a + b, 0) / 4 - 1.1) / 0.9))
            const rollRaw = (Math.atan2(h[17].y - h[5].y, h[17].x - h[5].x) * 180) / Math.PI
            const span = lms.length > 1 ? Math.hypot(lms[1][9].x - h[9].x, lms[1][9].y - h[9].y) : 0
            const s = sm.current
            s.x += ((1 - h[8].x) - s.x) * EMA; s.y += (h[8].y - s.y) * EMA
            s.pinch += (pinchRaw - s.pinch) * EMA; s.open += (openRaw - s.open) * EMA; s.span += (span - s.span) * EMA; s.roll += (rollRaw - s.roll) * EMA
            const cls = res.gestures[0]?.[0]
            const raw = cls?.categoryName ?? 'None'
            const conf = cls?.score ?? 0
            // our intent: geometry first (pinch beats everything), then the model's class
            const intent: Intent = lms.length > 1 ? 'two_hands' : s.pinch > 0.72 ? 'pinch'
              : raw === 'Thumb_Up' && conf > 0.6 ? 'thumbs_up' : raw === 'Victory' && conf > 0.6 ? 'peace'
              : raw === 'Closed_Fist' && conf > 0.5 ? 'fist' : raw === 'Open_Palm' && conf > 0.5 ? 'open' : s.open < 0.18 ? 'fist' : 'point'
            const vs = votes.current; vs.push(intent); if (vs.length > VOTE) vs.shift()
            const tally = vs.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<Intent, number>())
            const [voted, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
            setState({ x: s.x, y: s.y, present: true, hands: lms.length, intent: voted, confidence: n / vs.length, pinch: s.pinch, openness: s.open, span: s.span, roll: s.roll, raw: `${raw} ${(conf * 100).toFixed(0)}%`, fps: f.fps })
          }
        }
        raf.current = requestAnimationFrame(loop)
      }
      raf.current = requestAnimationFrame(loop)
    })()
    return () => { cancelled = true; stop() }
  }, [enabled, video, stop])

  const useMouse = useCallback(() => { manual.current = true; stop(); setStatus('mouse'); setState({ ...EMPTY, present: true, hands: 1, intent: 'point', raw: 'mouse' }) }, [stop])
  return { hand: state, status, useMouse }
}

/** Fires `fn` once each time the intent becomes `want` and holds for `holdMs` (so a confirm needs a steady thumbs-up). */
export function useHold(hand: HandState, want: Intent, fn: () => void, holdMs = 450) {
  const since = useRef<number | null>(null)
  const fired = useRef(false)
  const cb = useRef(fn); cb.current = fn
  useEffect(() => {
    if (hand.intent !== want || hand.confidence < 0.6) { since.current = null; fired.current = false; return }
    if (since.current == null) since.current = performance.now()
    const t = setTimeout(() => { if (!fired.current && since.current != null && performance.now() - since.current >= holdMs - 20) { fired.current = true; cb.current() } }, holdMs)
    return () => clearTimeout(t)
  }, [hand.intent, hand.confidence, want, holdMs])
  const progress = hand.intent === want && since.current != null ? Math.min(1, (performance.now() - since.current) / holdMs) : 0
  return progress
}
