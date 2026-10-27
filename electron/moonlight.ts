import { execFile, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { artworkRoots, localArtworkPath, readMoonlightArtwork } from './moonlight-artwork';
import { fullscreenStreamArgs } from './fullscreen';
import type { AppConfig, MoonlightGameConfig, MoonlightLibrary } from '../shared/types';

interface MoonlightEntry extends MoonlightGameConfig { remoteId?: string; artworkFile?: string; }
// Plain `list` prints names only. `list --csv` adds IDs and cached boxart URLs.
// Keep names as individual arguments; never interpolate them into a shell.
export function parseGameList(output: string, configured: MoonlightGameConfig[] = []): MoonlightEntry[] {
  const names = new Set<string>();
  const games: MoonlightEntry[] = [];
  const lines = output.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  const csv = /^Name,\s*ID,.*Boxart URL\s*$/i.test(lines[0] ?? '');
  for (const line of csv ? lines.slice(1) : lines) {
    // Qt currently doesn't escape quotes in app names. Match its typed trailing
    // columns so names containing commas and quotes remain intact.
    const record = csv ? line.match(/^"(.*)",\s*(-?\d+),\s*(?:true|false),\s*(?:true|false),\s*(?:true|false),\s*(?:true|false),\s*"(.*)"\s*$/i) : null;
    if (csv && !record) throw new Error('Moonlight returned an invalid CSV game list.');
    const name = (record ? record[1] : line).trim();
    if (!name) continue;
    if (name.length > 200 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Moonlight returned an invalid game name.');
    const key = name.toLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    const saved = configured.find(game => game.app.toLowerCase() === key);
    const entry: MoonlightEntry = { ...(saved ?? { id: `remote-${createHash('sha256').update(key).digest('hex')}`, name, app: name }) };
    if (record) { entry.remoteId = record[2]; entry.artworkFile = localArtworkPath(record[3]); }
    games.push(entry);
    if (games.length > 1000) throw new Error('Moonlight returned too many games.');
  }
  // A placeholder may be printed while Moonlight downloads a different cover.
  // Only infer sibling filenames when a cached URL identifies this host's cache.
  const directories = new Set(games.flatMap(game => game.artworkFile ? [path.dirname(game.artworkFile)] : []));
  if (directories.size === 1) {
    const directory = [...directories][0];
    for (const game of games) if (!game.artworkFile && game.remoteId) game.artworkFile = path.join(directory, `${game.remoteId}.png`);
  }
  // A remote name's generated ID must not collide with a manually configured ID.
  if (new Set(games.map(game => game.id)).size !== games.length) throw new Error('Conflicting Moonlight game IDs.');
  return games;
}

type Runner = (config: AppConfig, args: string[]) => Promise<string>;
export class MoonlightIntegration {
  private games = new Map<string, MoonlightEntry[]>();
  private sources = new Map<string, 'configured' | 'host'>();
  private requests = new Map<string, Promise<MoonlightLibrary>>();
  private children = new Set<ChildProcess>();
  private artworkSession = randomUUID();
  private revisions = new Map<string, number>();
  constructor(private configs: AppConfig[], private runner?: Runner, private allowedArtworkRoots?: string[]) {
    for (const config of configs) if (config.moonlight) this.games.set(config.id, config.moonlight.games);
  }
  private config(id: string) {
    const config = this.configs.find(item => item.id === id);
    if (!config?.moonlight) throw new Error('This application has no Moonlight integration.');
    return config as AppConfig & { moonlight: NonNullable<AppConfig['moonlight']> };
  }
  snapshot(id: string): MoonlightLibrary {
    const { moonlight } = this.config(id);
    return { host: moonlight.host, configured: !!moonlight.host, games: (this.games.get(id) ?? []).map(game => ({ id: game.id, name: game.name, ...(game.artworkFile ? { artwork: `ubuntuhub-art://covers/${encodeURIComponent(id)}/${encodeURIComponent(game.id)}?v=${this.artworkSession}-${this.revisions.get(id) ?? 0}` } : {}) })), source: this.sources.get(id) ?? 'configured' };
  }
  async artwork(id: string, gameId: string): Promise<Uint8Array | undefined> {
    const config = this.config(id);
    const file = this.games.get(id)?.find(game => game.id === gameId)?.artworkFile;
    if (file) return readMoonlightArtwork(file, this.allowedArtworkRoots ?? artworkRoots(config));
  }
  isLoading(id: string) { return this.requests.has(id); }
  async library(id: string, refresh = false): Promise<MoonlightLibrary> {
    const config = this.config(id);
    const snapshot = this.snapshot(id);
    if (!snapshot.configured) return snapshot;
    const existing = this.requests.get(id);
    if (existing) return existing;
    if (!refresh && this.sources.has(id)) return snapshot;
    const request = (async () => {
      const query = async (csv: boolean) => {
        const args = [...config.args, 'list', ...(csv ? ['--csv'] : []), '--', config.moonlight.host];
        return this.runner ? this.runner(config, args) : this.run(config, args);
      };
      let output: string;
      try { output = await query(true); }
      catch (error) {
        if (!(error instanceof Error) || !/(?:unknown|unrecognized|unsupported)\s+options?[^\n]*csv/i.test(error.message)) throw error;
        output = await query(false); // Older Moonlight builds still get working game tiles.
      }
      let games = parseGameList(output, config.moonlight.games);
      if (games.some(game => game.remoteId && !game.artworkFile)) {
        // On a cold cache Moonlight prints qrc placeholders before its artwork
        // workers finish. One bounded retry retrieves the now-cached file URLs.
        try { games = parseGameList(await query(true), config.moonlight.games); } catch { /* Keep the first usable list. */ }
      }
      this.games.set(id, games);
      this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
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
    return [...config.args, 'stream', ...fullscreenStreamArgs(config.moonlight.streamArgs), '--', config.moonlight.host, game.app];
  }
  private run(config: AppConfig, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(config.command, args, { cwd: config.cwd, windowsHide: true, timeout: 35000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
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
