// node tools/api-smoke.mjs [baseUrl] [origin] [--venue vestibul]
// Smoke test of every API route against a running local API (default http://localhost:8787/api, e.g. npm run dev):
// globe, place detail, search, the gate and the venue's status (before the ball: onboarding only, lights from the
// admin only; the ball night; after the ball: read only), confirmation of attendance, submit + undo, live/summary,
// guests' photos (upload, metadata stripped, moderation, the wall's feed, undo, the photo modes), feedback, admin login,
// moderation, scene, access code. It puts the venue's status and photo mode back where it found them.
// --venue vestibul tests the student lobby's routes (/api/vestibul/…, its own database) instead of the ball's, and
// every run checks that its lights never show in the other venue. With an origin (e.g. http://localhost:4173, the
// cross-origin setup in CLAUDE.md) every response must carry CORS headers. It writes test lights (undone again),
// a feedback row and audit rows, so it refuses non-local servers. The admin password comes from the repository
// .env and is never printed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// VENUES in packages/shared/src/constants.ts: path prefix and event of each venue
const VENUES = { ples: { prefix: '', event: 'ples-2027' }, vestibul: { prefix: '/vestibul', event: 'vestibul' } };
const args = process.argv.slice(2);
const venueAt = args.indexOf('--venue');
const venueKey = venueAt >= 0 ? args.splice(venueAt, 2)[1] : 'ples';
const venue = VENUES[venueKey];
if (!venue) {
  console.error(`unknown venue ${venueKey}: one of ${Object.keys(VENUES).join(', ')}`);
  process.exit(2);
}
const root = (args[0] ?? 'http://localhost:8787/api').replace(/\/+$/, '');
const origin = args[1];
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(root)) {
  console.error(`refusing ${root}: the smoke test writes data, run it against a local API only`);
  process.exit(2);
}
const base = root + venue.prefix;
const EV = `/events/${venue.event}`;
const others = Object.entries(VENUES).filter(([key]) => key !== venueKey);
console.log(`venue ${venueKey}: ${base}`);
const env = Object.fromEntries(readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const device = crypto.randomUUID().replace(/-/g, ''); // a new browser per run: the rate limits never trip
// a 48 × 32 JPEG with an EXIF block holding a GPS position: the API must keep the picture and drop the EXIF
const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4QCwRXhpZgAATU0AKgAAAAgAAwEPAAIAAAAIAAAAMgEQAAIAAAAIAAAAOoglAAQAAAABAAAAQgAAAABUZXN0Q2FtAE1vZGVsIFgAAAQAAQACAAAAAk4AAAAAAgAFAAAAAwAAAHgAAwACAAAAAkUAAAAABAAFAAAAAwAAAJAAAAAAAAAAMAAAAAEAAAArAAAAAQAAADEAAAABAAAAFQAAAAEAAAAOAAAAAQAAACwAAAAB/9sAQwAKBwcIBwYKCAgICwoKCw4YEA4NDQ4dFRYRGCMfJSQiHyIhJis3LyYpNCkhIjBBMTQ5Oz4+PiUuRElDPEg3PT47/9sAQwEKCwsODQ4cEBAcOygiKDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7/8AAEQgAIAAwAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A5L7N7UfZvaryzWbSLGtzCzN0AcHP+c1Q1LVFtZfJtwsjqfnJ6D2+teqq7Zi6SWpoWHhnU9Ut5riysnmih++y4HOM4GfvH2GTyPUVQ+ze1W9C+Imr6FZzWkMdu8cvzAsuGRsY3A9Ow4II4+uasWs2Lxln3xsBnaVzk+gI/ripVarzPm26B7ODWgn2b2o+ze1VItccTEywqYyeAvVR/WtW9vLWyiDM4dnXcirzuHrn096p15IFSizn0tN0RLHDHoaYYAOCSCKv0VfIiTMWP/TI4WJwyk9P8+lJHG0k0qLyEbHStIxoZBIVG8DANCxojMyqAXOWI71Ps9R3KgtCR0NNe2KgHp9av0113KRVciC5/9k=', 'base64');
let cookie = '';
let failures = 0;

async function call(method, path, body, headers = {}) {
  const h = { ...headers };
  if (origin) h.origin = origin;
  if (body !== undefined) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (origin && res.headers.get('access-control-allow-origin') !== origin) { failures++; console.log('  ! missing CORS header on', method, path); }
  return { status: res.status, json, headers: res.headers };
}
/** A multipart photo upload (the guest form's FormData): the fields as JSON, the picture and its small copy. */
async function sendPhoto(meta, { photo = TINY_JPEG, thumb = TINY_JPEG, dev = device } = {}) {
  const form = new FormData();
  if (meta !== undefined) form.append('meta', JSON.stringify(meta));
  form.append('photo', new Blob([photo], { type: 'image/jpeg' }), 'photo.jpg');
  form.append('thumb', new Blob([thumb], { type: 'image/jpeg' }), 'thumb.jpg');
  const h = { 'x-device-id': dev };
  if (origin) h.origin = origin;
  if (cookie) h.cookie = cookie;
  const res = await fetch(`${base}${EV}/photos`, { method: 'POST', headers: h, body: form });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (origin && res.headers.get('access-control-allow-origin') !== origin) { failures++; console.log('  ! missing CORS header on POST photos'); }
  return { status: res.status, json };
}
/** The bytes of a photo as a visitor (or the admin) gets them. */
async function photoBytes(id, size) {
  const h = cookie ? { cookie } : {};
  const res = await fetch(`${base}${EV}/photos/${id}${size ? `?size=${size}` : ''}`, { headers: h });
  return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), bytes: Buffer.from(await res.arrayBuffer()) };
}

/** Runs a request as a visitor, without the admin cookie. */
async function anonymous(request) {
  const saved = cookie;
  cookie = '';
  try { return await request(); } finally { cookie = saved; }
}
function check(label, ok, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` – ${extra}` : ''}`);
}
/** Light count of every other venue whose database is up, read uncached (live with a cursor past every light). */
async function otherTotals() {
  const result = {};
  for (const [key, other] of others) {
    const res = await fetch(`${root}${other.prefix}/events/${other.event}/live?after=2000000000`);
    result[key] = res.status === 200 ? (await res.json()).totals.pins : `HTTP ${res.status}`;
  }
  return result;
}

const health = await call('GET', '/health');
check('health', health.status === 200 && health.json.database === 'up' && health.json.venue === venueKey, JSON.stringify(health.json));
for (const [key, other] of others) {
  // the event of this venue does not exist in the other venue's database, and the other way round
  const res = await fetch(`${root}${other.prefix}${EV}`);
  check(`event of ${venueKey} unknown in ${key}`, res.status === 404 || res.status === 503, `HTTP ${res.status}`);
  const back = await call('GET', `/events/${other.event}`);
  check(`event of ${key} unknown in ${venueKey}`, back.status === 404, `HTTP ${back.status}`);
}
const othersBefore = await otherTotals();

const globe = await call('GET', '/globe');
const g = globe.json;
check('globe from database', globe.status === 200 && g.source === 'database', `${g.stats?.places} places, ${g.stats?.institutions} institutions, ${g.stats?.links} links, ${g.stats?.countries} countries, version ${g.version}`);
const withSince = g.places?.filter(p => p.since !== null).length;
const first = g.places?.[0];
check('globe place shape', first && typeof first.lat === 'number' && Array.isArray(first.groups) && typeof first.institutions === 'number', JSON.stringify(first));
check('globe since years', withSince > 700, `${withSince} places with a year, min ${Math.min(...g.places.filter(p => p.since).map(p => p.since))}`);
const etag = globe.headers.get('etag');
const again = await call('GET', '/globe', undefined, { 'if-none-match': etag });
check('globe ETag 304', again.status === 304);

const place = await call('GET', `/globe/places/${first.id}`);
check('place detail', place.status === 200 && place.json.institutions?.length > 0 && Array.isArray(place.json.institutions[0].links[0].tukeUnits), `${place.json.name}: ${place.json.institutions?.length} institutions`);
const badPlace = await call('GET', '/globe/places/x1');
check('place invalid id 400', badPlace.status === 400);

for (const q of ['kosice', 'Košice', 'wien', 'mnich', 'praha', 'slov', 'sao paulo']) {
  const s = await call('GET', `/gazetteer/search?q=${encodeURIComponent(q)}`);
  check(`search "${q}"`, s.status === 200 && s.json.hits.length > 0, s.json.hits?.slice(0, 4).map(h => `${h.kind}:${h.name}`).join(', '));
}
const short = await call('GET', '/gazetteer/search?q=k');
check('search too short 400', short.status === 400);

// ---------------------------------------------------------------- admin login, the venue's status and the gate
const noSession = await call('GET', '/admin/me');
check('admin without session 401', noSession.status === 401);
const wrong = await call('POST', '/admin/login', { password: 'definitely-wrong' });
check('admin wrong password 401', wrong.status === 401);
const gateVisitor = await call('GET', '/gate');
const login = await call('POST', '/admin/login', { password: env.ADMIN_PASSWORD });
check('admin login', login.status === 200 && cookie.startsWith('ples_admin='), `cookie ${cookie ? 'set' : 'missing'}; ${login.headers.get('set-cookie')?.replace(/ples_admin=[^;]+/, 'ples_admin=…')}`);
const me = await call('GET', '/admin/me');
check('admin me', me.status === 200);
const ev = await call('GET', `/admin${EV}`);
check('admin event', ev.status === 200, JSON.stringify(ev.json));
const startStatus = ev.json.status;
// gateOf in packages/shared/src/constants.ts
const gateOf = s => (s === 'live' || s === 'closed' ? 'open' : s === 'open' ? 'onboarding' : 'off');
check('gate for visitors follows the status', gateVisitor.status === 200 && gateVisitor.json.admin === false && gateVisitor.json.state === gateOf(startStatus), `${startStatus} -> ${JSON.stringify(gateVisitor.json)}`);
const gateAdmin = await call('GET', '/gate');
check('gate knows the admin', gateAdmin.status === 200 && gateAdmin.json.admin === true, JSON.stringify(gateAdmin.json));
const setStatus = async status => (await call('PATCH', `/admin${EV}`, { status })).json?.status;

// ---------------------------------------------------------------- before the ball: only the onboarding
check('status open (before the ball)', (await setStatus('open')) === 'open');
const gateOpen = await anonymous(() => call('GET', '/gate'));
check('gate before the ball: onboarding', gateOpen.json.state === 'onboarding' && gateOpen.json.admin === false, JSON.stringify(gateOpen.json));
const early = await anonymous(() => call('POST', `${EV}/pins`, { places: [{ countryCode: 'NP' }], visitKind: 'erasmus_study' }, { 'x-device-id': device }));
check('light from a visitor before the ball 409', early.status === 409, `HTTP ${early.status}`);
const rehearsal = await call('POST', `${EV}/pins`, { places: [{ countryCode: 'NP' }], visitKind: 'erasmus_study' }, { 'x-device-id': device });
check('light from the admin before the ball (rehearsal)', rehearsal.status === 201, `HTTP ${rehearsal.status}`);
if (rehearsal.json?.submissionId) await call('DELETE', `${EV}/submissions/${rehearsal.json.submissionId}`, undefined, { 'x-device-id': device });

const attendee = await anonymous(() => call('POST', `${EV}/attendees`, { name: 'Skúšobný Hosť Ľščťžý', affiliation: 'FEI TUKE', companion: 'Skúšobný Doprovod' }, { 'x-device-id': device }));
check('attendance with a companion confirmed', attendee.status === 201 && typeof attendee.json.id === 'number' && attendee.json.name === 'Skúšobný Hosť Ľščťžý' && attendee.json.companion === 'Skúšobný Doprovod', `${attendee.status} ${JSON.stringify(attendee.json)}`);
const alone = await anonymous(() => call('POST', `${EV}/attendees`, { name: 'Skúšobný Sólo', affiliation: 'Hosť' }, { 'x-device-id': device }));
check('attendance without a companion', alone.status === 201 && alone.json.companion === null, `${alone.status} ${JSON.stringify(alone.json)}`);
const badAttendee = await anonymous(() => call('POST', `${EV}/attendees`, { name: 'X', affiliation: '' }, { 'x-device-id': device }));
check('attendance without name and affiliation 400', badAttendee.status === 400, `HTTP ${badAttendee.status}`);
const badCompanion = await anonymous(() => call('POST', `${EV}/attendees`, { name: 'Skúšobný Hosť', affiliation: 'Hosť', companion: 'X' }, { 'x-device-id': device }));
check('attendance with a one-letter companion 400', badCompanion.status === 400, `HTTP ${badCompanion.status}`);
const attendees = await call('GET', '/admin/attendees');
check('admin attendance list', attendees.status === 200 && attendees.json.attendees.some(a => a.id === attendee.json.id && a.affiliation === 'FEI TUKE' && a.companion === 'Skúšobný Doprovod') && attendees.json.attendees.some(a => a.id === alone.json.id && a.companion === null), `${attendees.json.attendees?.length} confirmed`);
const attendeesVisitor = await anonymous(() => call('GET', '/admin/attendees'));
check('attendance list needs the admin 401', attendeesVisitor.status === 401, `HTTP ${attendeesVisitor.status}`);

// ---------------------------------------------------------------- the ball night: every page, lights from guests
check('status live (the ball)', (await setStatus('live')) === 'live');
const gateLive = await anonymous(() => call('GET', '/gate'));
check('gate on the ball night: open', gateLive.json.state === 'open', JSON.stringify(gateLive.json));

const event = await call('GET', EV);
check('event', event.status === 200 && event.json.slug === venue.event && event.json.status === 'live', JSON.stringify(event.json));
const before = await call('GET', `${EV}/summary`);
check('summary', before.status === 200 && before.json.totals, JSON.stringify(before.json.totals));

const kosice = (await call('GET', '/gazetteer/search?q=kosice')).json.hits.find(h => h.kind === 'city');
const submit = await anonymous(() => call('POST', `${EV}/pins`, { places: [{ geonameId: kosice.geonameId }, { countryCode: 'NP' }], visitKind: 'erasmus_study', role: 'student', faculty: 'FEI' }, { 'x-device-id': device }));
check('submit 2 lights (a guest)', submit.status === 201 && submit.json.pins?.length === 2 && /^[0-9a-f-]{36}$/.test(submit.json.submissionId), `${submit.status} ${JSON.stringify(submit.json).slice(0, 200)}`);

await new Promise(r => setTimeout(r, 2100)); // the live feed is shared for 2 s
const live = await call('GET', `${EV}/live`);
check('live has the new lights', live.status === 200 && live.json.pins.some(p => p.id === submit.json.pins?.[0]?.id), `cursor ${live.json.cursor}, totals ${JSON.stringify(live.json.totals)}`);
const after = await call('GET', `${EV}/live?after=${(submit.json.pins?.[0]?.id ?? 1) - 1}`);
check('live after cursor', after.status === 200 && after.json.pins.length >= 2, `${after.json.pins.length} pins`);
await new Promise(r => setTimeout(r, 2100)); // summary is shared for 2 s
const summary = await call('GET', `${EV}/summary`);
check('summary counts the lights', summary.json.totals.pins === before.json.totals.pins + 2, `${JSON.stringify(summary.json.totals)}, keys ${summary.json.places.map(p => p.key).join(' ')}`);
const othersAfter = await otherTotals();
check('the lights stay in this venue', JSON.stringify(othersAfter) === JSON.stringify(othersBefore), `other venues before ${JSON.stringify(othersBefore)}, after ${JSON.stringify(othersAfter)}`);

const badUndo = await call('DELETE', `${EV}/submissions/------------------------------------`, undefined, { 'x-device-id': device });
check('undo invalid id 400', badUndo.status === 400);
const otherDevice = await call('DELETE', `${EV}/submissions/${submit.json.submissionId}`, undefined, { 'x-device-id': 'fedcba9876543210fedcba9876543210' });
check('undo from another device 404', otherDevice.status === 404);
const undo = await call('DELETE', `${EV}/submissions/${submit.json.submissionId}`, undefined, { 'x-device-id': device });
check('undo', undo.status === 200 && undo.json.ok === true);
const undoAgain = await call('DELETE', `${EV}/submissions/${submit.json.submissionId}`, undefined, { 'x-device-id': device });
check('undo twice 404', undoAgain.status === 404);

const unknown = await call('POST', `${EV}/pins`, { places: [{ geonameId: 999999999 }], visitKind: 'erasmus_study' }, { 'x-device-id': device });
check('unknown place 400', unknown.status === 400 && unknown.json.error.code === 'unknown_place');

// ---------------------------------------------------------------- guests' photos (the ball night)
const startPhotos = ev.json.photos;
const photosBefore = (await call('GET', '/admin/photos')).json.photos?.length ?? 0;
const setPhotos = async photos => (await call('PATCH', `/admin${EV}`, { photos })).json?.photos;
const wait = () => new Promise(r => setTimeout(r, 2100)); // the live feed and the photo list are shared for 2 s
check('photos mode review', (await setPhotos('review')) === 'review' && (await call('GET', EV)).json.photos === 'review');

const ballPhoto = await anonymous(() => sendPhoto({ kind: 'ball' }));
check('photo from the ball waits for review', ballPhoto.status === 201 && ballPhoto.json.status === 'pending' && /^[0-9a-f-]{36}$/.test(ballPhoto.json.id), `${ballPhoto.status} ${JSON.stringify(ballPhoto.json)}`);
const ballId = ballPhoto.json.id;
const hiddenFromVisitors = await anonymous(() => photoBytes(ballId));
check('a waiting photo is hidden from visitors 404', hiddenFromVisitors.status === 404, `HTTP ${hiddenFromVisitors.status}`);
const adminView = await photoBytes(ballId);
check('the admin sees the waiting photo, EXIF and GPS stripped', adminView.status === 200 && adminView.type === 'image/jpeg' && adminView.bytes[0] === 0xff && adminView.bytes[1] === 0xd8
  && !adminView.bytes.includes(Buffer.from('Exif')) && TINY_JPEG.includes(Buffer.from('Exif')) && adminView.bytes.length < TINY_JPEG.length, `${adminView.bytes.length} of ${TINY_JPEG.length} bytes, ${adminView.cache}`);
const thumbView = await photoBytes(ballId, 'thumb');
check('the admin sees its small copy', thumbView.status === 200 && thumbView.bytes.length > 100, `${thumbView.bytes.length} bytes`);
const adminList = await call('GET', '/admin/photos');
check('admin photo list', adminList.status === 200 && adminList.json.photos.some(p => p.id === ballId && p.status === 'pending' && p.kind === 'ball' && p.width === 48 && p.height === 32), JSON.stringify(adminList.json.photos?.[0]));
await wait();
const liveWaiting = await call('GET', `${EV}/live`);
check('the wall does not get a waiting photo', Array.isArray(liveWaiting.json.photos?.latest) && !liveWaiting.json.photos.latest.some(p => p.id === ballId), `${liveWaiting.json.photos?.total} on the wall`);
check('admin approves the photo', (await call('PATCH', `/admin/photos/${ballId}`, { status: 'approved' })).status === 200);
await wait();
const liveApproved = await call('GET', `${EV}/live`);
const onWall = liveApproved.json.photos?.latest.find(p => p.id === ballId);
check('the wall gets the approved photo', Boolean(onWall) && onWall.kind === 'ball' && onWall.countryCode === 'SK' && liveApproved.json.photos.total >= 1, JSON.stringify(onWall));
const gallery = await call('GET', `${EV}/photos`);
check('photo list of the wall', gallery.status === 200 && gallery.json.photos.some(p => p.id === ballId), `${gallery.json.photos?.length} photos`);
const publicView = await anonymous(() => photoBytes(ballId));
check('visitors see the approved photo, cached', publicView.status === 200 && /immutable/.test(publicView.cache ?? ''), publicView.cache);

const placeLight = await call('POST', `${EV}/pins`, { places: [{ countryCode: 'NP' }], visitKind: 'travel' }, { 'x-device-id': device });
const placePin = placeLight.json.pins?.[0]?.id;
const placePhoto = await anonymous(() => sendPhoto({ kind: 'place', pinId: placePin }));
check('photo to one of my lights', placePhoto.status === 201, `${placePhoto.status} ${JSON.stringify(placePhoto.json)}`);
const strangerPhoto = await anonymous(() => sendPhoto({ kind: 'place', pinId: placePin }, { dev: 'fedcba9876543210fedcba9876543210' }));
check("photo to somebody else's light 404", strangerPhoto.status === 404, `HTTP ${strangerPhoto.status}`);
const placeRow = (await call('GET', '/admin/photos')).json.photos.find(p => p.id === placePhoto.json.id);
check('the place of the photo comes from the light', placeRow?.kind === 'place' && placeRow.countryCode === 'NP' && placeRow.visitKind === 'travel' && placeRow.name === placeLight.json.pins[0].name, JSON.stringify(placeRow));
await call('DELETE', `${EV}/submissions/${placeLight.json.submissionId}`, undefined, { 'x-device-id': device });
const afterUndo = (await call('GET', '/admin/photos')).json.photos;
check('undoing the light deletes its photo', !afterUndo.some(p => p.id === placePhoto.json.id), `${afterUndo.length} photos`);

const notJpeg = await anonymous(() => sendPhoto({ kind: 'ball' }, { photo: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }));
check('not a JPEG 400', notJpeg.status === 400, `HTTP ${notJpeg.status}`);
const cut = await anonymous(() => sendPhoto({ kind: 'ball' }, { photo: TINY_JPEG.subarray(0, TINY_JPEG.length - 200) }));
check('a cut-off JPEG 400', cut.status === 400, `HTTP ${cut.status}`);
const noMeta = await anonymous(() => sendPhoto(undefined));
check('photo without its fields 400', noMeta.status === 400, `HTTP ${noMeta.status}`);
const noPin = await anonymous(() => sendPhoto({ kind: 'place' }));
check('place photo without a light 400', noPin.status === 400, `HTTP ${noPin.status}`);
let huge;
try { huge = await anonymous(() => sendPhoto({ kind: 'ball' }, { photo: Buffer.concat([TINY_JPEG, Buffer.alloc(2_000_000)]) })); } catch (err) { huge = { status: `error ${err.cause?.code ?? err.message}` }; }
check('a photo over the size limit 413', huge.status === 413, `HTTP ${huge.status}`);

check('photos mode auto', (await setPhotos('auto')) === 'auto');
const autoPhoto = await anonymous(() => sendPhoto({ kind: 'ball' }));
check('photo goes on the wall at once', autoPhoto.status === 201 && autoPhoto.json.status === 'approved', JSON.stringify(autoPhoto.json));
const otherUndo = await call('DELETE', `${EV}/photos/${autoPhoto.json.id}`, undefined, { 'x-device-id': 'fedcba9876543210fedcba9876543210' });
check('photo undo from another device 404', otherUndo.status === 404, `HTTP ${otherUndo.status}`);
const ownUndo = await call('DELETE', `${EV}/photos/${autoPhoto.json.id}`, undefined, { 'x-device-id': device });
check('photo undo', ownUndo.status === 200, `HTTP ${ownUndo.status}`);
const undoAgainPhoto = await call('DELETE', `${EV}/photos/${autoPhoto.json.id}`, undefined, { 'x-device-id': device });
check('photo undo twice 404', undoAgainPhoto.status === 404, `HTTP ${undoAgainPhoto.status}`);

check('admin hides the photo', (await call('PATCH', `/admin/photos/${ballId}`, { status: 'hidden' })).status === 200);
const hiddenView = await anonymous(() => photoBytes(ballId));
check('a hidden photo is gone for visitors 404', hiddenView.status === 404, `HTTP ${hiddenView.status}`);
check('admin shows it again', (await call('PATCH', `/admin/photos/${ballId}`, { status: 'approved' })).status === 200);
check('photos mode off', (await setPhotos('off')) === 'off');
const offPhoto = await anonymous(() => sendPhoto({ kind: 'ball' }));
check('no photos while switched off 409', offPhoto.status === 409, `HTTP ${offPhoto.status}`);
await wait();
const liveOff = await call('GET', `${EV}/live`);
const galleryOff = await call('GET', `${EV}/photos`);
const offView = await anonymous(() => photoBytes(ballId));
check('switched off: the wall shows no photos', liveOff.json.photos?.total === 0 && galleryOff.json.photos?.length === 0 && offView.status === 404, `${JSON.stringify(liveOff.json.photos)}, list ${galleryOff.json.photos?.length}, picture ${offView.status}`);
check('bad photo id 400', (await call('PATCH', '/admin/photos/abc', { status: 'hidden' })).status === 400);
check('missing photo 404', (await call('DELETE', '/admin/photos/00000000-0000-0000-0000-000000000000')).status === 404);
if (photosBefore === 0) {
  const all = await call('DELETE', '/admin/photos'); // nothing but this run's photos: the button "Zmazať všetky fotky"
  check('admin deletes every photo', all.status === 200 && all.json.deleted === 1 && (await call('GET', '/admin/photos')).json.photos.length === 0, JSON.stringify(all.json));
} else {
  check('admin deletes the test photo', (await call('DELETE', `/admin/photos/${ballId}`)).status === 200);
}
check(`photos mode back to ${startPhotos}`, (await setPhotos(startPhotos)) === startPhotos);

const feedback = await call('POST', '/feedback', { page: '/test', message: 'Skúšobná pripomienka – ľščťžýáíé', author: 'test' });
check('feedback', feedback.status === 201 && typeof feedback.json.id === 'number', JSON.stringify(feedback.json));

const scene = await call('PATCH', `/admin${EV}`, { displayScene: 'live' });
check('admin scene switch to live', scene.status === 200 && scene.json.displayScene === 'live');
const sceneBack = await call('PATCH', `/admin${EV}`, { displayScene: 'cooperation' });
check('admin scene back to cooperation', sceneBack.status === 200 && sceneBack.json.displayScene === 'cooperation');
const codeSet = await call('PATCH', `/admin${EV}`, { code: 'TEST' });
check('admin access code set', codeSet.status === 200 && codeSet.json.requiresCode === true);
const needsCode = await call('POST', `${EV}/pins`, { places: [{ countryCode: 'NP' }], visitKind: 'erasmus_study' }, { 'x-device-id': device });
check('submit without code 403', needsCode.status === 403);
const codeOff = await call('PATCH', `/admin${EV}`, { code: '' });
check('admin access code removed', codeOff.status === 200 && codeOff.json.requiresCode === false);

const sub2 = await call('POST', `${EV}/pins`, { places: [{ countryCode: 'NP' }], visitKind: 'erasmus_study' }, { 'x-device-id': device });
const pins = await call('GET', '/admin/pins?limit=5');
check('admin pins', pins.status === 200 && pins.json.pins.length > 0, JSON.stringify(pins.json.pins[0]));
const pinId = sub2.json.pins?.[0]?.id;
const hide = await call('PATCH', `/admin/pins/${pinId}`, { status: 'hidden' });
check('admin hide light', hide.status === 200);
const badPin = await call('PATCH', '/admin/pins/abc', { status: 'hidden' });
check('admin bad pin id 400', badPin.status === 400);
const missingPin = await call('PATCH', '/admin/pins/99999999', { status: 'hidden' });
check('admin missing pin 404', missingPin.status === 404);
const fb = await call('GET', '/admin/feedback');
check('admin feedback list', fb.status === 200 && fb.json.feedback.some(f => f.id === feedback.json.id), fb.json.feedback?.[0]?.message);
const fbPatch = await call('PATCH', `/admin/feedback/${feedback.json.id}`, { status: 'done' });
check('admin feedback status', fbPatch.status === 200);
const show = await call('PATCH', `/admin/pins/${pinId}`, { status: 'visible' });
check('admin show light', show.status === 200);
const undo2 = await call('DELETE', `${EV}/submissions/${sub2.json.submissionId}`, undefined, { 'x-device-id': device });
check('cleanup undo', undo2.status === 200);

// ---------------------------------------------------------------- after the ball: read only
check('status closed (after the ball)', (await setStatus('closed')) === 'closed');
const late = await anonymous(() => call('POST', `${EV}/attendees`, { name: 'Neskorý Hosť', affiliation: 'Hosť' }, { 'x-device-id': device }));
check('attendance after the ball 409', late.status === 409, `HTTP ${late.status}`);
const lateLight = await anonymous(() => call('POST', `${EV}/pins`, { places: [{ countryCode: 'NP' }], visitKind: 'erasmus_study' }, { 'x-device-id': device }));
check('light after the ball 409', lateLight.status === 409, `HTTP ${lateLight.status}`);

// ---------------------------------------------------------------- cleanup: the test attendance, the starting status
const del = await call('DELETE', `/admin/attendees/${attendee.json.id}`);
check('admin delete attendance', del.status === 200);
const delAlone = await call('DELETE', `/admin/attendees/${alone.json.id}`);
check('admin delete the second attendance', delAlone.status === 200);
const delAgain = await call('DELETE', `/admin/attendees/${attendee.json.id}`);
check('admin delete attendance twice 404', delAgain.status === 404);
check(`status back to ${startStatus}`, (await setStatus(startStatus)) === startStatus);
const logout = await call('POST', '/admin/logout');
check('admin logout', logout.status === 200);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
