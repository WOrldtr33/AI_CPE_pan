import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { timestamp } from '../src/time.mjs';

export const assetId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function detectMedia(bytes) {
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE') return { kind: 'audio', mime: 'audio/wav' };
  if (bytes.length > 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { kind: 'image', mime: 'image/jpeg' };
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { kind: 'image', mime: 'image/png' };
  if (bytes.subarray(4, 8).toString() === 'ftyp') return { kind: 'video', mime: 'video/mp4' };
  if (bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) return { kind: 'video', mime: 'video/webm' };
  throw new Error('MEDIA_UNSUPPORTED_FORMAT：支持 WAV、JPEG、PNG、MP4、WebM。');
}
export function wavInfo(bytes) {
  let format, rate, channels, bits, length;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > bytes.length) throw new Error('MEDIA_INVALID_WAV');
    if (name === 'fmt ' && size >= 16) { format = bytes.readUInt16LE(start); channels = bytes.readUInt16LE(start + 2); rate = bytes.readUInt32LE(start + 4); bits = bytes.readUInt16LE(start + 14); }
    if (name === 'data') length = size;
    offset = start + size + (size % 2);
  }
  if (format !== 1 || ![1, 2].includes(channels) || ![8000, 16000, 22050, 24000, 44100, 48000].includes(rate) || bits !== 16 || !length) throw new Error('MEDIA_INVALID_WAV：需要 PCM16 WAV。');
  const seconds = length / (rate * channels * 2);
  if (seconds > 60) throw new Error('MEDIA_AUDIO_TOO_LONG');
  return { sampleRate: rate, channels, seconds };
}
export class MediaStore {
  constructor(settings) { this.settings = settings; this.directory = join(settings.directory, 'assets'); this.pending = Promise.resolve(); }
  async init() { await mkdir(this.directory, { recursive: true }); }
  async put(bytes, source = 'upload') {
    const operation = this.pending.then(() => this.putExclusive(bytes, source));
    this.pending = operation.catch(() => {}); return operation;
  }
  async putExclusive(bytes, source) {
    if (!bytes.length || bytes.length > this.settings.maxBytes) throw new Error('MEDIA_SIZE_LIMIT');
    const type = detectMedia(bytes), info = type.mime === 'audio/wav' ? wavInfo(bytes) : {};
    if ((await this.list()).length >= this.settings.maxAssets) throw new Error('MEDIA_STORAGE_FULL：请在媒体页面删除不用的素材。');
    const id = randomUUID(), meta = { id, ...type, ...info, bytes: bytes.length, source, createdAt: timestamp() };
    try { await writeFile(join(this.directory, `${id}.bin`), bytes, { flag: 'wx', mode: 0o600 }); await writeFile(join(this.directory, `${id}.json`), JSON.stringify(meta), { flag: 'wx', mode: 0o600 }); }
    catch (error) { await this.remove(id); throw error; }
    return meta;
  }
  async get(id) {
    if (!assetId.test(id)) throw new Error('MEDIA_INVALID_ASSET_ID');
    try { const meta = JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8')); return { meta, bytes: await readFile(join(this.directory, `${id}.bin`)) }; }
    catch { throw new Error('MEDIA_ASSET_NOT_FOUND'); }
  }
  async list() { return (await Promise.all((await readdir(this.directory)).filter(n => assetId.test(n.slice(0, -5)) && n.endsWith('.json')).map(async n => JSON.parse(await readFile(join(this.directory, n), 'utf8'))))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async remove(id) { if (!assetId.test(id)) throw new Error('MEDIA_INVALID_ASSET_ID'); await Promise.all(['bin', 'json'].map(ext => rm(join(this.directory, `${id}.${ext}`), { force: true }))); }
}
