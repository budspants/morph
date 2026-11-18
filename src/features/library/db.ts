// Library storage (spec: IndexedDB). Every finished file lands here, on this device only.
import { useEffect, useState } from 'react'
import type { Kind } from '../convert/presets'

export type LibFile = {
  id: string
  name: string
  type: string
  size: number
  blob: Blob
  kind: Kind
  /** Original file name and the preset that made it. */
  source: string
  preset: string
  createdAt: number
}

const CHANGED = 'morph:library'
let dbp: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('morph', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbp = null
      reject(req.error)
    }
  })
  return dbp
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction('files', mode)
    const req = fn(t.objectStore('files'))
    t.oncomplete = () => resolve(req.result)
    t.onerror = t.onabort = () => reject(t.error ?? req.error)
  })
}

const kindOfType = (type: string): Kind => (type.startsWith('video') ? 'video' : type.startsWith('image') ? 'image' : 'audio')

/** Stores a finished file. Returns false if the device is out of space. */
export async function addFile(blob: Blob, name: string, source: string, preset: string): Promise<boolean> {
  // Ask once to keep files even when the device is low on space (Safari may say no).
  void navigator.storage?.persist?.().catch(() => {})
  const f: LibFile = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    type: blob.type,
    size: blob.size,
    blob,
    kind: kindOfType(blob.type),
    source,
    preset,
    createdAt: Date.now(),
  }
  try {
    try {
      await tx('readwrite', (s) => s.put(f))
    } catch {
      // Safari private mode can't store Blobs in IndexedDB; raw bytes still work.
      const { blob: b, ...rest } = f
      const data = await b.arrayBuffer()
      await tx('readwrite', (s) => s.put({ ...rest, data }))
    }
    window.dispatchEvent(new Event(CHANGED))
    return true
  } catch (err) {
    console.warn('Library full, file not kept:', err)
    return false
  }
}

export async function deleteFile(id: string) {
  await tx('readwrite', (s) => s.delete(id))
  window.dispatchEvent(new Event(CHANGED))
}

export async function listFiles(): Promise<LibFile[]> {
  const all = await tx<(LibFile & { data?: ArrayBuffer })[]>('readonly', (s) => s.getAll())
  return all
    .map(({ data, ...f }) => (data ? { ...f, blob: new Blob([data], { type: f.type }) } : f))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Live list of library files, newest first; refreshes on every change. */
export function useLibrary() {
  const [files, setFiles] = useState<LibFile[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => listFiles().then((f) => alive && setFiles(f)).catch(() => alive && setFiles([]))
    load()
    window.addEventListener(CHANGED, load)
    return () => {
      alive = false
      window.removeEventListener(CHANGED, load)
    }
  }, [])
  return files
}

/** Bytes used by this app and the browser's limit for it. */
export async function storageUse(): Promise<{ used: number; quota: number } | null> {
  const e = await navigator.storage?.estimate?.().catch(() => null)
  return e?.usage != null && e.quota ? { used: e.usage, quota: e.quota } : null
}
