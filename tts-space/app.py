"""Wilson Echo voice: Kokoro-82M (ONNX int8) on CPU. POST /tts {"text": "..."} -> audio/wav (24 kHz mono 16-bit)"""
import io, math, os, re, time
import numpy as np, soundfile as sf
import onnxruntime as ort
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from kokoro_onnx import Kokoro

MODEL = os.environ.get("KOKORO_MODEL", "kokoro-v1.0.int8.onnx")
VOICES = os.environ.get("KOKORO_VOICES", "voices-v1.0.bin")
SHARED = os.environ.get("WILSON_TTS_SECRET", "")  # worker sends X-Wilson-Key


def usable_cpus() -> int:
    """Cores we can actually use (respects cgroup CPU quota, e.g. Render free = fractional CPU)."""
    if os.environ.get("TTS_THREADS"):
        return max(1, int(os.environ["TTS_THREADS"]))
    n = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else (os.cpu_count() or 1)
    try:
        q, p = open("/sys/fs/cgroup/cpu.max").read().split()
        if q != "max":
            n = min(n, max(1, math.ceil(int(q) / int(p))))
    except Exception:
        try:
            q = int(open("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read()); p = int(open("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read())
            if q > 0:
                n = min(n, max(1, math.ceil(q / p)))
        except Exception:
            pass
    return max(1, n)


THREADS = usable_cpus()
so = ort.SessionOptions()
so.intra_op_num_threads = THREADS
so.inter_op_num_threads = 1
so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
kokoro = Kokoro.from_session(ort.InferenceSession(MODEL, so, providers=["CPUExecutionProvider"]), VOICES)
_t = time.time()
kokoro.create("Hi.", voice="am_echo", speed=1.1, lang="en-us")  # warm the graph once at startup
print(f"[tts] ready threads={THREADS} warmup={time.time()-_t:.2f}s", flush=True)
app = FastAPI()


@app.get("/")
@app.get("/health")
def health():
    return {"ok": True, "voice": "am_echo", "threads": THREADS}


@app.post("/tts")
async def tts(req: Request):
    if SHARED and req.headers.get("x-wilson-key") != SHARED:
        raise HTTPException(403, "forbidden")
    body = await req.json()
    text = re.sub(r"\s+", " ", str(body.get("text", ""))).strip()[:1200]
    if not text:
        raise HTTPException(400, "text required")
    speed = min(1.4, max(0.8, float(body.get("speed", 1.1))))
    t0 = time.time()
    samples, sr = await run_in_threadpool(kokoro.create, text, voice="am_echo", speed=speed, lang="en-us")
    buf = io.BytesIO()
    sf.write(buf, np.asarray(samples, dtype=np.float32), sr, format="WAV", subtype="PCM_16")
    dt = time.time() - t0
    print(f"[tts] {len(text)} chars -> {len(samples)/sr:.1f}s audio in {dt:.2f}s", flush=True)
    return Response(buf.getvalue(), media_type="audio/wav",
                    headers={"Cache-Control": "public, max-age=86400", "X-Gen-Seconds": f"{dt:.2f}"})
