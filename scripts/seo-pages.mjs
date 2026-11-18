// After `vite build`: one static page per tool (own title, description, how-to and FAQ in the HTML, so
// search engines see real text; the app itself loads on top), a privacy page, and sitemap.xml.
// SITE_URL (e.g. https://morph.app) adds canonical links and the sitemap; SOURCE_URL links the source code.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'

const SITE = process.env.SITE_URL?.replace(/\/$/, '')
const SOURCE = process.env.SOURCE_URL
const shell = readFileSync('dist/index.html', 'utf8')
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const NO_UPLOAD = ['Are my files uploaded?', 'No. MORPH runs entirely in your browser, on your own device. Your files are never sent to a server, so they stay private even on public Wi-Fi.']
const FREE = ['Is it free?', 'Yes. There is no sign-up, no watermark and no file-size limit beyond what your device can handle.']

/** slug, <title>, meta description, h1, intro, steps, extra FAQ */
const PAGES = [
  ['mp4-to-mp3', 'MP4 to MP3 Converter – Free, No Upload | MORPH', 'Convert MP4 and other videos to MP3 in seconds, right in your browser. No upload, no sign-up, no limits.',
    'Convert MP4 to MP3', 'Pull the sound out of any video and save it as an MP3: lectures, podcasts, music videos, voice memos. MORPH also makes M4A, OGG and Opus, or lossless FLAC and WAV with “Studio quality”.',
    ['Drop your video above, or tap to choose it.', 'Tap <b>Audio only</b>.', 'Tap <b>Save</b>. Done.'],
    [['Which videos work?', 'MP4, MOV, MKV, WebM, AVI and most other video files your phone or camera makes.']]],
  ['add-captions-to-video', 'Add Captions to Video Free – Auto Subtitles, No Watermark | MORPH', 'Auto-generate captions for your video with on-device AI. Word highlight, pop and karaoke styles, burned in or as SRT. No upload.',
    'Add captions to a video, automatically', 'MORPH listens to your video and writes the captions for you, using the Whisper speech model running on your own device. Fix any word, pick a style (word highlight, pop or karaoke), then burn the captions into the video or download an SRT file.',
    ['Go to <b>Editor</b> and choose your video.', 'Under <b>Captions</b>, pick the language and tap <b>Auto captions</b>.', 'Choose a style and tap <b>Export MP4</b>, or <b>Download SRT</b>.'],
    [['Which languages?', 'English, Spanish, French, German, Portuguese, Italian, Dutch, Russian, Arabic, Hindi, Japanese, Korean and Chinese, or let it detect the language. Captions in Arabic, Hindi, Chinese, Japanese and Korean can be downloaded as SRT but not yet burned into the video.'], ['Do I need an internet connection?', 'Only the first time: the speech model (about 40 MB) downloads once and is kept on your device.']]],
  ['vertical-video', 'Make a Video Vertical (9:16) for TikTok, Reels & Shorts | MORPH', 'Turn a horizontal video into a 1080×1920 vertical video with blurred bars or crop to fill. Free, in your browser.',
    'Make a horizontal video vertical', 'Turn a wide 16:9 clip into a 9:16 vertical video for TikTok, Instagram Reels and YouTube Shorts. Keep the whole picture with a blurred background, or crop to fill the screen and let <b>Follow face</b> keep the speaker in the middle as they move, all on your device.',
    ['Drop your video above.', 'Tap <b>TikTok / Reels vertical</b>, or open it in the <b>Editor</b> and pick <b>9:16</b>.', 'Save, then post.'],
    [['Can I add captions too?', 'Yes. In the Editor, tap Auto captions and export: you get a captioned vertical video in one go.']]],
  ['compress-video', 'Compress Video to 8 MB, 25 MB or 50 MB – Free | MORPH', 'Shrink a video to fit Discord, email or WhatsApp limits. Pick the size, MORPH does the rest. No upload.',
    'Compress a video to a size', 'Too big to send? Pick a size (8, 10, 25 or 50 MB) and MORPH re-encodes the video to fit, lowering the resolution when it needs to so it still looks clean.',
    ['Drop your video above.', 'Tap <b>Shrink to a size</b> and pick the size.', 'Tap <b>Save</b>.'],
    [['Why 8 MB and 25 MB?', 'Those are common upload limits on Discord and email. 50 MB fits most messaging apps.']]],
  ['video-to-gif', 'Video to GIF Converter – Free, No Upload | MORPH', 'Turn any video clip into a GIF. Choose the start, length, size and frame rate. Runs on your device.',
    'Make a GIF from a video', 'Turn a moment from any video into a GIF. Pick where it starts, how long it lasts, its size and how smooth it is (8 to 24 frames per second).',
    ['Drop your video above.', 'Tap <b>Make a GIF</b>; open the options to set start and length.', 'Tap <b>Save</b>.'],
    []],
  ['mov-to-mp4', 'MOV to MP4 Converter – Free, Private | MORPH', 'Convert MOV, MKV, WebM and other videos to MP4 that plays everywhere. No upload, no watermark.',
    'Convert MOV to MP4', 'iPhone videos and screen recordings often come as MOV. “Phone-friendly video” turns them, or MKV and WebM files, into MP4 that plays on any phone, TV or website.',
    ['Drop your video above.', 'Tap <b>Phone-friendly video</b> (MP4 is the default; MOV, MKV and WebM are in the options).', 'Tap <b>Save</b>.'],
    []],
  ['heic-to-jpg', 'HEIC to JPG Converter – Free, Batch, No Upload | MORPH', 'Convert iPhone HEIC photos to JPG, PNG or WebP. Up to 50 at once, saved as one zip. Private: nothing is uploaded.',
    'Convert HEIC photos to JPG', 'iPhones save photos as HEIC, which many websites and Windows PCs can’t open. Convert them to JPG, PNG or WebP, one photo or up to 50 at once.',
    ['Drop your photos above.', 'Tap <b>Convert image</b> (JPG by default).', 'Tap <b>Save</b>, or <b>Save all</b> for a zip.'],
    []],
  ['resize-image', 'Resize Image Online – Square, Story, 50% | MORPH', 'Resize photos to 50%, 1080 wide, square 1080×1080 or story 1080×1920, and rename them in a batch. Free, private.',
    'Resize images', 'Make photos smaller, or crop them to the exact size a post needs: square 1080×1080, story 1080×1920, post 1080×1350, a width you type, or 75 / 50 / 25%. Rename a whole batch with a pattern like <i>trip-{n}</i>.',
    ['Drop one or more images above.', 'Open the options on <b>Resize image</b> and pick a size.', 'Tap <b>Convert</b>, then <b>Save</b>.'],
    []],
  ['compress-image', 'Compress Image to 100 KB, 250 KB or 1 MB | MORPH', 'Compress JPG and PNG photos to a target size for forms and uploads. Keeps the best quality that fits. No upload.',
    'Compress an image to a size', 'Need a photo under 100 KB for a form? Pick the size and MORPH finds the best quality that fits, so it isn’t crushed more than it has to be.',
    ['Drop your image above.', 'Open the options on <b>Compress image</b> and pick 100 KB, 250 KB, 500 KB, 1 MB, or type your own.', 'Tap <b>Convert</b>, then <b>Save</b>.'],
    []],
  ['remove-background', 'Remove Background from Photo – Free, Private | MORPH', 'Cut people out of photos in one tap: transparent PNG, or a white or black backdrop. On-device AI, nothing uploaded.',
    'Remove the background from a photo', 'Cut yourself out of a selfie or portrait for a profile picture, sticker or thumbnail. The AI runs on your own device, so even private photos stay private. Save as a transparent PNG, or put the person on white or black.',
    ['Drop your photo above.', 'Tap <b>Remove background</b> (options: transparent, white or black).', 'Tap <b>Save</b>.'],
    [['Does it work on objects?', 'It’s made for people. Products, pets and things aren’t supported yet.'], ['Is there a download?', 'The first time, a small AI model (about 7 MB) downloads and is kept on your device.']]],
  ['ringtone-maker', 'Ringtone Maker – Make an iPhone Ringtone (M4R) Free | MORPH', 'Cut any song or video into a ringtone: M4R for iPhone or MP3 for Android. Free, in your browser.',
    'Make a ringtone', 'Turn any song or video into a ringtone: pick the start and length, and save it as M4R for iPhone or MP3 for Android.',
    ['Drop a song or video above.', 'Tap <b>Ringtone</b>; open the options to set start and length.', 'Tap <b>Save</b>.'],
    []],
  ['trim-video', 'Trim and Cut Video Online – Free, No Watermark | MORPH', 'Trim, split and cut videos, change speed, reverse, rotate and add music. A free video editor that runs on your device.',
    'Trim and cut a video', 'Cut out the parts you don’t want, split a clip into pieces, change speed, reverse it, rotate or mirror it, add text, stickers and music. Undo anything.',
    ['Go to <b>Editor</b> and choose your video.', 'Move the playhead and use <b>Split at playhead</b>, <b>Trim start</b> or <b>Trim end</b>.', 'Tap <b>Export MP4</b>.'],
    []],
  ['extract-frames', 'Extract Frames from Video – Save Video as Images | MORPH', 'Save frames from a video as images: one every ½, 1, 2, 5 or 10 seconds. Free, private, in your browser.',
    'Extract frames from a video', 'Save stills from a video as images: one every half second up to one every 10 seconds, downloaded together as a zip.',
    ['Drop your video above.', 'Tap <b>Extract frames</b>; open the options to choose how often.', 'Tap <b>Save</b>.'],
    []],
]

const EDITOR_PAGES = ['add-captions-to-video', 'trim-video'] // these tools live in the Editor tab

const links = (except) =>
  PAGES.filter((p) => p[0] !== except).map(([slug, , , h1]) => `<a href="/${slug}/">${esc(h1.replace(/,.*$/, ''))}</a>`).join(' · ')
const footer = (slug) =>
  `<p class="seo-links">${links(slug)}</p><p class="seo-links"><a href="/">Home</a> · <a href="/privacy/">Privacy</a>${SOURCE ? ` · <a href="${esc(SOURCE)}">Source code (GPL)</a>` : ''}</p>`

const STYLE = `<style>.seo{max-width:48rem;margin:0 auto;padding:2rem 1rem 8rem;color:rgb(255 255 255/.72);font:15px/1.6 'Inter Variable',Inter,system-ui,sans-serif}.seo h1,.seo h2{color:#fff;line-height:1.25}.seo h1{font-size:1.6rem;margin:0 0 .75rem}.seo h2{font-size:1.1rem;margin:1.75rem 0 .5rem}.seo a{color:#9d8bff}.seo ol{padding-left:1.25rem;list-style:decimal}.seo-links{font-size:13px;margin-top:1.5rem}</style>`

function page({ slug, title, desc, body, headline, tab }) {
  const url = SITE ? `${SITE}/${slug ? slug + '/' : ''}` : null
  let html = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(desc)}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(title)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(desc)}`)
  if (headline) html = html.replace('<html lang="en">', `<html lang="en" data-headline="${esc(headline)}"${tab ? ` data-tab="${tab}"` : ''}>`)
  // AdSense site verification (no ads load from this; the Ad component does that once a slot is set).
  if (process.env.VITE_ADSENSE_CLIENT) html = html.replace('</head>', `<meta name="google-adsense-account" content="${esc(process.env.VITE_ADSENSE_CLIENT)}" />\n</head>`)
  if (url) html = html.replace('</head>', `<link rel="canonical" href="${url}" /><meta property="og:url" content="${url}" />\n</head>`)
  return html.replace('</head>', `${STYLE}\n</head>`).replace('</body>', `<main class="seo">${body}</main>\n</body>`)
}
const write = (slug, html) => {
  mkdirSync(`dist/${slug}`, { recursive: true })
  writeFileSync(`dist/${slug}/index.html`, html)
}
const faq = (items) => items.map(([q, a]) => `<h2>${esc(q)}</h2><p>${a}</p>`).join('')

for (const [slug, title, desc, h1, intro, steps, extra] of PAGES) {
  const body = `<h2>${esc(h1)}</h2><p>${intro}</p><h2>How to do it</h2><ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>${faq([...extra, NO_UPLOAD, FREE])}${footer(slug)}`
  write(slug, page({ slug, title, desc, body, headline: h1, tab: EDITOR_PAGES.includes(slug) ? 'editor' : undefined }))
}

// Home: keep its title and description, add the intro and links.
writeFileSync('dist/index.html', page({
  slug: '',
  title: shell.match(/<title>([^<]*)/)[1],
  desc: shell.match(/<meta name="description" content="([^"]*)/)[1],
  body: `<h1>Private video, audio and image tools</h1><p>MORPH converts, edits and captions your files right in the browser. Nothing is uploaded: the work happens on your phone or computer, so it’s fast, free and private. It even works offline once it’s loaded.</p>${faq([NO_UPLOAD, FREE, ['Can I install it?', 'Yes. On iPhone, tap Share then “Add to Home Screen”. On Android and desktop Chrome, use “Install app” in the menu.']])}${footer('')}`,
}))

const privacy = `<h1>Privacy</h1>
<p><b>Your files never leave your device.</b> MORPH processes video, audio and images inside your browser. They are not uploaded to us or anyone else.</p>
<h2>What is stored, and where</h2><p>Files you convert can be kept in this browser’s Library (on your device, in its own storage) so you can find them again. Your settings are saved the same way. Delete them any time in the Library, or by clearing this site’s data in your browser.</p>
<h2>What is downloaded</h2><p>The app itself comes from our web host. The first time you use auto captions or background removal, the AI model downloads from Hugging Face (huggingface.co); like any website, they see your IP address, not your files.</p>
<h2>Ads</h2><p>The free version may show ads from Google AdSense. Google and its partners can use cookies to show and measure ads. Where the law requires it, we ask for your consent first, and you can change your choice at any time. See <a href="https://policies.google.com/technologies/ads">how Google uses data from sites that use its services</a>. Ads never see your files.</p>
<h2>Payments</h2><p>If you buy “Remove ads”, Stripe handles the payment as the seller of record. They process your payment details; we never see them. To keep ads off, your purchase code (a Stripe checkout ID) is stored on your device, and MORPH asks Stripe once whether it was paid.</p>
<h2>Analytics and accounts</h2><p>There are no accounts. We don’t run our own analytics or tracking.</p>
<h2>Contact</h2><p>${SOURCE ? `Questions: open an issue on <a href="${esc(SOURCE)}">the project’s GitHub page</a>.` : 'Questions: see the project’s GitHub page.'}</p>
<p class="seo-links">Last updated ${new Date().toISOString().slice(0, 10)}</p>${footer('privacy')}`
write('privacy', page({ slug: 'privacy', title: 'Privacy | MORPH', desc: 'MORPH processes your files on your device. What is stored, what is downloaded, ads and payments.', body: privacy }))

// AdSense needs /ads.txt naming the publisher (VITE_ADSENSE_CLIENT is "ca-pub-…").
const client = process.env.VITE_ADSENSE_CLIENT
if (client) writeFileSync('dist/ads.txt', `google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`)

if (SITE) {
  const urls = ['', ...PAGES.map((p) => p[0] + '/'), 'privacy/']
  writeFileSync('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}/${u}</loc></url>`).join('\n')}\n</urlset>\n`)
  appendFileSync('dist/robots.txt', `Sitemap: ${SITE}/sitemap.xml\n`)
}
console.log(`✓ ${PAGES.length} tool pages + privacy${SITE ? ' + sitemap' : ' (no SITE_URL: no canonical links or sitemap)'}`)
