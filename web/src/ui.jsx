import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, animate, useMotionValue, useTransform, useReducedMotion } from 'motion/react';
import { SPRING, SPRING_MOMENTUM, SPRING_SNAP, project, rubberband } from './motion.js';

export function Field({ label, value, onChange, type = 'text', hint, readOnly, ...rest }) {
  const numeric = type === 'number';
  return (
    <label className="field">
      {label}
      <input
        type={numeric ? 'text' : type}
        inputMode={numeric ? 'decimal' : undefined}
        value={value ?? ''}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, tone }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  );
}

export const tone = (n) => (n > 0.005 ? 'pos' : n < -0.005 ? 'neg' : undefined);

export function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div className="msg error" role="alert">
      {error.message}
      {error.errors?.length > 0 && (
        <ul>
          {error.errors.map((e, i) => (
            <li key={i}>
              {e.date} – {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const Chevron = () => (
  <svg className="chev" width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true">
    <path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const BackChevron = () => (
  <svg width="10" height="17" viewBox="0 0 10 17" fill="none" aria-hidden="true">
    <path d="M8.5 1.5L1.5 8.5l7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Segmented control. The selected thumb is a spring that glides from one segment to the next, and can be re-aimed mid-flight. */
export function Segmented({ options, value, onChange, small, label }) {
  const id = useId();
  return (
    <div className={`segmented${small ? ' small' : ''}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={id} className="thumb" transition={SPRING_SNAP} />}
          <span style={{ position: 'relative' }}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)}>
      <motion.span layout className="knob" transition={SPRING_SNAP} />
    </button>
  );
}

/**
 * A bottom sheet that behaves like a physical object:
 *  - it follows the finger 1:1 from where it was grabbed (never snaps to the pointer),
 *  - you can grab it again while it is still moving and it continues from where it is,
 *  - on release it keeps the finger's velocity and lands where the flick is HEADING, not where it was let go,
 *  - dragging it past the top resists progressively (rubber band),
 *  - it leaves along the same path it arrived on.
 * `children` can be a function that receives `close` so a form can dismiss the sheet with the same motion.
 */
export function Sheet({ title, onClose, children, leading }) {
  const reduce = useReducedMotion();
  const y = useMotionValue(0);
  const [height, setHeight] = useState(600);
  const sheetRef = useRef(null);
  const closing = useRef(0); // bumped on every grab, so an interrupted dismissal never completes
  const drag = useRef(null);
  const opener = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  const titleId = useId();
  const scrimOpacity = useTransform(y, [0, height], [1, 0]);

  useLayoutEffect(() => {
    const h = sheetRef.current?.offsetHeight || 600;
    setHeight(h);
    if (reduce) return undefined;
    y.set(h);
    const controls = animate(y, 0, SPRING); // nothing was thrown, so no bounce
    return () => controls.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(
    (velocity = 0) => {
      const token = ++closing.current;
      if (reduce) {
        onClose();
        return;
      }
      animate(y, height, {
        ...(velocity ? SPRING_MOMENTUM : SPRING),
        velocity,
        onComplete: () => {
          if (closing.current === token) onClose();
        },
      });
    },
    [height, reduce, onClose, y]
  );

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = sheetRef.current;
    (el?.querySelector('.body input:not([readonly]), .body select') ?? el)?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      opener.current?.focus?.({ preventScroll: true });
    };
  }, [close]);

  const down = (e) => {
    if (reduce || e.button > 0 || e.target.closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    closing.current++; // cancel any dismissal that is still in flight
    y.stop(); // pick the sheet up from where it is on screen, not from where it was going
    drag.current = { startPointer: e.clientY, startY: y.get(), history: [{ t: e.timeStamp, y: y.get() }] };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    let next = d.startY + (e.clientY - d.startPointer);
    if (next < 0) next = -rubberband(-next, height);
    y.set(next);
    d.history.push({ t: e.timeStamp, y: next });
    if (d.history.length > 6) d.history.shift();
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const first = d.history[0];
    const last = d.history[d.history.length - 1];
    const dt = (last.t - first.t) / 1000;
    const v = dt > 0 ? (last.y - first.y) / dt : 0; // px/s, positive is downward
    const projected = y.get() + project(v);
    if (projected > height * 0.5 && v > -300) close(v);
    else animate(y, 0, { ...SPRING_MOMENTUM, velocity: v }); // flicked: carry the velocity, allow a little bounce
  };

  return createPortal(
    <>
      <motion.div className="scrim" style={{ opacity: scrimOpacity }} onClick={() => close()} />
      <div className="sheet-wrap">
        <motion.div ref={sheetRef} className={`sheet${reduce ? ' reduced' : ''}`} style={{ y }} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <div className="grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <div className="grabber" />
            <div className="head">
              <span>{leading ?? <button type="button" className="linkbtn" onClick={() => close()}>Cancel</button>}</span>
              <h2 id={titleId}>{title}</h2>
              <span />
            </div>
          </div>
          <div className="body">{typeof children === 'function' ? children(() => close()) : children}</div>
        </motion.div>
      </div>
    </>,
    document.body
  );
}
