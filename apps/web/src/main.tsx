import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { venueOfPath } from '@ples/shared/constants';
import { pageAllowed, useGate } from './lib/gate.ts';
import { kioskMode, navigate, usePathname } from './lib/router.tsx';
import { pageOf, venueHref } from './lib/venue.ts';
import { FeedbackButton } from './components/FeedbackButton.tsx';
import './styles/base.css';

// the globe pages pull in three.js + globe.gl; the guest form loads without them
const Wall = lazy(() => import('./pages/Wall.tsx'));
const MapPage = lazy(() => import('./pages/MapPage.tsx'));
const Join = lazy(() => import('./pages/Join.tsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.tsx'));
const Admin = lazy(() => import('./pages/Admin.tsx'));
const About = lazy(() => import('./pages/About.tsx'));
const Compare = lazy(() => import('./pages/Compare.tsx'));
const Teaser = lazy(() => import('./pages/Teaser.tsx'));

// The pages of a venue. The ball has them at the root (/mapa), the student lobby under its prefix
// (/vestibul/mapa, see VENUES in packages/shared); tools/build-tuke.mjs makes a folder for each.
const ROUTES: Record<string, React.ComponentType> = {
  '/': Wall,
  '/stena': Wall,
  '/mapa': MapPage,
  '/zapoj-sa': Join,
  '/onboarding': Onboarding, // confirmation of attendance; before the ball the only open page
  '/admin': Admin,
  '/o-projekte': About,
  '/porovnanie': Compare, // 3D globe and 2D map side by side
};

/**
 * Review build: a logged-in admin gets a comment button on the pages (not on the onboarding, the teaser or a kiosk);
 * guests never see it.
 */
const REVIEW = import.meta.env.VITE_REVIEW_MODE !== 'false';

const Waiting = () => <div className="stage-light" />;

function App() {
  const pathname = usePathname();
  const page = pageOf(pathname); // the page inside its venue: /vestibul/mapa -> /mapa
  const venue = venueOfPath(pathname);
  const gate = useGate(venue);
  const kiosk = kioskMode(page);
  useEffect(() => { document.title = `Rozsvieťme mapu sveta · ${venue.name}`; }, [venue.name]);

  // Which pages are open depends on the operator's switch in /admin (the event status): before the ball only the
  // onboarding (the QR code on the invitations leads there, and so does the bare address), the rest shows a teaser.
  const allowed = page === '/admin' || (gate !== null && pageAllowed(gate, page, venue));
  const toOnboarding = gate !== null && !allowed && page === '/' && gate.state === 'onboarding' && venue.onboarding;
  useEffect(() => { if (toOnboarding) navigate(venueHref('/onboarding'), { replace: true }); }, [toOnboarding]);

  // an address that is no page (a typo, a guess) gets the teaser with its hint too, never a bare error
  const known = Boolean(ROUTES[page]);
  const Page = allowed && known ? ROUTES[page]! : null;
  return (
    <>
      <Suspense fallback={<Waiting />}>
        {/* keyed by venue: a page never carries one venue's data over to the other */}
        {Page ? <Page key={venue.key} />
          : gate === null || toOnboarding ? <Waiting />
          : <Teaser venue={venue} state={gate.state} lost={!known} />}
      </Suspense>
      {REVIEW && Page && gate?.admin && !kiosk && page !== '/admin' && page !== '/onboarding' && <FeedbackButton page={pathname.replace(/\/+$/, '') || '/'} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
