import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { venueOfPath } from '@ples/shared/constants';
import { Link, usePathname } from './lib/router.tsx';
import { pageOf } from './lib/venue.ts';
import { FeedbackButton } from './components/FeedbackButton.tsx';
import './styles/base.css';

// the globe pages pull in three.js + globe.gl; the guest form loads without them
const Wall = lazy(() => import('./pages/Wall.tsx'));
const MapPage = lazy(() => import('./pages/MapPage.tsx'));
const Join = lazy(() => import('./pages/Join.tsx'));
const Admin = lazy(() => import('./pages/Admin.tsx'));
const About = lazy(() => import('./pages/About.tsx'));
const Compare = lazy(() => import('./pages/Compare.tsx'));

// The pages of a venue. The ball has them at the root (/mapa), the student lobby under its prefix
// (/vestibul/mapa, see VENUES in packages/shared); tools/build-tuke.mjs makes a folder for each.
const ROUTES: Record<string, React.ComponentType> = {
  '/': Wall,
  '/stena': Wall,
  '/mapa': MapPage,
  '/zapoj-sa': Join,
  '/admin': Admin,
  '/o-projekte': About,
  '/porovnanie': Compare, // 3D globe and 2D map side by side
};

/** Review build: every page except the wall in kiosk mode offers a comment button. */
const REVIEW = import.meta.env.VITE_REVIEW_MODE !== 'false';

function App() {
  const pathname = usePathname();
  const page = pageOf(pathname); // the page inside its venue: /vestibul/mapa -> /mapa
  const Page = ROUTES[page] ?? NotFound;
  const kiosk = new URLSearchParams(location.search).has('kiosk');
  const venue = venueOfPath(pathname);
  useEffect(() => { document.title = `Rozsvieťme mapu sveta · ${venue.name}`; }, [venue.name]);
  return (
    <>
      <Suspense fallback={<div className="stage-light" />}>
        {/* keyed by venue: a page never carries one venue's data over to the other */}
        <Page key={venue.key} />
      </Suspense>
      {REVIEW && !kiosk && page !== '/admin' && <FeedbackButton page={pathname.replace(/\/+$/, '') || '/'} />}
    </>
  );
}

function NotFound() {
  return (
    <main style={{ padding: 'var(--gutter)', maxWidth: 640, margin: '10vh auto' }}>
      <h1 style={{ font: 'italic 500 48px var(--font-display)' }}>Táto stránka nesvieti</h1>
      <p className="muted">Adresa neexistuje. Pokračuj na <Link href="/">zemeguľu</Link>.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
