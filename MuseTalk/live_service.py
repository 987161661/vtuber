from __future__ import annotations

import asyncio
import os
import struct
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from types import SimpleNamespace

import torch
from fastapi import FastAPI, HTTPException, Request, Response
from transformers import WhisperModel

from musetalk.utils.audio_processor import AudioProcessor
from musetalk.utils.face_parsing import FaceParsing
from musetalk.utils.utils import load_all_model
import scripts.realtime_inference as realtime


ROOT = Path(__file__).resolve().parent
AVATAR_ID = "linglan_current"
AVATAR_VIDEO = ROOT.parent / "aituber-onair-main" / "packages" / "core" / "examples" / "react-purupuru-app" / "public" / "avatar" / "linglan-current" / "lipsync-source.mp4"
MAX_AUDIO_BYTES = 20 * 1024 * 1024


def detect_audio_suffix(data: bytes) -> str:
    if data[:4] == b"RIFF":
        return ".wav"
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return ".mp3"
    return ".audio"


class MuseTalkRuntime:
    def __init__(self) -> None:
        os.chdir(ROOT)
        self.device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
        self.args = SimpleNamespace(
            version="v15",
            extra_margin=10,
            parsing_mode="jaw",
            audio_padding_length_left=2,
            audio_padding_length_right=2,
            skip_save_images=False,
        )

        vae, unet, pe = load_all_model(
            unet_model_path="models/musetalkV15/unet.pth",
            vae_type="sd-vae",
            unet_config="models/musetalkV15/musetalk.json",
            device=self.device,
        )
        self.vae = vae
        self.unet = unet
        self.pe = pe.half().to(self.device)
        self.vae.vae = self.vae.vae.half().to(self.device)
        self.unet.model = self.unet.model.half().to(self.device)
        self.timesteps = torch.tensor([0], device=self.device)
        self.audio_processor = AudioProcessor(feature_extractor_path="models/whisper")
        self.weight_dtype = self.unet.model.dtype
        self.whisper = WhisperModel.from_pretrained("models/whisper")
        self.whisper = self.whisper.to(device=self.device, dtype=self.weight_dtype).eval()
        self.whisper.requires_grad_(False)
        self.face_parser = FaceParsing(left_cheek_width=90, right_cheek_width=90)

        realtime.args = self.args
        realtime.device = self.device
        realtime.vae = self.vae
        realtime.unet = self.unet
        realtime.pe = self.pe
        realtime.timesteps = self.timesteps
        realtime.audio_processor = self.audio_processor
        realtime.weight_dtype = self.weight_dtype
        realtime.whisper = self.whisper
        realtime.fp = self.face_parser

        self.avatar = realtime.Avatar(
            avatar_id=AVATAR_ID,
            video_path=str(AVATAR_VIDEO),
            bbox_shift=0,
            batch_size=20,
            preparation=not (ROOT / "results" / "v15" / "avatars" / AVATAR_ID).exists(),
        )

    def render(self, audio: bytes) -> tuple[bytes, bytes, float]:
        job_id = f"live-{uuid.uuid4().hex}"
        suffix = detect_audio_suffix(audio)
        input_path: Path | None = None
        normalized_path: Path | None = None
        output_path = ROOT / "results" / "v15" / "avatars" / AVATAR_ID / "vid_output" / f"{job_id}.mp4"
        transparent_path = output_path.with_suffix(".webm")
        started = time.perf_counter()
        try:
            with tempfile.NamedTemporaryFile(prefix="musetalk-", suffix=suffix, delete=False, dir=ROOT / "data" / "audio") as file:
                file.write(audio)
                input_path = Path(file.name)
            normalized_path = input_path.with_suffix(".normalized.wav")
            subprocess.run(
                [
                    "ffmpeg", "-y", "-v", "error", "-i", str(input_path),
                    "-ac", "1", "-ar", "24000", str(normalized_path),
                ],
                check=True,
                capture_output=True,
            )
            self.avatar.inference(str(normalized_path), job_id, 25, False)
            subprocess.run(
                [
                    "ffmpeg", "-y", "-v", "error", "-i", str(output_path),
                    "-an", "-vf",
                    "chromakey=0x00FF00:0.27:0.10,despill=green:mix=0.45,format=yuva420p",
                    "-c:v", "libvpx-vp9", "-crf", "28", "-b:v", "0",
                    "-auto-alt-ref", "0", "-pix_fmt", "yuva420p",
                    str(transparent_path),
                ],
                check=True,
                capture_output=True,
            )
            return (
                transparent_path.read_bytes(),
                normalized_path.read_bytes(),
                (time.perf_counter() - started) * 1000,
            )
        finally:
            if input_path:
                input_path.unlink(missing_ok=True)
            if normalized_path:
                normalized_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            transparent_path.unlink(missing_ok=True)


app = FastAPI(title="Local MuseTalk Service", docs_url=None, redoc_url=None)
render_lock = asyncio.Lock()
runtime: MuseTalkRuntime | None = None
startup_error: str | None = None


@app.on_event("startup")
async def load_runtime() -> None:
    global runtime, startup_error
    try:
        runtime = await asyncio.to_thread(MuseTalkRuntime)
    except Exception as error:
        startup_error = f"{type(error).__name__}: {error}"


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "ready": runtime is not None,
        "busy": render_lock.locked(),
        "device": str(runtime.device) if runtime else None,
        "error": startup_error,
    }


@app.post("/render")
async def render(request: Request, bundle: bool = False) -> Response:
    if runtime is None:
        raise HTTPException(status_code=503, detail=startup_error or "MuseTalk is loading")
    audio = await request.body()
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="Audio payload is empty or too large")

    async with render_lock:
        try:
            video, normalized_audio, elapsed_ms = await asyncio.to_thread(runtime.render, audio)
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"MuseTalk render failed: {type(error).__name__}") from error

    content = (
        struct.pack(">I", len(normalized_audio)) + normalized_audio + video
        if bundle
        else video
    )
    return Response(
        content=content,
        media_type="application/x-musetalk-bundle" if bundle else "video/webm",
        headers={
            "Cache-Control": "no-store",
            "X-MuseTalk-Render-Ms": f"{elapsed_ms:.0f}",
        },
    )
