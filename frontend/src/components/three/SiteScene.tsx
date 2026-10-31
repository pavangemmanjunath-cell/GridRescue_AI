import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'
import type { SimRow } from '../../api/types'
import { Label } from './Label'
import { BlenderPart } from './BlenderPart'
import { BackupDeviceUnit, GeneratorSet, GridTower, POS, SolarArray, edgeOf } from './Equipment'
import { Ambulance, FlowRibbons, MapPins, People, SiteMap, Trees, type FlowSpec } from './SceneDetails'

export interface SimFrame {
  hour: number; load_kw: number; critical_kw: number; pv_kw: number; wind_kw: number; grid_import_kw: number; grid_available: number; outage_event: number
  backup_charge_kw: number; backup_discharge_kw: number; soc_pct: number; generator_kw: number; fuel_cell_kw: number; unserved_kw: number; unserved_critical_kw: number
}

/** Linear interpolation between hourly rows for a fractional hour. */
export function frameAt(rows: SimRow[], t: number): SimFrame {
  const h = ((t % 24) + 24) % 24
  const i0 = Math.floor(h), i1 = (i0 + 1) % 24, f = h - i0
  const a = rows[i0], b = rows[i1]
  const L = (k: keyof SimRow) => (a[k] as number) * (1 - f) + (b[k] as number) * f
  return {
    hour: h, load_kw: L('load_kw'), critical_kw: L('critical_kw'), pv_kw: L('pv_kw'), wind_kw: L('wind_kw'), grid_import_kw: L('grid_import_kw'),
    grid_available: a.grid_available, outage_event: a.outage_event, backup_charge_kw: L('backup_charge_kw'), backup_discharge_kw: L('backup_discharge_kw'),
    soc_pct: L('soc_pct'), generator_kw: L('generator_kw'), fuel_cell_kw: L('fuel_cell_kw'), unserved_kw: L('unserved_kw'), unserved_critical_kw: L('unserved_critical_kw'),
  }
}

export interface SceneConfig {
  pvKwp: number; backupKwh: number; windKw: number; generatorKva: number; hasUps: boolean; hasHydrogen: boolean; hasRiver: boolean; hasGrid: boolean; peakKw: number
  lat?: number; lng?: number; name?: string; backupType?: string
  /** Brief 12: the building's address under its name, and labels that say the kit is relocatable */
  address?: string; relocatable?: boolean
}

interface SceneProps { config: SceneConfig; frameRef: React.MutableRefObject<SimFrame> }

const HOSPITAL = new THREE.Vector3(0, 0, 0)

function sunPosition(hour: number): [number, number, number] {
  const a = ((hour - 6) / 12) * Math.PI // 6h → sunrise (east), 18h → sunset (west)
  return [Math.cos(a) * 40, Math.sin(a) * 30, -10]
}

function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#E9EEF3" roughness={1} />
      </mesh>
      {/* access road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 6]}><planeGeometry args={[3, 12]} /><meshStandardMaterial color="#CBD5E1" /></mesh>
    </group>
  )
}

function Hospital({ frameRef, peakKw, name, address, relocatable }: { frameRef: SceneProps['frameRef']; peakKw: number; name?: string; address?: string; relocatable?: boolean }) {
  const winMat = useRef<THREE.MeshStandardMaterial>(null)
  const crossMat = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(() => {
    const f = frameRef.current
    const served = 1 - Math.min(1, f.unserved_kw / Math.max(f.load_kw, 1))
    const critOk = f.unserved_critical_kw < 0.5
    const night = f.hour < 6 || f.hour > 18
    if (winMat.current) { winMat.current.emissiveIntensity = (night ? 1.6 : 0.4) * served; winMat.current.emissive.set(served > 0.98 ? '#ffe7a8' : '#ff9a3c') }
    if (crossMat.current) { crossMat.current.emissiveIntensity = critOk ? 1.2 : 0.2 + 0.8 * Math.abs(Math.sin(performance.now() / 150)); crossMat.current.emissive.set(critOk ? '#ff3b3b' : '#ff0000') }
  })
  const floors = Math.max(2, Math.min(6, Math.round(peakKw / 150)))
  const h = floors * 0.9
  return (
    <group position={HOSPITAL.toArray()}>
      <BlenderPart name="Hospital"><mesh position={[0, h / 2, 0]} castShadow receiveShadow><boxGeometry args={[6, h, 4]} /><meshStandardMaterial color="#F8FAFC" roughness={0.6} /></mesh></BlenderPart>
      <mesh position={[0, h + 0.06, 0]} castShadow><boxGeometry args={[6.3, 0.14, 4.3]} /><meshStandardMaterial color="#2F6FEB" roughness={0.5} /></mesh>
      {/* windows */}
      {Array.from({ length: floors }).map((_, fl) => Array.from({ length: 5 }).map((_, w) => (
        <mesh key={`${fl}-${w}`} position={[-2.2 + w * 1.1, 0.55 + fl * 0.9, 2.01]}><planeGeometry args={[0.6, 0.45]} /><meshStandardMaterial ref={fl === 0 && w === 0 ? winMat : undefined} color="#5b8def" emissive="#ffe7a8" emissiveIntensity={0.6} /></mesh>
      )))}
      {/* red cross */}
      <group position={[0, h + 0.02, 0]}>
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1.6, 0.5]} /><meshStandardMaterial ref={crossMat} color="#ff3b3b" emissive="#ff3b3b" emissiveIntensity={1} /></mesh>
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.5, 1.6]} /><meshStandardMaterial color="#ff3b3b" emissive="#ff3b3b" emissiveIntensity={1} /></mesh>
      </group>
      <Label position={[0, h + (address ? 1.5 : 0.9), 0]} color="#EF4444">{name ? (name.length > 42 ? name.slice(0, 40) + '…' : name) : 'HOSPITAL'}</Label>
      {address && <Label position={[0, h + 0.75, 0]} color="#94A3B8">{address}</Label>}
      {/* entrance canopy + steps */}
      <mesh position={[0, 1.15, 2.6]} castShadow><boxGeometry args={[2.4, 0.12, 1.2]} /><meshStandardMaterial color="#cbd5e1" /></mesh>
      {[-1.1, 1.1].map((x) => <mesh key={x} position={[x, 0.57, 3.1]}><cylinderGeometry args={[0.06, 0.06, 1.15, 8]} /><meshStandardMaterial color="#94a3b8" /></mesh>)}
      <mesh position={[0, 0.5, 2.03]}><planeGeometry args={[1.2, 1]} /><meshStandardMaterial color="#93c5fd" emissive="#bfdbfe" emissiveIntensity={0.5} /></mesh>
      {/* UPS cabinet */}
      <mesh position={[3.6, 0.5, 1.2]} castShadow><boxGeometry args={[0.8, 1, 0.8]} /><meshStandardMaterial color="#B8C4D9" /></mesh>
      <Label position={[3.6, 1.3, 1.2]} color="#B8C4D9">{relocatable ? 'Theatre UPS · 0 ms' : 'UPS'}</Label>
    </group>
  )
}

function Turbine({ kw, frameRef }: { kw: number; frameRef: SceneProps['frameRef'] }) {
  const rotor = useRef<THREE.Group>(null)
  useFrame((_, dt) => { const f = frameRef.current; if (rotor.current) rotor.current.rotation.z -= dt * (0.3 + (f.wind_kw / Math.max(kw, 1)) * 3.5) })
  if (kw <= 0) return null
  return (
    <group position={POS.wind.toArray()}>
      <mesh position={[0, 4, 0]}><cylinderGeometry args={[0.12, 0.25, 8, 12]} /><meshStandardMaterial color="#e8edf3" /></mesh>
      <group ref={rotor} position={[0, 8, 0.35]}>
        <mesh><sphereGeometry args={[0.3, 12, 12]} /><meshStandardMaterial color="#cfd8e3" /></mesh>
        {[0, 1, 2].map((i) => <mesh key={i} rotation={[0, 0, (i * 2 * Math.PI) / 3]} position={[Math.cos((i * 2 * Math.PI) / 3 + Math.PI / 2) * 1.6, Math.sin((i * 2 * Math.PI) / 3 + Math.PI / 2) * 1.6, 0]}><boxGeometry args={[0.25, 3.2, 0.06]} /><meshStandardMaterial color="#ffffff" /></mesh>)}
      </group>
      <Label position={[0, 10.2, 0]} color="#22B7E8">{`WIND ${kw} kW`}</Label>
    </group>
  )
}

function River() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#2b5fa8'; ctx.fillRect(0, 0, 256, 64)
    ctx.strokeStyle = 'rgba(180,220,255,0.55)'; ctx.lineWidth = 3
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, 10 + i * 10); for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, 10 + i * 10 + Math.sin(x / 14 + i) * 3); ctx.stroke() }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 1); return t
  }, [])
  useFrame((_, dt) => { tex.offset.x -= dt * 0.25 })
  return (
    <group position={POS.river.toArray()}>
      <mesh rotation={[-Math.PI / 2, 0, 0.15]} position={[0, 0.02, 0]}><planeGeometry args={[60, 5, 1, 1]} /><meshStandardMaterial map={tex} transparent opacity={0.92} roughness={0.2} metalness={0.1} /></mesh>
      <Label position={[-14, 0.6, 0]} color="#7FB2FF">RIVER</Label>
    </group>
  )
}

/** Who sends energy where, per frame: solar fills the backup device first, the grid tops it up, the rest feeds the hospital. */
function Flows({ config, frameRef }: SceneProps) {
  const flows = useMemo(() => {
    const pvToBat = (f: SimFrame) => Math.min(f.pv_kw, f.backup_charge_kw)
    const list: FlowSpec[] = []
    if (config.pvKwp > 0) list.push({ id: 'pv-h', from: POS.pv, to: edgeOf(POS.pv), color: '#F59E0B', power: (f) => f.pv_kw - pvToBat(f) })
    if (config.pvKwp > 0 && config.backupKwh > 0) list.push({ id: 'pv-b', from: POS.pv, to: POS.backup_device, color: '#F59E0B', power: pvToBat })
    if (config.backupKwh > 0) list.push({ id: 'b-h', from: POS.backup_device, to: edgeOf(POS.backup_device), color: '#22C55E', power: (f) => f.backup_discharge_kw })
    if (config.hasGrid) list.push({ id: 'g-h', from: POS.grid, to: edgeOf(POS.grid), color: '#2F6FEB', power: (f) => f.grid_import_kw - Math.max(0, f.backup_charge_kw - f.pv_kw) })
    if (config.hasGrid && config.backupKwh > 0) list.push({ id: 'g-b', from: POS.grid, to: POS.backup_device, color: '#2F6FEB', power: (f) => (f.grid_available ? Math.max(0, f.backup_charge_kw - f.pv_kw) : 0) })
    if (config.generatorKva > 0) list.push({ id: 'gen-h', from: POS.gen, to: edgeOf(POS.gen), color: '#EF4444', power: (f) => f.generator_kw })
    if (config.windKw > 0) list.push({ id: 'w-h', from: POS.wind, to: edgeOf(POS.wind), color: '#0EA5E9', power: (f) => f.wind_kw })
    if (config.hasHydrogen) list.push({ id: 'h2-h', from: POS.h2, to: edgeOf(POS.h2), color: '#8B5CF6', power: (f) => f.fuel_cell_kw })
    return list
  }, [config])
  return <FlowRibbons flows={flows} frameRef={frameRef} scale={config.peakKw} />
}

function Lighting({ frameRef }: { frameRef: SceneProps['frameRef'] }) {
  const sun = useRef<THREE.DirectionalLight>(null)
  const amb = useRef<THREE.AmbientLight>(null)
  const sunMesh = useRef<THREE.Mesh>(null)
  useFrame(({ scene }) => {
    const f = frameRef.current
    const [x, y, z] = sunPosition(f.hour)
    const day = Math.max(0, Math.min(1, (y + 6) / 20))
    if (sun.current) { sun.current.position.set(x, Math.max(y, -5), z); sun.current.intensity = 0.4 + day * 1.6 }
    if (amb.current) amb.current.intensity = 0.55 + day * 0.45
    if (sunMesh.current) { sunMesh.current.position.set(x, y, z); sunMesh.current.visible = y > -2 }
    // soft daylight sky; dusk-blue at night (never black, so the scene stays readable)
    const sky = new THREE.Color('#3B4F70').lerp(new THREE.Color('#E6EDF5'), day)
    scene.background = sky
    if (scene.fog) (scene.fog as THREE.Fog).color = sky
  })
  return (
    <>
      <ambientLight ref={amb} intensity={0.8} />
      <hemisphereLight args={['#ffffff', '#cbd5e1', 0.6]} />
      <directionalLight ref={sun} position={[20, 20, -10]} intensity={1.5} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-25} shadow-camera-right={25} shadow-camera-top={25} shadow-camera-bottom={-25} />
      <mesh ref={sunMesh}><sphereGeometry args={[1.6, 16, 16]} /><meshBasicMaterial color="#FFD97A" /></mesh>
      <fog attach="fog" args={['#E6EDF5', 55, 110]} />
    </>
  )
}

function NightSky({ frameRef }: { frameRef: SceneProps['frameRef'] }) {
  const g = useRef<THREE.Group>(null)
  useFrame(() => { const f = frameRef.current; if (g.current) g.current.visible = f.hour < 5.5 || f.hour > 18.5 })
  return <group ref={g}><Stars radius={80} depth={20} count={1500} factor={3} fade /></group>
}

export function SiteScene({ config, frameRef }: SceneProps) {
  // a wind design stands its turbine at the left of the site: frame the camera from the front so it is in view
  const wind = config.windKw > 0
  return (
    <Canvas key={wind ? 'wind-view' : 'site-view'} shadows camera={{ position: wind ? [14, 15, 33] : [24, 21, 24], fov: wind ? 40 : 34 }} dpr={[1, 1.75]} gl={{ antialias: true, preserveDrawingBuffer: true }} data-testid="three-canvas">
      <Suspense fallback={null}>
      <Lighting frameRef={frameRef} />
      <NightSky frameRef={frameRef} />
      <Ground />
      {config.lat != null && config.lng != null && <SiteMap lat={config.lat} lng={config.lng} />}
      <Trees />
      <Hospital frameRef={frameRef} peakKw={config.peakKw} name={config.name} address={config.address} relocatable={config.relocatable} />
      <People frameRef={frameRef} />
      <MapPins items={[
        config.pvKwp > 0 && { at: POS.pv, h: 3.4, color: '#F59E0B' },
        config.backupKwh > 0 && { at: POS.backup_device, h: 3.8, color: '#22C55E' },
        config.generatorKva > 0 && { at: POS.gen, h: 3.6, color: '#EF4444' },
        config.windKw > 0 && { at: POS.wind, h: 11.4, color: '#0EA5E9' },
      ].filter(Boolean) as { at: THREE.Vector3; h: number; color: string }[]} />
      <Ambulance />
      <Suspense fallback={null}><SolarArray kwp={config.pvKwp} frameRef={frameRef} relocatable={config.relocatable} /></Suspense>   {/* the panel photo loads on its own; the rest of the scene never waits for it */}
      <BackupDeviceUnit kwh={config.backupKwh} type={config.backupType} frameRef={frameRef} hydrogen={config.hasHydrogen} relocatable={config.relocatable} />
      <GeneratorSet kva={config.generatorKva} frameRef={frameRef} />
      <Turbine kw={config.windKw} frameRef={frameRef} />
      {config.hasGrid && <GridTower frameRef={frameRef} />}
      {config.hasRiver && <River />}
      <Flows config={config} frameRef={frameRef} />
      <OrbitControls maxPolarAngle={Math.PI / 2.05} minDistance={8} maxDistance={60} target={wind ? [-3, 4.5, 0] : [3, 1, -1.5]} enableDamping />
      </Suspense>
    </Canvas>
  )
}

