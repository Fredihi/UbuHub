import type { Result, UpdateState } from '../shared/types';

export interface UpdatePort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(silent?: boolean, forceRunAfter?: boolean): void;
}
interface Options {
  currentVersion: string;
  port?: UpdatePort;
  disabledReason?: string;
  isBusy: () => boolean;
  changed: (state: UpdateState) => void;
  beforeInstall: () => Promise<void>;
  installFailed: () => void;
}

export class UpdateManager {
  private state: UpdateState;
  private disposed = false;
  private downloaded = false;
  private listeners: [string, (...args: any[]) => void][] = [];
  private startup?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;
  constructor(private options: Options) {
    this.state = { currentVersion: options.currentVersion, status: options.port ? 'idle' : 'disabled', message: options.disabledReason, canInstall: false };
    const port = options.port;
    if (!port) return;
    port.autoDownload = false;
    port.autoInstallOnAppQuit = false; // Only the explicit controller action may restart.
    port.autoRunAppAfterInstall = true;
    port.allowPrerelease = false;
    port.allowDowngrade = false;
    this.listen('update-not-available', () => this.set({ status: 'idle', version: undefined, progress: undefined, message: undefined }));
    this.listen('update-available', (info: { version: string }) => {
      if (this.state.status === 'downloading' || this.state.status === 'ready' || this.state.status === 'installing') return;
      this.set({ status: 'downloading', version: info.version, progress: 0, message: undefined });
      void port.downloadUpdate().catch(error => this.fail(error));
    });
    this.listen('download-progress', (info: { percent: number }) => {
      if (this.state.status === 'downloading' && Number.isFinite(info.percent)) this.set({ progress: Math.max(0, Math.min(100, Math.round(info.percent))) });
    });
    this.listen('update-downloaded', (info: { version: string }) => {
      this.downloaded = true;
      this.set({ status: 'ready', version: info.version, progress: 100, message: undefined });
    });
    this.listen('error', (error: unknown) => this.fail(error));
  }
  private listen(event: string, listener: (...args: any[]) => void) {
    this.listeners.push([event, listener]);
    this.options.port!.on(event, listener);
  }
  private set(patch: Partial<UpdateState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.refresh();
  }
  private fail(error: unknown) {
    if (this.disposed) return;
    if (this.state.status === 'installing') this.options.installFailed();
    const detail = error instanceof Error ? error.message : 'Please try again later.';
    this.set({ status: this.downloaded ? 'ready' : 'error', message: detail.slice(0, 500) });
  }
  snapshot(): UpdateState {
    return { ...this.state, canInstall: this.state.status === 'ready' && !this.options.isBusy() };
  }
  refresh() { if (!this.disposed) this.options.changed(this.snapshot()); }
  start(delayMs = 15000, intervalMs = 6 * 60 * 60 * 1000) {
    if (!this.options.port || this.startup || this.interval || this.disposed) return;
    this.startup = setTimeout(() => { void this.check(); }, delayMs);
    this.startup.unref();
    this.interval = setInterval(() => { void this.check(); }, intervalMs);
    this.interval.unref();
  }
  async check(): Promise<Result> {
    if (this.disposed || !this.options.port) return { ok: false, error: this.state.message ?? 'Updates are unavailable in this build.' };
    if (['checking', 'downloading', 'ready', 'installing'].includes(this.state.status)) return { ok: true };
    this.set({ status: 'checking', message: undefined });
    try { await this.options.port.checkForUpdates(); return { ok: true }; }
    catch (error) { this.fail(error); return { ok: false, error: 'Could not check for updates. Please try again later.' }; }
  }
  async install(): Promise<Result> {
    if (this.disposed || !this.options.port || this.state.status !== 'ready') return { ok: false, error: 'No downloaded update is ready.' };
    if (this.options.isBusy()) return { ok: false, error: 'Close your running apps or finish streaming before restarting UbuntuHub.' };
    this.set({ status: 'installing', message: undefined }); // Blocks new launches before awaiting preflight.
    try {
      await this.options.beforeInstall();
      if (this.disposed) return { ok: false, error: 'UbuntuHub is closing.' };
      this.options.port.quitAndInstall(false, true);
      if (this.snapshot().status !== 'installing') return { ok: false, error: this.state.message ?? 'Could not install the update.' };
      return { ok: true };
    } catch (error) {
      this.fail(error);
      return { ok: false, error: this.state.message ?? 'Could not install the update.' };
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.startup); clearInterval(this.interval);
    for (const [event, listener] of this.listeners) this.options.port?.removeListener(event, listener);
    // A download may finish while Electron is shutting down; never leave its
    // EventEmitter without an error listener after removing our state listeners.
    this.options.port?.on('error', () => {});
  }
}
