import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AppConfig, MoonlightConfig } from '../shared/types';

export function parseMoonlight(input: unknown): MoonlightConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('moonlight must be a configuration object.');
  const raw = input as Record<string, unknown>;
  if (typeof raw.host !== 'string' || raw.host.length > 255 || /[\s\x00-\x1f\x7f]/.test(raw.host) || raw.host.startsWith('-')) throw new Error('Moonlight host must be a hostname, UUID or IP address (or empty until configured).');
  const games = raw.games ?? [];
  if (!Array.isArray(games) || games.length > 1000) throw new Error('Moonlight games must be an array of up to 1000 games.');
  const ids = new Set<string>();
  const names = new Set<string>();
  const parsed = games.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid Moonlight game.');
    const game = value as Record<string, unknown>;
    if (typeof game.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(game.id) || ids.has(game.id)) throw new Error('Moonlight game IDs must be unique lowercase letters, digits or hyphens.');
    if (typeof game.name !== 'string' || !game.name.trim() || game.name.length > 200 || /[\x00-\x1f\x7f]/.test(game.name)) throw new Error('Invalid Moonlight game name.');
    const app = game.app ?? game.name;
    if (typeof app !== 'string' || !app.trim() || app.length > 200 || /[\x00-\x1f\x7f]/.test(app) || names.has(app.toLowerCase())) throw new Error('Moonlight apps must be unique, nonempty names.');
    ids.add(game.id); names.add(app.toLowerCase());
    return { id: game.id, name: game.name, app };
  });
  const streamArgs = raw.streamArgs ?? ['--display-mode', 'fullscreen', '--no-quit-after'];
  if (!Array.isArray(streamArgs) || streamArgs.length > 100 || !streamArgs.every(v => typeof v === 'string' && !v.includes('\0'))) throw new Error('Moonlight streamArgs must be an array of strings.');
  if (raw.settingsPath !== undefined && (typeof raw.settingsPath !== 'string' || !raw.settingsPath.trim() || raw.settingsPath.includes('\0'))) throw new Error('Moonlight settingsPath must be a nonempty local file path.');
  return { host: raw.host, games: parsed, streamArgs, ...(raw.settingsPath === undefined ? {} : { settingsPath: raw.settingsPath as string }) };
}

export function parseConfig(input: unknown, base: string): AppConfig[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('apps.json must contain at least one application.');
  const ids = new Set<string>();
  return input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid application entry.');
    const a = raw as Record<string, unknown>;
    for (const key of ['id', 'name', 'command', 'cwd']) {
      if (typeof a[key] !== 'string' || !(a[key] as string).trim()) throw new Error(`Missing ${key} in application configuration.`);
    }
    if (!/^[a-z0-9-]+$/.test(a.id as string) || ids.has(a.id as string)) throw new Error(`Invalid or duplicate app ID: ${a.id}`);
    ids.add(a.id as string);
    if (a.type !== 'native' && a.type !== 'web') throw new Error(`Invalid type for ${a.id}`);
    if (a.moonlight !== undefined && a.type !== 'native') throw new Error('Moonlight integration requires a native application.');
    if (!Array.isArray(a.args) || !a.args.every(v => typeof v === 'string')) throw new Error(`args must be a string array for ${a.id}`);
    if (a.type === 'web') {
      const url = new URL(String(a.url));
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error(`Web apps require a loopback HTTP URL: ${a.id}`);
    }
    if (a.startupTimeoutMs !== undefined && (typeof a.startupTimeoutMs !== 'number' || !Number.isFinite(a.startupTimeoutMs) || a.startupTimeoutMs < 1000 || a.startupTimeoutMs > 300000)) throw new Error(`Invalid startup timeout for ${a.id}`);
    const cwd = (a.cwd as string).replace(/^~(?=$|[\\/])/, os.homedir());
    const moonlight = a.moonlight === undefined ? undefined : parseMoonlight(a.moonlight);
    if (moonlight?.settingsPath) moonlight.settingsPath = path.resolve(base, moonlight.settingsPath.replace(/^~(?=$|[\\/])/, os.homedir()));
    return {
      id: a.id as string, name: a.name as string, command: a.command as string,
      cwd: path.resolve(base, cwd), args: a.args as string[], type: a.type,
      subtitle: typeof a.subtitle === 'string' ? a.subtitle : '',
      icon: ['terminal', 'files', 'web', 'moon', 'steam'].includes(String(a.icon)) ? a.icon as AppConfig['icon'] : 'web',
      color: typeof a.color === 'string' && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#a89cff',
      url: a.url as string | undefined, startupTimeoutMs: a.startupTimeoutMs as number | undefined,
      moonlight
    };
  });
}
export async function loadConfig(file: string): Promise<AppConfig[]> {
  return parseConfig(JSON.parse(await readFile(file, 'utf8')), path.dirname(file));
}
