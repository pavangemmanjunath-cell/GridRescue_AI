import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { Label } from '../components/three/Label'
import { FlowRibbons, type FlowSpec } from '../components/three/SceneDetails'
import type { SimFrame } from '../components/three/SiteScene'
import type { PresetId, Slot } from './catalog'
import type { Result, Row } from './engine'

export type Focus = Slot | 'overview' | 'site' | 'load' | 'simulate'
type FrameRef = React.MutableRefObject<Row>
/** A zoom request from the page: step in, step out, or fit the whole site; `seq` changes on every press. */
export interface ZoomCmd { seq: number; kind: 'in' | 'out' | 'fit' }
interface Props { result: Result; frameRef: FrameRef; focus: Focus; labels: boolean; onPick: (s: Slot) => void; zoom?: ZoomCmd }

// ---------- layout: where the building and each part stand (scene units ≈ 3 m) ----------
interface Lay { bw: number; bd: number; h: number; tower?: { w: number; d: number; h: number }; floors: number }
const LAYOUT: Record<Exclude<PresetId, 'rail' | 'road'>, Lay> = {
  clinic: { bw: 6, bd: 4, h: 2.4, floors: 1 },
  cah: { bw: 8, bd: 5, h: 4.6, floors: 2 },
  community: { bw: 10, bd: 6, h: 9.2, floors: 4 },
  regional: { bw: 12, bd: 7, h: 5.4, floors: 2, tower: { w: 8, d: 6, h: 20 } },
}
function spots(l: Lay) {
  const V = THREE.Vector3, z0 = -3
  return {
    building: new V(0, 0, z0), front: z0 + l.bd,
    storage: new V(l.bw + 6.5, 0, z0 - 1), control: new V(l.bw + 4.2, 0, z0 + l.bd + 3), backup: new V(l.bw + 8.5, 0, z0 + l.bd + 4),
    solar: new V(0, l.tower ? l.tower.h : l.h, z0), carport: new V(0, 0, z0 + l.bd + 6.5), ground: new V(-(l.bw + 8), 0, z0 - 1),
    grid: new V(-(l.bw + 5), 0, z0 + l.bd + 7), plinth: { w: 2 * (l.bw + 15), d: 2 * (l.bd + 13) },
  }
}

// ---------- procedural textures ----------
const texCache = new Map<string, THREE.Texture>()
function canvasTex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, rep: [number, number] = [1, 1]) {
  const k = `${key}:${rep}`
  if (texCache.has(k)) return texCache.get(k)!
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.anisotropy = 4
  texCache.set(k, t); return t
}
/** Façade: white panels with a 4 × 2 grid of glazing; the emissive map lights only the glass. */
const facade = (lit: boolean, rep: [number, number]) => canvasTex(lit ? 'facade-e' : 'facade', 128, 128, (x) => {
  x.fillStyle = lit ? '#000' : '#F4F7FB'; x.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    x.fillStyle = lit ? (j === 0 && i % 2 ? '#bbb' : '#fff') : '#5E7FA8'; x.fillRect(6 + i * 31, 12 + j * 62, 24, 40)
    if (!lit) { x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(6 + i * 31, 12 + j * 62, 24, 6) }
  }
}, rep)
const pvTex = (rep: [number, number]) => canvasTex('pv', 128, 64, (x) => {
  x.fillStyle = '#16294A'; x.fillRect(0, 0, 128, 64)
  x.strokeStyle = '#6E8BB8'; x.lineWidth = 1.2
  for (let i = 0; i <= 12; i++) { x.beginPath(); x.moveTo(i * 10.6, 0); x.lineTo(i * 10.6, 64); x.stroke() }
  for (let j = 0; j <= 6; j++) { x.beginPath(); x.moveTo(0, j * 10.6); x.lineTo(128, j * 10.6); x.stroke() }
  const g = x.createLinearGradient(0, 0, 128, 64); g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 64)
}, rep)
const ribs = (rep: [number, number]) => canvasTex('ribs', 64, 64, (x) => { x.fillStyle = '#F1F5F9'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#D5DEE9'; for (let i = 0; i < 8; i++) x.fillRect(i * 8 + 2, 0, 3, 64) }, rep)
const asphalt = (rep: [number, number]) => canvasTex('asphalt', 128, 128, (x) => {
  x.fillStyle = '#3B4452'; x.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`; x.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5) }
}, rep)
const grass = (rep: [number, number]) => canvasTex('grass', 128, 128, (x) => {
  x.fillStyle = '#6E9F5B'; x.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 1400; i++) { x.fillStyle = Math.random() > 0.5 ? 'rgba(40,80,30,0.18)' : 'rgba(200,230,150,0.12)'; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2) }
}, rep)

// ---------- animation helpers ----------
const ease = (p: number) => 1 - Math.pow(1 - p, 3)
/** Drops its children into place (like a part being fitted) every time its key changes. */
function Assemble({ children, position, delay = 0, onPick }: { children: React.ReactNode; position: THREE.Vector3 | [number, number, number]; delay?: number; onPick?: () => void }) {
  const g = useRef<THREE.Group>(null), t0 = useRef<number | null>(null)
  const base = useMemo(() => (Array.isArray(position) ? new THREE.Vector3(...position) : position.clone()), [position])
  useFrame(({ clock }) => {
    if (!g.current) return
    if (t0.current == null) t0.current = clock.elapsedTime + delay
    const p = Math.max(0, Math.min(1, (clock.elapsedTime - t0.current) / 0.9)), e = ease(p)
    g.current.position.set(base.x, base.y + (1 - e) * 9, base.z)
    g.current.scale.setScalar(0.55 + 0.45 * e)
    g.current.visible = clock.elapsedTime >= t0.current
  })
  return (
    <group ref={g} position={base} onClick={onPick ? (e) => { e.stopPropagation(); onPick() } : undefined}
      onPointerOver={onPick ? (e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' } : undefined} onPointerOut={() => { document.body.style.cursor = '' }}>
      {children}
    </group>
  )
}
/** Pulsing ring that marks the slot being configured. */
function FocusRing({ at, r }: { at: THREE.Vector3; r: number }) {
  const m = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => { if (m.current) { const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.06; m.current.scale.set(s, s, s); (m.current.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(clock.elapsedTime * 3) * 0.25 } })
  return <mesh ref={m} position={[at.x, 0.06, at.z]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[r, r + 0.35, 64]} /><meshBasicMaterial color="#F0CB72" transparent depthWrite={false} /></mesh>
}

// ---------- environment ----------
function Lighting({ frameRef, night }: { frameRef: FrameRef; night: React.MutableRefObject<number> }) {
  const sun = useRef<THREE.DirectionalLight>(null), amb = useRef<THREE.AmbientLight>(null), hemi = useRef<THREE.HemisphereLight>(null)
  useFrame(({ scene }) => {
    const hod = frameRef.current.h % 24, a = ((hod - 6) / 12) * Math.PI
    const y = Math.sin(a) * 40, day = Math.max(0, Math.min(1, (y + 8) / 22))
    night.current = 1 - day
    if (sun.current) { sun.current.position.set(Math.cos(a) * 45, Math.max(6, y), -18); sun.current.intensity = 0.25 + day * 2.1; sun.current.color.set(day < 0.5 ? '#FFC58A' : '#FFF4E0') }
    if (amb.current) amb.current.intensity = 0.25 + day * 0.45
    if (hemi.current) hemi.current.intensity = 0.35 + day * 0.55
    const sky = new THREE.Color('#0A1424').lerp(new THREE.Color('#BFD3EA'), day)
    scene.background = sky
    if (scene.fog) (scene.fog as THREE.Fog).color = sky
  })
  return (
    <>
      <ambientLight ref={amb} intensity={0.6} />
      <hemisphereLight ref={hemi} args={['#EAF2FF', '#3B4A3A', 0.8]} />
      <directionalLight ref={sun} position={[30, 40, -18]} intensity={2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45} shadow-bias={-0.0004} />
      <fog attach="fog" args={['#BFD3EA', 90, 190]} />
    </>
  )
}
function NightStars({ night }: { night: React.MutableRefObject<number> }) {
  const g = useRef<THREE.Group>(null)
  useFrame(() => { if (g.current) g.current.visible = night.current > 0.6 })
  return <group ref={g}><Stars radius={120} depth={30} count={1800} factor={4} fade /></group>
}
/** The model base: a thick slab with a lit rim, like an architectural diorama on a studio table. */
function Plinth({ w, d, top }: { w: number; d: number; top: 'site' | 'rail' | 'road' }) {
  return (
    <group>
      <mesh position={[0, -1.6, 0]} receiveShadow><boxGeometry args={[w + 1.2, 3, d + 1.2]} /><meshStandardMaterial color="#1B2638" roughness={0.6} metalness={0.2} /></mesh>
      <mesh position={[0, -0.08, 0]}><boxGeometry args={[w + 1.25, 0.08, d + 1.25]} /><meshStandardMaterial color="#F0CB72" emissive="#F0CB72" emissiveIntensity={0.35} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} /><meshStandardMaterial map={grass([w / 8, d / 8])} roughness={1} />
      </mesh>
      {top === 'site' && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, d / 2 - 4]} receiveShadow><planeGeometry args={[w, 3.4]} /><meshStandardMaterial map={asphalt([w / 6, 1])} /></mesh>}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.2, 0]}><circleGeometry args={[Math.max(w, d) * 1.6, 64]} /><meshStandardMaterial color="#0E1726" roughness={1} /></mesh>
    </group>
  )
}
function Tree({ p, s = 1 }: { p: [number, number]; s?: number }) {
  return (
    <group position={[p[0], 0, p[1]]} scale={s}>
      <mesh position={[0, 0.7, 0]} castShadow><cylinderGeometry args={[0.12, 0.18, 1.4, 6]} /><meshStandardMaterial color="#6B4F2A" /></mesh>
      <mesh position={[0, 2, 0]} castShadow><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color="#2F7D4A" flatShading roughness={0.9} /></mesh>
    </group>
  )
}

// ---------- hospital ----------
function Block({ w, h, d, pos, glow, frameRef, night }: { w: number; h: number; d: number; pos: [number, number, number]; glow?: boolean; frameRef: FrameRef; night: React.MutableRefObject<number> }) {
  const mats = useMemo(() => {
    const rep: [number, number] = [w / 2.4, h / 2.3], repD: [number, number] = [d / 2.4, h / 2.3]
    const mk = (r: [number, number]) => new THREE.MeshStandardMaterial({ map: facade(false, r), emissiveMap: facade(true, r), emissive: new THREE.Color('#FFE3A3'), emissiveIntensity: 0.2, roughness: 0.55 })
    const side = mk(repD), front = mk(rep), top = new THREE.MeshStandardMaterial({ color: '#DCE3EC' })
    return [side, side, top, top, front, front]
  }, [w, h, d])
  useFrame(() => {
    const f = frameRef.current, served = f.load > 0 ? 1 - (f.shed + f.unserved) / f.load : 1
    const k = (0.15 + night.current * 1.6) * (f.unserved > 0.5 ? 0.12 : served)
    const m = mats[4]; m.emissiveIntensity = k; mats[0].emissiveIntensity = k
    m.emissive.set(f.outage ? '#FFB86B' : '#FFE3A3'); mats[0].emissive.set(m.emissive)
  })
  return (
    <group position={pos}>
      <mesh position={[0, h / 2, 0]} material={mats} castShadow receiveShadow><boxGeometry args={[w, h, d]} /></mesh>
      <mesh position={[0, h + 0.12, 0]} castShadow><boxGeometry args={[w + 0.3, 0.24, d + 0.3]} /><meshStandardMaterial color={glow ? '#2F6FEB' : '#B8C4D4'} /></mesh>
    </group>
  )
}
function Hospital({ lay, frameRef, night, name }: { lay: Lay; frameRef: FrameRef; night: React.MutableRefObject<number>; name: string }) {
  const S = spots(lay), z0 = S.building.z
  const cross = useRef<THREE.MeshStandardMaterial>(null), beacon = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const bad = frameRef.current.unserved > 0.5
    if (cross.current) cross.current.emissiveIntensity = bad ? 0.3 + Math.abs(Math.sin(clock.elapsedTime * 6)) : 1.1
    if (beacon.current) beacon.current.visible = !!frameRef.current.outage
  })
  const roofY = lay.tower ? lay.tower.h : lay.h
  return (
    <group>
      <Block w={lay.bw * 2} h={lay.h} d={lay.bd * 2} pos={[0, 0, z0]} glow frameRef={frameRef} night={night} />
      {lay.floors >= 2 && <Block w={lay.bw * 0.9} h={lay.h * 0.55} d={lay.bd * 0.8} pos={[-lay.bw * 0.55, 0, z0 + lay.bd + lay.bd * 0.4]} frameRef={frameRef} night={night} />}
      {lay.tower && <Block w={lay.tower.w} h={lay.tower.h} d={lay.tower.d} pos={[0, 0, z0]} glow frameRef={frameRef} night={night} />}
      {/* emergency entrance canopy */}
      <group position={[lay.bw * 0.45, 0, z0 + lay.bd + 1.3]}>
        <mesh position={[0, 2.1, 0]} castShadow><boxGeometry args={[4.2, 0.2, 2.6]} /><meshStandardMaterial color="#E2E8F0" /></mesh>
        <mesh position={[0, 2.25, 1.31]}><planeGeometry args={[3.2, 0.32]} /><meshStandardMaterial color="#DC2626" emissive="#DC2626" emissiveIntensity={0.8} /></mesh>
        {[-1.9, 1.9].map((x) => <mesh key={x} position={[x, 1.05, 1.1]}><cylinderGeometry args={[0.08, 0.08, 2.1, 8]} /><meshStandardMaterial color="#94A3B8" /></mesh>)}
      </group>
      <Ambulance pos={[lay.bw * 0.45 + 0.4, 0, z0 + lay.bd + 3.6]} />
      {/* roof: red cross or helipad */}
      <group position={[lay.tower ? 0 : -lay.bw * 0.55, roofY + 0.26, z0 + (lay.tower ? 0 : -lay.bd * 0.45)]}>
        {lay.tower ? (
          <>
            <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[2.4, 40]} /><meshStandardMaterial color="#334155" /></mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}><ringGeometry args={[2.0, 2.15, 40]} /><meshStandardMaterial color="#F8FAFC" /></mesh>
            <mesh position={[-0.45, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.22, 1.5]} /><meshStandardMaterial color="#F8FAFC" /></mesh>
            <mesh position={[0.45, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.22, 1.5]} /><meshStandardMaterial color="#F8FAFC" /></mesh>
            <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.9, 0.22]} /><meshStandardMaterial color="#F8FAFC" /></mesh>
          </>
        ) : (
          <>
            <mesh rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[2.4, 0.7]} /><meshStandardMaterial ref={cross} color="#EF4444" emissive="#EF4444" emissiveIntensity={1} /></mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}><planeGeometry args={[0.7, 2.4]} /><meshStandardMaterial color="#EF4444" emissive="#EF4444" emissiveIntensity={1} /></mesh>
          </>
        )}
        <mesh ref={beacon} position={[lay.tower ? 3.2 : 1.8, 0.5, 0]}><octahedronGeometry args={[0.35]} /><meshStandardMaterial color="#F59E0B" emissive="#F59E0B" emissiveIntensity={2} /></mesh>
      </group>
      <Label position={[-lay.bw * 0.7, roofY + 4.2, z0 - lay.bd * 0.5]} color="#EF4444">{name}</Label>
    </group>
  )
}
function Ambulance({ pos }: { pos: [number, number, number] }) {
  const light = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => { if (light.current) light.current.emissiveIntensity = Math.sin(clock.elapsedTime * 8) > 0 ? 2 : 0.2 })
  return (
    <group position={pos} rotation={[0, Math.PI / 2, 0]}>
      <mesh position={[0, 0.75, 0]} castShadow><boxGeometry args={[2.6, 1.2, 1.1]} /><meshStandardMaterial color="#F8FAFC" /></mesh>
      <mesh position={[1.45, 0.55, 0]} castShadow><boxGeometry args={[0.6, 0.8, 1.06]} /><meshStandardMaterial color="#F8FAFC" /></mesh>
      <mesh position={[0, 0.8, 0.56]}><planeGeometry args={[2.4, 0.16]} /><meshStandardMaterial color="#DC2626" /></mesh>
      <mesh position={[0.6, 1.42, 0]}><boxGeometry args={[0.3, 0.12, 0.8]} /><meshStandardMaterial ref={light} color="#3B82F6" emissive="#3B82F6" /></mesh>
      {[[-0.8, 0.5], [0.95, 0.5], [-0.8, -0.5], [0.95, -0.5]].map(([x, z], i) => <mesh key={i} position={[x, 0.22, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.22, 0.22, 0.14, 14]} /><meshStandardMaterial color="#111827" /></mesh>)}
    </group>
  )
}
function Cars({ z, w }: { z: number; w: number }) {
  const cols = ['#64748B', '#1E40AF', '#B91C1C', '#E2E8F0', '#0F766E', '#334155']
  const n = Math.floor(w / 2.4)
  return <group>{Array.from({ length: n }).map((_, i) => i % 3 === 1 ? null : (
    <group key={i} position={[-w / 2 + 1.2 + i * 2.4, 0, z]}>
      <mesh position={[0, 0.4, 0]} castShadow><boxGeometry args={[1.1, 0.5, 2.1]} /><meshStandardMaterial color={cols[i % cols.length]} metalness={0.4} roughness={0.4} /></mesh>
      <mesh position={[0, 0.78, -0.1]} castShadow><boxGeometry args={[1.0, 0.38, 1.1]} /><meshStandardMaterial color="#CBD5E1" metalness={0.3} roughness={0.2} /></mesh>
    </group>
  ))}</group>
}

// ---------- energy parts ----------
function PanelRow({ len, tilt = -0.32, pos }: { len: number; tilt?: number; pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <group rotation={[tilt, 0, 0]}>
        <mesh castShadow><boxGeometry args={[len, 0.06, 1.15]} /><meshStandardMaterial color="#CBD5E1" metalness={0.8} roughness={0.3} /></mesh>
        <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[len - 0.08, 1.07]} /><meshStandardMaterial map={pvTex([len / 2, 1])} metalness={0.4} roughness={0.18} /></mesh>
      </group>
    </group>
  )
}
function Solar({ kind, lay, onPick }: { kind: string; lay: Lay; onPick: () => void }) {
  const S = spots(lay)
  if (kind === 'none') return null
  const roof = lay.tower ? { w: lay.bw * 2 - 1.5, d: lay.bd * 2 - 1.5, y: lay.h + 0.6, skip: lay.tower } : { w: lay.bw * 1.1, d: lay.bd * 1.7, y: lay.h + 0.6 }
  const roofRows = Math.floor(roof.d / 1.6)
  const roofX = lay.tower ? 0 : lay.bw * 0.35
  return (
    <group>
      <Assemble position={[roofX, roof.y, S.building.z]} onPick={onPick}>
        {Array.from({ length: roofRows }).map((_, i) => {
          const z = -roof.d / 2 + 0.8 + i * 1.6
          if (lay.tower && Math.abs(z) < lay.tower.d / 2 + 0.4) {
            const side = (roof.w - lay.tower.w) / 2 - 0.4
            return <group key={i}><PanelRow len={side} pos={[-(lay.tower.w / 2 + side / 2 + 0.2), 0, z]} /><PanelRow len={side} pos={[lay.tower.w / 2 + side / 2 + 0.2, 0, z]} /></group>
          }
          return <PanelRow key={i} len={roof.w} pos={[0, 0, z]} />
        })}
      </Assemble>
      {(kind === 'carport' || kind === 'ground') && (
        <Assemble position={S.carport} delay={0.25} onPick={onPick}>
          {[-1, 1].map((side) => (
            <group key={side} position={[0, 0, side * 1.9]}>
              <PanelRow len={lay.bw * 2} tilt={side * 0.08} pos={[0, 2.6, 0]} />
              {Array.from({ length: Math.floor(lay.bw / 2.5) + 1 }).map((_, i) => <mesh key={i} position={[-lay.bw + i * 5, 1.3, 0]} castShadow><cylinderGeometry args={[0.1, 0.1, 2.6, 8]} /><meshStandardMaterial color="#94A3B8" metalness={0.7} /></mesh>)}
            </group>
          ))}
        </Assemble>
      )}
      {kind === 'ground' && (
        <Assemble position={S.ground} delay={0.5} onPick={onPick}>
          {Array.from({ length: Math.round(lay.bd * 1.3) }).map((_, i) => (
            <group key={i} position={[0, 0, -lay.bd * 0.65 * 1.6 + i * 1.7]}>
              <PanelRow len={9} pos={[0, 0.9, 0]} tilt={-0.45} />
              {[-4, 4].map((x) => <mesh key={x} position={[x, 0.45, 0.15]}><boxGeometry args={[0.08, 0.9, 0.08]} /><meshStandardMaterial color="#94A3B8" /></mesh>)}
            </group>
          ))}
        </Assemble>
      )}
    </group>
  )
}
function Switchgear({ kind, onPick, at }: { kind: string; onPick: () => void; at: THREE.Vector3 }) {
  const led = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => { if (led.current) led.current.emissiveIntensity = 0.8 + Math.sin(clock.elapsedTime * 2.5) * 0.6 })
  if (kind === 'none') return (
    <Assemble position={at} onPick={onPick}>
      <mesh position={[0, 0.9, 0]} castShadow><boxGeometry args={[1.6, 1.8, 0.8]} /><meshStandardMaterial color="#94A3B8" /></mesh>
    </Assemble>
  )
  return (
    <Assemble position={at} onPick={onPick}>
      <mesh position={[0, 0.1, 0]}><boxGeometry args={[4.6, 0.2, 2.2]} /><meshStandardMaterial color="#A3AEBD" /></mesh>
      {[-1.5, 0, 1.5].map((x, i) => (
        <group key={x} position={[x, 0.2, 0]}>
          <mesh position={[0, 1.1, 0]} castShadow><boxGeometry args={[1.3, 2.2, 1.4]} /><meshStandardMaterial color={i === 1 ? '#1E3A5F' : '#E2E8F0'} metalness={0.3} roughness={0.5} /></mesh>
          <mesh position={[0.35, 1.8, 0.71]}><circleGeometry args={[0.08, 12]} /><meshStandardMaterial ref={i === 1 ? led : undefined} color="#22C55E" emissive="#22C55E" emissiveIntensity={1} /></mesh>
          {i === 1 && <mesh position={[0, 1.3, 0.71]}><planeGeometry args={[0.8, 0.5]} /><meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={0.7} /></mesh>}
        </group>
      ))}
      {kind === 'ups' && <mesh position={[3.0, 1.0, 0]} castShadow><boxGeometry args={[1.1, 1.8, 1.2]} /><meshStandardMaterial color="#F0CB72" /></mesh>}
    </Assemble>
  )
}
function Generator({ kind, kva, frameRef, onPick, at, small }: { kind: string; kva: number; frameRef: FrameRef; onPick: () => void; at: THREE.Vector3; small?: boolean }) {
  const puffs = useRef<THREE.InstancedMesh>(null), dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame(({ clock }) => {
    const on = frameRef.current.gen > 0.5
    if (!puffs.current) return
    for (let i = 0; i < 14; i++) {
      const t = (clock.elapsedTime * 0.55 + i / 14) % 1
      dummy.position.set(1.1 + Math.sin(t * 6 + i) * 0.2, 2.5 + t * 3, Math.cos(t * 5 + i) * 0.2)
      const s = on ? 0.18 + t * 0.55 : 0
      dummy.scale.setScalar(s); dummy.updateMatrix(); puffs.current.setMatrixAt(i, dummy.matrix)
    }
    puffs.current.instanceMatrix.needsUpdate = true
  })
  if (kind === 'none' || kva <= 0) return null
  const n = small ? 1 : Math.min(3, Math.max(1, Math.ceil(kva / 1500)))
  return (
    <Assemble position={at} onPick={onPick}>
      {Array.from({ length: n }).map((_, i) => (
        <group key={i} position={[0, 0, i * 2.2]} scale={small ? 0.7 : 1}>
          <mesh position={[0, 0.25, 0]} castShadow><boxGeometry args={[3.6, 0.5, 1.8]} /><meshStandardMaterial color="#475569" /></mesh>
          <mesh position={[0, 1.2, 0]} castShadow><boxGeometry args={[3.3, 1.4, 1.6]} /><meshStandardMaterial map={ribs([1, 3])} color={kind === 'diesel-green' ? '#D9F99D' : '#FFFFFF'} /></mesh>
          <mesh position={[0, 1.55, 0]}><boxGeometry args={[3.32, 0.14, 1.62]} /><meshStandardMaterial color={kind === 'diesel-green' ? '#16A34A' : '#EF4444'} /></mesh>
          <mesh position={[1.1, 2.2, 0]}><cylinderGeometry args={[0.12, 0.14, 1.1, 12]} /><meshStandardMaterial color="#334155" metalness={0.6} /></mesh>
        </group>
      ))}
      <instancedMesh ref={puffs} args={[undefined, undefined, 14]}><sphereGeometry args={[1, 8, 8]} /><meshStandardMaterial color="#8E99A6" transparent opacity={0.42} depthWrite={false} /></instancedMesh>
    </Assemble>
  )
}
function GridLine({ at, to, frameRef }: { at: THREE.Vector3; to: THREE.Vector3; frameRef: FrameRef }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2F6FEB', emissive: '#2F6FEB', emissiveIntensity: 0.5 }), [])
  useFrame(({ clock }) => {
    const on = frameRef.current.gridOn
    mat.color.set(on ? '#2F6FEB' : '#EF4444'); mat.emissive.set(mat.color); mat.emissiveIntensity = on ? 0.5 : 0.3 + Math.abs(Math.sin(clock.elapsedTime * 6)) * 0.8
  })
  const curves = useMemo(() => {
    const top = at.clone().setY(6.2), end = to.clone().setY(3)
    return [-0.6, 0, 0.6].map((o) => { const a = top.clone().add(new THREE.Vector3(o, 0, 0)), b = end.clone().add(new THREE.Vector3(o * 0.6, 0, 0)), m = a.clone().lerp(b, 0.5); m.y -= 1.2; return new THREE.QuadraticBezierCurve3(a, m, b) })
  }, [at, to])
  return (
    <group>
      <group position={at}>
        <mesh position={[0, 3.2, 0]} castShadow><cylinderGeometry args={[0.14, 0.2, 6.4, 10]} /><meshStandardMaterial color="#A8A29E" /></mesh>
        <mesh position={[0, 6.2, 0]}><boxGeometry args={[2.2, 0.12, 0.12]} /><meshStandardMaterial color="#64748B" /></mesh>
        <mesh position={[0.35, 4.8, 0]} castShadow><cylinderGeometry args={[0.4, 0.4, 0.9, 14]} /><meshStandardMaterial color="#94A3B8" metalness={0.5} /></mesh>
      </group>
      {curves.map((c, i) => <mesh key={i} material={mat}><tubeGeometry args={[c, 24, 0.04, 6, false]} /></mesh>)}
    </group>
  )
}

// ---------- crew scenes ----------
function Worker({ p, c = '#F97316' }: { p: [number, number]; c?: string }) {
  const g = useRef<THREE.Group>(null), ph = useMemo(() => Math.random() * 6, [])
  useFrame(({ clock }) => { if (g.current) g.current.rotation.y = Math.sin(clock.elapsedTime * 0.6 + ph) * 0.8 })
  return (
    <group ref={g} position={[p[0], 0, p[1]]}>
      <mesh position={[0, 0.55, 0]} castShadow><capsuleGeometry args={[0.22, 0.6, 4, 10]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.15} /></mesh>
      <mesh position={[0, 0.62, 0]}><boxGeometry args={[0.47, 0.08, 0.47]} /><meshStandardMaterial color="#E5E7EB" emissive="#E5E7EB" emissiveIntensity={0.6} /></mesh>
      <mesh position={[0, 1.22, 0]}><sphereGeometry args={[0.17, 12, 12]} /><meshStandardMaterial color="#D6A77A" /></mesh>
      <mesh position={[0, 1.36, 0]}><sphereGeometry args={[0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#FACC15" /></mesh>
    </group>
  )
}
/** LED light tower; the beam and lamp head light up when the crew is on shift at night and the tower has power. */
function LightTower({ p, frameRef, night }: { p: [number, number]; frameRef: FrameRef; night: React.MutableRefObject<number> }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null), beam = useRef<THREE.MeshBasicMaterial>(null), spot = useRef<THREE.SpotLight>(null)
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.set(p[0], 0, p[1] + 3); return o }, [p])
  useFrame(() => {
    const f = frameRef.current, on = f.onShift && f.unserved < 0.5
    const k = on ? 0.3 + night.current : 0
    if (lamp.current) lamp.current.emissiveIntensity = on ? 2.5 : 0
    if (beam.current) beam.current.opacity = 0.12 * k
    if (spot.current) spot.current.intensity = 60 * k
  })
  return (
    <group>
      <group position={[p[0], 0, p[1]]}>
        <mesh position={[0, 0.35, 0]} castShadow><boxGeometry args={[1.2, 0.7, 0.9]} /><meshStandardMaterial color="#FACC15" /></mesh>
        <mesh position={[0, 3, 0]}><cylinderGeometry args={[0.07, 0.09, 5.2, 8]} /><meshStandardMaterial color="#94A3B8" metalness={0.6} /></mesh>
        <mesh position={[0, 5.6, 0.15]} rotation={[0.5, 0, 0]}><boxGeometry args={[1.4, 0.5, 0.18]} /><meshStandardMaterial ref={lamp} color="#F8FAFC" emissive="#FFF7D6" emissiveIntensity={0} /></mesh>
        <mesh position={[0, 2.8, 1.6]} rotation={[0.5, 0, 0]}><coneGeometry args={[2.6, 5.6, 24, 1, true]} /><meshBasicMaterial ref={beam} color="#FFF3C4" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} /></mesh>
      </group>
      <primitive object={target} />
      <spotLight ref={spot} position={[p[0], 5.6, p[1]]} target={target} angle={0.75} penumbra={0.6} distance={18} decay={1.6} intensity={0} color="#FFF3C4" />
    </group>
  )
}
function Rail({ len }: { len: number }) {
  const ties = Math.floor(len / 1.1)
  return (
    <group>
      <mesh position={[0, 0.15, 0]} receiveShadow><boxGeometry args={[len, 0.3, 4.2]} /><meshStandardMaterial color="#8B8478" roughness={1} /></mesh>
      {Array.from({ length: ties }).map((_, i) => <mesh key={i} position={[-len / 2 + 0.55 + i * 1.1, 0.36, 0]} castShadow><boxGeometry args={[0.38, 0.16, 3.1]} /><meshStandardMaterial color="#5B4636" /></mesh>)}
      {[-0.75, 0.75].map((z) => <mesh key={z} position={[0, 0.52, z]} castShadow><boxGeometry args={[len, 0.16, 0.12]} /><meshStandardMaterial color="#B8BEC6" metalness={0.9} roughness={0.25} /></mesh>)}
    </group>
  )
}
function Road({ len }: { len: number }) {
  return (
    <group>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[len, 8]} /><meshStandardMaterial map={asphalt([len / 8, 1])} /></mesh>
      {Array.from({ length: Math.floor(len / 3) }).map((_, i) => <mesh key={i} position={[-len / 2 + 1.5 + i * 3, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1.5, 0.16]} /><meshStandardMaterial color="#F8FAFC" /></mesh>)}
      {[-3.9, 3.9].map((z) => <mesh key={z} position={[0, 0.05, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[len, 0.14]} /><meshStandardMaterial color="#FACC15" /></mesh>)}
      {Array.from({ length: 12 }).map((_, i) => (
        <group key={i} position={[-12 + i * 2, 0, 0.4 + Math.max(0, 6 - i) * 0.55]}>
          <mesh position={[0, 0.35, 0]} castShadow><coneGeometry args={[0.22, 0.7, 12]} /><meshStandardMaterial color="#F97316" /></mesh>
          <mesh position={[0, 0.4, 0]}><cylinderGeometry args={[0.15, 0.17, 0.1, 12]} /><meshStandardMaterial color="#F8FAFC" emissive="#F8FAFC" emissiveIntensity={0.4} /></mesh>
        </group>
      ))}
    </group>
  )
}
function Truck({ p, color = '#F8FAFC', rot = 0 }: { p: [number, number, number]; color?: string; rot?: number }) {
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh position={[1.6, 1.1, 0]} castShadow><boxGeometry args={[1.6, 1.5, 1.9]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[2.05, 1.45, 0]}><boxGeometry args={[0.72, 0.6, 1.8]} /><meshStandardMaterial color="#1E293B" metalness={0.4} roughness={0.15} /></mesh>
      <mesh position={[-0.9, 0.9, 0]} castShadow><boxGeometry args={[3.4, 1.0, 2]} /><meshStandardMaterial color="#64748B" /></mesh>
      <mesh position={[1.6, 1.92, 0]}><boxGeometry args={[0.9, 0.12, 1.2]} /><meshStandardMaterial color="#F59E0B" emissive="#F59E0B" emissiveIntensity={1.2} /></mesh>
      {[[-1.8, 0.95], [1.6, 0.95], [-1.8, -0.95], [1.6, -0.95]].map(([x, z], i) => <mesh key={i} position={[x, 0.4, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.4, 0.4, 0.3, 16]} /><meshStandardMaterial color="#111827" /></mesh>)}
    </group>
  )
}
function BatteryTrailer({ kind, kwh, frameRef, at, onPick }: { kind: string; kwh: number; frameRef: FrameRef; at: THREE.Vector3; onPick: () => void }) {
  const strip = useRef<THREE.MeshStandardMaterial>(null), bar = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const f = frameRef.current, s = Math.max(0.02, f.soc / 100)
    if (bar.current) { bar.current.scale.x = s; bar.current.position.x = -1.1 + 2.2 * s / 2 }
    if (strip.current) { strip.current.color.set(f.soc > 50 ? '#22C55E' : f.soc > 20 ? '#F59E0B' : '#EF4444'); strip.current.emissive.copy(strip.current.color); strip.current.emissiveIntensity = f.battDis > 0.2 ? 0.7 + Math.abs(Math.sin(clock.elapsedTime * 4)) : 0.6 }
  })
  if (kind === 'none') return null
  const L = kind === 'cart' ? 1.6 : kind === 'trailer' ? 3.2 : 4.4, H = kind === 'cart' ? 1.1 : 1.7
  return (
    <Assemble position={at} onPick={onPick}>
      <mesh position={[0, 0.5 + H / 2, 0]} castShadow><boxGeometry args={[L, H, 1.8]} /><meshStandardMaterial map={ribs([L, 1])} color="#E8F5E9" /></mesh>
      <mesh position={[0, 0.55 + H, 0]}><boxGeometry args={[L + 0.04, 0.1, 1.84]} /><meshStandardMaterial ref={strip} color="#22C55E" emissive="#22C55E" emissiveIntensity={0.6} /></mesh>
      <mesh position={[0, 0.5 + H * 0.55, 0.91]}><planeGeometry args={[2.3, 0.3]} /><meshStandardMaterial color="#0F172A" /></mesh>
      <mesh ref={bar} position={[0, 0.5 + H * 0.55, 0.92]}><planeGeometry args={[2.2, 0.22]} /><meshStandardMaterial color="#22C55E" emissive="#22C55E" emissiveIntensity={0.9} /></mesh>
      {kind !== 'cart' && <mesh position={[L / 2 + 0.6, 0.45, 0]}><boxGeometry args={[1.2, 0.08, 0.08]} /><meshStandardMaterial color="#334155" /></mesh>}
      {[-0.3, 0.3].map((x) => [-0.95, 0.95].map((z) => <mesh key={`${x}${z}`} position={[x * (L / 2), 0.32, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.32, 0.32, 0.22, 16]} /><meshStandardMaterial color="#111827" /></mesh>))}
      <Label position={[0, H + 1.7, 0]} color="#22C55E">{`${Math.round(kwh)} kWh`}</Label>
    </Assemble>
  )
}
/** Where the mobile battery van parks to charge: right beside the depot charger. */
const VAN_DOCK = new THREE.Vector3(-11.6, 0, 6.2)
/**
 * Mobile battery van: drives into the scene when chosen, parks at the depot charger by day (cable glows while it charges
 * from the grid) and drives out to the track for the night shift.
 */
function BatteryVan({ kwh, frameRef, work, dock, onPick, labels }: { kwh: number; frameRef: FrameRef; work: THREE.Vector3; dock: THREE.Vector3; onPick: () => void; labels: boolean }) {
  const g = useRef<THREE.Group>(null), cable = useRef<THREE.Mesh>(null), strip = useRef<THREE.MeshStandardMaterial>(null), bar = useRef<THREE.Mesh>(null)
  const pos = useRef(new THREE.Vector3(30, 0, work.z))   // starts off the plinth and drives in
  useFrame(({ clock }, dt) => {
    const f = frameRef.current, goal = f.onShift ? work : dock
    const before = pos.current.clone()
    pos.current.lerp(goal, 1 - Math.exp(-Math.min(dt, 0.1) * 1.1))
    const v = pos.current.clone().sub(before)
    if (g.current) { g.current.position.copy(pos.current); if (v.lengthSq() > 1e-6) g.current.rotation.y = Math.atan2(-v.z, v.x) }
    const docked = pos.current.distanceTo(dock) < 0.4, charging = docked && f.depot > 0.1
    if (cable.current) cable.current.visible = docked
    if (strip.current) {
      strip.current.color.set(charging ? '#38BDF8' : f.soc > 50 ? '#22C55E' : f.soc > 20 ? '#F59E0B' : '#EF4444'); strip.current.emissive.copy(strip.current.color)
      strip.current.emissiveIntensity = charging ? 0.8 + Math.abs(Math.sin(clock.elapsedTime * 3)) : 0.7
    }
    if (bar.current) { const s = Math.max(0.02, f.soc / 100); bar.current.scale.x = s; bar.current.position.x = -1.2 + 2.4 * s / 2 }
  })
  return (
    <group>
      <group ref={g} position={[30, 0, work.z]} onClick={(e) => { e.stopPropagation(); onPick() }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
        <mesh position={[-0.3, 1.25, 0]} castShadow><boxGeometry args={[3.2, 1.9, 1.75]} /><meshStandardMaterial color="#F8FAFC" roughness={0.4} /></mesh>
        <mesh position={[1.75, 0.95, 0]} castShadow><boxGeometry args={[1.0, 1.3, 1.7]} /><meshStandardMaterial color="#F8FAFC" roughness={0.4} /></mesh>
        <mesh position={[2.26, 1.15, 0]}><boxGeometry args={[0.04, 0.6, 1.5]} /><meshStandardMaterial color="#1E293B" metalness={0.4} roughness={0.15} /></mesh>
        <mesh position={[-0.3, 1.0, 0]}><boxGeometry args={[3.22, 0.18, 1.77]} /><meshStandardMaterial ref={strip} color="#22C55E" emissive="#22C55E" emissiveIntensity={0.7} /></mesh>
        <mesh position={[-0.3, 1.55, 0.885]}><planeGeometry args={[2.5, 0.22]} /><meshStandardMaterial color="#0F172A" /></mesh>
        <mesh ref={bar} position={[-0.3, 1.55, 0.89]}><planeGeometry args={[2.4, 0.15]} /><meshStandardMaterial color="#22C55E" emissive="#22C55E" emissiveIntensity={0.9} /></mesh>
        <mesh position={[0.4, 2.25, 0]}><boxGeometry args={[0.9, 0.1, 1.2]} /><meshStandardMaterial color="#F59E0B" emissive="#F59E0B" emissiveIntensity={0.9} /></mesh>
        {[[-1.3, 0.85], [1.6, 0.85], [-1.3, -0.85], [1.6, -0.85]].map(([x, z], i) => <mesh key={i} position={[x, 0.35, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.35, 0.35, 0.25, 16]} /><meshStandardMaterial color="#111827" /></mesh>)}
        {labels && <Label position={[0, 3.2, 0]} color="#22C55E">{`Battery van · ${Math.round(kwh)} kWh`}</Label>}
      </group>
      {/* charging cable from the depot charger to the van's rear socket */}
      <mesh ref={cable} position={[dock.x - 2.25, 0.9, dock.z]} rotation={[0, 0, Math.PI / 2]} visible={false}><cylinderGeometry args={[0.06, 0.06, 0.9, 8]} /><meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={1.2} /></mesh>
    </group>
  )
}
/** The depot's own renewable, chosen from the Explorer site's sun, wind or water: it charges alongside the grid. */
function DepotRenewable({ kind }: { kind: string }) {
  const rotor = useRef<THREE.Group>(null), wheel = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => { if (rotor.current) rotor.current.rotation.z -= dt * 2.2; if (wheel.current) wheel.current.rotation.z -= dt * 1.5 })
  if (kind === 'charger-sun') return (
    <group position={[-2.6, 0, 0]}>
      {[-1, 1].map((x) => <mesh key={x} position={[x * 1.6, 1.3, 0]}><cylinderGeometry args={[0.07, 0.07, 2.6, 8]} /><meshStandardMaterial color="#94A3B8" /></mesh>)}
      <PanelRow len={4} pos={[0, 2.65, 0]} tilt={-0.25} /><PanelRow len={4} pos={[0, 2.65, 1.2]} tilt={-0.25} />
      <Label position={[0, 4.0, 0]} color="#F59E0B">Depot solar · 30 kWp</Label>
    </group>
  )
  if (kind === 'charger-wind') return (
    <group position={[-4.5, 0, 1.5]}>
      <mesh position={[0, 4, 0]} castShadow><cylinderGeometry args={[0.1, 0.18, 8, 12]} /><meshStandardMaterial color="#F1F5F9" /></mesh>
      <group ref={rotor} position={[0, 8, 0.3]}>
        <mesh><sphereGeometry args={[0.2, 12, 12]} /><meshStandardMaterial color="#CBD5E1" /></mesh>
        {[0, 1, 2].map((b) => <mesh key={b} rotation={[0, 0, (b * 2 * Math.PI) / 3]} position={[Math.cos((b * 2 * Math.PI) / 3 + Math.PI / 2) * 1.5, Math.sin((b * 2 * Math.PI) / 3 + Math.PI / 2) * 1.5, 0]}><boxGeometry args={[0.2, 3, 0.05]} /><meshStandardMaterial color="#FFFFFF" /></mesh>)}
      </group>
      <Label position={[0, 10.2, 0]} color="#22B7E8">Depot wind · 20 kW</Label>
    </group>
  )
  if (kind === 'charger-water') return (
    <group position={[-4, 0, 1.5]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}><planeGeometry args={[1.6, 7]} /><meshStandardMaterial color="#2B5FA8" roughness={0.15} /></mesh>
      <mesh ref={wheel} position={[0.9, 0.8, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[0.7, 0.1, 8, 18]} /><meshStandardMaterial color="#334155" metalness={0.5} /></mesh>
      <mesh position={[1.8, 0.7, 0]} castShadow><boxGeometry args={[1.2, 1.4, 1.2]} /><meshStandardMaterial color="#D6D3CB" /></mesh>
      <Label position={[1, 2.6, 0]} color="#3A86E6">Depot micro-hydro · 10 kW</Label>
    </group>
  )
  return null
}
function SolarMast({ kind, at, onPick }: { kind: string; at: THREE.Vector3; onPick: () => void }) {
  if (kind === 'none') return null
  if (kind === 'skid') return (
    <Assemble position={at} onPick={onPick}>
      {[0, 1, 2].map((i) => <PanelRow key={i} len={4.5} pos={[0, 0.7, i * 1.6 - 1.6]} tilt={-0.5} />)}
    </Assemble>
  )
  return (
    <Assemble position={at} onPick={onPick}>
      <mesh position={[0, 1.7, 0]}><cylinderGeometry args={[0.08, 0.08, 3.2, 8]} /><meshStandardMaterial color="#94A3B8" /></mesh>
      {[-1, 1].map((s) => <group key={s} position={[s * 1.25, 3.3, 0]} rotation={[0, 0, s * 0.12]}><PanelRow len={2.4} pos={[0, 0, 0]} tilt={-0.6} /></group>)}
    </Assemble>
  )
}

// ---------- wind and water generation ----------
/** Turbines whose rotors spin with the simulated output (feathered and still when there is no wind). */
function WindTurbines({ n, kw, frameRef, at, onPick }: { n: number; kw: number; frameRef: FrameRef; at: THREE.Vector3; onPick: () => void }) {
  const rotors = useRef<(THREE.Group | null)[]>([])
  useFrame((_, dt) => {
    const f = frameRef.current, k = kw > 0 ? f.renAvail / kw : 0
    rotors.current.forEach((r, i) => { if (r) r.rotation.z -= dt * (0.15 + k * 5) * (1 + i * 0.07) })
  })
  const H = 11
  return (
    <Assemble position={at} onPick={onPick}>
      {Array.from({ length: n }).map((_, i) => (
        <group key={i} position={[(i % 2) * 3, 0, i * 6.5 - (n - 1) * 3.25]}>
          <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.9, 1, 0.4, 16]} /><meshStandardMaterial color="#A3AEBD" /></mesh>
          <mesh position={[0, H / 2, 0]} castShadow><cylinderGeometry args={[0.16, 0.32, H, 14]} /><meshStandardMaterial color="#F1F5F9" roughness={0.4} /></mesh>
          <mesh position={[0, H, -0.3]} castShadow rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[0.3, 1.1, 4, 10]} /><meshStandardMaterial color="#E2E8F0" /></mesh>
          <group ref={(g) => { rotors.current[i] = g }} position={[0, H, 0.45]}>
            <mesh><sphereGeometry args={[0.32, 14, 14]} /><meshStandardMaterial color="#CBD5E1" /></mesh>
            {[0, 1, 2].map((b) => (
              <mesh key={b} rotation={[0, 0, (b * 2 * Math.PI) / 3]} position={[Math.cos((b * 2 * Math.PI) / 3 + Math.PI / 2) * 2.4, Math.sin((b * 2 * Math.PI) / 3 + Math.PI / 2) * 2.4, 0]} castShadow>
                <boxGeometry args={[0.32, 4.6, 0.07]} /><meshStandardMaterial color="#FFFFFF" />
              </mesh>
            ))}
          </group>
          <mesh position={[0, H + 0.45, -0.9]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#EF4444" emissive="#EF4444" emissiveIntensity={1.5} /></mesh>
        </group>
      ))}
    </Assemble>
  )
}
/** A river along the back of the site with an intake, a penstock and a powerhouse; the wheel turns with the flow. */
function MicroHydro({ units, kw, frameRef, at, width, onPick }: { units: number; kw: number; frameRef: FrameRef; at: THREE.Vector3; width: number; onPick: () => void }) {
  const tex = useMemo(() => {
    const t = canvasTex('river', 256, 64, (x) => {
      x.fillStyle = '#2B5FA8'; x.fillRect(0, 0, 256, 64); x.strokeStyle = 'rgba(190,225,255,0.55)'; x.lineWidth = 3
      for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(0, 8 + i * 10); for (let xx = 0; xx <= 256; xx += 8) x.lineTo(xx, 8 + i * 10 + Math.sin(xx / 14 + i) * 3); x.stroke() }
    }, [width / 8, 1])
    return t
  }, [width])
  const wheels = useRef<(THREE.Mesh | null)[]>([])
  useFrame((_, dt) => {
    tex.offset.x -= dt * 0.35
    const k = kw > 0 ? frameRef.current.renAvail / kw : 0
    wheels.current.forEach((w) => { if (w) w.rotation.z -= dt * (0.4 + k * 3) })
  })
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, at.z]}><planeGeometry args={[width, 4.2]} /><meshStandardMaterial map={tex} roughness={0.15} metalness={0.2} /></mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[0, 0.15, at.z + s * 2.2]}><boxGeometry args={[width, 0.3, 0.3]} /><meshStandardMaterial color="#8B8478" /></mesh>)}
      <Assemble position={at} onPick={onPick}>
        {Array.from({ length: units }).map((_, i) => (
          <group key={i} position={[i * 4.5, 0, 3.6]}>
            <mesh position={[0, 1.3, 0]} castShadow><boxGeometry args={[3.2, 2.6, 2.6]} /><meshStandardMaterial color="#D6D3CB" /></mesh>
            <mesh position={[0, 2.8, 0]} castShadow rotation={[0, 0, 0]}><boxGeometry args={[3.5, 0.3, 2.9]} /><meshStandardMaterial color="#2F6FEB" /></mesh>
            <mesh position={[-0.8, 1.0, 1.31]}><planeGeometry args={[0.9, 1.6]} /><meshStandardMaterial color="#475569" /></mesh>
            <mesh position={[0.9, 1.6, 1.31]}><planeGeometry args={[1.0, 0.6]} /><meshStandardMaterial color="#93C5FD" emissive="#93C5FD" emissiveIntensity={0.4} /></mesh>
            <mesh position={[1.3, 0.9, -2.1]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.28, 0.28, 2.0, 12]} /><meshStandardMaterial color="#64748B" metalness={0.6} /></mesh>
            <mesh ref={(m) => { wheels.current[i] = m }} position={[-1.9, 1.0, -2.6]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[1.0, 0.12, 8, 18]} /><meshStandardMaterial color="#334155" metalness={0.5} /></mesh>
          </group>
        ))}
      </Assemble>
    </group>
  )
}

// ---------- storage devices ----------
/** Charge column used by every store: green above half, amber, then red. */
function SocGauge({ frameRef, pos, h = 1.8 }: { frameRef: FrameRef; pos: [number, number, number]; h?: number }) {
  const bar = useRef<THREE.Mesh>(null), mat = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(() => {
    const s = Math.max(0.02, frameRef.current.soc / 100)
    if (bar.current) { bar.current.scale.y = s; bar.current.position.y = 0.2 + (h * s) / 2 }
    if (mat.current) { mat.current.color.set(s > 0.5 ? '#22C55E' : s > 0.2 ? '#F59E0B' : '#EF4444'); mat.current.emissive.copy(mat.current.color) }
  })
  return (
    <group position={pos}>
      <mesh position={[0, 0.2 + h / 2, 0]}><boxGeometry args={[0.34, h + 0.1, 0.34]} /><meshStandardMaterial color="#0F172A" transparent opacity={0.55} /></mesh>
      <mesh ref={bar} position={[0, 0.2 + h / 2, 0]}><boxGeometry args={[0.38, h, 0.38]} /><meshStandardMaterial ref={mat} color="#22C55E" emissive="#22C55E" emissiveIntensity={0.8} /></mesh>
    </group>
  )
}
const BAND: Record<string, string> = { container: '#22C55E', 'container-na': '#F59E0B', 'container-lto': '#14B8A6' }
/** Every storage technology gets its own model; all show a live charge gauge. */
function StorageModel({ kind, kwh, frameRef, at, onPick }: { kind: string; kwh: number; frameRef: FrameRef; at: THREE.Vector3; onPick: () => void }) {
  const spin = useRef<(THREE.Object3D | null)[]>([]), lift = useRef<THREE.Group>(null), glow = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }, dt) => {
    const f = frameRef.current, active = f.battDis > 0.5 || f.battChg > 0.5
    spin.current.forEach((s) => { if (s) s.rotation.y += dt * (active ? 12 : 3) })
    if (lift.current) lift.current.position.y = 1 + (f.soc / 100) * 9                       // gravity blocks rise as the store fills
    if (glow.current) glow.current.emissiveIntensity = 0.6 + (active ? Math.abs(Math.sin(clock.elapsedTime * 5)) * 1.2 : 0)
  })
  if (kind === 'none') return null
  const pad = (w: number, d: number) => <mesh position={[0, 0.1, 0]} receiveShadow><boxGeometry args={[w, 0.2, d]} /><meshStandardMaterial color="#A3AEBD" /></mesh>
  if (kind.startsWith('container')) {
    const n = Math.min(4, Math.max(1, Math.ceil(kwh / 2000)))
    return (
      <Assemble position={at} onPick={onPick}>
        {pad(n * 2.55 + 1.5, 7.2)}
        {Array.from({ length: n }).map((_, i) => (
          <group key={i} position={[(i - (n - 1) / 2) * 2.55, 0.2, 0]}>
            <mesh position={[0, 1.25, 0]} castShadow><boxGeometry args={[2.3, 2.5, 6]} /><meshStandardMaterial map={ribs([5, 1])} roughness={0.5} /></mesh>
            <mesh position={[0, 2.3, 0]}><boxGeometry args={[2.32, 0.16, 6.02]} /><meshStandardMaterial ref={i === 0 ? glow : undefined} color={BAND[kind]} emissive={BAND[kind]} emissiveIntensity={0.6} /></mesh>
            <mesh position={[0, 2.75, -1.5]} castShadow><boxGeometry args={[1.4, 0.5, 1.2]} /><meshStandardMaterial color="#CBD5E1" metalness={0.5} /></mesh>
          </group>
        ))}
        <SocGauge frameRef={frameRef} pos={[-(n * 2.55) / 2 - 0.6, 0, 2.4]} />
      </Assemble>
    )
  }
  if (kind === 'racks') return (
    <Assemble position={at} onPick={onPick}>
      {pad(8, 6)}
      <mesh position={[0, 3.2, 0]} castShadow><boxGeometry args={[8, 0.15, 6]} /><meshStandardMaterial color="#94A3B8" /></mesh>
      {[-3.8, 3.8].map((x) => [-2.8, 2.8].map((z) => <mesh key={`${x}${z}`} position={[x, 1.65, z]}><cylinderGeometry args={[0.08, 0.08, 3.1, 8]} /><meshStandardMaterial color="#64748B" /></mesh>))}
      {Array.from({ length: 12 }).map((_, i) => <mesh key={i} position={[-3 + (i % 6) * 1.2, 0.75, (i < 6 ? -1.2 : 1.2)]} castShadow><boxGeometry args={[1, 1.1, 1.6]} /><meshStandardMaterial color="#1F2937" /></mesh>)}
      <SocGauge frameRef={frameRef} pos={[4.6, 0, 2.4]} />
    </Assemble>
  )
  if (kind === 'ice') return (
    <Assemble position={at} onPick={onPick}>
      {pad(9, 6)}
      {[-2.6, 0, 2.6].map((x, i) => <mesh key={i} position={[x, 2.1, -0.6]} castShadow><cylinderGeometry args={[1.15, 1.15, 3.8, 24]} /><meshStandardMaterial color="#F8FAFC" roughness={0.35} /></mesh>)}
      {[-2.6, 0, 2.6].map((x, i) => <mesh key={`b${i}`} position={[x, 3.2, 0.56]}><planeGeometry args={[1.4, 0.18]} /><meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={0.8} /></mesh>)}
      <mesh position={[0, 0.9, 2.2]} castShadow><boxGeometry args={[5, 1.4, 1.6]} /><meshStandardMaterial color="#CBD5E1" /></mesh>
      {[-1.5, 0, 1.5].map((x, i) => <mesh key={i} ref={(m) => { spin.current[i] = m }} position={[x, 1.62, 2.2]}><cylinderGeometry args={[0.55, 0.55, 0.06, 4]} /><meshStandardMaterial color="#334155" /></mesh>)}
      <SocGauge frameRef={frameRef} pos={[4.2, 0, 2.2]} />
    </Assemble>
  )
  if (kind === 'hotwater') return (
    <Assemble position={at} onPick={onPick}>
      {pad(6, 5)}
      {[-1.4, 1.4].map((x, i) => <mesh key={i} position={[x, 1.9, 0]} castShadow><cylinderGeometry args={[1, 1, 3.4, 24]} /><meshStandardMaterial color="#B45309" metalness={0.5} roughness={0.35} /></mesh>)}
      <mesh position={[0, 3.4, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.12, 0.12, 3, 10]} /><meshStandardMaterial color="#DC2626" metalness={0.5} /></mesh>
      <mesh position={[0, 0.6, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.12, 0.12, 3, 10]} /><meshStandardMaterial color="#2563EB" metalness={0.5} /></mesh>
      <SocGauge frameRef={frameRef} pos={[2.8, 0, 1.6]} />
    </Assemble>
  )
  if (kind === 'h2') return (
    <Assemble position={at} onPick={onPick}>
      {pad(10, 7)}
      <mesh position={[-3, 1.3, -1.8]} castShadow><boxGeometry args={[3, 2.6, 2.4]} /><meshStandardMaterial color="#E2E8F0" /></mesh>
      <mesh position={[-3, 2.2, -0.59]}><planeGeometry args={[2.2, 0.35]} /><meshStandardMaterial ref={glow} color="#8B5CF6" emissive="#8B5CF6" emissiveIntensity={0.6} /></mesh>
      {[0, 1, 2].map((i) => (
        <group key={i} position={[1.6, 0.9 + i * 1.25, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow><capsuleGeometry args={[0.55, 4.6, 6, 18]} /><meshStandardMaterial color="#F8FAFC" roughness={0.3} /></mesh>
        </group>
      ))}
      <mesh position={[-3, 1.0, 2.2]} castShadow><boxGeometry args={[2.4, 2, 1.6]} /><meshStandardMaterial color="#334155" /></mesh>
      <SocGauge frameRef={frameRef} pos={[4.6, 0, 2.6]} />
    </Assemble>
  )
  if (kind === 'supercap') return (
    <Assemble position={at} onPick={onPick}>
      {pad(5, 3)}
      {[-1.2, 0, 1.2].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 1.1, 0]} castShadow><boxGeometry args={[1, 2.2, 1.4]} /><meshStandardMaterial color="#0F172A" /></mesh>
          {[0.5, 1.0, 1.5].map((y) => <mesh key={y} position={[0, y, 0.71]}><planeGeometry args={[0.8, 0.12]} /><meshStandardMaterial ref={i === 0 && y === 0.5 ? glow : undefined} color="#22D3EE" emissive="#22D3EE" emissiveIntensity={1} /></mesh>)}
        </group>
      ))}
      <SocGauge frameRef={frameRef} pos={[2.4, 0, 1.0]} h={1.2} />
    </Assemble>
  )
  if (kind === 'flywheel') return (
    <Assemble position={at} onPick={onPick}>
      <mesh position={[0, 0.25, 0]} receiveShadow><boxGeometry args={[8, 0.5, 4]} /><meshStandardMaterial color="#9CA3AF" /></mesh>
      {[-2.7, -0.9, 0.9, 2.7].map((x, i) => (
        <group key={i} position={[x, 0.5, 0]}>
          <mesh position={[0, 0.9, 0]} castShadow><cylinderGeometry args={[0.75, 0.75, 1.8, 24]} /><meshStandardMaterial color="#64748B" metalness={0.7} roughness={0.3} /></mesh>
          <mesh ref={(m) => { spin.current[i] = m }} position={[0, 1.85, 0]}><cylinderGeometry args={[0.6, 0.6, 0.1, 6]} /><meshStandardMaterial color="#22D3EE" emissive="#22D3EE" emissiveIntensity={0.6} /></mesh>
        </group>
      ))}
      <SocGauge frameRef={frameRef} pos={[4.4, 0, 1.4]} h={1.2} />
    </Assemble>
  )
  if (kind === 'flow') {
    const n = Math.min(4, Math.max(2, Math.ceil(kwh / 2500)))
    return (
      <Assemble position={at} onPick={onPick}>
        {pad(n * 2.5 + 1.5, 7.2)}
        {Array.from({ length: n }).map((_, i) => (
          <group key={i} position={[(i - (n - 1) / 2) * 2.5, 0.2, 0]}>
            {[-1.6, 1.6].map((z, k) => <mesh key={z} position={[0, 1.4, z]} castShadow><cylinderGeometry args={[0.95, 0.95, 2.8, 24]} /><meshStandardMaterial color={k ? '#7C3AED' : '#0EA5E9'} roughness={0.4} /></mesh>)}
            <mesh position={[0, 0.8, 0]} castShadow><boxGeometry args={[1.6, 1.6, 1.2]} /><meshStandardMaterial color="#E2E8F0" /></mesh>
          </group>
        ))}
        <SocGauge frameRef={frameRef} pos={[-(n * 2.5) / 2 - 0.6, 0, 2.6]} />
      </Assemble>
    )
  }
  if (kind === 'phes') return (
    <Assemble position={at} onPick={onPick}>
      {/* upper reservoir on a bank, penstock down to the powerhouse */}
      <mesh position={[0, 2.2, -3]} castShadow><boxGeometry args={[9, 4.4, 6]} /><meshStandardMaterial color="#6B7F5A" roughness={1} /></mesh>
      <WaterLevel frameRef={frameRef} />
      <mesh position={[3.2, 2.2, 0.6]} rotation={[0.9, 0, 0]}><cylinderGeometry args={[0.3, 0.3, 4.8, 12]} /><meshStandardMaterial color="#475569" metalness={0.6} /></mesh>
      <mesh position={[3.2, 0.9, 2.6]} castShadow><boxGeometry args={[2.6, 1.8, 2]} /><meshStandardMaterial color="#D6D3CB" /></mesh>
      <SocGauge frameRef={frameRef} pos={[-5.2, 0, 1.5]} />
    </Assemble>
  )
  if (kind === 'watertower') return (
    <Assemble position={at} onPick={onPick}>
      {[[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].map(([x, z], i) => <mesh key={i} position={[x, 3, z]}><cylinderGeometry args={[0.12, 0.16, 6, 8]} /><meshStandardMaterial color="#64748B" /></mesh>)}
      <mesh position={[0, 7.2, 0]} castShadow><cylinderGeometry args={[2.2, 2.0, 2.6, 28]} /><meshStandardMaterial color="#CBD5E1" metalness={0.3} /></mesh>
      <mesh position={[0, 8.7, 0]}><coneGeometry args={[2.3, 0.8, 28]} /><meshStandardMaterial color="#2F6FEB" /></mesh>
      <mesh position={[1.8, 0.7, 1.6]} castShadow><boxGeometry args={[1.6, 1.4, 1.4]} /><meshStandardMaterial color="#D6D3CB" /></mesh>
      <SocGauge frameRef={frameRef} pos={[-2.6, 0, 1.6]} />
    </Assemble>
  )
  if (kind === 'gravity') return (
    <Assemble position={at} onPick={onPick}>
      {pad(6, 6)}
      {[[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]].map(([x, z], i) => <mesh key={i} position={[x, 6, z]} castShadow><boxGeometry args={[0.3, 12, 0.3]} /><meshStandardMaterial color="#94A3B8" /></mesh>)}
      <mesh position={[0, 12.1, 0]}><boxGeometry args={[5, 0.3, 5]} /><meshStandardMaterial color="#64748B" /></mesh>
      {Array.from({ length: 6 }).map((_, i) => <mesh key={i} position={[-1.2 + (i % 2) * 2.4, 0.6 + Math.floor(i / 2) * 0.0, -1.2 + Math.floor(i / 2) * 1.2]} castShadow><boxGeometry args={[1.6, 1.0, 1.0]} /><meshStandardMaterial color="#A8A29E" /></mesh>)}
      <group ref={lift}>
        <mesh castShadow><boxGeometry args={[2.2, 1.4, 2.2]} /><meshStandardMaterial color="#78716C" /></mesh>
        <mesh position={[0, 5.5, 0]}><cylinderGeometry args={[0.04, 0.04, 11, 6]} /><meshStandardMaterial color="#1F2937" /></mesh>
      </group>
      <SocGauge frameRef={frameRef} pos={[3.4, 0, 2.4]} />
    </Assemble>
  )
  return null
}
function WaterLevel({ frameRef }: { frameRef: FrameRef }) {
  const m = useRef<THREE.Mesh>(null)
  useFrame(() => { if (m.current) m.current.position.y = 3.2 + (frameRef.current.soc / 100) * 1.1 })
  return <mesh ref={m} position={[0, 4, -3]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[8, 5]} /><meshStandardMaterial color="#2B5FA8" roughness={0.15} metalness={0.2} /></mesh>
}

// ---------- camera ----------
function CameraRig({ focus, targets, viewId, zoom, maxDist }: { focus: Focus; targets: Record<string, { pos: THREE.Vector3; look: THREE.Vector3 }>; viewId: string; zoom?: ZoomCmd; maxDist: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null }
  const until = useRef(0)
  const goal = useRef(targets[focus] ?? targets.overview)
  // glide only when the step or the site really changes (not on every animation frame), so zoom and orbit are never fought
  useEffect(() => { goal.current = targets[focus] ?? targets.overview; until.current = performance.now() + 3000 }, [focus, viewId])   // eslint-disable-line react-hooks/exhaustive-deps
  // read-only probe for the GUI tests: how far the camera is from what it looks at
  useEffect(() => {
    const w = window as unknown as { __buildCam?: () => number }
    w.__buildCam = () => (controls ? camera.position.distanceTo(controls.target) : 0)
    return () => { delete w.__buildCam }
  }, [camera, controls])
  // zoom buttons: move along the line of sight (same target), or glide back to the whole site
  useEffect(() => {
    if (!zoom || !zoom.seq || !controls) return
    if (zoom.kind === 'fit') { goal.current = targets.overview; until.current = performance.now() + 3000; return }
    const look = controls.target.clone(), dir = camera.position.clone().sub(look)
    const d = THREE.MathUtils.clamp(dir.length() * (zoom.kind === 'in' ? 0.75 : 1.35), 8, maxDist)
    goal.current = { pos: look.clone().add(dir.setLength(d)), look }
    until.current = performance.now() + 3000
  }, [zoom?.seq])   // eslint-disable-line react-hooks/exhaustive-deps
  // frame-rate independent glide that runs until the camera arrives (slow GPUs get there too, just in fewer frames)
  useFrame((_, dt) => {
    if (performance.now() > until.current || !controls) return
    const a = 1 - Math.exp(-Math.min(dt, 0.25) * 5)
    camera.position.lerp(goal.current.pos, a); controls.target.lerp(goal.current.look, a); controls.update()
    if (camera.position.distanceTo(goal.current.pos) < 0.05 && controls.target.distanceTo(goal.current.look) < 0.05) until.current = 0
  })
  return null
}

// ---------- scene ----------
export function BuildScene({ result, frameRef, focus, labels, onPick, zoom }: Props) {
  const night = useRef(0)
  const preset = result.ctx.preset
  const c = result.chosen
  const hosp = preset.family === 'hospital'
  const lay = hosp ? LAYOUT[preset.id as keyof typeof LAYOUT] : LAYOUT.clinic
  const S = useMemo(() => spots(lay), [lay])   // built once per layout, so camera targets stay stable between frames
  const plinth = hosp ? S.plinth : { w: 50, d: 26 }
  const R = Math.max(plinth.w, plinth.d)
  const src = c.source.part.kind
  const wind = src.startsWith('turbine'), hydro = src.startsWith('hydro')
  const river = useMemo(() => new THREE.Vector3(-(lay.bw + 2), 0, -plinth.d / 2 + 3.2), [lay.bw, plinth.d])
  const turbines = useMemo(() => new THREE.Vector3(-(lay.bw + 9), 0, -1), [lay.bw])
  const crewAt = useMemo(() => ({ storage: new THREE.Vector3(3, 0, 5.2), source: new THREE.Vector3(-3.5, 0, 6.4), backup: new THREE.Vector3(11, 0, 5.4), control: new THREE.Vector3(-14, 0, 6.2) }), [])
  const at = useMemo(() => (hosp
    ? { storage: S.storage, control: S.control, backup: S.backup, source: wind ? turbines : hydro ? river : src === 'ground' ? S.ground : src === 'carport' ? S.carport : S.solar }
    : crewAt), [hosp, S, wind, hydro, src, turbines, river, crewAt])

  // Every step keeps the whole site in view and centred, from the same front-right angle as the overview; the view is
  // only nudged towards the part being configured (the gold ring and its label mark it), so nothing drops out of frame.
  const targets = useMemo(() => {
    const V = THREE.Vector3
    const base = new V(R * 0.62, R * 0.5, R * 0.78), centre = new V(0, hosp ? 2 : 1, hosp ? -1 : 0)
    const frame = (p?: THREE.Vector3, k = 1, pull = 0.3) => {
      const look = p ? centre.clone().lerp(p.clone().setY(centre.y + p.y * 0.5), pull) : centre.clone()
      return { pos: look.clone().add(base.clone().multiplyScalar(k)), look }
    }
    return {
      overview: frame(undefined, 1), site: frame(undefined, 1.02), load: frame(hosp ? S.building : undefined, 0.98),
      source: frame(at.source, 0.98), storage: frame(at.storage, 0.96), control: frame(at.control, 0.96), backup: frame(at.backup, 0.96),
      simulate: frame(undefined, 0.98),
    }
  }, [R, hosp, S, at])
  const viewId = `${preset.id}|${src}|${c.storage.part.kind}`

  // energy ribbons into the building (or the work site)
  const flows = useMemo(() => {
    const sink = hosp ? S.building.clone().add(new THREE.Vector3(lay.bw * 0.9, 0, lay.bd * 0.6)) : new THREE.Vector3(0, 0, 2)
    const list: FlowSpec[] = []
    const P = (k: keyof Row) => (f: SimFrame) => Number((f as unknown as Row)[k]) || 0
    const srcColor = wind ? '#22B7E8' : hydro ? '#3A86E6' : '#F59E0B'
    if (c.source.size > 0) list.push({ id: 'ren', from: at.source.clone().setY(0), to: sink, color: srcColor, power: P('ren') })
    if (c.storage.size > 0) list.push({ id: 'bd', from: at.storage, to: sink, color: '#22C55E', power: P('battDis') })
    if (c.storage.size > 0) list.push({ id: 'bc', from: hosp ? S.grid : at.control, to: at.storage, color: '#38BDF8', power: (f) => { const r = f as unknown as Row; return hosp ? (r.gridOn ? Math.max(0, r.battChg - r.ren) : 0) : r.depot } })
    if (c.backup.size > 0) list.push({ id: 'gen', from: at.backup, to: sink, color: '#EF4444', power: P('gen') })
    if (hosp) list.push({ id: 'grid', from: S.grid, to: sink, color: '#2F6FEB', power: P('grid') })
    return list
  }, [hosp, wind, hydro, c.source.size, c.storage.size, c.backup.size, at, S.grid, S.building, lay])

  const pick = (s: Slot) => () => onPick(s)
  const show = labels
  const size = (v: number, unit: string) => (unit === 'kWh' && v >= 1000 ? `${(v / 1000).toFixed(1)} MWh` : `${Math.round(v).toLocaleString()} ${unit}`)
  const srcName = wind ? 'Wind' : hydro ? 'Micro-hydro' : 'Solar'
  const storeName = c.storage.part.name.split(' (')[0].split(' ·')[0]
  const trees: [number, number][] = [[-plinth.w / 2 + 3, -plinth.d / 2 + 3], [plinth.w / 2 - 3, -plinth.d / 2 + 4], [-plinth.w / 2 + 4, plinth.d / 2 - 3], [plinth.w / 2 - 2.5, plinth.d / 2 - 2.5], [-plinth.w / 2 + 2.5, 0], [0, -plinth.d / 2 + 2.2], [lay.bw + 2, -plinth.d / 2 + 3]]
  return (
    <Canvas shadows camera={{ position: [R * 0.62, R * 0.5, R * 0.78], fov: 36, near: 0.5, far: 600 }} dpr={[1, 1.75]} gl={{ antialias: true, preserveDrawingBuffer: true }} data-testid="build-canvas">
      <Lighting frameRef={frameRef} night={night} />
      <NightStars night={night} />
      <Plinth w={plinth.w} d={plinth.d} top={hosp ? 'site' : preset.id === 'rail' ? 'rail' : 'road'} />
      {hosp ? (
        <group>
          <Hospital lay={lay} frameRef={frameRef} night={night} name={preset.short.toUpperCase()} />
          <Cars z={S.carport.z} w={lay.bw * 2} />
          <GridLine at={S.grid} to={S.building.clone().add(new THREE.Vector3(-lay.bw, 0, lay.bd))} frameRef={frameRef} />
          {!wind && !hydro && <Solar key={`pv-${c.source.part.id}`} kind={src} lay={lay} onPick={pick('source')} />}
          {wind && <WindTurbines key={`w-${c.source.part.id}`} n={Number(src.slice(-1))} kw={c.source.size} frameRef={frameRef} at={turbines} onPick={pick('source')} />}
          {hydro && <MicroHydro key={`h-${c.source.part.id}`} units={Number(src.slice(-1))} kw={c.source.size} frameRef={frameRef} at={river} width={plinth.w} onPick={pick('source')} />}
          <StorageModel key={`b-${c.storage.part.id}`} kind={c.storage.part.kind} kwh={c.storage.size} frameRef={frameRef} onPick={pick('storage')} at={S.storage} />
          <Switchgear key={`c-${c.control.part.id}`} kind={c.control.part.kind} onPick={pick('control')} at={S.control} />
          <Generator key={`g-${c.backup.part.id}`} kind={c.backup.part.kind} kva={c.backup.size} small={c.backup.part.id === 'gen-small'} frameRef={frameRef} onPick={pick('backup')} at={S.backup} />
          {trees.filter(([x, z]) => !(hydro && z < -plinth.d / 2 + 6) && !(wind && x < -lay.bw - 3 && Math.abs(z) < 8)).map((p, i) => <Tree key={i} p={p} s={0.9 + (i % 3) * 0.2} />)}
          {show && <>
            {c.storage.size > 0 && <Label position={[S.storage.x, c.storage.part.kind === 'gravity' ? 13.4 : c.storage.part.kind === 'watertower' ? 10 : 5.2, S.storage.z]} color="#22C55E">{`${storeName} · ${size(c.storage.size, 'kWh')}`}</Label>}
            {c.source.size > 0 && <Label position={wind ? [turbines.x, 15, turbines.z] : hydro ? [river.x, 4.6, river.z + 3.6] : [src === 'ground' || src === 'carport' ? at.source.x : lay.tower ? lay.bw * 0.7 : lay.bw * 0.35, at.source.y + (src === 'carport' ? 5 : 2.2), at.source.z + (src === 'carport' ? 0 : lay.bd * 0.5)]} color={wind ? '#22B7E8' : hydro ? '#3A86E6' : '#F59E0B'}>{`${srcName} · ${size(c.source.size, c.source.part.unit)}`}</Label>}
            <Label position={[S.control.x, 3.6, S.control.z]} color="#38BDF8">{c.control.part.kind === 'none' ? 'Grid-tied inverter' : c.control.part.kind === 'ups' ? 'Microgrid + UPS' : 'Microgrid controller'}</Label>
            <Label position={[S.backup.x, 4.2, S.backup.z]} color="#EF4444">{`Generator · ${Math.round(c.backup.size)} kVA`}</Label>
            <Label position={[S.grid.x, 7.6, S.grid.z]} color="#2F6FEB">Utility grid</Label>
          </>}
        </group>
      ) : (
        <group>
          {preset.id === 'rail' ? <Rail len={plinth.w - 2} /> : <Road len={plinth.w - 2} />}
          {preset.id === 'rail' ? <Truck p={[-12, 0.6, 0]} color="#FACC15" /> : <Truck p={[-15, 0, -2]} color="#F97316" />}
          {[[-7, -3.4], [-1, -3.4], [5, -3.4], [11, -3.4], ...(preset.id === 'road' ? [[-4, 4], [8, 4]] : [])].map((p, i) => <LightTower key={i} p={p as [number, number]} frameRef={frameRef} night={night} />)}
          {[[-3, 1.4], [-1.5, -1.2], [0.5, 1.6], [2, -1.6], [4.5, 0.8], [6.5, -0.9]].map((p, i) => <Worker key={i} p={p as [number, number]} />)}
          {c.storage.part.kind === 'van'
            ? <BatteryVan key={`van-${preset.id}`} kwh={c.storage.size} frameRef={frameRef} work={crewAt.storage} dock={VAN_DOCK} onPick={pick('storage')} labels={show} />
            : <BatteryTrailer key={`bt-${c.storage.part.id}`} kind={c.storage.part.kind} kwh={c.storage.size} frameRef={frameRef} at={crewAt.storage} onPick={pick('storage')} />}
          <SolarMast key={`sm-${c.source.part.id}`} kind={src} at={crewAt.source} onPick={pick('source')} />
          <Generator key={`g-${c.backup.part.id}`} kind={c.backup.part.kind} kva={c.backup.size} small frameRef={frameRef} onPick={pick('backup')} at={crewAt.backup} />
          <Assemble key={`ch-${c.control.part.id}`} position={crewAt.control} onPick={pick('control')}>
            <mesh position={[0, 1, 0]} castShadow><boxGeometry args={[0.9, 2, 0.6]} /><meshStandardMaterial color="#1E3A5F" /></mesh>
            <mesh position={[0, 1.4, 0.31]}><planeGeometry args={[0.5, 0.35]} /><meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={0.8} /></mesh>
            <DepotRenewable kind={c.control.part.kind} />
          </Assemble>
          {[[-22, -9], [-18, 10], [20, -10], [22, 9], [0, -11], [14, 11]].map((p, i) => <Tree key={i} p={p as [number, number]} s={1 + (i % 2) * 0.3} />)}
          {show && <>
            <Label position={[crewAt.control.x, 3.2, crewAt.control.z]} color="#38BDF8">{c.control.part.charge?.source === 'sun' ? 'Depot charger · grid + solar' : c.control.part.charge?.source === 'wind' ? 'Depot charger · grid + wind' : c.control.part.charge?.source === 'water' ? 'Depot charger · grid + hydro' : `Depot charger · grid ${c.control.size} kW`}</Label>
            {c.backup.size > 0 && <Label position={[crewAt.backup.x, 3.4, crewAt.backup.z]} color="#EF4444">Diesel generator · standby</Label>}
            {c.source.size > 0 && <Label position={[crewAt.source.x, 5, crewAt.source.z]} color="#F59E0B">{`Solar · ${c.source.size} kWp`}</Label>}
            <Label position={[-1, 7.4, -3.4]} color="#FACC15">{preset.id === 'rail' ? 'Night track possession' : 'Night work zone'}</Label>
          </>}
        </group>
      )}
      {(['source', 'storage', 'control', 'backup'] as Slot[]).includes(focus as Slot) && <FocusRing at={at[focus as Slot]} r={hosp ? (focus === 'source' && (src === 'roof' || src === 'carport') ? lay.bw * 0.6 : focus === 'source' && (wind || hydro) ? 7 : 5) : 2.6} />}
      <FlowRibbons flows={flows} frameRef={frameRef as unknown as React.MutableRefObject<SimFrame>} scale={Math.max(1, result.ctx.peakKw * (hosp ? 0.6 : 1))} />
      <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2.15} minDistance={8} maxDistance={R * 2.2} target={[0, 2, 0]} />
      <CameraRig focus={focus} targets={targets} viewId={viewId} zoom={zoom} maxDist={R * 2.2} />
    </Canvas>
  )
}

/** Small helper for the page: true once WebGL is known to work, so the page can show a friendly message otherwise. */
export function useWebGL() {
  const [ok] = useState(() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false } })
  return ok
}
