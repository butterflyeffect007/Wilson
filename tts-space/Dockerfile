FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl libsndfile1 espeak-ng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# 512 MB free tier: single malloc arena + aggressive trim keeps peak RSS ~300 MB (vs ~700 MB default)
ENV MALLOC_ARENA_MAX=1 MALLOC_TRIM_THRESHOLD_=0 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 7860
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-7860}"]
