import React, { useEffect, useState } from 'react';

/**
 * Registers the service worker (production builds only). When a new version of the app has been downloaded in the
 * background, a small bar offers to switch to it, so the page never reloads under someone who is typing.
 */
export function UpdateBar() {
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    let live = true;
    if (!import.meta.env.PROD) return undefined;
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        const apply = registerSW({ onNeedRefresh: () => live && setUpdate(() => () => apply(true)) });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!update) return null;
  return (
    <div className="actionbar" style={{ position: 'fixed', left: '1rem', right: '1rem', bottom: 'calc(0.75rem + var(--safe-bottom))', zIndex: 50, maxWidth: '30rem', margin: '0 auto' }} role="status">
      <span style={{ flex: 1, alignSelf: 'center', paddingLeft: '0.5rem' }}>A new version is ready.</span>
      <button className="btn small" style={{ flex: 'none' }} onClick={update}>Update</button>
    </div>
  );
}
