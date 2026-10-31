import { Suspense, useEffect, useMemo, useState } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

/**
 * A part modelled in Blender (docs/blender/build_site_assets.py → /models/site.glb). When the file exists the named
 * object is drawn; when it does not, the children (the built-in primitives) are drawn instead — so the app looks the
 * same with or without Blender on the machine.
 */
const MODEL = '/models/site.glb'
let known: boolean | null = null
const listeners = new Set<(v: boolean) => void>()
function check() {
  if (known !== null) return
  // the dev server answers any path with index.html, so a 200 is not enough: the body must be a binary model
  fetch(MODEL, { method: 'HEAD' }).then((r) => { const ct = r.headers.get('content-type') ?? ''; known = r.ok && !ct.includes('text/html') && !ct.includes('text/plain') }).catch(() => { known = false }).finally(() => listeners.forEach((l) => l(!!known)))
}

export function useSiteModel() {
  const [ok, setOk] = useState<boolean>(!!known)
  useEffect(() => { if (known !== null) { setOk(known); return } listeners.add(setOk); check(); return () => { listeners.delete(setOk) } }, [])
  return ok
}

function Glb({ name, scale = 1 }: { name: string; scale?: number }) {
  const { scene } = useGLTF(MODEL)
  const obj = useMemo(() => {
    const src = scene.getObjectByName(name)
    if (!src) return null
    const c = src.clone(true)
    c.position.set(0, 0, 0)
    c.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true } })
    return c
  }, [scene, name])
  return obj ? <primitive object={obj} scale={scale} /> : null
}

export function BlenderPart({ name, scale, children }: { name: string; scale?: number; children: React.ReactNode }) {
  const ok = useSiteModel()
  if (!ok) return <>{children}</>
  return <Suspense fallback={<>{children}</>}><Glb name={name} scale={scale} /></Suspense>
}
