import axios from "axios";
import fs from "fs";
import { spawn } from "child_process";
import path from "path";
import os from "os";

export async function mkTmpDir(prefix = "job-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

export async function downloadToFile(url, outPath) {
  const writer = fs.createWriteStream(outPath);
  const resp = await axios.get(url, { responseType: "stream" });
  await new Promise((resolve, reject) => {
    resp.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
  return outPath;
}

export function runFFmpeg(args = [], logLabel = "ffmpeg") {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", d => (out += d.toString()));
    p.stderr.on("data", d => (err += d.toString()));
    p.on("close", code => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${logLabel} failed (${code}): ${err}`));
    });
  });
}

export function runFFprobe(args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", d => (out += d.toString()));
    p.stderr.on("data", d => (err += d.toString()));
    p.on("close", code => {
      if (code === 0) resolve(out);
      else reject(new Error(`ffprobe failed (${code}): ${err}`));
    });
  });
}
