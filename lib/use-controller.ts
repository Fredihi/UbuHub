'use client';
import { useEffect, useRef, useState } from 'react';
import { RepeatGate } from './controller';

export function useController(move: (direction: number) => void, launch: () => void, back: () => void, enabled = true) {
  const callbacks = useRef({ move, launch, back });
  useEffect(() => { callbacks.current = { move, launch, back }; });
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    setConnected(false);
    if (!enabled) return;
    let frame = 0;
    const gate = new RepeatGate();
    let active = '';
    let aHeld = true;
    let bHeld = true;
    function poll(now: number) {
      const pads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(pads).find(p => p?.connected && p.mapping === 'standard');
      const identity = pad ? `${pad.index}:${pad.id}` : '';
      if (identity !== active) { active = identity; gate.reset(); aHeld = true; bHeld = true; setConnected(!!pad); }
      if (pad && document.hasFocus() && !document.hidden) {
        const left = pad.buttons[14]?.pressed || pad.axes[0] < -0.55;
        const right = pad.buttons[15]?.pressed || pad.axes[0] > 0.55;
        const direction = left === right ? 0 : right ? 1 : -1;
        const step = gate.update(direction, now);
        if (step) callbacks.current.move(step);
        const a = !!pad.buttons[0]?.pressed;
        const b = !!pad.buttons[1]?.pressed;
        if (a && !aHeld) callbacks.current.launch();
        if (b && !bHeld) callbacks.current.back();
        aHeld = a; bHeld = b;
      } else { gate.reset(); aHeld = true; bHeld = true; }
      frame = requestAnimationFrame(poll);
    }
    frame = requestAnimationFrame(poll);
    const keys = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (['ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape', 'Backspace'].includes(event.key)) event.preventDefault();
      if (event.key === 'ArrowLeft') callbacks.current.move(-1);
      if (event.key === 'ArrowRight') callbacks.current.move(1);
      if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) callbacks.current.launch();
      if (!event.repeat && (event.key === 'Escape' || event.key === 'Backspace')) callbacks.current.back();
    };
    window.addEventListener('keydown', keys);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', keys); };
  }, [enabled]);
  return connected;
}
