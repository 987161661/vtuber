import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            background: '#090d16',
            color: '#dbeafe',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          正在同步直播场次…
        </div>
      }
    >
      <App />
    </Suspense>
  </StrictMode>,
);
