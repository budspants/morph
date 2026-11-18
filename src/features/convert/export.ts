type SavePicker = (opts: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>

/**
 * Phone: native share sheet ("Save to Files", AirDrop…).
 * Desktop: system save dialog where supported, else a normal download.
 * Resolves false if the user backed out.
 */
export async function saveFile(blob: Blob, name: string): Promise<boolean> {
  const file = new File([blob], name, { type: blob.type })
  try {
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] })
      return true
    }
    const picker = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
    if (picker) {
      const ext = name.split('.').pop() ?? ''
      const handle = await picker({
        suggestedName: name,
        types: [{ description: `${ext.toUpperCase()} file`, accept: { [blob.type]: [`.${ext}`] } }],
      })
      const w = await handle.createWritable()
      await w.write(blob)
      await w.close()
      return true
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return false // user backed out
    // Half-supported APIs (e.g. a save dialog that can't write, as seen in Safari 26)
    // shouldn't block the export: fall through to a plain download.
    console.warn('Save dialog/share failed, downloading instead:', err)
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
  return true
}

/** Several files: one share sheet on phones, otherwise a single zip. */
export async function saveAll(outs: { blob: Blob; name: string }[]): Promise<boolean> {
  if (outs.length === 1) return saveFile(outs[0].blob, outs[0].name)
  const files = outs.map((o) => new File([o.blob], o.name, { type: o.blob.type }))
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files })
      return true
    } catch (err) {
      if ((err as Error).name === 'AbortError') return false
    }
  }
  const { zipSync } = await import('fflate')
  const entries: Record<string, Uint8Array> = {}
  for (const o of outs) {
    let name = o.name
    for (let n = 2; entries[name]; n++) name = o.name.replace(/(\.[^.]+)?$/, ` (${n})$1`) // same name twice
    entries[name] = new Uint8Array(await o.blob.arrayBuffer())
  }
  const zip = zipSync(entries, { level: 0 }) // media is already compressed
  return saveFile(new Blob([zip as BlobPart], { type: 'application/zip' }), `morph-${outs.length}-files.zip`)
}
