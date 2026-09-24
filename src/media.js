import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, realpath, stat, unlink, rename } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const types = {
  'image/png': ['images', '.png'], 'image/jpeg': ['images', '.jpg'], 'image/gif': ['images', '.gif'],
  'image/webp': ['images', '.webp'], 'video/mp4': ['videos', '.mp4'], 'video/webm': ['videos', '.webm'],
  'audio/mpeg': ['audio', '.mp3'], 'audio/wav': ['audio', '.wav'], 'audio/ogg': ['audio', '.ogg'],
};
const signature = (bytes, type) => {
  const text = (a, b) => bytes.subarray(a, b).toString('ascii');
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/gif') return ['GIF87a','GIF89a'].includes(text(0,6));
  if (type === 'image/webp') return text(0,4) === 'RIFF' && text(8,12) === 'WEBP';
  if (type === 'audio/wav') return text(0,4) === 'RIFF' && text(8,12) === 'WAVE';
  if (type === 'audio/ogg') return text(0,4) === 'OggS';
  if (type === 'audio/mpeg') return text(0,3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224);
  if (type === 'video/mp4') return text(4,8) === 'ftyp';
  if (type === 'video/webm') return bytes.subarray(0,4).equals(Buffer.from([26,69,223,163]));
  return false;
};

/** All public media paths are relative to the portable configuration directory. */
export class MediaFiles {
  constructor(directory, { maxBytes = 512 * 1024 * 1024 } = {}) { this.directory = resolve(directory); this.maxBytes = maxBytes; }

  async receive(req, name) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!types[type]) fail(415, 'Supported files: PNG, JPEG, GIF, WebP, MP4, WebM, MP3, WAV and OGG.');
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 160) fail(400, 'Media name must contain 1 to 160 characters.');
    const length = Number(req.headers['content-length']);
    if (Number.isFinite(length) && length > this.maxBytes) fail(413, 'Media file exceeds the 512 MB limit.');
    const id = randomUUID(), [folder, extension] = types[type];
    const path = `media/${folder}/${id}${extension}`, target = resolve(this.directory, path), temporary = `${target}.upload`;
    await mkdir(resolve(this.directory, 'media', folder), { recursive: true });
    const handle = await open(temporary, 'wx');
    let size = 0, prefix = Buffer.alloc(0);
    try {
      for await (const bytes of req) {
        size += bytes.length;
        if (size > this.maxBytes) fail(413, 'Media file exceeds the 512 MB limit.');
        if (prefix.length < 16) prefix = Buffer.concat([prefix, bytes.subarray(0, 16 - prefix.length)]);
        await handle.writeFile(bytes);
      }
      if (!size || !signature(prefix, type)) fail(400, 'The file content does not match its media type.');
      await handle.sync(); await handle.close();
      await rename(temporary, target);
      return { id, name: name.trim(), kind: type.split('/')[0] === 'image' ? 'image' : type.split('/')[0], mimeType: type, sizeBytes: size, path };
    } catch (error) { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
  }

  async resolveFile(media) {
    if (!media || typeof media.path !== 'string' || !/^media\/(audio|images|videos)\//.test(media.path) || media.path.includes('\\') || media.path.split('/').includes('..') || isAbsolute(media.path)) fail(400, 'Invalid media path.');
    const base = await realpath(resolve(this.directory, 'media'));
    let file;
    try { file = await realpath(resolve(this.directory, media.path)); } catch (error) { if (error.code === 'ENOENT') fail(404, 'Media file is missing from the config folder.'); throw error; }
    const remainder = relative(base, file);
    if (!remainder || remainder.startsWith('..') || isAbsolute(remainder)) fail(400, 'Media file must remain inside the config/media folder.');
    const info = await stat(file);
    if (!info.isFile()) fail(404, 'Media file not found.');
    return { file, info };
  }

  async remove(media) { const { file } = await this.resolveFile(media); await unlink(file); }

  async serve(req, res, media) {
    const { file, info } = await this.resolveFile(media);
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2])) return this.#rangeError(res, info.size);
      if (!range[1]) { const suffix = Number(range[2]); if (!suffix) return this.#rangeError(res, info.size); start = Math.max(0, info.size - suffix); }
      else { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), end); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) return this.#rangeError(res, info.size);
      status = 206;
    }
    const headers = { 'Content-Type': types[media.mimeType] ? media.mimeType : 'application/octet-stream', 'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="media${extname(file).replace(/[^.a-z0-9]/gi, '')}"` };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    try { await pipeline(createReadStream(file, { start, end }), res); }
    catch (error) { if (!res.destroyed) throw error; }
  }

  #rangeError(res, size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); }
}
