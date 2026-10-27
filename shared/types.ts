export type AppStatus = 'idle' | 'starting' | 'running' | 'error';
export interface AppTile {
  id: string;
  name: string;
  subtitle: string;
  icon: 'terminal' | 'files' | 'web' | 'moon' | 'steam';
  color: string;
  status: AppStatus;
  error?: string;
  integration?: 'moonlight';
}
export interface MoonlightGame { id: string; name: string; artwork?: string; }
export interface MoonlightGameConfig extends MoonlightGame { app: string; }
export interface MoonlightConfig {
  host: string;
  games: MoonlightGameConfig[];
  streamArgs: string[];
  settingsPath?: string;
}
export interface MoonlightLibrary {
  host: string;
  configured: boolean;
  games: MoonlightGame[];
  source: 'configured' | 'host';
}
export type MoonlightLibraryResult = { ok: true; library: MoonlightLibrary } | { ok: false; error: string };
export interface AppConfig extends Omit<AppTile, 'status' | 'error'> {
  type: 'native' | 'web';
  command: string;
  args: string[];
  cwd: string;
  url?: string;
  startupTimeoutMs?: number;
  moonlight?: MoonlightConfig;
}
export type Result = { ok: true } | { ok: false; error: string };
export interface UpdateState {
  status: 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';
  currentVersion: string;
  version?: string;
  progress?: number;
  message?: string;
  canInstall: boolean;
}
export interface HubAPI {
  listApps(): Promise<AppTile[]>;
  launch(id: string): Promise<Result>;
  cancelLaunch(id: string): Promise<Result>;
  moonlightLibrary(id: string, refresh?: boolean): Promise<MoonlightLibraryResult>;
  launchMoonlight(id: string, gameId: string): Promise<Result>;
  returnToLauncher(): Promise<Result>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<Result>;
  installUpdate(): Promise<Result>;
  onUpdateChanged(callback: (state: UpdateState) => void): () => void;
  onAppsChanged(callback: (apps: AppTile[]) => void): () => void;
}
