import { useEffect, useState } from 'react'

/**
 * A blob: URL that lives as long as the component. Made inside the effect, not in useMemo:
 * React StrictMode runs effect cleanup once on mount, which would revoke a memoized URL
 * that the remount then keeps using.
 */
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return setUrl(undefined)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}
