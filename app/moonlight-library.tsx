'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useController } from '../lib/use-controller';
import type { AppTile, MoonlightLibrary, Result, UpdateState } from '../shared/types';
import { LaunchScreen } from './launch-screen';

interface LibraryItem { id: string; name: string; gameId?: string; artwork?: string; kind: 'game' | 'back' | 'update'; }
function GameCover({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  // A local Electron protocol serves only verified PNGs from known Moonlight
  // cache entries. Next's optimizer cannot serve these desktop-only resources.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="game-cover" src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
export function MoonlightLibraryView({ application, initialLibrary, onBack, update }: { application: AppTile; initialLibrary?: MoonlightLibrary; onBack: () => void; update: { state: UpdateState | null; actionLabel: string | null; act: () => Promise<Result> } }) {
  const [library, setLibrary] = useState<MoonlightLibrary | null>(initialLibrary ?? null);
  const [selected, setSelected] = useState(initialLibrary?.games[0] ? `game:${initialLibrary.games[0].id}` : 'back');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(!initialLibrary);
  const [pending, setPending] = useState(false);
  const [activeGame, setActiveGame] = useState('');
  const [launchName, setLaunchName] = useState('');
  const request = useRef(0);
  const busy = useRef(false);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const load = useCallback(async () => {
    const version = ++request.current;
    setLoading(true); setMessage('');
    try {
      const api = window.ubuntuHub;
      if (!api) throw new Error('Open UbuntuHub in Electron to connect to your Moonlight library.');
      const result = await api.moonlightLibrary(application.id);
      if (version !== request.current) return;
      if (!result.ok) { setMessage(result.error); return; }
      setLibrary(result.library);
      setSelected(result.library.games[0] ? `game:${result.library.games[0].id}` : 'back');
    } catch (error) {
      if (version === request.current) setMessage(error instanceof Error ? error.message : 'Could not load games.');
    } finally { if (version === request.current) setLoading(false); }
  }, [application.id]);
  useEffect(() => {
    if (initialLibrary) {
      setLibrary(initialLibrary);
      setSelected(initialLibrary.games[0] ? `game:${initialLibrary.games[0].id}` : 'back');
      setLoading(false);
      return;
    }
    void load();
    return () => { request.current++; };
  }, [load, initialLibrary]);
  const items = useMemo<LibraryItem[]>(() => [
    ...(library?.games ?? []).map(game => ({ id: `game:${game.id}`, gameId: game.id, name: game.name, artwork: game.artwork, kind: 'game' as const })),
    { id: 'back', name: 'Back', kind: 'back' },
    ...(update.actionLabel ? [{ id: 'update', name: update.actionLabel, kind: 'update' as const }] : [])
  ], [library, update.actionLabel]);
  const index = Math.max(0, items.findIndex(item => item.id === selected));
  const move = useCallback((direction: number) => {
    if (busy.current) return;
    const next = Math.max(0, Math.min(items.length - 1, index + direction));
    setSelected(items[next].id);
  }, [index, items]);
  const activate = useCallback(async (item: LibraryItem) => {
    if (busy.current) return;
    if (item.kind === 'back') { onBack(); return; }
    if (item.kind === 'update') { const result = await update.act(); if (!result.ok) setMessage(result.error); return; }
    if (loading || busy.current) return;
    if (application.status === 'running' || application.status === 'starting') {
      setMessage('Moonlight is already running. Disconnect or close it before starting another session.'); return;
    }
    if (item.kind === 'game' && !library?.configured) { setMessage('Configure your gaming PC’s address before starting a stream.'); return; }
    const api = window.ubuntuHub;
    if (!api) { setMessage('Open UbuntuHub in Electron to launch Moonlight.'); return; }
    busy.current = true; setPending(true); setMessage('');
    setLaunchName(item.name);
    setActiveGame(item.kind === 'game' ? item.id : '');
    try {
      const result = await api.launchMoonlight(application.id, item.gameId!);
      if (!result.ok) setMessage(result.error);
    } catch { setMessage('Could not reach the launcher. Restart UbuntuHub to try again.'); }
    finally { busy.current = false; setPending(false); }
  }, [application.id, application.status, library?.configured, loading, onBack, update.act]);
  const connected = useController(move, () => void activate(items[index]), onBack, !pending);
  useEffect(() => {
    refs.current.get(selected)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }, [selected]);
  return <section className="library moonlight-library relative flex flex-1 flex-col justify-center" aria-label="Moonlight games">
    <div className="moonlight-heading"><div><span className="library-eyebrow">MOONLIGHT</span><h1>Your games</h1></div><span className="host-label">{library?.host || 'No gaming PC configured'}</span></div>
    {!library?.games.length && <div className="library-empty" role="status">
      <h2>{loading ? 'Finding your games…' : !library ? 'Game library unavailable' : !library.configured ? 'Connect your gaming PC' : 'No games available yet'}</h2>
      <p>{loading ? 'Checking your Moonlight library.' : !library ? 'Check that your gaming PC is online and paired in Moonlight, then return to this library to try again.' : !library.configured ? 'Set moonlight.host in apps.json to your PC’s hostname or IP address, then restart. Pair this device in Moonlight first.' : 'Add games to your host’s application list in Sunshine, then restart UbuntuHub to update your library.'}</p>
    </div>}
    <div className="tile-track game-track" role="group" aria-label="Games and library controls" aria-busy={loading}>
      {items.map((item, position) => {
        const active = item.kind === 'game' && activeGame === item.id;
        const starting = active && (pending || application.status === 'starting');
        const running = active && application.status === 'running';
        return <button key={item.id} ref={element => { if (element) refs.current.set(item.id, element); else refs.current.delete(item.id); }}
          className={`app-button ${item.kind === 'game' ? 'game-button' : 'library-utility'} ${items[index].id === item.id ? 'selected' : ''} ${starting ? 'is-starting' : ''}`}
          style={{ '--accent': application.color, '--tile-index': Math.min(position, 5) } as React.CSSProperties}
          aria-pressed={items[index].id === item.id} aria-label={item.name}
          aria-disabled={item.kind !== 'back' && (loading || pending)}
          onFocus={() => setSelected(item.id)} onClick={() => { setSelected(item.id); void activate(item); }}>
          <div className="tile"><div className="tile-grain"/><div className="tile-shimmer" aria-hidden="true"/>
            {item.kind === 'game' ? <><span className="game-monogram" aria-hidden="true">{item.name.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('')}</span><span className="tile-type">STREAM VIA MOONLIGHT</span></> : <span className="utility-icon" aria-hidden="true">{item.kind === 'update' ? '⟳' : '‹'}</span>}
            {item.kind === 'game' && item.artwork && <GameCover key={item.artwork} src={item.artwork} />}
            {starting && <span className="running"><span className="spinner"/> Starting</span>}{running && <span className="running">● Streaming</span>}
          </div>
          <div className="tile-caption"><span className="app-name">{item.name}</span></div>
        </button>;
      })}
    </div>
    <div className="feedback" role="status" aria-live="polite">{message || application.error || (loading ? 'Refreshing game library…' : '\u00a0')}</div>
    <div className="library-hints">{connected ? 'D-pad / stick · Select     A · Open     B · Back' : '← → Select     Enter Open     Esc Back'}</div>
    {pending && <LaunchScreen id={application.id} name={launchName} color={application.color} streaming={!!activeGame} />}
  </section>;
}
