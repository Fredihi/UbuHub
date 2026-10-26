'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Result, UpdateState } from '../shared/types';

export function updateActionLabel(state: UpdateState | null): string | null {
  if (state?.status === 'ready') return 'Restart to update';
  if (state?.status === 'error') return 'Retry update';
  return null;
}
export function useUpdates() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const api = window.ubuntuHub;
    if (!api) return;
    let live = true;
    let revision = 0;
    const unsubscribe = api.onUpdateChanged(next => { revision++; if (live) setState(next); });
    api.getUpdateState().then(next => { if (live && revision === 0) setState(next); }).catch(() => { /* Older previews may not provide updates. */ });
    return () => { live = false; unsubscribe(); };
  }, []);
  const act = useCallback(async (): Promise<Result> => {
    const api = window.ubuntuHub;
    if (!api) return { ok: false, error: 'Open the installed AppImage to update UbuntuHub.' };
    try { return state?.status === 'ready' ? await api.installUpdate() : await api.checkForUpdates(); }
    catch { return { ok: false, error: 'Could not reach the updater. Please try again later.' }; }
  }, [state?.status]);
  return { state, act, actionLabel: updateActionLabel(state) };
}
