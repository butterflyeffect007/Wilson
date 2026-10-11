"""Wilson voice: Edge TTS (Microsoft neural voices) on CPU.
POST /tts {"text": "..."} -> audio/wav (24 kHz mono 16-bit)
Free, no API key, no model downloads. Voices: en-US-GuyNeural (default),
en-US-ChristopherNeural, en-US-EricNeural, en-US-BrianNeural, en-GB-RyanNeural.
"""
import asyncio, io, os, re, threading, time
import numpy as np, soundfile as sf
import edge_tts
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response

VOICE = os.environ.get("EDGE_VOICE", "en-US-GuyNeural")
RATE = os.environ.get("EDGE_RATE", "+5%")   # slightly faster than default
SHARED = os.environ.get("WILSON_TTS_SECRET", "")  # worker sends X-Wilson-Key

# Validate the voice exists at startup (fail fast if misconfigured)
async def _check_voice():
    try:
        voices = await edge_tts.list_voices()
        names = {v["ShortName"] for v in voices}
        if VOICE not in names:
            print(f"[tts] WARNING: voice {VOICE!r} not found; falling back to en-US-GuyNeural", flush=True)
            return "en-US-GuyNeural"
        return VOICE

VOICE = asyncio.run(_check_voice())
print(f"[tts] ready voice={VOICE} rate={RATE}", flush=True)

LOCK = threading.Lock()  # one synthesis at a time (network-bound, but keep it simple)
CHUNK = int(os.environ.get("TTS_CHUNK_CHARS", "300"))


def split_text(text: str) -> list[str]:
    parts, cur = [], ""
    for s in re.split(r"(?<=[.!?;:,])\s+", text):
        while len(s) > CHUNK:  # very long clause: cut on a space
            cut = s.rfind(" ", 0, CHUNK); cut = cut if cut > 20 else CHUNK
            if cur: parts.append(cur); cur = ""
            parts.append(s[:cut]); s = s[:cut].strip() if False else s[cut:].strip()
        if cur and len(cur) + 1 + len(s) > CHUNK:
            parts.append(cur); cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur: parts.append(cur)
    return parts


async def synth_async(text: str) -> tuple[np.ndarray, int]:
    communicate = edge_tts.Communicate(text, VOICE, rate=RATE)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    buf.seek(0)
    data, sr = sf.read(buf, dtype="float32")
    return np.asarray(data, dtype=np.float32), int(sr)


def synth(text: str) -> tuple[np.ndarray, int]:
    with LOCK:
        out, sr = [], 24000
        for part in split_text(text):
            a, sr = asyncio.run(synth_async(part))
            out.append(a)
        return np.concatenate(out), sr


app = FastAPI()


@app.get("/")
@app.get("/health")
def health():
    return {"ok": True, "voice": VOICE, "rate": RATE, "engine": "edge-tts"}


@app.post("/tts")
async def tts(req: Request):
    if SHARED and req.headers.get("x-wilson-key") != SHARED:
        raise HTTPException(403, "forbidden")
    body = await req.json()
    text = re.sub(r"\s+", " ", str(body.get("text", ""))).strip()[:1200]
    if not text:
        raise HTTPException(400, "text required")
    t0 = time.time()
    samples, sr = await asyncio.to_thread(synth, text)
    buf = io.BytesIO()
    sf.write(buf, np.asarray(samples, dtype=np.float32), sr, format="WAV", subtype="PCM_16")
    dt = time.time() - t0
    print(f"[tts] {len(text)} chars -> {len(samples)/sr:.1f}s audio in {dt:.2f}s", flush=True)
    return Response(buf.getvalue(), media_type="audio/wav",
                    headers={"Cache-Control": "public, max-age=86400", "X-Gen-Seconds": f"{dt:.2f}"})
