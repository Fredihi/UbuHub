import { execFile, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { AppConfig, MoonlightGameConfig, MoonlightLibrary } from '../shared/types';

// Moonlight Qt's non-verbose `list` prints one app name per stdout line.
// Keep names as individual arguments; never interpolate them into a shell.
export function parseGameList(output: string, configured: MoonlightGameConfig[] = []): MoonlightGameConfig[] {
  const names = new Set<string>();
  const games: MoonlightGameConfig[] = [];
  for (const line of output.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const name = line.trim();
    if (!name) continue;
    if (name.length > 200 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Moonlight returned an invalid game name.');
    const key = name.toLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    const saved = configured.find(game => game.app.toLowerCase() === key);
    games.push(saved ?? { id: `remote-${createHash('sha256').update(key).digest('hex')}`, name, app: name });
    if (games.length > 1000) throw new Error('Moonlight returned too many games.');
  }
  // A remote name's generated ID must not collide with a manually configured ID.
  if (new Set(games.map(game => game.id)).size !== games.length) throw new Error('Conflicting Moonlight game IDs.');
  return games;
}

type Runner = (config: AppConfig, args: string[]) => Promise<string>;
export class MoonlightIntegration {
  private games = new Map<string, MoonlightGameConfig[]>();
  private sources = new Map<string, 'configured' | 'host'>();
  private requests = new Map<string, Promise<MoonlightLibrary>>();
  private children = new Set<ChildProcess>();
  constructor(private configs: AppConfig[], private runner?: Runner) {
    for (const config of configs) if (config.moonlight) this.games.set(config.id, config.moonlight.games);
  }
  private config(id: string) {
    const config = this.configs.find(item => item.id === id);
    if (!config?.moonlight) throw new Error('This application has no Moonlight integration.');
    return config as AppConfig & { moonlight: NonNullable<AppConfig['moonlight']> };
  }
  snapshot(id: string): MoonlightLibrary {
    const { moonlight } = this.config(id);
    return { host: moonlight.host, configured: !!moonlight.host, games: (this.games.get(id) ?? []).map(({ id, name }) => ({ id, name })), source: this.sources.get(id) ?? 'configured' };
  }
  isLoading(id: string) { return this.requests.has(id); }
  async library(id: string, refresh = false): Promise<MoonlightLibrary> {
    const config = this.config(id);
    const snapshot = this.snapshot(id);
    if (!snapshot.configured || (!refresh && (snapshot.games.length > 0 || this.sources.has(id)))) return snapshot;
    const existing = this.requests.get(id);
    if (existing) return existing;
    const request = (async () => {
      const args = [...config.args, 'list', '--', config.moonlight.host];
      const output = await (this.runner ? this.runner(config, args) : this.run(config, args));
      const games = parseGameList(output, config.moonlight.games);
      this.games.set(id, games);
      this.sources.set(id, 'host');
      return this.snapshot(id);
    })();
    this.requests.set(id, request);
    try { return await request; } finally { this.requests.delete(id); }
  }
  streamArgs(id: string, gameId: string): string[] {
    const config = this.config(id);
    if (!config.moonlight.host) throw new Error('Configure your gaming PC before starting a stream.');
    if (this.isLoading(id)) throw new Error('Wait for the game list to finish refreshing.');
    const game = this.games.get(id)?.find(game => game.id === gameId);
    if (!game) throw new Error('Unknown game. Refresh the library and select a game again.');
    return [...config.args, 'stream', ...config.moonlight.streamArgs, '--', config.moonlight.host, game.app];
  }
  private run(config: AppConfig, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(config.command, args, { cwd: config.cwd, windowsHide: true, timeout: 35000, maxBuffer: 512 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
        this.children.delete(child);
        if (error) {
          const detail = String(stderr || error.message).trim().slice(-1200);
          reject(new Error(`Could not load Moonlight games. Ensure the host is online and paired in Moonlight. ${detail}`));
        } else resolve(stdout);
      });
      this.children.add(child);
    });
  }
  dispose() { for (const child of this.children) child.kill(); }
}
