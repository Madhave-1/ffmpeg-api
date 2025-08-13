# ffmpeg-api
ffmpeg-api
7) How to call the endpoints (examples)
A) Make a Shorts slideshow

bash
Copy
Edit
curl -X POST https://your-ffmpeg-api.onrender.com/make-video \
  -H "Content-Type: application/json" \
  -d '{
    "images": [
      "https://.../img1.jpg",
      "https://.../img2.jpg",
      "https://.../img3.jpg"
    ],
    "audioUrl": "https://.../voice.mp3",
    "perImageSec": 2,
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "fit": "contain"
  }' --output short.mp4
B) Make a Shorts slideshow with captions (Roman Hindi or Hindi)

bash
Copy
Edit
curl -X POST https://your-ffmpeg-api.onrender.com/make-video-captions \
  -H "Content-Type: application/json" \
  -d '{
    "images": ["https://.../a.jpg","https://.../b.jpg","https://.../c.jpg"],
    "audioUrl": "https://.../narration.mp3",
    "perImageSec": 2,
    "captions": [
      { "start": 0.0, "end": 2.0, "text": "Arey yaar, subah walk best hai!", "lang": "roman", "x": "center", "y": "h-240", "fontSize": 58 },
      { "start": 2.0, "end": 5.0, "text": "अच्छी सेहत, फ्रेश माइंड", "lang": "hi", "x": "center", "y": "h-240", "fontSize": 58 }
    ]
  }' --output short_caps.mp4
C) Burn SRT

bash
Copy
Edit
curl -X POST https://your-ffmpeg-api.onrender.com/burn-srt \
  -F "videoUrl=https://.../input.mp4" \
  -F "srtUrl=https://.../subs.srt" \
  --output subtitled.mp4
D) Concat videos

bash
Copy
Edit
curl -X POST https://your-ffmpeg-api.onrender.com/concat-videos \
  -H "Content-Type: application/json" \
  -d '{"videos":["https://.../v1.mp4","https://.../v2.mp4","https://.../v3.mp4"]}' \
  --output joined.mp4
E) Transcode

bash
Copy
Edit
curl -X POST https://your-ffmpeg-api.onrender.com/transcode \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"https://.../in.mp4","width":1080,"height":1920,"fps":30,"videoBitrate":"3500k"}' \
  --output out.mp4
F) Mix audio (voice + bg music)

bash
Copy
Edit
curl -X POST https://your-ffmpeg-api.onrender.com/mix-audio \
  -H "Content-Type: application/json" \
  -d '{"voiceUrl":"https://.../voice.mp3","musicUrl":"https://.../bg.mp3","voiceGain":1.0,"musicGain":0.25}' \
  --output mix.m4a
G) Thumbnail

bash
Copy
Edit
curl -X POST https://your-ffmpeg-api.onrender.com/thumbnail \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"https://.../in.mp4","timeSec":0.7}' \
  --output thumb.jpg
H) Probe

bash
Copy
Edit
curl -X POST https://your-ffmpeg-api.onrender.com/probe \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"https://.../in.mp4"}'
Notes & tips
Hindi/Roman captions: Provided via /make-video-captions using drawtext. You can position text with x/y and tweak fontSize.

Fonts: Ensure the two Noto fonts exist at /app/fonts/.... (Render copies your repo; you can commit the fonts or apt-get system Noto fonts in Docker. We did both for safety.)

Performance: Render Free will sleep on inactivity; first request after sleep has a cold start (a few seconds).

File sizes: For big inputs, consider uploading to object storage (Supabase/AWS) and pass URLs (the API already supports URLs).

Security: If you go public, add a simple API key check in headers before processing.

