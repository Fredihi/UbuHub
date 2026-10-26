import { spawn, type ChildProcess } from 'node:child_process';
import type { AppConfig, AppTile, Result } from '../shared/types';

interface Managed { child: ChildProcess; stopped: boolean; }
export class ProcessManager {
  private processes = new Map<string, Managed>();
  private states = new Map<string, Pick<AppTile, 'status' | 'error'>>();
  constructor(private apps: AppConfig[], private changed: () => void, private exited: (id: string) => void) {}
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
    if (this.processes.has(id)) return { ok: false, error: 'This application is already running.' };
    this.state(id, 'starting');
    let tail = '';
    const child = spawn(config.command, args ?? config.args, { cwd: config.cwd, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'] });
    const entry: Managed = { child, stopped: false };
    this.processes.set(id, entry);
    child.stderr?.on('data', data => { tail = (tail + String(data)).slice(-2000); });
    const finish = (error?: string) => {
      if (this.processes.get(id) !== entry) return;
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
      if (this.processes.get(id) === entry) this.state(id, 'running');
      return { ok: true };
    } catch (error) {
      entry.stopped = true;
      this.killTree(child);
      const message = error instanceof Error ? error.message : 'Application startup failed.';
      finish(message);
      return { ok: false, error: message };
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
    const entry = this.processes.get(id);
    if (entry) { entry.stopped = true; this.killTree(entry.child); }
  }
  stopAll() { for (const id of this.processes.keys()) this.stop(id); }
}
