import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const App = lazy(() => import('./App'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense
      fallback={
        <div className="boot-shell">
          <div className="boot-card">
            <span className="eyebrow">Pokemon Champions Lab</span>
            <h1>Loading the full battle roster...</h1>
            <p>
              Pulling in the Champions dex, damage engine, team tools, and live battle systems.
            </p>
          </div>
        </div>
      }
    >
      <App />
    </Suspense>
  </React.StrictMode>,
);
