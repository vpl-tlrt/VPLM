import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from '@/app.tsx';

// Online-only deployment. Retire legacy VPLM service workers so they cannot
// continue serving stale/offline app shells. Do not touch unrelated GitHub
// Pages registrations or clear browser storage holding legacy recovery journals.
if ('serviceWorker' in navigator) {
  const hostedAtCustomDomain = window.location.hostname === 'vplm.qd.je';
  const appPath = new URL('./', window.location.href).pathname;
  void navigator.serviceWorker.getRegistrations().then(registrations =>
    Promise.all(registrations
      .filter(reg => {
        const scope = new URL(reg.scope);
        return scope.origin === window.location.origin &&
          (hostedAtCustomDomain || scope.pathname.startsWith(appPath));
      })
      .map(reg => reg.unregister()),
    ),
  ).catch(() => { /* The app still requires a live cloud connection. */ });
}

const NativeResizeObserver = window.ResizeObserver;

class AnimationFrameResizeObserver extends NativeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    let frameId: number | undefined;
    super((entries: ResizeObserverEntry[], observer: ResizeObserver) => {
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => callback(entries, observer));
    });
  }
}

// Deliver resize measurements in the next frame so layout updates cannot feed back
// into the same ResizeObserver notification cycle.
window.ResizeObserver = AnimationFrameResizeObserver;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
