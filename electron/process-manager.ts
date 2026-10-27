import { spawn, type ChildProcess } from 'node:child_process';
import type { AppConfig, AppTile, Result } from '../shared/types';
import { nativeLaunchArgs, prepareNativeFullscreen } from './fullscreen';
import { createNativeReadiness, type NativeReadiness, type ReadinessFactory } from './native-readiness';

interface Managed { child: ChildProcess; stopped: boolean; startup: AbortController; }
export class ProcessManager {
  private processes = new Map<string, Managed>();
  private preparing = new Set<string>();
  private cancelled = new Set<string>();
  private stopping = false;
  private states = new Map<string, Pick<AppTile, 'status' | 'error'>>();
  constructor(private apps: AppConfig[], private changed: () => void, private exited: (id: string) => void, private readiness: ReadinessFactory = createNativeReadiness) {}
  list(): AppTile[] {
    return this.apps.map(({ id, name, subtitle, icon, color, moonlight }) => ({ id, name, subtitle, icon, color, integration: moonlight ? 'moonlight' as const : undefined, ...(this.states.get(id) ?? { status: 'idle' as const }) }));
  }
  private state(id: string, status: AppTile['status'], error?: string) {
    this.states.set(id, { status, error });
    this.changed();
  }
  async launch(id: string, openWeb: (config: AppConfig) => Promise<void>, args?: string[]): Promise<Result> {
    const config = this.apps.find(a => a.id === id);
    if (!config) return { ok: false, error: 'Unknown application.' };
    if (this.stopping) return { ok: false, error: 'UbuntuHub is closing.' };
    if (this.processes.has(id) || this.preparing.has(id)) return { ok: false, error: 'This application is already running.' };
    if (this.preparing.size || [...this.states.values()].some(state => state.status === 'starting')) return { ok: false, error: 'Wait for the current application to finish starting.' };
    this.preparing.add(id);
    this.cancelled.delete(id);
    this.state(id, 'starting');
    let readiness: NativeReadiness | undefined;
    try {
      if (config.type === 'native') readiness = await this.readiness(config, !!config.moonlight && !!args);
      if (!args) await prepareNativeFullscreen(config);
    }
    catch (error) {
      this.preparing.delete(id);
      const message = error instanceof Error ? error.message : 'Could not prepare fullscreen launch.';
      this.state(id, 'error', message); this.exited(id);
      return { ok: false, error: message };
    }
    this.preparing.delete(id);
    if (this.stopping || this.cancelled.delete(id)) {
      this.state(id, 'idle'); this.exited(id);
      return { ok: false, error: 'Application launch was cancelled.' };
    }
    let tail = '';
    const child = spawn(config.command, args ?? nativeLaunchArgs(config), {
      cwd: config.cwd, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      // XWayland lets the hub observe native readiness on Ubuntu's Wayland desktop.
      env: process.platform === 'linux' && config.type === 'native'
        ? { ...process.env, QT_QPA_PLATFORM: 'xcb', SDL_VIDEODRIVER: 'x11', GDK_BACKEND: 'x11' } : process.env
    });
    const entry: Managed = { child, stopped: false, startup: new AbortController() };
    this.processes.set(id, entry);
    const output = (data: Buffer) => { tail = (tail + String(data)).slice(-2000); readiness?.output(String(data)); };
    child.stderr?.on('data', output);
    child.stdout?.on('data', output);
    const finish = (error?: string) => {
      if (this.processes.get(id) !== entry) return;
      entry.startup.abort(new Error(error ?? 'Application stopped during startup.'));
      this.processes.delete(id);
      this.state(id, error ? 'error' : 'idle', error);
      this.exited(id);
    };
    child.on('error', error => finish(`Could not start ${config.name}: ${error.message}`));
    child.on('exit', (code, signal) => {
      if (!entry.stopped) this.killTree(child); // Clean up descendants after a wrapper exits.
      finish(!entry.stopped && code !== 0 && signal === null ? `${config.name} exited (${code}). ${tail.trim()}` : undefined);
    });
    try {
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      if (readiness) {
        const timeout = setTimeout(() => entry.startup.abort(new Error(`${config.name} did not become ready${args && config.moonlight ? ' with a fullscreen stream' : ''}. ${tail.trim()}`)), config.startupTimeoutMs ?? 60000);
        try { await readiness.wait(child.pid!, entry.startup.signal); entry.startup.signal.throwIfAborted(); }
        finally { clearTimeout(timeout); }
      }
      if (config.type === 'web') {
        const deadline = Date.now() + (config.startupTimeoutMs ?? 60000);
        let ready = false;
        while (Date.now() < deadline && this.processes.get(id) === entry && !entry.stopped) {
          try {
            const response = await fetch(config.url!, { signal: AbortSignal.timeout(1200), redirect: 'error' });
            ready = response.ok;
            await response.body?.cancel();
            if (ready) break;
          } catch { /* The configured server may still be starting. */ }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (this.processes.get(id) !== entry || entry.stopped) return { ok: false, error: 'Application stopped during startup.' };
        if (!ready) throw new Error(`${config.name} did not become ready. ${tail.trim()}`);
        await openWeb(config);
      }
      if (this.processes.get(id) !== entry || entry.stopped) return { ok: false, error: 'Application stopped during startup.' };
      this.state(id, 'running');
      return { ok: true };
    } catch (error) {
      const cancelled = entry.stopped;
      entry.stopped = true;
      this.killTree(child);
      const reason = entry.startup.signal.aborted ? entry.startup.signal.reason : error;
      const message = reason instanceof Error ? reason.message : 'Application startup failed.';
      finish(cancelled ? undefined : message);
      return { ok: false, error: cancelled ? 'Application launch was cancelled.' : message };
    }
  }
  private killTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { /* Already exited. */ }
    if (signal === 'SIGTERM') {
      const timer = setTimeout(() => this.killTree(child, 'SIGKILL'), 2000);
      timer.unref();
    }
  }
  stop(id: string) {
    if (this.preparing.has(id)) this.cancelled.add(id);
    const entry = this.processes.get(id);
    if (entry) { entry.stopped = true; entry.startup.abort(new Error('Application launch was cancelled.')); this.killTree(entry.child); }
  }
  stopAll() { this.stopping = true; for (const id of this.processes.keys()) this.stop(id); }
}
