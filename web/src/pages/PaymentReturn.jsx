import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { haptic } from '../motion.js';
import { motion } from 'motion/react';
import { SPRING } from '../motion.js';

const Tick = () => (
  <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
    <path d="M6 16l6 6 12-14" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Cross = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
    <path d="M6 6l14 14M20 6L6 20" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
  </svg>
);

/** The customer is back from Flutterwave. We confirm the payment with the server, which confirms it with Flutterwave. */
export default function PaymentReturn({ params, onDone, onRetry }) {
  const [state, setState] = useState({ phase: 'checking' });

  useEffect(() => {
    let live = true;
    api
      .verifyPayment(params)
      .then((r) => {
        if (!live) return;
        if (r.status === 'successful') haptic(15);
        setState({ phase: r.status, organisation: r.organisation, kind: r.kind });
      })
      .catch((e) => live && setState({ phase: 'error', message: e.message }));
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { phase } = state;
  return (
    <div className="page">
      <div className="card">
        <div className="empty">
          {phase === 'checking' && (
            <>
              <div className="big">Confirming your payment…</div>
              <p>This takes a few seconds. Please don’t close this page.</p>
            </>
          )}
          {phase === 'successful' && (
            <>
              <motion.div className="check" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING}>
                <Tick />
              </motion.div>
              <div className="big">{state.kind === 'renewal' ? 'Subscription renewed' : 'Payment confirmed'}</div>
              <p style={{ margin: '0 0 1.1rem' }}>
                {state.kind === 'renewal' ? `${state.organisation.name} is paid up again.` : `${state.organisation.name} is ready. Add your stations and your staff next.`}
              </p>
              <button className="btn" onClick={() => onDone(state.organisation)}>Open your dashboard</button>
            </>
          )}
          {phase !== 'checking' && phase !== 'successful' && (
            <>
              <div className="check fail"><Cross /></div>
              <div className="big">{phase === 'cancelled' ? 'Payment cancelled' : 'We could not confirm the payment'}</div>
              <p style={{ margin: '0 0 1.1rem' }}>
                {phase === 'cancelled'
                  ? 'You have not been charged.'
                  : state.message ?? 'If money left your account, don’t pay again. It will be matched automatically within a few minutes; check back, or contact support with your payment reference.'}
              </p>
              <button className="btn" onClick={onRetry}>Back to home</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
