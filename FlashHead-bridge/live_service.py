from __future__ import annotations

import asyncio
import hashlib
import io
import json
import logging
import os
import struct
import subprocess
import sys
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

import av
import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Request, Response


ROOT = Path(__file__).resolve().parent
COPYME_ROOT = Path(r"D:\copyme\OpenAvatarChat")
FLASHHEAD_ROOT = COPYME_ROOT / "src" / "handlers" / "avatar" / "flashhead" / "SoulX-FlashHead"
CHECKPOINT_DIR = COPYME_ROOT / "models" / "SoulX-FlashHead-1_3B"
WAV2VEC_DIR = COPYME_ROOT / "models" / "wav2vec2-base-960h"
PORTRAIT_PATH = (
    ROOT.parent
    / "aituber-onair-main"
    / "packages"
    / "core"
    / "examples"
    / "react-purupuru-app"
    / "public"
    / "avatar"
    / "linglan-current"
    / "reference.png"
)
MAX_AUDIO_BYTES = 8 * 1024 * 1024
OUTPUT_SAMPLE_RATE = 32_000
TRACE_LOG_PATH = ROOT / "logs" / "render-trace.jsonl"

logger = logging.getLogger("uvicorn.error")
logger.setLevel(logging.INFO)


def read_trace_text(request: Request) -> str | None:
    """Read the browser's already-sanitized speech text from a bounded header."""
    encoded = request.headers.get("x-avatar-text")
    if not encoded:
        return None
    try:
        return unquote(encoded)[:2_000]
    except Exception:
        return None


def write_render_trace(trace: dict[str, object]) -> None:
    """Append a locally readable trace without coupling request latency to logging."""
    TRACE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with TRACE_LOG_PATH.open("a", encoding="utf-8") as output:
        # ASCII escapes keep JSONL valid and portable across Windows consoles
        # even when the spoken text contains Chinese or emoji.
        output.write(json.dumps(trace, ensure_ascii=True) + "\n")


def read_recent_traces(limit: int) -> list[dict[str, object]]:
    if not TRACE_LOG_PATH.exists():
        return []
    rows: list[dict[str, object]] = []
    with TRACE_LOG_PATH.open("r", encoding="utf-8") as trace_file:
        for line in deque(trace_file, maxlen=limit * 3):
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                rows.append(row)
    return rows[-limit:]


class StreamingMp3Decoder:
    """Incrementally parse and decode one continuous MiniMax MP3 stream."""

    def __init__(self, sample_rate: int) -> None:
        self.sample_rate = sample_rate
        self._codec = av.CodecContext.create("mp3", "r")
        self._resampler = av.AudioResampler(
            format="flt",
            layout="mono",
            rate=sample_rate,
        )
        # MiniMax SSE fragments can end in the middle of an MP3 frame. PyAV's
        # generic parser occasionally emits that incomplete tail as a packet,
        # which later fails with "Header missing". Keep compressed bytes here
        # and only hand complete MP3 frames to the decoder.
        self._compressed = bytearray()
        self.discarded_bytes = 0
        self.decoded_frames = 0

    @staticmethod
    def _frame_length(header: bytes) -> int | None:
        if len(header) < 4 or header[0] != 0xFF or (header[1] & 0xE0) != 0xE0:
            return None
        version_bits = (header[1] >> 3) & 0x03
        layer_bits = (header[1] >> 1) & 0x03
        bitrate_index = (header[2] >> 4) & 0x0F
        sample_index = (header[2] >> 2) & 0x03
        padding = (header[2] >> 1) & 0x01
        if version_bits == 1 or layer_bits != 1 or bitrate_index in (0, 15) or sample_index == 3:
            return None

        mpeg1_bitrates = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)
        mpeg2_bitrates = (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
        sample_rates = (44_100, 48_000, 32_000)
        if version_bits == 3:  # MPEG-1
            bitrate = mpeg1_bitrates[bitrate_index]
            sample_rate = sample_rates[sample_index]
            return (144_000 * bitrate) // sample_rate + padding
        bitrate = mpeg2_bitrates[bitrate_index]
        divisor = 2 if version_bits == 2 else 4
        sample_rate = sample_rates[sample_index] // divisor
        return (72_000 * bitrate) // sample_rate + padding

    def _complete_frames(self, data: bytes, final: bool) -> list[bytes]:
        self._compressed.extend(data)
        frames: list[bytes] = []
        cursor = 0
        size = len(self._compressed)
        while cursor + 4 <= size:
            frame_length = self._frame_length(self._compressed[cursor : cursor + 4])
            if frame_length is None:
                cursor += 1
                self.discarded_bytes += 1
                continue
            if cursor + frame_length > size:
                break
            frames.append(bytes(self._compressed[cursor : cursor + frame_length]))
            cursor += frame_length
        if cursor:
            del self._compressed[:cursor]
        if final and self._compressed:
            self.discarded_bytes += len(self._compressed)
            self._compressed.clear()
        return frames

    def _decode_packets(self, packets) -> list[np.ndarray]:
        chunks: list[np.ndarray] = []
        for packet in packets:
            for frame in self._codec.decode(packet):
                for output in self._resampler.resample(frame):
                    chunks.append(
                        output.to_ndarray().reshape(-1).astype(np.float32, copy=False)
                    )
        return chunks

    def feed(self, data: bytes, final: bool = False) -> np.ndarray:
        frames = self._complete_frames(data, final)
        chunks = self._decode_packets(av.Packet(frame) for frame in frames)
        self.decoded_frames += len(frames)
        if final:
            for frame in self._codec.decode(None):
                for output in self._resampler.resample(frame):
                    chunks.append(
                        output.to_ndarray().reshape(-1).astype(np.float32, copy=False)
                    )
            for output in self._resampler.resample(None):
                chunks.append(
                    output.to_ndarray().reshape(-1).astype(np.float32, copy=False)
                )
        return np.concatenate(chunks) if chunks else np.empty(0, dtype=np.float32)

    def close(self) -> None:
        return


def encode_wav(audio: np.ndarray, sample_rate: int) -> bytes:
    import wave

    output = io.BytesIO()
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return output.getvalue()


def encode_transparent_webm(frames_rgb: np.ndarray, fps: int) -> bytes:
    if frames_rgb.ndim != 4 or frames_rgb.shape[-1] != 3:
        raise ValueError(f"unexpected frame shape: {frames_rgb.shape}")
    height, width = frames_rgb.shape[1:3]
    command = [
        "ffmpeg", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0", "-an",
        "-vf",
        (
            "chromakey=0x00FF00:0.24:0.08,despill=green:mix=0.40,"
            "scale=1024:1024:flags=lanczos,"
            "unsharp=5:5:0.55:3:3:0.15,format=yuva420p"
        ),
        "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8",
        "-crf", "18", "-b:v", "0", "-auto-alt-ref", "0",
        "-pix_fmt", "yuva420p", "-f", "webm", "pipe:1",
    ]
    result = subprocess.run(
        command,
        input=np.ascontiguousarray(frames_rgb, dtype=np.uint8).tobytes(),
        capture_output=True,
        check=True,
    )
    return result.stdout


class FlashHeadRuntime:
    def __init__(self) -> None:
        missing = [
            str(path)
            for path in (FLASHHEAD_ROOT, CHECKPOINT_DIR, WAV2VEC_DIR, PORTRAIT_PATH)
            if not path.exists()
        ]
        if missing:
            raise FileNotFoundError(f"FlashHead assets missing: {missing}")

        os.environ.setdefault("XFORMERS_IGNORE_FLASH_VERSION_CHECK", "1")
        sys.path.insert(0, str(FLASHHEAD_ROOT))
        original_cwd = Path.cwd()
        os.chdir(FLASHHEAD_ROOT)
        try:
            import flash_head.src.pipeline.flash_head_pipeline as pipeline_module
            from flash_head.inference import get_base_data, get_infer_params, get_pipeline

            # Stable eager execution starts faster and avoids one-off torch.compile stalls.
            pipeline_module.COMPILE_MODEL = False
            pipeline_module.COMPILE_VAE = False
            self.pipeline = get_pipeline(
                world_size=1,
                ckpt_dir=str(CHECKPOINT_DIR),
                model_type="lite",
                wav2vec_dir=str(WAV2VEC_DIR),
            )
            get_base_data(
                self.pipeline,
                cond_image_path_or_dir=str(PORTRAIT_PATH),
                base_seed=42,
                use_face_crop=False,
            )
            self.pipeline.rank = 1
            self.params = get_infer_params()
        finally:
            os.chdir(original_cwd)

        self.sample_rate = int(self.params["sample_rate"])
        self.fps = int(self.params["tgt_fps"])
        self.frame_num = int(self.params["frame_num"])
        self.motion_frames_num = int(self.params["motion_frames_num"])
        self.slice_frames = self.frame_num - self.motion_frames_num
        self.slice_samples = self.slice_frames * self.sample_rate // self.fps
        self.output_slice_samples = self.slice_frames * OUTPUT_SAMPLE_RATE // self.fps
        self.cached_samples = self.sample_rate * int(self.params["cached_audio_duration"])
        self.audio_end_idx = int(self.params["cached_audio_duration"]) * self.fps
        self.audio_start_idx = self.audio_end_idx - self.frame_num
        self.embedding_indices = (
            torch.arange(self.audio_start_idx, self.audio_end_idx).unsqueeze(1)
            + (torch.arange(5) - 2).unsqueeze(0)
        ).clamp(min=0, max=self.audio_end_idx - 1)
        self.reset()

    def reset(self) -> None:
        previous_decoder = getattr(self, "decoder", None)
        if previous_decoder is not None:
            previous_decoder.close()
        self.decoder = StreamingMp3Decoder(OUTPUT_SAMPLE_RATE)
        self.audio_context = deque([0.0] * self.cached_samples, maxlen=self.cached_samples)
        self.pending_16k = np.empty(0, dtype=np.float32)
        self.pending_output = np.empty(0, dtype=np.float32)
        self.pipeline.latent_motion_frames = self.pipeline.ref_img_latent[:, :1].clone()
        self.pipeline.generator = torch.Generator(device=self.pipeline.device).manual_seed(42)

    def _embedding(self, window: np.ndarray) -> torch.Tensor:
        embedding = self.pipeline.preprocess_audio(window, sr=self.sample_rate, fps=self.fps)
        return embedding[self.embedding_indices][None, ...].contiguous()

    def render(self, data: bytes, reset: bool, end: bool) -> tuple[bytes, bytes, int, float]:
        started = time.perf_counter()
        if reset:
            self.reset()

        if data:
            audio_output = self.decoder.feed(data, final=False)
            # 32 kHz -> 16 kHz is an exact 2:1 conversion for the model input.
            audio_16k = audio_output[::2].copy()
            self.pending_output = np.concatenate((self.pending_output, audio_output))
            self.pending_16k = np.concatenate((self.pending_16k, audio_16k))
        if end:
            tail_output = self.decoder.feed(b"", final=True)
            if tail_output.size:
                self.pending_output = np.concatenate((self.pending_output, tail_output))
                self.pending_16k = np.concatenate((self.pending_16k, tail_output[::2].copy()))
        real_pending_output_samples = self.pending_output.size

        if end and self.pending_16k.size % self.slice_samples:
            pad_16k = self.slice_samples - self.pending_16k.size % self.slice_samples
            self.pending_16k = np.pad(self.pending_16k, (0, pad_16k))
            self.pending_output = np.pad(self.pending_output, (0, pad_16k * 2))

        generated: list[np.ndarray] = []
        consumed_audio: list[np.ndarray] = []
        while self.pending_16k.size >= self.slice_samples:
            chunk_16k = self.pending_16k[: self.slice_samples]
            chunk_output = self.pending_output[: self.output_slice_samples]
            self.pending_16k = self.pending_16k[self.slice_samples :]
            self.pending_output = self.pending_output[self.output_slice_samples :]
            self.audio_context.extend(chunk_16k.tolist())
            embedding = self._embedding(np.asarray(self.audio_context, dtype=np.float32))
            sample = self.pipeline.generate(embedding.to(self.pipeline.device))
            frames = (
                ((sample[:, self.motion_frames_num :] + 1) / 2)
                .permute(1, 2, 3, 0)
                .clamp(0, 1)
                .mul(255)
                .byte()
                .cpu()
                .numpy()
            )
            generated.append(frames)
            consumed_audio.append(chunk_output)

        if not generated:
            return b"", b"", 0, (time.perf_counter() - started) * 1000

        frames_rgb = np.concatenate(generated, axis=0)
        output_audio = np.concatenate(consumed_audio)
        if end:
            # Do not make the listener hear padding added only for the final video slice.
            output_audio = output_audio[:real_pending_output_samples]
        video = encode_transparent_webm(frames_rgb, self.fps)
        audio = encode_wav(output_audio, OUTPUT_SAMPLE_RATE)
        return video, audio, len(frames_rgb), (time.perf_counter() - started) * 1000


app = FastAPI(title="FlashHead streaming bridge", docs_url=None, redoc_url=None)
runtime: FlashHeadRuntime | None = None
startup_error: str | None = None
render_lock = asyncio.Lock()


@app.on_event("startup")
async def load_runtime() -> None:
    global runtime, startup_error
    try:
        runtime = await asyncio.to_thread(FlashHeadRuntime)
    except Exception as error:
        startup_error = f"{type(error).__name__}: {error}"


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "ready": runtime is not None,
        "busy": render_lock.locked(),
        "device": str(runtime.pipeline.device) if runtime else None,
        "model": "SoulX-FlashHead Lite",
        "source": str(FLASHHEAD_ROOT),
        "error": startup_error,
    }


@app.get("/traces")
async def traces(limit: int = 20) -> dict[str, object]:
    safe_limit = min(max(limit, 1), 200)
    return {
        "items": await asyncio.to_thread(read_recent_traces, safe_limit),
        "log_path": str(TRACE_LOG_PATH),
    }


@app.post("/render")
async def render(request: Request, reset: bool = False, end: bool = False) -> Response:
    if runtime is None:
        raise HTTPException(status_code=503, detail=startup_error or "FlashHead is loading")
    data = await request.body()
    if (not data and not end) or len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="Audio payload is empty or too large")

    async with render_lock:
        try:
            video, audio, frame_count, elapsed_ms = await asyncio.to_thread(
                runtime.render, data, reset, end
            )
        except Exception as error:
            logger.exception(
                "render_failed bytes=%d reset=%s end=%s", len(data), reset, end
            )
            raise HTTPException(
                status_code=500,
                detail=f"FlashHead render failed: {type(error).__name__}: {error}",
            ) from error

    audio_sha = hashlib.sha256(data).hexdigest()[:12]
    trace = {
        "at": datetime.now().astimezone().isoformat(timespec="milliseconds"),
        "request_id": request.headers.get("x-avatar-request-id") or None,
        "sequence": request.headers.get("x-avatar-sequence") or None,
        "caller": request.headers.get("x-avatar-caller") or None,
        "source": request.headers.get("x-avatar-source") or None,
        "client_host": request.client.host if request.client else None,
        "client_port": request.client.port if request.client else None,
        "text": read_trace_text(request),
        "model": "SoulX-FlashHead Lite",
        "audio_bytes": len(data),
        "audio_sha256_12": audio_sha,
        "reset": reset,
        "end": end,
        "frames": frame_count,
        "render_ms": round(elapsed_ms),
        "mp3_frames": runtime.decoder.decoded_frames,
        "discarded_bytes": runtime.decoder.discarded_bytes,
        "status": 200 if video else 204,
    }
    await asyncio.to_thread(write_render_trace, trace)
    logger.info(
        "render_ok request_id=%s sequence=%s caller=%s bytes=%d sha=%s id3=%d reset=%s end=%s frames=%d render_ms=%.0f mp3_frames=%d discarded=%d",
        trace["request_id"], trace["sequence"], trace["caller"],
        len(data), audio_sha, data.count(b"ID3"),
        reset, end, frame_count, elapsed_ms,
        runtime.decoder.decoded_frames, runtime.decoder.discarded_bytes,
    )
    if not video:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})
    bundle = struct.pack(">I", len(audio)) + audio + video
    return Response(
        content=bundle,
        media_type="application/x-flashhead-bundle",
        headers={
            "Cache-Control": "no-store",
            "X-FlashHead-Render-Ms": f"{elapsed_ms:.0f}",
            "X-FlashHead-Frames": str(frame_count),
        },
    )
