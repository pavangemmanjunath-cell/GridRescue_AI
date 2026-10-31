import { useMemo, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { Label } from './Label'
import type { SimFrame } from './SiteScene'

type FrameRef = React.MutableRefObject<SimFrame>
// where each asset stands on the site (scene units ≈ 10 m)
export const POS = {
  pv: new THREE.Vector3(-9, 0, -6), backup_device: new THREE.Vector3(6, 0, -5), gen: new THREE.Vector3(9, 0, 2), grid: new THREE.Vector3(-1, 0, 11),
  pole: new THREE.Vector3(-3.2, 0, 4.4), wind: new THREE.Vector3(-11, 0, 6), h2: new THREE.Vector3(11, 0, -2), river: new THREE.Vector3(0, 0, -14),
}
const HOSPITAL_HALF = { x: 3.3, z: 2.3 }   // half footprint of the hospital block + a small margin

/** Point on the hospital wall that faces `from`, so energy arrows stop at the building instead of crossing the roof. */
export function edgeOf(from: THREE.Vector3) {
  const d = new THREE.Vector3(from.x, 0, from.z).normalize()
  const t = Math.min(HOSPITAL_HALF.x / Math.max(1e-3, Math.abs(d.x)), HOSPITAL_HALF.z / Math.max(1e-3, Math.abs(d.z)))
  return d.multiplyScalar(t)
}

/** Small procedural textures: ribbed container steel and generator louvres. */
function stripes(base: string, line: string, vertical: boolean, count: number) {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const ctx = c.getContext('2d')!
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256); ctx.fillStyle = line
  for (let i = 0; i < count; i++) { const p = (i + 0.5) * (256 / count); if (vertical) ctx.fillRect(p - 2, 0, 4, 256); else ctx.fillRect(0, p - 2, 256, 4) }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** A cylinder strut between two points (for lattice towers and cross-bracing). */
function Strut({ a, b, r = 0.05, color = '#94A3B8' }: { a: THREE.Vector3; b: THREE.Vector3; r?: number; color?: string }) {
  const mid = a.clone().lerp(b, 0.5), len = a.distanceTo(b)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return <mesh position={mid} quaternion={q} castShadow><cylinderGeometry args={[r, r, len, 6]} /><meshStandardMaterial color={color} metalness={0.6} roughness={0.4} /></mesh>
}

/** Solar rows: the real module photo (public domain, NASA / Wikimedia Commons) on aluminium frames with legs. */
export function SolarArray({ kwp, frameRef, relocatable }: { kwp: number; frameRef: FrameRef; relocatable?: boolean }) {
  const photo = useLoader(THREE.TextureLoader, '/textures/pv_module.jpg')
  const face = useMemo(() => { const t = photo.clone(); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(5, 1); t.needsUpdate = true; return t }, [photo])
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const rows = Math.max(2, Math.min(8, Math.round(kwp / 60)))
  // a soft warm sheen while the panels are producing
  useFrame(() => { if (mat.current) mat.current.emissiveIntensity = Math.min(0.25, (frameRef.current.pv_kw / Math.max(kwp, 1)) * 0.5) })
  if (kwp <= 0) return null
  return (
    <group position={POS.pv}>
      {Array.from({ length: rows }).map((_, i) => {
        const z = i * 1.5 - (rows * 1.5) / 2
        return (
          <group key={i} position={[0, 0.75, z]}>
            <group rotation={[-Math.PI / 9, 0, 0]}>
              <mesh castShadow receiveShadow><boxGeometry args={[5.7, 0.07, 1.22]} /><meshStandardMaterial color="#CBD5E1" metalness={0.85} roughness={0.3} /></mesh>
              <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[5.56, 1.1]} /><meshStandardMaterial ref={i === 0 ? mat : undefined} map={face} emissive="#FFD27A" emissiveIntensity={0} metalness={0.3} roughness={0.25} /></mesh>
            </group>
            {[-2.5, 2.5].map((x) => <mesh key={x} position={[x, -0.4, 0.2]}><boxGeometry args={[0.08, 0.8, 0.08]} /><meshStandardMaterial color="#94A3B8" metalness={0.7} /></mesh>)}
          </group>
        )
      })}
      <Label position={[0, 2.4, 0]} color="#F59E0B">{relocatable ? `Ground-mount solar · ${Math.round(kwp)} kWp · moves` : `Solar · ${Math.round(kwp)} kWp`}</Label>
    </group>
  )
}

/** Backup Device containers: ribbed steel, blue band, roof cooling unit, doors and a charge gauge. */
export function BackupDeviceUnit({ kwh, type, frameRef, hydrogen, relocatable }: { kwh: number; type?: string; frameRef: FrameRef; hydrogen?: boolean; relocatable?: boolean }) {
  const ribs = useMemo(() => stripes('#F8FAFC', '#E2E8F0', true, 14), [])
  const fill = useRef<THREE.Mesh>(null)
  const n = Math.max(1, Math.min(4, Math.ceil(kwh / 1500)))
  useFrame(() => { if (fill.current) { const s = Math.max(0.02, frameRef.current.soc_pct / 100); fill.current.scale.y = s; fill.current.position.y = 0.2 + 0.8 * s } })
  if (kwh <= 0 && !hydrogen) return null
  const size = kwh >= 1000 ? `${(kwh / 1000).toFixed(1)} MWh` : `${Math.round(kwh)} kWh`
  return (
    <group position={POS.backup_device}>
      {Array.from({ length: n }).map((_, i) => (
        <group key={i} position={[i * 2.1, 0, 0]}>
          <mesh position={[0, 0.12, 0]} receiveShadow><boxGeometry args={[2.0, 0.24, 3.6]} /><meshStandardMaterial color="#64748B" /></mesh>
          <mesh position={[0, 1.2, 0]} castShadow><boxGeometry args={[1.85, 1.9, 3.4]} /><meshStandardMaterial map={ribs} roughness={0.55} /></mesh>
          <mesh position={[0, 1.75, 0]}><boxGeometry args={[1.87, 0.18, 3.42]} /><meshStandardMaterial color="#2F6FEB" /></mesh>
          <mesh position={[0, 2.3, -0.8]} castShadow><boxGeometry args={[1.0, 0.35, 0.8]} /><meshStandardMaterial color="#CBD5E1" metalness={0.5} /></mesh>
          {[-0.45, 0.45].map((x) => <mesh key={x} position={[x, 1.15, 1.705]}><planeGeometry args={[0.8, 1.6]} /><meshStandardMaterial color="#E2E8F0" /></mesh>)}
          <mesh position={[0.75, 1.9, 1.71]}><circleGeometry args={[0.06, 12]} /><meshBasicMaterial color="#22C55E" /></mesh>
        </group>
      ))}
      {/* charge gauge */}
      <mesh position={[-1.3, 0.6, 1.2]}><boxGeometry args={[0.22, 0.85, 0.22]} /><meshStandardMaterial color="#1E293B" /></mesh>
      <mesh ref={fill} position={[-1.3, 0.6, 1.2]}><boxGeometry args={[0.24, 0.8, 0.24]} /><meshStandardMaterial color="#22C55E" emissive="#22C55E" emissiveIntensity={0.8} /></mesh>
      <Label position={[(n - 1) * 1.05, 3.1, 0]} color="#22C55E">{kwh > 0 ? `${relocatable ? 'Battery containers' : 'Backup Device'}${type ? ` · ${type}` : ''} · ${size}${relocatable ? ' · moves' : ''}` : 'Hydrogen store'}</Label>
    </group>
  )
}

/** Generator set: skid and fuel tank, louvred enclosure, radiator grille, exhaust stack; smoke only while running. */
export function GeneratorSet({ kva, frameRef }: { kva: number; frameRef: FrameRef }) {
  const louvre = useMemo(() => stripes('#F1F5F9', '#CBD5E1', false, 16), [])
  const puffs = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame(({ clock }) => {
    const on = frameRef.current.generator_kw > 1 || frameRef.current.fuel_cell_kw > 1
    if (!puffs.current) return
    for (let i = 0; i < 12; i++) {
      const t = (clock.elapsedTime * 0.6 + i / 12) % 1
      dummy.position.set(0.95 + Math.sin(t * 6 + i) * 0.15, 2.1 + t * 2.2, 0)
      const s = on ? 0.12 + t * 0.35 : 0
      dummy.scale.set(s, s, s); dummy.updateMatrix(); puffs.current.setMatrixAt(i, dummy.matrix)
    }
    puffs.current.instanceMatrix.needsUpdate = true
  })
  if (kva <= 0) return null
  return (
    <group position={POS.gen}>
      <mesh position={[0, 0.2, 0]} castShadow><boxGeometry args={[3.0, 0.4, 1.6]} /><meshStandardMaterial color="#475569" /></mesh>
      <mesh position={[0, 0.95, 0]} castShadow><boxGeometry args={[2.7, 1.1, 1.4]} /><meshStandardMaterial map={louvre} roughness={0.6} /></mesh>
      <mesh position={[0, 1.2, 0]}><boxGeometry args={[2.72, 0.14, 1.42]} /><meshStandardMaterial color="#EF4444" /></mesh>
      <mesh position={[-1.36, 0.95, 0]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[1.2, 0.9]} /><meshStandardMaterial color="#1E293B" /></mesh>
      <mesh position={[0.95, 1.85, 0]}><cylinderGeometry args={[0.1, 0.12, 0.9, 12]} /><meshStandardMaterial color="#334155" metalness={0.6} /></mesh>
      <mesh position={[0.95, 2.33, 0]}><cylinderGeometry args={[0.18, 0.18, 0.05, 12]} /><meshStandardMaterial color="#334155" /></mesh>
      <instancedMesh ref={puffs} args={[undefined, undefined, 12]}><sphereGeometry args={[1, 8, 8]} /><meshStandardMaterial color="#9AA3AD" transparent opacity={0.45} /></instancedMesh>
      <Label position={[0, 2.9, 0]} color="#EF4444">{`Generator · ${Math.round(kva)} kVA`}</Label>
    </group>
  )
}

/**
 * Grid connection: a lattice transmission tower with insulators, three sagging conductors to a pole-mounted
 * transformer at the hospital. Conductors glow blue when the grid is on and pulse red during an outage.
 */
export function GridTower({ frameRef }: { frameRef: FrameRef }) {
  const wireMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2F6FEB', emissive: '#2F6FEB', emissiveIntensity: 0.5 }), [])
  const beacon = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const on = !!frameRef.current.grid_available
    wireMat.color.set(on ? '#2F6FEB' : '#EF4444'); wireMat.emissive.set(on ? '#2F6FEB' : '#EF4444'); wireMat.emissiveIntensity = on ? 0.5 : 0.3 + 0.5 * Math.abs(Math.sin(clock.elapsedTime * 6))
    if (beacon.current) beacon.current.visible = !on
  })
  const { struts, wires, tips } = useMemo(() => {
    const H = 8.5, base = 0.9, top = 0.3, V = THREE.Vector3
    const leg = (sx: number, sz: number, y: number) => { const w = base + (top - base) * (y / H); return new V(sx * w, y, sz * w) }
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    const s: [THREE.Vector3, THREE.Vector3, number][] = []
    const levels = [0, 1.7, 3.4, 5.1, 6.8, H]
    corners.forEach(([x, z]) => s.push([leg(x, z, 0), leg(x, z, H), 0.07]))
    for (let k = 0; k < levels.length - 1; k++) {
      for (let c = 0; c < 4; c++) {
        const [x1, z1] = corners[c], [x2, z2] = corners[(c + 1) % 4]
        s.push([leg(x1, z1, levels[k]), leg(x2, z2, levels[k + 1]), 0.03])   // X bracing on every face
        s.push([leg(x2, z2, levels[k]), leg(x1, z1, levels[k + 1]), 0.03])
        s.push([leg(x1, z1, levels[k + 1]), leg(x2, z2, levels[k + 1]), 0.035])
      }
    }
    // cross-arms and the three insulator tips (phases)
    s.push([new V(-2.0, 6.9, 0), new V(2.0, 6.9, 0), 0.06]); s.push([new V(-1.4, 8.0, 0), new V(1.4, 8.0, 0), 0.05])
    const tipLocal = [new V(-1.9, 6.4, 0), new V(1.9, 6.4, 0), new V(0, 7.5, 0)]
    const g = POS.grid, p = POS.pole
    const poleTips = [new V(-0.6, 4.6, 0), new V(0.6, 4.6, 0), new V(0, 5.0, 0)]
    const w = tipLocal.map((t, i) => {
      const a = t.clone().add(g), b = poleTips[i].clone().add(p)
      const mid = a.clone().lerp(b, 0.5); mid.y -= 1.2   // conductor sag
      return new THREE.QuadraticBezierCurve3(a, mid, b)
    })
    return { struts: s, wires: w, tips: tipLocal }
  }, [])
  const pole = POS.pole
  return (
    <group>
      <group position={POS.grid}>
        {struts.map(([a, b, r], i) => <Strut key={i} a={a} b={b} r={r} />)}
        {tips.map((t, i) => <mesh key={i} position={[t.x, t.y + 0.25, t.z]}><cylinderGeometry args={[0.07, 0.07, 0.5, 8]} /><meshStandardMaterial color="#E2E8F0" roughness={0.3} /></mesh>)}
        <mesh ref={beacon} position={[0, 9.2, 0]}><octahedronGeometry args={[0.35]} /><meshStandardMaterial color="#EF4444" emissive="#EF4444" emissiveIntensity={1.5} /></mesh>
        <Label position={[0, 10.0, 0]} color="#2F6FEB">Grid</Label>
      </group>
      {/* pole-mounted transformer and the service drop into the hospital */}
      <group position={pole}>
        <mesh position={[0, 2.6, 0]} castShadow><cylinderGeometry args={[0.1, 0.14, 5.2, 10]} /><meshStandardMaterial color="#A8A29E" /></mesh>
        <mesh position={[0, 4.6, 0]}><boxGeometry args={[1.5, 0.08, 0.08]} /><meshStandardMaterial color="#64748B" /></mesh>
        <mesh position={[0.25, 3.6, 0]} castShadow><cylinderGeometry args={[0.3, 0.3, 0.7, 14]} /><meshStandardMaterial color="#94A3B8" metalness={0.5} /></mesh>
      </group>
      {wires.map((c, i) => <mesh key={i} material={wireMat}><tubeGeometry args={[c, 32, 0.03, 6, false]} /></mesh>)}
      <Strut a={new THREE.Vector3(pole.x + 0.25, 3.3, pole.z)} b={new THREE.Vector3(-1.2, 2.2, 2.0)} r={0.025} color="#334155" />
    </group>
  )
}
