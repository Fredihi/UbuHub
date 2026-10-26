import path from 'node:path';
import os from 'node:os';
import { access, copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../shared/types';

export function nativeLaunchArgs(config: AppConfig): string[] {
  const executable = path.basename(config.command).toLowerCase();
  const steam = config.id === 'steam' || executable === 'steam' || executable === 'steam.exe' || config.args.includes('com.valvesoftware.Steam');
  if (!steam || config.type !== 'native') return [...config.args];
  const conflicting = new Set(['-windowed', '-nobigpicture', '-tenfoot', '-bigpicture', '-gamepadui', '-fullscreen']);
  return [...config.args.filter(arg => !conflicting.has(arg.toLowerCase())), '-gamepadui', '-fullscreen'];
}

export function fullscreenStreamArgs(args: string[]): string[] {
  const rest: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (/^--?display-mode$/.test(arg)) { if (args[index + 1] && !args[index + 1].startsWith('-')) index++; }
    else if (!/^--?display-mode=/.test(arg)) rest.push(arg);
  }
  return ['--display-mode', 'fullscreen', ...rest];
}

export function fullscreenMoonlightIni(contents: string): string {
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const lines = contents.split(/\r?\n/);
  let general = true, found = false, generalSection = -1;
  for (let index = 0; index < lines.length; index++) {
    const section = lines[index].match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      general = section[1] === 'General';
      if (general && generalSection === -1) generalSection = index;
    } else if (general && /^\s*uidisplaymode\s*=/.test(lines[index])) {
      // Moonlight's UIDisplayMode enum: windowed=0, maximized=1, fullscreen=2.
      lines[index] = 'uidisplaymode=2'; found = true;
    }
  }
  if (found) return lines.join(newline);
  if (generalSection !== -1) { lines.splice(generalSection + 1, 0, 'uidisplaymode=2'); return lines.join(newline); }
  return `[General]${newline}uidisplaymode=2${newline}${contents ? newline + contents : ''}`;
}

export async function writeMoonlightFullscreen(file: string): Promise<void> {
  let contents = '', mode = 0o600, exists = false;
  try {
    file = await realpath(file);
    const info = await stat(file);
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Moonlight settings file is invalid or too large.');
    contents = await readFile(file, 'utf8'); mode = info.mode & 0o777; exists = true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const updated = fullscreenMoonlightIni(contents);
  if (updated === contents) return;
  await mkdir(path.dirname(file), { recursive: true });
  if (exists) {
    try { await copyFile(file, `${file}.ubuntuhub-backup`, constants.COPYFILE_EXCL); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, updated, { mode, flag: 'wx' }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}

export async function moonlightSettingsFile(config: AppConfig, home = os.homedir(), env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (config.moonlight?.settingsPath) return config.moonlight.settingsPath;
  const relative = path.join('Moonlight Game Streaming Project', 'Moonlight.conf');
  if (config.args.includes('com.moonlight_stream.Moonlight')) return path.join(home, '.var/app/com.moonlight_stream.Moonlight/config', relative);
  if (config.command.startsWith('/snap/') || (path.basename(config.command) === 'snap' && config.args.includes('moonlight'))) return path.join(home, 'snap/moonlight/current/.config', relative);
  try { await access(path.join(config.cwd, 'portable.dat')); return path.join(config.cwd, 'Moonlight Game Streaming Project', 'Moonlight.ini'); } catch { /* Normal installation. */ }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), relative);
}

export async function prepareNativeFullscreen(config: AppConfig): Promise<void> {
  if (process.platform !== 'linux' || config.type !== 'native' || !config.moonlight) return;
  const executable = path.basename(config.command).toLowerCase();
  // Don't modify external settings for arbitrary wrappers or test executables.
  const known = /^moonlight(?:$|[-.])/.test(executable) || config.args.includes('com.moonlight_stream.Moonlight') || (executable === 'snap' && config.args.includes('moonlight'));
  if (!known && !config.moonlight.settingsPath) return;
  try { await writeMoonlightFullscreen(await moonlightSettingsFile(config)); }
  catch (error) { throw new Error(`Could not configure Moonlight's fullscreen UI: ${error instanceof Error ? error.message : String(error)}`); }
}
