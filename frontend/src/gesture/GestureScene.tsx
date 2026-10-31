import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Label } from '../components/three/Label'
import { BackupDeviceUnit, GeneratorSet, GridTower, POS, SolarArray } from '../components/three/Equipment'
import type { SimFrame } from '../components/three/SiteScene'

/** Where a part can stand on the campus. The engine's sizing decides which pad is right for each part. */
export const PADS: { id: string; label: string; at: [number, number, number]; why: string }[] = [
  { id: 'field', label: 'Free land · south', at: [POS.pv.x, 0, POS.pv.z], why: 'open ground, no shading, nothing fixed to a building — the solar field moves from here' },
  { id: 'yard', label: 'Plant yard · east', at: [POS.backup_device.x, 0, POS.backup_device.z], why: 'next to the main switchboard: short cables, crane access for the containers' },
  { id: 'gen', label: 'Generator bay', at: [POS.gen.x, 0, POS.gen.z], why: 'the existing diesel sets stay here as the last tier' },
  { id: 'north', label: 'North lawn', at: [-9, 0, -8], why: 'shaded by the ward block in the afternoon — a poor place for solar' },
  { id: 'gate', label: 'Entrance', at: [0, 0, 12], why: 'ambulance route — must stay clear' },
]
export type PartId = 'pv' | 'bess' | 'gen' | 'ups'
export interface PlacedPart { id: PartId; pad: string | null; carried: boolean }
export const PART_META: Record<PartId, { label: string; rightPad: string; color: string }> = {
  pv: { label: 'Ground-mount solar', rightPad: 'field', color: '#F59E0B' },
  bess: { label: 'Battery containers', rightPad: 'yard', color: '#22C55E' },
  ups: { label: 'Theatre UPS e-house', rightPad: 'yard', color: '#B8C4D9' },
  gen: { label: 'Diesel generators', rightPad: 'gen', color: '#EF4444' },
}

export interface GestureSceneProps {
  parts: PlacedPart[]; sizing: { pvKwp: number; bessKwh: number; genKva: number; upsKva: number; backupType?: string }
  cursor: { x: number; y: number }; carriedId: PartId | null; explode: number; zoom: number; inspect: PartId | null
  frameRef: React.MutableRefObject<SimFrame>; name: string; address?: string
  onCursorWorld: (p: THREE.Vector3) => void
}

function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow><planeGeometry args={[60, 60]} /><meshStandardMaterial color="#E9EEF3" transparent opacity={0.55} roughness={1} /></mesh>
      <gridHelper args={[60, 30, '#94A3B8', '#CBD5E1']} position={[0, 0, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 6]}><planeGeometry args={[3, 12]} /><meshStandardMaterial color="#CBD5E1" /></mesh>
    </group>
  )
}

function Hospital({ name, address, frameRef }: { name: string; address?: string; frameRef: GestureSceneProps['frameRef'] }) {
  const cross = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(() => { const f = frameRef.current; if (cross.current) cross.current.emissiveIntensity = f.unserved_critical_kw < 0.5 ? 1.2 : 0.3 + 0.7 * Math.abs(Math.sin(performance.now() / 150)) })
  const h = 3.6
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow><boxGeometry args={[6, h, 4]} /><meshStandardMaterial color="#F8FAFC" roughness={0.6} /></mesh>
      <mesh position={[0, h + 0.06, 0]}><boxGeometry args={[6.3, 0.14, 4.3]} /><meshStandardMaterial color="#2F6FEB" /></mesh>
      <mesh position={[0, h + 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1.6, 0.5]} /><meshStandardMaterial ref={cross} color="#ff3b3b" emissive="#ff3b3b" emissiveIntensity={1} /></mesh>
      <mesh position={[0, h + 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.5, 1.6]} /><meshStandardMaterial color="#ff3b3b" emissive="#ff3b3b" emissiveIntensity={1} /></mesh>
      <Label position={[0, h + 1.5, 0]} color="#EF4444">{name}</Label>
      {address && <Label position={[0, h + 0.8, 0]} color="#94A3B8">{address}</Label>}
    </group>
  )
}

function Pad({ pad, hot, right, filled }: { pad: (typeof PADS)[number]; hot: boolean; right: boolean; filled: boolean }) {
  const color = right ? '#22C55E' : hot ? '#F59E0B' : '#94A3B8'
  return (
    <group position={pad.at}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}><ringGeometry args={[2.6, 3.0, 48]} /><meshBasicMaterial color={color} transparent opacity={right ? 0.95 : hot ? 0.8 : 0.35} /></mesh>
      {right && !filled && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}><circleGeometry args={[2.6, 48]} /><meshBasicMaterial color="#22C55E" transparent opacity={0.12} /></mesh>}
      <Label position={[0, 0.9, 0]} color={color}>{pad.label}</Label>
    </group>
  )
}

/** The hand's cursor on the ground: a ring that follows the index finger; a beam while a part is carried. */
function Cursor({ cursor, carried, onWorld }: { cursor: { x: number; y: number }; carried: boolean; onWorld: (p: THREE.Vector3) => void }) {
  const { camera } = useThree()
  const ring = useRef<THREE.Group>(null)
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const rc = useMemo(() => new THREE.Raycaster(), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    rc.setFromCamera(new THREE.Vector2(cursor.x * 2 - 1, -(cursor.y * 2 - 1)), camera)
    if (rc.ray.intersectPlane(plane, hit) && ring.current) { ring.current.position.set(hit.x, 0.03, hit.z); onWorld(hit) }
  })
  return (
    <group ref={ring}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.5, 0.7, 32]} /><meshBasicMaterial color={carried ? '#F59E0B' : '#fff'} /></mesh>
      {carried && <mesh position={[0, 2, 0]}><cylinderGeometry args={[0.06, 0.06, 4, 8]} /><meshBasicMaterial color="#F59E0B" transparent opacity={0.6} /></mesh>}
    </group>
  )
}

/** A placed (or carried) part, drawn with the same equipment the Simulate page uses, lifted apart on explode. */
function Part({ p, sizing, explode, carriedWorld, frameRef, inspect }: { p: PlacedPart; sizing: GestureSceneProps['sizing']; explode: number; carriedWorld: THREE.Vector3 | null; frameRef: GestureSceneProps['frameRef']; inspect: boolean }) {
  const pad = PADS.find((x) => x.id === p.pad)
  const base = p.carried && carriedWorld ? carriedWorld : pad ? new THREE.Vector3(...pad.at) : null
  if (!base) return null
  const home = PART_META[p.id].rightPad === 'field' ? POS.pv : PART_META[p.id].rightPad === 'gen' ? POS.gen : POS.backup_device
  // Equipment components sit at fixed POS.*; offset the group so the part lands on the chosen pad
  const off: [number, number, number] = [base.x - home.x, (p.carried ? 1.2 : 0) + explode * (p.id === 'pv' ? 1.5 : p.id === 'bess' ? 3 : p.id === 'ups' ? 4.5 : 2.2), base.z - home.z]
  const dir = new THREE.Vector3(base.x, 0, base.z).normalize().multiplyScalar(explode * 4)
  return (
    <group position={[off[0] + dir.x, off[1], off[2] + dir.z]}>
      {inspect && <mesh position={[home.x, 0.05, home.z]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[3.2, 3.5, 48]} /><meshBasicMaterial color="#5BD4FF" /></mesh>}
      {p.id === 'pv' && <Suspense fallback={null}><SolarArray kwp={sizing.pvKwp} frameRef={frameRef} relocatable /></Suspense>}
      {p.id === 'bess' && <BackupDeviceUnit kwh={sizing.bessKwh} type={sizing.backupType} frameRef={frameRef} relocatable />}
      {p.id === 'gen' && <GeneratorSet kva={sizing.genKva} frameRef={frameRef} />}
      {p.id === 'ups' && (
        <group position={[POS.backup_device.x - 3.2, 0, POS.backup_device.z + 1]}>
          <mesh position={[0, 1, 0]} castShadow><boxGeometry args={[1.6, 2, 2.4]} /><meshStandardMaterial color="#CBD5E1" /></mesh>
          <mesh position={[0, 1.6, 1.21]}><planeGeometry args={[0.6, 0.6]} /><meshBasicMaterial color="#22C55E" /></mesh>
          <Label position={[0, 2.7, 0]} color="#B8C4D9">{`Theatre UPS · ${sizing.upsKva} kVA · 0 ms`}</Label>
        </group>
      )}
    </group>
  )
}

function Rig({ zoom }: { zoom: number }) {
  const { camera } = useThree()
  useFrame(() => { const d = 36 / Math.max(0.5, Math.min(2.2, zoom)); const t = new THREE.Vector3(d * 0.62, d * 0.55, d * 0.62); camera.position.lerp(t, 0.08); camera.lookAt(2, 0.5, -1) })
  return null
}

export function GestureScene(props: GestureSceneProps) {
  const carried = useRef<THREE.Vector3 | null>(null)
  const nearPad = (w: THREE.Vector3 | null) => w ? PADS.find((p) => Math.hypot(p.at[0] - w.x, p.at[2] - w.z) < 3.2)?.id ?? null : null
  const hot = nearPad(carried.current)
  const carriedMeta = props.carriedId ? PART_META[props.carriedId] : null
  const filled = (id: string) => props.parts.some((p) => p.pad === id && !p.carried)
  return (
    <Canvas shadows camera={{ position: [22, 20, 22], fov: 34 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }} data-testid="gesture-canvas">
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#ffffff', '#cbd5e1', 0.6]} />
      <directionalLight position={[20, 24, -10]} intensity={1.4} castShadow />
      <Rig zoom={props.zoom} />
      <Ground />
      <Hospital name={props.name} address={props.address} frameRef={props.frameRef} />
      {PADS.map((pad) => <Pad key={pad.id} pad={pad} hot={hot === pad.id} right={!!carriedMeta && carriedMeta.rightPad === pad.id} filled={filled(pad.id)} />)}
      <GridTower frameRef={props.frameRef} />
      {props.parts.map((p) => <Part key={p.id} p={p} sizing={props.sizing} explode={props.explode} carriedWorld={p.carried ? carried.current : null} frameRef={props.frameRef} inspect={props.inspect === p.id} />)}
      <Cursor cursor={props.cursor} carried={!!props.carriedId} onWorld={(w) => { carried.current = w.clone(); props.onCursorWorld(w) }} />
    </Canvas>
  )
}
