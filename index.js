import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import multer from "multer";
import { mkTmpDir, downloadToFile, runFFmpeg, runFFprobe } from "./utils.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const upload = multer({ dest: "uploads/" });

// Fonts (ensure these files exist — see project structure)
const FONT_LATIN = "/app/fonts/NotoSans-Regular.ttf";
const FONT_HINDI = "/app/fonts/NotoSansDevanagari-Regular.ttf";

// ============ Health & Version ============
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/version", async (req, res) => {
  try {
    const info = await runFFprobe(["-version"]);
    res.type("text/plain").send(info);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ============ Make video (images + audio) ============
/**
 * JSON body:
 * {
 *   "images": ["https://...jpg", ...]            // OR upload via multipart 'images'
 *   "audioUrl": "https://...mp3",                // optional
 *   "perImageSec": 2,                            // default 2
 *   "width": 1080, "height": 1920, "fps": 30,
 *   "fit": "cover" | "contain" (default: contain)
 * }
 *
 * Returns MP4 (1080x1920) slideshow, shortest with audio if provided.
 */
app.post("/make-video", async (req, res) => {
  try {
    const { images = [], audioUrl = null, perImageSec = 2, width = 1080, height = 1920, fps = 30, fit = "contain" } = req.body;
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: "images[] required (URLs)" });
    }

    const tmp = await mkTmpDir("make-");
    const listPath = path.join(tmp, "list.ffconcat");
    const imgPaths = [];

    // Download images
    for (let i = 0; i < images.length; i++) {
      const p = path.join(tmp, `img_${String(i).padStart(3, "0")}.jpg`);
      await downloadToFile(images[i], p);
      imgPaths.push(p);
    }

    // Build ffconcat file with durations
    // NOTE: repeat last image once without duration for correct timing
    let listTxt = "ffconcat version 1.0\n";
    for (const p of imgPaths) {
      listTxt += `file '${p}'\n`;
      listTxt += `duration ${perImageSec}\n`;
    }
    listTxt += `file '${imgPaths[imgPaths.length - 1]}'\n`;
    fs.writeFileSync(listPath, listTxt);

    const output = path.join(tmp, "out.mp4");
    const scalePad =
      fit === "cover"
        ? `scale=${width}:${height},crop=${width}:${height}`
        : `scale=${width}:-2:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

    const args = [
      "-safe", "0",
      "-f", "concat",
      "-i", listPath,
      ...(audioUrl ? ["-i", path.join(tmp, "audio.mp3")] : []),
      ...(audioUrl ? [] : []),
      ...(audioUrl ? [] : []),
    ];

    // Download audio if provided
    if (audioUrl) {
      await downloadToFile(audioUrl, path.join(tmp, "audio.mp3"));
    }

    args.push(
      "-vsync", "vfr",
      "-r", String(fps),
      "-vf", `${scalePad},format=yuv420p`,
      "-c:v", "libx264",
      ...(audioUrl ? ["-c:a", "aac"] : []),
      "-shortest",
      output
    );

    await runFFmpeg(args, "make-video");

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", 'inline; filename="short.mp4"');
    fs.createReadStream(output).pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============ Make video with captions ============
/**
 * JSON body:
 * {
 *   "images": ["https://...jpg", ...],
 *   "audioUrl": "https://...mp3",
 *   "perImageSec": 2,
 *   "width": 1080, "height": 1920, "fps": 30,
 *   "captions": [
 *     { "start": 0.0, "end": 2.0, "text": "Arey yaar, subah walk..." , "lang": "roman"|"hi",
 *       "x": "center", "y": "h-250", "fontSize": 48 }
 *   ]
 * }
 *
 * Uses drawtext for on-screen captions (works for Roman Hindi & Devanagari).
 */
app.post("/make-video-captions", async (req, res) => {
  try {
    const { images = [], audioUrl, perImageSec = 2, width = 1080, height = 1920, fps = 30, captions = [] } = req.body;
    if (!Array.isArray(images) || images.length === 0 || !audioUrl) {
      return res.status(400).json({ error: "images[] and audioUrl required" });
    }

    const tmp = await mkTmpDir("cap-");
    const listPath = path.join(tmp, "list.ffconcat");
    const imgPaths = [];

    for (let i = 0; i < images.length; i++) {
      const p = path.join(tmp, `img_${String(i).padStart(3, "0")}.jpg`);
      await downloadToFile(images[i], p);
      imgPaths.push(p);
    }
    await downloadToFile(audioUrl, path.join(tmp, "audio.mp3"));

    let listTxt = "ffconcat version 1.0\n";
    for (const p of imgPaths) {
      listTxt += `file '${p}'\n`;
      listTxt += `duration ${perImageSec}\n`;
    }
    listTxt += `file '${imgPaths[imgPaths.length - 1]}'\n`;
    fs.writeFileSync(listPath, listTxt);

    // Build drawtext overlay chain
    // Choose font per caption language
    const baseScale = `scale=${width}:-2:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
    const capFilters = captions.map((c, idx) => {
      const font = c.lang === "hi" ? FONT_HINDI : FONT_LATIN;
      const txt = (c.text || "").replace(/:/g, "\\:").replace(/'/g, "\\'");
      const x = c.x === "center" ? "(w-text_w)/2" : (c.x || "(w-text_w)/2");
      const y = c.y || "h-250";
      const fs = c.fontSize || 56;
      return `drawtext=fontfile='${font}':text='${txt}':x=${x}:y=${y}:fontsize=${fs}:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=12:line_spacing=6:enable='between(t,${c.start},${c.end})'`;
    });

    const vf = [baseScale, ...capFilters].join(",");

    const output = path.join(tmp, "out.mp4");
    const args = [
      "-safe", "0",
      "-f", "concat",
      "-i", listPath,
      "-i", path.join(tmp, "audio.mp3"),
      "-vsync", "vfr",
      "-r", String(fps),
      "-vf", vf,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      output
    ];

    await runFFmpeg(args, "make-video-captions");

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", 'inline; filename="short_captions.mp4"');
    fs.createReadStream(output).pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============ Burn SRT onto a video ============
/**
 * Multipart form:
 *  - video (file OR "videoUrl" in JSON)
 *  - subs (file OR "srtUrl" in JSON)
 */
app.post("/burn-srt", upload.fields([{ name: "video" }, { name: "subs" }]), async (req, res) => {
  try {
    const tmp = await mkTmpDir("srt-");
    let videoPath, srtPath;

    if (req.files?.video?.[0]) videoPath = req.files.video[0].path;
    else if (req.body.videoUrl) videoPath = await downloadToFile(req.body.videoUrl, path.join(tmp, "in.mp4"));
    else return res.status(400).json({ error: "Provide video or videoUrl" });

    if (req.files?.subs?.[0]) srtPath = req.files.subs[0].path;
    else if (req.body.srtUrl) srtPath = await downloadToFile(req.body.srtUrl, path.join(tmp, "in.srt"));
    else return res.status(400).json({ error: "Provide subs or srtUrl" });

    const output = path.join(tmp, "out.mp4");
    await runFFmpeg([
      "-i", videoPath,
      "-vf", `subtitles='${srtPath.replace(/'/g, "\\'")}'`,
      "-c:a", "copy",
      output
    ], "burn-srt");

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", 'inline; filename="subtitled.mp4"');
    fs.createReadStream(output).pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============ Concat multiple videos ============
/**
 * JSON body:
 * { "videos": ["https://...mp4", "..."] }
 */
app.post("/concat-videos", async (req, res) => {
  try {
    const { videos = [] } = req.body;
    if (!Array.isArray(videos) || videos.length === 0) {
      return res.status(400).json({ error: "videos[] required" });
    }
    const tmp = await mkTmpDir("concat-");
    const listPath = path.join(tmp, "list.txt");
    const lines = [];

    for (let i = 0; i < videos.length; i++) {
      const p = path.join(tmp, `v_${i}.mp4`);
      await downloadToFile(videos[i], p);
      lines.push(`file '${p}'`);
    }
    fs.writeFileSync(listPath, lines.join("\n"));

    const output = path.join(tmp, "out.mp4");
    await runFFmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output], "concat-videos");

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", 'inline; filename="concat.mp4"');
    fs.createReadStream(output).pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Transcode / resize / fps / bitrate ============
/**
 * JSON body:
 * {
 *   "videoUrl": "https://...mp4",
 *   "width": 1080, "height": 1920, "fps": 30, "videoBitrate": "3000k"
 * }
 */
app.post("/transcode", async (req, res) => {
  try {
    const { videoUrl, width, height, fps, videoBitrate } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl required" });

    const tmp = await mkTmpDir("trans-");
    const inPath = path.join(tmp, "in.mp4");
    await downloadToFile(videoUrl, inPath);
    const output = path.join(tmp, "out.mp4");

    const vf = (width && height)
      ? `scale=${width}:-2:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`
      : "format=yuv420p";

    const args = ["-i", inPath, "-vf", vf, "-c:v", "libx264"];
    if (fps) args.push("-r", String(fps));
    if (videoBitrate) args.push("-b:v", videoBitrate);
    args.push("-c:a", "aac", output);

    await runFFmpeg(args, "transcode");

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", 'inline; filename="transcoded.mp4"');
    fs.createReadStream(output).pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Mix audio (voice + music) ============
/**
 * JSON body:
 * {
 *   "voiceUrl": "https://...mp3",
 *   "musicUrl": "https://...mp3",
 *   "voiceGain": 1.0,
 *   "musicGain": 0.3
 * }
 */
app.post("/mix-audio", async (req, res) => {
  try {
    const { voiceUrl, musicUrl, voiceGain = 1.0, musicGain = 0.3 } = req.body;
    if (!voiceUrl || !musicUrl) return res.status(400).json({ error: "voiceUrl and musicUrl required" });

    const tmp = await mkTmpDir("mix-");
    const vPath = path.join(tmp, "voice.mp3");
    const mPath = path.join(tmp, "music.mp3");
    await downloadToFile(voiceUrl, vPath);
    await downloadToFile(musicUrl, mPath);
    const output = path.join(tmp, "mix.m4a");

    // Simple ducking via volume + amix (voice louder)
    const filter = `[0:a]volume=${voiceGain}[v];[1:a]volume=${musicGain}[m];[v][m]amix=inputs=2:duration=longest:dropout_transition=3[aout]`;
    await runFFmpeg(["-i", vPath, "-i", mPath, "-filter_complex", filter, "-map", "[aout]", "-c:a", "aac", output], "mix-audio");

    res.setHeader("Content-Type", "audio/mp4");
    res.setHeader("Content-Disposition", 'inline; filename="mix.m4a"');
    fs.createReadStream(output).pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Thumbnail ============
/**
 * JSON body: { "videoUrl": "...", "timeSec": 1.5 }
 */
app.post("/thumbnail", async (req, res) => {
  try {
    const { videoUrl, timeSec = 0.5 } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl required" });

    const tmp = await mkTmpDir("thumb-");
    const inPath = path.join(tmp, "in.mp4");
    const outPath = path.join(tmp, "thumb.jpg");
    await downloadToFile(videoUrl, inPath);

    await runFFmpeg(["-ss", String(timeSec), "-i", inPath, "-frames:v", "1", "-q:v", "2", outPath], "thumbnail");

    res.setHeader("Content-Type", "image/jpeg");
    fs.createReadStream(outPath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ Probe ============
/**
 * JSON body: { "videoUrl": "..." }
 */
app.post("/probe", async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl required" });
    const tmp = await mkTmpDir("probe-");
    const inPath = path.join(tmp, "in.mp4");
    await downloadToFile(videoUrl, inPath);
    const info = await runFFprobe([
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      inPath
    ]);
    res.type("application/json").send(info);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`FFmpeg API listening on ${PORT}`));
