# MORPH

Convert, edit and caption video, audio and images — privately, in your browser. Files never leave your device.

- **Convert:** video to MP3, shrink videos, GIFs, frames, ringtones, phone-ready and vertical videos, images (HEIC too), batches of up to 50 files
- **Video editor:** trim and split, 9:16 / 1:1 / 4:5 crops with blur or fill, **Follow face** (the crop follows the speaker), rotate, mirror, reverse, speed, looks
- **Auto captions:** on-device Whisper speech-to-text, word highlight / pop / karaoke, burned in or as SRT
- **Cut silences** in one tap, and **reduce background noise** in voices
- **Text, stickers and music**, with the music ducking automatically under speech
- **Export to a size:** fit under 8 / 25 / 50 MB
- **Image tools:** remove the background (people, on-device AI), resize, crop to square or story, compress to a size, batch rename
- **Audio editor:** cut, fade, effects, EQ, BPM

Everything runs on your device with [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) and
[transformers.js](https://github.com/huggingface/transformers.js). The only downloads are the AI models
(from Hugging Face, the first time you use captions or background removal). It works offline after the first visit.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run dev:phone  # HTTPS on your Wi-Fi, to test on a real phone
npm run build      # production build in dist/
npm run test:e2e   # Playwright: Chrome, Safari, Android and iPhone profiles
```

Stack: React 19, Vite, Tailwind CSS 4, TypeScript. Needs Node 22+; the tests also need `ffmpeg` and,
on macOS, `say` for the speech tests.

## Licence

MORPH is free software under the [GNU GPL v3 or later](LICENSE). It bundles FFmpeg (GPL) and other
open-source parts listed in [NOTICE.md](NOTICE.md).
