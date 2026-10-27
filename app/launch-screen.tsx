'use client';
import { useCallback, useState } from 'react';
import { useController } from '../lib/use-controller';

export function LaunchScreen({ id, name, color, streaming = false }: { id: string; name: string; color: string; streaming?: boolean }) {
  const [cancelling, setCancelling] = useState(false);
  const cancel = useCallback(() => {
    if (cancelling) return;
    setCancelling(true);
    void window.ubuntuHub?.cancelLaunch(id).then(result => { if (!result.ok) setCancelling(false); }).catch(() => setCancelling(false));
  }, [cancelling, id]);
  useController(() => {}, cancel, cancel);
  return <div className="launch-screen" style={{ '--accent': color } as React.CSSProperties} role="dialog" aria-modal="true" aria-label={`Starting ${name}`}>
    <div className="launch-glow" aria-hidden="true" />
    <div className="launch-content" role="status" aria-live="polite" aria-busy="true">
      <span className="launch-spinner" aria-hidden="true" />
      <span className="library-eyebrow">{streaming ? 'CONNECTING VIA MOONLIGHT' : 'STARTING APPLICATION'}</span>
      <h1>{name}</h1>
      <p>{cancelling ? 'Cancelling launch…' : streaming ? 'Waiting for your fullscreen stream…' : 'Waiting for the application window…'}</p>
    </div>
    <button className="launch-cancel" onClick={cancel} disabled={cancelling}>Cancel <span>Esc / B</span></button>
  </div>;
}
