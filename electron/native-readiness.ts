import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type { AppConfig } from '../shared/types';

const exec = promisify(execFile);
async function xprop(args: string[]) {
  return (await exec('xprop', args, { timeout: 1500, maxBuffer: 256 * 1024 })).stdout;
}

export interface NativeReadiness {
  output(data: string): void;
  wait(pid: number, signal: AbortSignal): Promise<void>;
}
export type ReadinessFactory = (config: AppConfig, streaming: boolean) => Promise<NativeReadiness>;
interface WindowProbe {
  query(args: string[]): Promise<string>;
  stat(pid: number): Promise<string>;
}
const probe: WindowProbe = { query: xprop, stat: pid => readFile(`/proc/${pid}/stat`, 'utf8') };

export function windowIsReady(properties: string, fullscreen: boolean): boolean {
  return /window state: Normal\b/.test(properties)
    && !/_NET_WM_STATE_HIDDEN\b/.test(properties)
    && (!fullscreen || /_NET_WM_STATE_FULLSCREEN\b/.test(properties));
}

// Linux /proc stat's command field may contain spaces and closing parentheses.
export function processGroup(stat: string): number {
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
}

export const createNativeReadiness: ReadinessFactory = async (config, streaming) => {
  // Native launch support targets Ubuntu. Other platforms are for UI development.
  if (process.platform !== 'linux') return { output() {}, async wait() {} };
  if (!process.env.DISPLAY) throw new Error('Native launch detection requires X11 or XWayland (DISPLAY is missing).');
  return createX11Readiness(config, streaming);
};

export async function createX11Readiness(config: AppConfig, streaming: boolean, windows: WindowProbe = probe): Promise<NativeReadiness> {
  try { await windows.query(['-root', '_NET_CLIENT_LIST']); }
  catch { throw new Error('Cannot detect application windows. Install x11-utils and enable X11/XWayland, then retry.'); }
  const fullscreen = streaming || !!config.moonlight || config.id === 'steam'
    || /(?:^|[/\\])steam(?:\.exe)?$/i.test(config.command) || config.args.includes('com.valvesoftware.Steam');
  let output = '', videoInitialized = false, streamStarted = !streaming;
  return {
    output(data) {
      output = (output + data).slice(-8192);
      const video = output.search(/Video stream is \d+x\d+x\d+/);
      if (video !== -1) {
        videoInitialized = true;
        // Discard decoder-probe messages logged before the connection starts.
        output = output.slice(video).replace(/Video stream is \d+x\d+x\d+/, '');
      }
      if (videoInitialized && /(?:FFmpeg-based|SLVideo) video decoder chosen/.test(output)) streamStarted = true;
    },
    async wait(pid, signal) {
      while (!signal.aborted) {
        const clients = await windows.query(['-root', '_NET_CLIENT_LIST']);
        const ids = clients.match(/0x[0-9a-f]+/gi) ?? [];
        for (const id of ids) {
          signal.throwIfAborted();
          let properties: string;
          try { properties = await windows.query(['-id', id, '_NET_WM_PID', 'WM_STATE', '_NET_WM_STATE', '_NET_WM_NAME']); }
          catch { continue; } // Windows can disappear between queries.
          const owner = Number(properties.match(/_NET_WM_PID\(CARDINAL\)\s*=\s*(\d+)/)?.[1]);
          if (!owner || !windowIsReady(properties, fullscreen)) continue;
          // Moonlight creates its "<PC name> - Moonlight" SDL window only after
          // connection success. Its fullscreen Qt connection UI is not a stream.
          if (streaming && !/_NET_WM_NAME\(UTF8_STRING\) = ".+ - Moonlight"/.test(properties)) continue;
          let group: number;
          try { group = processGroup(await windows.stat(owner)); }
          catch { continue; }
          // Include children of shell/Flatpak/Steam wrappers, never unrelated windows.
          if ((owner === pid || group === pid) && streamStarted) { signal.throwIfAborted(); return; }
        }
        await delay(200, undefined, { signal });
      }
      signal.throwIfAborted();
    }
  };
}
