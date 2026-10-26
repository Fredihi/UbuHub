'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useController } from '../lib/use-controller';
import type { AppTile, MoonlightLibrary } from '../shared/types';

interface LibraryItem { id: string; name: string; gameId?: string; kind: 'game' | 'refresh' | 'open' | 'back'; }
export function MoonlightLibraryView({ application, onBack }: { application: AppTile; onBack: () => void }) {
  const [library, setLibrary] = useState<MoonlightLibrary | null>(null);
  const [selected, setSelected] = useState('refresh');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [activeGame, setActiveGame] = useState('');
  const request = useRef(0);
  const busy = useRef(false);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const load = useCallback(async (refresh = false) => {
    const version = ++request.current;
    setLoading(true); setMessage('');
    try {
      const api = window.ubuntuHub;
      if (!api) throw new Error('Open UbuntuHub in Electron to connect to your Moonlight library.');
      const result = await api.moonlightLibrary(application.id, refresh);
      if (version !== request.current) return;
      if (!result.ok) { setMessage(result.error); return; }
      setLibrary(result.library);
      if (!refresh) setSelected(result.library.games[0] ? `game:${result.library.games[0].id}` : 'open');
      if (refresh && !result.library.configured) setMessage('Set moonlight.host in apps.json to your gaming PC’s address, then restart UbuntuHub.');
    } catch (error) {
      if (version === request.current) setMessage(error instanceof Error ? error.message : 'Could not load games.');
    } finally { if (version === request.current) setLoading(false); }
  }, [application.id]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  const items = useMemo<LibraryItem[]>(() => [
    ...(library?.games ?? []).map(game => ({ id: `game:${game.id}`, gameId: game.id, name: game.name, kind: 'game' as const })),
    { id: 'refresh', name: 'Refresh games', kind: 'refresh' },
    { id: 'open', name: 'Open Moonlight', kind: 'open' },
    { id: 'back', name: 'Back', kind: 'back' }
  ], [library]);
  const index = Math.max(0, items.findIndex(item => item.id === selected));
  const move = useCallback((direction: number) => {
    if (busy.current) return;
    const next = Math.max(0, Math.min(items.length - 1, index + direction));
    setSelected(items[next].id);
  }, [index, items]);
  const activate = useCallback(async (item: LibraryItem) => {
    if (item.kind === 'back') { onBack(); return; }
    if (loading || busy.current) return;
    if (item.kind === 'refresh') { await load(true); return; }
    if (application.status === 'running' || application.status === 'starting') {
      setMessage('Moonlight is already running. Disconnect or close it before starting another session.'); return;
    }
    if (item.kind === 'game' && !library?.configured) { setMessage('Configure your gaming PC’s address before starting a stream.'); return; }
    const api = window.ubuntuHub;
    if (!api) { setMessage('Open UbuntuHub in Electron to launch Moonlight.'); return; }
    busy.current = true; setPending(true); setMessage('');
    setActiveGame(item.kind === 'game' ? item.id : '');
    try {
      const result = item.kind === 'game' ? await api.launchMoonlight(application.id, item.gameId!) : await api.launch(application.id);
      if (!result.ok) setMessage(result.error);
    } catch { setMessage('Could not reach the launcher. Restart UbuntuHub to try again.'); }
    finally { busy.current = false; setPending(false); }
  }, [application.id, application.status, library?.configured, load, loading, onBack]);
  const connected = useController(move, () => void activate(items[index]), onBack);
  useEffect(() => {
    refs.current.get(selected)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }, [selected]);
  return <section className="library moonlight-library relative flex flex-1 flex-col justify-center" aria-label="Moonlight games">
    <div className="moonlight-heading"><div><span className="library-eyebrow">MOONLIGHT</span><h1>Your games</h1></div><span className="host-label">{library?.host || 'No gaming PC configured'}</span></div>
    {!library?.games.length && <div className="library-empty" role="status">
      <h2>{loading ? 'Finding your games…' : !library ? 'Game library unavailable' : !library.configured ? 'Connect your gaming PC' : 'No games available yet'}</h2>
      <p>{loading ? 'Checking your Moonlight library.' : !library ? 'Try refreshing, or open Moonlight to check the connection and pairing.' : !library.configured ? 'Set moonlight.host in apps.json to your PC’s hostname or IP address, then restart. Open Moonlight to pair this device first.' : 'Add games to your host’s application list in Sunshine, then refresh here.'}</p>
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
            {item.kind === 'game' ? <><span className="game-monogram" aria-hidden="true">{item.name.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('')}</span><span className="tile-type">STREAM VIA MOONLIGHT</span></> : <span className="utility-icon" aria-hidden="true">{item.kind === 'refresh' ? '⟳' : item.kind === 'open' ? '☾' : '‹'}</span>}
            {starting && <span className="running"><span className="spinner"/> Starting</span>}{running && <span className="running">● Streaming</span>}
          </div>
          <div className="tile-caption"><span className="app-name">{item.name}</span></div>
        </button>;
      })}
    </div>
    <div className="feedback" role="status" aria-live="polite">{message || application.error || (loading ? 'Refreshing game library…' : '\u00a0')}</div>
    <div className="library-hints">{connected ? 'D-pad / stick · Select     A · Open     B · Back' : '← → Select     Enter Open     Esc Back'}</div>
  </section>;
}
