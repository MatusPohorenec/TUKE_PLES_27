import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { usePathname } from './lib/router.tsx';
import { FeedbackButton } from './components/FeedbackButton.tsx';
import './styles/base.css';

// the globe pages pull in three.js + globe.gl; the guest form loads without them
const Wall = lazy(() => import('./pages/Wall.tsx'));
const MapPage = lazy(() => import('./pages/MapPage.tsx'));
const Join = lazy(() => import('./pages/Join.tsx'));
const Admin = lazy(() => import('./pages/Admin.tsx'));
const About = lazy(() => import('./pages/About.tsx'));

const ROUTES: Record<string, React.ComponentType> = {
  '/': Wall,
  '/stena': Wall,
  '/mapa': MapPage,
  '/zapoj-sa': Join,
  '/admin': Admin,
  '/o-projekte': About,
};

/** Review build: every page except the wall in kiosk mode offers a comment button. */
const REVIEW = import.meta.env.VITE_REVIEW_MODE !== 'false';

function App() {
  const path = usePathname().replace(/\/+$/, '') || '/';
  const Page = ROUTES[path] ?? NotFound;
  const kiosk = new URLSearchParams(location.search).has('kiosk');
  return (
    <>
      <Suspense fallback={<div className="stage-light" />}>
        <Page />
      </Suspense>
      {REVIEW && !kiosk && path !== '/admin' && <FeedbackButton page={path} />}
    </>
  );
}

function NotFound() {
  return (
    <main style={{ padding: 'var(--gutter)', maxWidth: 640, margin: '10vh auto' }}>
      <h1 style={{ font: 'italic 500 48px var(--font-display)' }}>Táto stránka nesvieti</h1>
      <p className="muted">Adresa neexistuje. Pokračuj na <a href="/">zemeguľu</a>.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
