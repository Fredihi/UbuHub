'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppTile, HubAPI, MoonlightLibrary } from '../shared/types';
import { useController } from '../lib/use-controller';
import { MoonlightLibraryView } from './moonlight-library';
import { useUpdates } from '../lib/use-updates';
import { LaunchScreen } from './launch-screen';

declare global { interface Window { ubuntuHub?: HubAPI } }
const preview: AppTile[] = [
  { id: 'moonlight', name: 'Moonlight', subtitle: 'Stream your games', icon: 'moon', color: '#a89cff', status: 'idle', integration: 'moonlight' },
  { id: 'steam', name: 'Steam', subtitle: 'Your game library', icon: 'steam', color: '#79bfff', status: 'idle' }
];
function Icon({ type }: { type: AppTile['icon'] }) {
  if (type === 'steam') return <svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><circle cx="66" cy="34" r="20" stroke="currentColor" strokeWidth="4"/><circle cx="66" cy="34" r="11" stroke="currentColor" strokeWidth="4"/><path d="m48 29-13 27m35-2L46 73M13 59l21 10" stroke="currentColor" strokeWidth="7" strokeLinecap="round"/><circle cx="36" cy="68" r="13" stroke="currentColor" strokeWidth="4"/></svg>;
  if (type === 'moon') return <svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M77 62A33 33 0 0 1 38 23a33 33 0 1 0 39 39Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/></svg>;
  if (type === 'terminal') return <svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><rect x="14" y="22" width="72" height="56" rx="9" stroke="currentColor" strokeWidth="4"/><path d="m30 39 12 11-12 11m23 0h16" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (type === 'files') return <svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M14 32a8 8 0 0 1 8-8h21l10 11h25a8 8 0 0 1 8 8v28a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/><path d="M15 42h70" stroke="currentColor" strokeWidth="4"/></svg>;
  return <svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><rect x="13" y="22" width="74" height="56" rx="9" stroke="currentColor" strokeWidth="4"/><path d="M14 37h72M25 30h1m7 0h1M40 49l-9 9 9 9m20-18 9 9-9 9m-7-21-6 24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export default function Home() {
  const [apps, setApps] = useState<AppTile[]>(preview);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(true);
  const [libraryAppId, setLibraryAppId] = useState<string | null>(null);
  const [moonlightLibraries, setMoonlightLibraries] = useState<Record<string, MoonlightLibrary>>({});
  const [pendingApp, setPendingApp] = useState<AppTile | null>(null);
  const update = useUpdates();
  const itemCount = apps.length + (update.actionLabel ? 1 : 0);
  const launching = useRef(false);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const api = window.ubuntuHub;
    if (!api) return;
    let live = true;
    const unsubscribe = api.onAppsChanged(next => { if (live) setApps(next); });
    api.listApps().then(next => {
      if (!live) return;
      setApps(next);
      for (const application of next) if (application.integration === 'moonlight') {
        // Join the main process's startup discovery before the library is opened.
        void api.moonlightLibrary(application.id).then(result => {
          if (!live || !result.ok) return;
          setMoonlightLibraries(previous => ({ ...previous, [application.id]: result.library }));
          // Warm the first screen of covers in Chromium's cache as well.
          for (const game of result.library.games.slice(0, 8)) if (game.artwork) {
            const image = new Image();
            image.src = game.artwork;
          }
        }).catch(() => { /* Opening the library retries a failed preload. */ });
      }
    }).catch(() => setMessage('Unable to load apps. Restart UbuntuHub to try again.'));
    return () => { live = false; unsubscribe(); };
  }, []);
  const move = useCallback((direction: number) => {
    if (launching.current) return;
    setMessage('');
    setSelected(index => Math.max(0, Math.min(itemCount - 1, index + direction)));
  }, [itemCount]);
  const launch = useCallback(async (index = selected) => {
    if (launching.current) return;
    if (index === apps.length && update.actionLabel) {
      launching.current = true;
      try { const result = await update.act(); if (!result.ok) setMessage(result.error); }
      finally { launching.current = false; }
      return;
    }
    const app = apps[index];
    if (!app || launching.current) return;
    if (app.integration === 'moonlight') { setMessage(''); setLibraryAppId(app.id); return; }
    if (!window.ubuntuHub) { setMessage('Open UbuntuHub in Electron to launch your applications.'); return; }
    launching.current = true;
    setPendingApp(app);
    setMessage('');
    try {
      const result = await window.ubuntuHub.launch(app.id);
      if (!result.ok) setMessage(result.error);
    } catch { setMessage('Could not reach the launcher. Restart UbuntuHub to try again.'); }
    finally { launching.current = false; setPendingApp(null); }
  }, [apps, selected, update.actionLabel, update.act]);
  const back = useCallback(() => { setMessage(''); void window.ubuntuHub?.returnToLauncher(); }, []);
  const connected = useController(move, () => void launch(), back, libraryAppId === null && !pendingApp);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => { if (!libraryAppId) tileRefs.current[selected]?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'center' }); }, [selected, libraryAppId]);
  useEffect(() => { setSelected(index => Math.min(index, Math.max(0, itemCount - 1))); }, [itemCount]);
  useEffect(() => { if (update.state?.canInstall) setMessage(''); }, [update.state?.canInstall]);
  const current = apps[selected];
  const libraryApp = apps.find(item => item.id === libraryAppId);
  return (
    <main className={`launcher relative flex min-h-screen flex-col overflow-hidden text-[#f1f1f3] ${apps.length === 1 ? 'single-app' : ''} ${visible ? '' : 'motion-paused'}`}>
      <div className="ambient" aria-hidden="true">
        <div className="aurora aurora-one" /><div className="aurora aurora-two" />
        <div className="star-field stars-near" /><div className="star-field stars-far" />
        <div className="celestial"><div className="celestial-halo" /><div className="celestial-body" /><div className="celestial-orbit" /></div>
        <div className="horizon" /><div className="scene-vignette" />
      </div>
      <header className="relative flex items-center justify-between px-[6vw] pt-[5vh]">
        <div className="brand"><span className="brand-symbol" aria-hidden="true">u<span>•</span></span><span>ubuntu<span className="font-normal text-[#9b9ca3]">hub</span></span></div>
        <div className="connection"><span className={connected ? 'status-dot online' : 'status-dot'} />{libraryApp ? 'Moonlight library' : connected ? 'Controller connected' : 'Keyboard ready'}</div>
      </header>
      {libraryApp ? <MoonlightLibraryView application={libraryApp} initialLibrary={moonlightLibraries[libraryApp.id]} onBack={() => setLibraryAppId(null)} update={update} /> : <section className="library relative flex flex-1 flex-col justify-center" aria-label="Application launcher">
        {/* <div className="section-heading"><span>YOUR APPLICATIONS</span><span className="count">{String(selected + 1).padStart(2, '0')} <span>/ {String(apps.length).padStart(2, '0')}</span></span></div> */}
        <div className="tile-track" role="group" aria-label="Applications">
          {apps.map((app, index) => <button
            key={app.id} ref={element => { tileRefs.current[index] = element; }}
            className={`app-button ${selected === index ? 'selected' : ''} ${app.status === 'starting' ? 'is-starting' : ''}`}
            style={{ '--accent': app.color, '--tile-index': index } as React.CSSProperties}
            aria-pressed={selected === index} aria-label={`${app.name}${app.status !== 'idle' ? `, ${app.status}` : ''}`}
            onFocus={() => setSelected(index)} onClick={() => { setSelected(index); void launch(index); }}
          >
            <div className="tile"><div className="tile-grain"/><div className="tile-orbit" aria-hidden="true"/><div className="tile-shimmer" aria-hidden="true"/><span className="tile-number">{String(index + 1).padStart(2, '0')}</span><span className="tile-icon"><Icon type={app.icon}/></span><span className="tile-type">{app.icon === 'moon' ? 'GAME STREAMING' : app.icon === 'web' ? 'LOCAL WEB APP' : 'NATIVE APP'}</span>{app.status === 'starting' && <span className="running"><span className="spinner"/> Starting</span>}{app.status === 'running' && <span className="running">● Running</span>}</div>
            <div className="tile-caption"><span className="app-name">{app.name}</span></div>
          </button>)}
          {update.actionLabel && <button ref={element => { tileRefs.current[apps.length] = element; }}
            className={`app-button library-utility update-button ${selected === apps.length ? 'selected' : ''}`}
            style={{ '--accent': '#a3e9cb', '--tile-index': apps.length } as React.CSSProperties}
            aria-pressed={selected === apps.length} aria-label={update.actionLabel}
            onFocus={() => setSelected(apps.length)} onClick={() => { setSelected(apps.length); void launch(apps.length); }}>
            <div className="tile"><span className="utility-icon" aria-hidden="true">↻</span><span className="tile-type">{update.state?.version ? `v${update.state.version}` : 'UBUNTUHUB'}</span></div>
            <div className="tile-caption"><span className="app-name">{update.actionLabel}</span></div>
          </button>}
        </div>
        <div className="feedback" role="status" aria-live="polite">{message || (selected === apps.length ? update.state?.message || (update.state?.status === 'ready' && !update.state.canInstall ? 'Finish playing or close your running apps before restarting.' : '') : current?.error) || (current?.status === 'starting' ? `Starting ${current.name}…` : '\u00a0')}</div>
      </section>}
      <footer className="relative flex items-center justify-between px-[6vw] pb-[4vh]">
        <span className="update-status" role="status">{update.state?.status === 'downloading' ? `Downloading update · ${update.state.progress ?? 0}%` : update.state?.status === 'checking' ? 'Checking for updates…' : update.state?.status === 'installing' ? 'Restarting UbuntuHub…' : update.state?.status === 'ready' ? `Update ready · v${update.state.version}` : ''}</span>
      </footer>
      {pendingApp && <LaunchScreen id={pendingApp.id} name={pendingApp.name} color={pendingApp.color} />}
    </main>
  );
}
