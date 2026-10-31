import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SimFrame } from './SiteScene'

type FrameRef = React.MutableRefObject<SimFrame>
const Z = 17           // OSM zoom: one tile ≈ 300 m in Nigeria
const SIZE = 96        // scene units covered by the 3 × 3 tiles (≈ 10 m per unit)

/** The real street map of the site (3 × 3 OpenStreetMap tiles) laid under the scene, centred on the pin. */
export function SiteMap({ lat, lng }: { lat: number; lng: number }) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null)
  const { tx, ty, fx, fy } = useMemo(() => {
    const n = 2 ** Z, r = (lat * Math.PI) / 180
    const x = ((lng + 180) / 360) * n, y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
    return { tx: Math.floor(x), ty: Math.floor(y), fx: x - Math.floor(x), fy: y - Math.floor(y) }
  }, [lat, lng])
  useEffect(() => {
    let alive = true
    const c = document.createElement('canvas'); c.width = c.height = 768
    const ctx = c.getContext('2d')!
    const jobs: Promise<void>[] = []
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      jobs.push(new Promise((res) => {
        const img = new Image(); img.crossOrigin = 'anonymous'
        img.onload = () => { ctx.drawImage(img, (dx + 1) * 256, (dy + 1) * 256); res() }
        img.onerror = () => res()
        img.src = `https://tile.openstreetmap.org/${Z}/${tx + dx}/${ty + dy}.png`
      }))
    }
    Promise.all(jobs).then(() => {
      if (!alive) return
      ctx.fillStyle = 'rgba(255,255,255,0.42)'; ctx.fillRect(0, 0, 768, 768)   // wash the map out to a soft pastel so the equipment stands out
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
      setTex(t)
    })
    return () => { alive = false }
  }, [tx, ty])
  useEffect(() => () => tex?.dispose(), [tex])
  if (!tex) return null
  // shift the plane so the exact pin (not the tile corner) sits under the hospital
  const ox = (0.5 - (fx + 1) / 3) * SIZE, oz = (0.5 - (fy + 1) / 3) * SIZE
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ox, 0.001, oz]} receiveShadow><planeGeometry args={[SIZE, SIZE]} /><meshStandardMaterial map={tex} roughness={1} /></mesh>
}

/** Patients, staff and visitors walking near the entrance — they keep moving because the power stays on. */
export function People({ frameRef }: { frameRef: FrameRef }) {
  const COLORS = ['#F3F6FB', '#2EC4B6', '#F3F6FB', '#4F8EF7', '#E9C46A', '#2EC4B6', '#E76F51', '#F3F6FB', '#9B5DE5', '#2EC4B6', '#F4A261', '#F3F6FB']
  const people = useMemo(() => COLORS.map((c, i) => ({ c, r: 3.2 + (i % 4) * 0.9, speed: 0.12 + (i % 5) * 0.035, phase: i * 0.53, dir: i % 2 ? 1 : -1 })), []) // eslint-disable-line react-hooks/exhaustive-deps
  const refs = useRef<(THREE.Group | null)[]>([])
  useFrame(({ clock }) => {
    const slow = frameRef.current.unserved_critical_kw > 0.5 ? 0.3 : 1
    people.forEach((p, i) => {
      const g = refs.current[i]; if (!g) return
      const a = p.phase + clock.elapsedTime * p.speed * p.dir * slow
      g.position.set(Math.cos(a) * p.r * 1.25, Math.abs(Math.sin(clock.elapsedTime * 6 + i)) * 0.04, 4.6 + Math.sin(a) * p.r * 0.45)
      g.rotation.y = -a * p.dir + (p.dir > 0 ? Math.PI : 0)
    })
  })
  return (
    <group>
      {people.map((p, i) => (
        <group key={i} ref={(g) => { refs.current[i] = g }}>
          <mesh position={[0, 0.32, 0]} castShadow><capsuleGeometry args={[0.11, 0.36, 4, 8]} /><meshStandardMaterial color={p.c} roughness={0.7} /></mesh>
          <mesh position={[0, 0.68, 0]} castShadow><sphereGeometry args={[0.1, 12, 12]} /><meshStandardMaterial color="#6b4423" roughness={0.6} /></mesh>
        </group>
      ))}
    </group>
  )
}

/** Ambulance at the emergency entrance with a blinking beacon. */
export function Ambulance() {
  const beacon = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => { if (beacon.current) beacon.current.emissiveIntensity = Math.sin(clock.elapsedTime * 8) > 0 ? 2.5 : 0.2 })
  return (
    <group position={[-3.2, 0, 3.6]} rotation={[0, Math.PI / 2.4, 0]}>
      <mesh position={[0, 0.45, 0]} castShadow><boxGeometry args={[1.5, 0.7, 0.7]} /><meshStandardMaterial color="#F8FAFC" roughness={0.4} /></mesh>
      <mesh position={[0.82, 0.35, 0]} castShadow><boxGeometry args={[0.35, 0.5, 0.68]} /><meshStandardMaterial color="#E2E8F0" /></mesh>
      <mesh position={[0, 0.42, 0.352]}><planeGeometry args={[1.4, 0.12]} /><meshStandardMaterial color="#DC2626" /></mesh>
      <mesh position={[0.1, 0.86, 0]}><boxGeometry args={[0.25, 0.08, 0.2]} /><meshStandardMaterial ref={beacon} color="#3B82F6" emissive="#3B82F6" /></mesh>
      {[[-0.5, 0.36], [0.55, 0.36], [-0.5, -0.36], [0.55, -0.36]].map(([x, z], i) => <mesh key={i} position={[x, 0.12, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.13, 0.13, 0.08, 12]} /><meshStandardMaterial color="#111827" /></mesh>)}
    </group>
  )
}

/** A ring of shade trees (instanced) so the site reads as a real compound. */
export function Trees() {
  const trunk = useRef<THREE.InstancedMesh>(null), crown = useRef<THREE.InstancedMesh>(null)
  const spots = useMemo(() => {
    const out: [number, number, number][] = []
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.07, r = 17 + ((i * 37) % 7)
      out.push([Math.cos(a) * r, Math.sin(a) * r, 0.8 + ((i * 13) % 5) * 0.12])
    }
    return out.filter(([, z]) => z > -9 || z < -20)   // keep the river bank clear
  }, [])
  useEffect(() => {
    const d = new THREE.Object3D()
    spots.forEach(([x, z, s], i) => {
      d.position.set(x, 0.6 * s, z); d.scale.set(s, s, s); d.updateMatrix(); trunk.current?.setMatrixAt(i, d.matrix)
      d.position.set(x, 1.7 * s, z); d.updateMatrix(); crown.current?.setMatrixAt(i, d.matrix)
    })
    if (trunk.current) trunk.current.instanceMatrix.needsUpdate = true
    if (crown.current) crown.current.instanceMatrix.needsUpdate = true
  }, [spots])
  return (
    <group>
      <instancedMesh ref={trunk} args={[undefined, undefined, spots.length]} castShadow><cylinderGeometry args={[0.12, 0.16, 1.2, 6]} /><meshStandardMaterial color="#6B4F2A" /></instancedMesh>
      <instancedMesh ref={crown} args={[undefined, undefined, spots.length]} castShadow><icosahedronGeometry args={[0.95, 1]} /><meshStandardMaterial color="#2F7D4A" roughness={0.9} flatShading /></instancedMesh>
    </group>
  )
}

/** Floating map pins over each energy asset (bobbing gently), like markers on a live operations map. */
export function MapPins({ items }: { items: { at: THREE.Vector3; h: number; color: string }[] }) {
  const g = useRef<THREE.Group>(null)
  useFrame(({ clock }) => { g.current?.children.forEach((c, i) => { c.position.y = items[i].h + Math.sin(clock.elapsedTime * 2 + i) * 0.15 }) })
  return (
    <group ref={g}>
      {items.map((p, i) => (
        <group key={i} position={[p.at.x, p.h, p.at.z]}>
          <mesh position={[0, 0.5, 0]}><sphereGeometry args={[0.42, 24, 24]} /><meshStandardMaterial color={p.color} roughness={0.35} /></mesh>
          <mesh position={[0, -0.05, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.3, 0.7, 24]} /><meshStandardMaterial color={p.color} roughness={0.35} /></mesh>
          <mesh position={[0, 0.5, 0.36]}><circleGeometry args={[0.16, 20]} /><meshBasicMaterial color="#ffffff" /></mesh>
        </group>
      ))}
    </group>
  )
}
/** Chevron texture shared by every flow ribbon (white arrows on transparent; tinted per source). */
let chevronTex: THREE.CanvasTexture | null = null
function chevrons() {
  if (chevronTex) return chevronTex
  const c = document.createElement('canvas'); c.width = 128; c.height = 32
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(0, 12, 128, 8)          // the cable
  ctx.fillStyle = '#ffffff'
  for (const x of [8, 72]) { ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x + 26, 16); ctx.lineTo(x, 30); ctx.lineTo(x + 12, 16); ctx.closePath(); ctx.fill() }
  chevronTex = new THREE.CanvasTexture(c); chevronTex.wrapS = THREE.RepeatWrapping; chevronTex.colorSpace = THREE.SRGBColorSpace
  return chevronTex
}

export interface FlowSpec { id: string; from: THREE.Vector3; to: THREE.Vector3; color: string; power: (f: SimFrame) => number }

/**
 * Energy flows as tidy arrow ribbons that lie just above the ground and arc gently between assets.
 * Arrows move in the direction of the energy; ribbon width and speed follow the power; zero power hides it.
 */
export function FlowRibbons({ flows, frameRef, scale }: { flows: FlowSpec[]; frameRef: FrameRef; scale: number }) {
  const items = useMemo(() => flows.map((fl) => {
    const a = fl.from.clone().setY(0.6), b = fl.to.clone().setY(1.2)
    const mid = a.clone().lerp(b, 0.5).setY(1.2 + a.distanceTo(b) * 0.22)
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
    const len = curve.getLength()
    const tex = chevrons().clone(); tex.needsUpdate = true; tex.repeat.set(Math.max(2, Math.round(len / 1.6)), 1)
    return { ...fl, geo: ribbon(curve, 0.95), glow: ribbon(curve, 1.9), tex, mesh: { current: null as THREE.Object3D | null }, mat: { current: null as THREE.MeshBasicMaterial | null } }
  }), [flows])
  useEffect(() => () => items.forEach((i) => { i.tex.dispose(); i.geo.dispose(); i.glow.dispose() }), [items])
  useFrame((_, dt) => {
    const f = frameRef.current
    for (const it of items) {
      const p = Math.max(0, it.power(f)) / Math.max(scale, 1)
      if (it.mesh.current) it.mesh.current.visible = p > 0.01
      it.tex.offset.x -= dt * (0.4 + Math.min(1, p) * 2.2)
      if (it.mat.current) it.mat.current.opacity = 0.8 + Math.min(1, p) * 0.2
    }
  })
  return (
    <group>
      {items.map((it) => (
        <group key={it.id} ref={(g) => { it.mesh.current = g }}>
          <mesh geometry={it.glow} renderOrder={4}><meshBasicMaterial color={it.color} transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} /></mesh>
          <mesh geometry={it.geo} renderOrder={5}><meshBasicMaterial ref={(m) => { it.mat.current = m }} map={it.tex} color={it.color} transparent depthWrite={false} side={THREE.DoubleSide} /></mesh>
        </group>
      ))}
    </group>
  )
}
/** Flat, upward-facing strip of width `w` along a curve (u runs along the curve so the arrows follow it). */
function ribbon(curve: THREE.Curve<THREE.Vector3>, w: number) {
  const n = 48, pos: number[] = [], uv: number[] = [], idx: number[] = []
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = curve.getPoint(t), side = curve.getTangent(t).cross(up).normalize().multiplyScalar(w / 2)
    pos.push(p.x + side.x, p.y, p.z + side.z, p.x - side.x, p.y, p.z - side.z)
    uv.push(t, 0, t, 1)
    if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx)
  return g
}