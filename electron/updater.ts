import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { AppImageUpdater } from 'electron-updater';
import { UpdateManager } from './update-manager';
import type { UpdateState } from '../shared/types';

interface Options {
  packaged: boolean;
  platform: NodeJS.Platform;
  appImage?: string;
  resourcesPath: string;
  version: string;
  changed: (state: UpdateState) => void;
  isBusy: () => boolean;
  beforeInstall: () => Promise<void>;
  installFailed: () => void;
}
export async function createUpdates(options: Options): Promise<UpdateManager> {
  const common = { currentVersion: options.version, changed: options.changed, isBusy: options.isBusy, beforeInstall: options.beforeInstall, installFailed: options.installFailed };
  let disabledReason: string | undefined;
  if (!options.packaged || options.platform !== 'linux') disabledReason = 'Automatic updates are available in released Linux AppImage builds.';
  else if (!options.appImage || !path.isAbsolute(options.appImage)) disabledReason = 'Use the AppImage release for in-app updates. DEB builds are updated through your package manager.';
  else {
    try { await access(path.join(options.resourcesPath, 'app-update.yml'), constants.R_OK); }
    catch { disabledReason = 'This build has no GitHub release feed. Install an AppImage from GitHub Releases.'; }
    if (!disabledReason) {
      try { await access(options.appImage, constants.W_OK); await access(path.dirname(options.appImage), constants.W_OK); }
      catch { disabledReason = 'Move the AppImage to a writable folder such as ~/Applications to enable updates.'; }
    }
  }
  if (disabledReason) return new UpdateManager({ ...common, disabledReason });
  const port = new AppImageUpdater();
  // Feed is embedded by electron-builder. No URL or token comes from the renderer.
  return new UpdateManager({ ...common, port, beforeInstall: async () => {
    await access(options.appImage!, constants.W_OK);
    await access(path.dirname(options.appImage!), constants.W_OK);
    await options.beforeInstall();
  } });
}
