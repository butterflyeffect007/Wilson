"""Wilson Echo voice: Kokoro-82M (ONNX int8) on CPU. POST /tts {"text": "..."} -> audio/wav"""
import io, os, re
import numpy as np, soundfile as sf
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from kokoro_onnx import Kokoro

MODEL = os.environ.get("KOKORO_MODEL", "kokoro-v1.0.int8.onnx")
VOICES = os.environ.get("KOKORO_VOICES", "voices-v1.0.bin")
SHARED = os.environ.get("WILSON_TTS_SECRET", "")  # worker sends X-Wilson-Key
kokoro = Kokoro(MODEL, VOICES)
app = FastAPI()

@app.get("/")
def health():
    return {"ok": True, "voice": "am_echo"}

@app.post("/tts")
async def tts(req: Request):
    if SHARED and req.headers.get("x-wilson-key") != SHARED:
        raise HTTPException(403, "forbidden")
    body = await req.json()
    text = re.sub(r"\s+", " ", str(body.get("text", ""))).strip()[:1200]
    if not text:
        raise HTTPException(400, "text required")
    speed = float(body.get("speed", 1.1))
    speed = min(1.4, max(0.8, speed))
    samples, sr = await run_in_threadpool(kokoro.create, text, voice="am_echo", speed=speed, lang="en-us")
    buf = io.BytesIO()
    sf.write(buf, np.asarray(samples, dtype=np.float32), sr, format="WAV", subtype="PCM_16")
    return Response(buf.getvalue(), media_type="audio/wav", headers={"Cache-Control": "public, max-age=86400"})
