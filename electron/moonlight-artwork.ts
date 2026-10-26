import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AppConfig } from '../shared/types';

export function localArtworkPath(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost') || url.search || url.hash) return;
    const file = fileURLToPath(url);
    // Moonlight stores PNGs as boxart/<host UUID>/<numeric app ID>.png.
    if (!/^-?\d+\.png$/i.test(path.basename(file)) || path.basename(path.dirname(path.dirname(file))) !== 'boxart') return;
    return file;
  } catch { return; }
}

function inside(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function artworkRoots(config: AppConfig): string[] {
  // Includes native, Flatpak, Snap and portable caches in the user's home.
  // XDG_CACHE_HOME and cwd are trusted local environment/configuration values.
  return [os.homedir(), process.env.XDG_CACHE_HOME, path.join(config.cwd, 'boxart')].filter((value): value is string => !!value && path.isAbsolute(value));
}
export async function readMoonlightArtwork(file: string, roots: string[]): Promise<Uint8Array | undefined> {
  if (!localArtworkPath(pathToFileURL(file).href)) return;
  try {
    const resolved = await realpath(file);
    let permitted = false;
    for (const root of roots) {
      try { if (inside(await realpath(root), resolved)) { permitted = true; break; } } catch { /* Missing optional cache root. */ }
    }
    if (!permitted) return;
    const handle = await open(resolved, 'r');
    try {
      const stat = await handle.stat();
      const maxBytes = 4 * 1024 * 1024;
      if (!stat.isFile() || stat.size < 24 || stat.size > maxBytes) return;
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== stat.size || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return;
      if (buffer.toString('ascii', 12, 16) !== 'IHDR') return;
      const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
      if (!width || !height || width > 4096 || height > 4096 || width * height > 16_000_000) return;
      return new Uint8Array(buffer.subarray(0, length));
    } finally { await handle.close(); }
  } catch { return; }
}
