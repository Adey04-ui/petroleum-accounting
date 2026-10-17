import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken, setStation } from './api.js';
import { Sheet, BackChevron } from './ui.jsx';
import Auth from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import NewOrganisation from './pages/NewOrganisation.jsx';
import PaymentReturn from './pages/PaymentReturn.jsx';
import Org from './pages/Org.jsx';
import Platform from './pages/Platform.jsx';
import Station from './pages/Station.jsx';

/** Flutterwave sends the customer back to /?payment=return&status=...&tx_ref=...&transaction_id=... */
function readPaymentParams() {
  const q = new URLSearchParams(window.location.search);
  if (q.get('payment') !== 'return' || !q.get('tx_ref')) return null;
  return { tx_ref: q.get('tx_ref'), transaction_id: q.get('transaction_id') ?? '', status: q.get('status') ?? '' };
}
const clearUrl = () => window.history.replaceState({}, '', window.location.pathname);

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return scrolled;
}

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [view, setView] = useState({ name: 'home' });
  const [trail, setTrail] = useState([]);
  const [payment, setPayment] = useState(readPaymentParams);
  const [account, setAccount] = useState(false);
  const scrolled = useScrolled();
  const firstLoad = useRef(true);

  const refreshMe = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      return m;
    } catch (e) {
      if (e.status === 401) {
        setToken(null);
        setMe(null);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (getToken()) refreshMe();
  }, [refreshMe]);

  // Someone who works at exactly one station and owns nothing goes straight to it.
  useEffect(() => {
    if (me && firstLoad.current && !payment) {
      firstLoad.current = false;
      if (me.stations.length === 1 && me.organisations.length === 0) setView({ name: 'station', stationId: me.stations[0].id });
    }
  }, [me, payment]);

  const go = useCallback((next, { replace = false } = {}) => {
    setView((current) => {
      if (!replace) setTrail((t) => [...t, current]);
      return next;
    });
    window.scrollTo({ top: 0 });
  }, []);

  const back = () => {
    setTrail((t) => {
      const prev = t[t.length - 1] ?? { name: 'home' };
      setView(prev);
      return t.slice(0, -1);
    });
    window.scrollTo({ top: 0 });
  };

  const signOut = () => {
    setToken(null);
    setStation(null);
    setMe(null);
    setView({ name: 'home' });
    setTrail([]);
    setAccount(false);
    firstLoad.current = true;
  };

  if (loading) return <div className="app"><div className="page muted" style={{ paddingTop: '30vh', textAlign: 'center' }}>Loading…</div></div>;
  if (!me) return <Auth onSignedIn={() => { setLoading(true); refreshMe(); }} />;

  const finishPayment = () => {
    clearUrl();
    setPayment(null);
  };

  let title = '';
  let content;
  if (payment) {
    title = 'Payment';
    content = (
      <PaymentReturn
        params={payment}
        onRetry={() => { finishPayment(); setView({ name: 'home' }); }}
        onDone={async (org) => {
          finishPayment();
          await refreshMe();
          setTrail([]);
          setView({ name: 'org', orgId: org.id });
        }}
      />
    );
  } else if (view.name === 'new-org') {
    title = 'New organisation';
    content = <NewOrganisation me={me} />;
  } else if (view.name === 'org') {
    title = me.organisations.find((o) => o.id === view.orgId)?.name ?? 'Organisation';
    content = <Org key={view.orgId} orgId={view.orgId} go={go} refreshMe={refreshMe} />;
  } else if (view.name === 'platform') {
    title = 'Platform';
    content = <Platform />;
  } else if (view.name === 'station') {
    title = me.stations.find((s) => s.id === view.stationId)?.name ?? 'Station';
    content = <Station key={view.stationId} stationId={view.stationId} me={me} go={go} />;
  } else {
    title = 'Home';
    content = <Home me={me} go={go} />;
  }

  const atHome = view.name === 'home' && !payment;
  const initial = me.user.name.trim().charAt(0).toUpperCase();

  return (
    <div className="app">
      <header className="bar" data-scrolled={scrolled}>
        <div className="left">
          {!atHome && !payment && (
            <button className="linkbtn" onClick={back} aria-label="Back">
              <BackChevron /> Back
            </button>
          )}
        </div>
        <div className="bar-title">{title}</div>
        <div className="right">
          <button className="avatar" onClick={() => setAccount(true)} aria-label="Account">{initial}</button>
        </div>
      </header>

      {content}

      {account && (
        <Sheet title="Account" onClose={() => setAccount(false)} leading={<span />}>
          {(close) => (
            <>
              <div className="card">
                <div style={{ fontWeight: 600, letterSpacing: '-0.01em' }}>{me.user.name}</div>
                <div className="footnote">{me.user.email}</div>
              </div>
              <button className="btn ghost block" onClick={() => { close(); setTimeout(signOut, 250); }} style={{ color: 'var(--negative)' }}>Sign out</button>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
