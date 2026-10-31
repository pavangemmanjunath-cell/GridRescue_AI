import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

/** Screen-sized text label drawn on a canvas sprite (drei <Html> mounted a React root per label and
 *  unmounted it mid-render, which React 19 reports as an error when leaving the page). */
export function Label({ position, color, children }: { position: [number, number, number]; color: string; children: React.ReactNode }) {
  const text = String(children)
  const { tex, aspect } = useMemo(() => {
    const c = document.createElement('canvas'), ctx = c.getContext('2d')!, fs = 44
    ctx.font = `700 ${fs}px "DM Sans", system-ui, sans-serif`
    c.width = Math.ceil(ctx.measureText(text).width + 44); c.height = fs + 26
    ctx.font = `700 ${fs}px "DM Sans", system-ui, sans-serif`
    c.width += 26   // room for the colour dot
    ctx.font = `700 ${fs}px "DM Sans", system-ui, sans-serif`
    // white pill, dark text, coloured dot — the clean "map chip" look
    ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.strokeStyle = 'rgba(15,23,42,0.12)'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.roundRect(2, 2, c.width - 4, c.height - 4, c.height / 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(30, c.height / 2, 11, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#0F172A'; ctx.textBaseline = 'middle'; ctx.fillText(text, 50, c.height / 2 + 2)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    return { tex: t, aspect: c.width / c.height }
  }, [text, color])
  useEffect(() => () => tex.dispose(), [tex])
  const h = 0.024   // screen-relative label height
  return <sprite position={position} scale={[h * aspect, h, 1]} renderOrder={10}><spriteMaterial map={tex} transparent depthTest={false} sizeAttenuation={false} /></sprite>
}
