# Third-party software

MORPH is licensed under the GNU General Public License v3.0 or later (see `LICENSE`). It includes or
downloads the following, each under its own licence:

| Component | Use | Licence |
| --- | --- | --- |
| [FFmpeg](https://ffmpeg.org) via [@ffmpeg/core](https://github.com/ffmpegwasm/ffmpeg.wasm) 0.12 (with x264, libass, FreeType) | All video and audio processing | GPL-2.0-or-later |
| [@ffmpeg/ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm), @ffmpeg/util | Runs FFmpeg in a worker | MIT |
| [transformers.js](https://github.com/huggingface/transformers.js) | Runs the speech model | Apache-2.0 |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | Model runtime | MIT |
| [Whisper](https://github.com/openai/whisper) tiny/base, [onnx-community](https://huggingface.co/onnx-community) builds | Speech-to-text, downloaded on first use | MIT |
| [MODNet](https://github.com/ZHKKKe/MODNet) ([Xenova/modnet](https://huggingface.co/Xenova/modnet) ONNX build) | Background removal, downloaded on first use | Apache-2.0 |
| [MediaPipe](https://github.com/google-ai-edge/mediapipe) Tasks Vision and BlazeFace short-range model | “Follow face” face detection | Apache-2.0 |
| [Inter](https://rsms.me/inter/) via Fontsource | App and caption font | SIL OFL 1.1 |
| [React](https://react.dev) | UI | MIT |
| [Motion](https://motion.dev) | Animation | MIT |
| [fflate](https://github.com/101arrowz/fflate) | Zip downloads | MIT |
| [heic2any](https://github.com/alexcorvi/heic2any) | HEIC photos | MIT |

FFmpeg's source code is available from <https://ffmpeg.org/download.html> and the exact build scripts
from <https://github.com/ffmpegwasm/ffmpeg.wasm>.
