# Wilson TTS (Edge TTS)

Free Microsoft neural voices via the `edge-tts` Python package. No API key, no model downloads.

- Default voice: `en-US-GuyNeural` (set `EDGE_VOICE` env var to change)
- Other good US male options: `en-US-ChristopherNeural`, `en-US-EricNeural`, `en-US-BrianNeural`
- Endpoint: `POST /tts` with JSON `{"text": "..."}` returns `audio/wav`
- Health: `GET /health`
