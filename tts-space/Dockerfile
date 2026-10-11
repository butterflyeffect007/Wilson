FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl libsndfile1 espeak-ng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# 512 MB free tier: single malloc arena + aggressive trim keeps peak RSS ~300 MB (vs ~700 MB default)
ENV MALLOC_ARENA_MAX=1 MALLOC_TRIM_THRESHOLD_=0 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN curl -fsSL -o kokoro-v1.0.int8.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx \
 && curl -fsSL -o voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
COPY app.py .
EXPOSE 7860
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-7860}"]
