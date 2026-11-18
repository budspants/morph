// Inter ExtraBold for burned-in captions. Plain WOFF (zlib), which ffmpeg.wasm's FreeType can
// read; WOFF2 would need brotli, which that build lacks. libass picks whichever subset has a glyph.
// shortcut: no CJK font yet; Chinese/Japanese/Korean captions won't burn in until one is added.
import cyr from '@fontsource/inter/files/inter-cyrillic-800-normal.woff?url'
import cyrExt from '@fontsource/inter/files/inter-cyrillic-ext-800-normal.woff?url'
import greek from '@fontsource/inter/files/inter-greek-800-normal.woff?url'
import greekExt from '@fontsource/inter/files/inter-greek-ext-800-normal.woff?url'
import latin from '@fontsource/inter/files/inter-latin-800-normal.woff?url'
import latinExt from '@fontsource/inter/files/inter-latin-ext-800-normal.woff?url'
import viet from '@fontsource/inter/files/inter-vietnamese-800-normal.woff?url'

const URLS = { latin, latinExt, cyr, cyrExt, greek, greekExt, viet }

export function captionFonts(): Promise<File[]> {
  return Promise.all(Object.entries(URLS).map(async ([k, u]) => new File([await (await fetch(u)).blob()], `font-${k}.woff`)))
}
