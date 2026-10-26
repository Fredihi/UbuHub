import { contextBridge, ipcRenderer } from 'electron';
import type { AppTile, HubAPI } from '../shared/types';
const api: HubAPI = {
  listApps: () => ipcRenderer.invoke('hub:list'),
  launch: (id) => ipcRenderer.invoke('hub:launch', id),
  moonlightLibrary: (id, refresh = false) => ipcRenderer.invoke('hub:moonlight-library', id, refresh),
  launchMoonlight: (id, gameId) => ipcRenderer.invoke('hub:moonlight-launch', id, gameId),
  returnToLauncher: () => ipcRenderer.invoke('hub:return'),
  onAppsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, apps: AppTile[]) => callback(apps);
    ipcRenderer.on('hub:apps', listener);
    return () => ipcRenderer.removeListener('hub:apps', listener);
  }
};
contextBridge.exposeInMainWorld('ubuntuHub', api);
