/** Shown while an admin previews pages the guests cannot open yet (usePreview in lib/gate.ts); never on the kiosk wall. */
import type { GateState, Venue } from '@ples/shared/constants';
import { endPreview } from '../lib/gate.ts';
import './preview.css';

export function PreviewBadge({ venue, state }: { venue: Venue; state: GateState }) {
  const guestsSee = state === 'onboarding' && venue.onboarding ? 'len potvrdenie účasti' : 'len teaser';
  return (
    <div className="preview-badge" role="status">
      <span><b>Náhľad pre admina.</b> Hostia teraz vidia {guestsSee}.</span>
      <button type="button" className="chip" onClick={() => endPreview(venue)}>Ukončiť náhľad</button>
    </div>
  );
}
