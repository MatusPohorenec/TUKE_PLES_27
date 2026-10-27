// node tools/api-smoke.mjs [baseUrl] [origin] [--venue vestibul]
// Smoke test of every API route against a running local API (default http://localhost:8787/api, e.g. npm run dev):
// globe, place detail, search, the gate and the venue's status (before the ball: onboarding only, lights from the
// admin only; the ball night; after the ball: read only), confirmation of attendance, submit + undo, live/summary,
// feedback, admin login, moderation, scene, access code. It puts the venue's status back where it found it.
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

const attendee = await anonymous(() => call('POST', `${EV}/attendees`, { name: 'Skúšobný Hosť Ľščťžý', affiliation: 'FEI TUKE' }, { 'x-device-id': device }));
check('attendance confirmed', attendee.status === 201 && typeof attendee.json.id === 'number' && attendee.json.name === 'Skúšobný Hosť Ľščťžý', `${attendee.status} ${JSON.stringify(attendee.json)}`);
const badAttendee = await anonymous(() => call('POST', `${EV}/attendees`, { name: 'X', affiliation: '' }, { 'x-device-id': device }));
check('attendance without name and affiliation 400', badAttendee.status === 400, `HTTP ${badAttendee.status}`);
const attendees = await call('GET', '/admin/attendees');
check('admin attendance list', attendees.status === 200 && attendees.json.attendees.some(a => a.id === attendee.json.id && a.affiliation === 'FEI TUKE'), `${attendees.json.attendees?.length} confirmed`);
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
await new Promise(r => setTimeout(r, 5200)); // summary is shared for 5 s
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
const delAgain = await call('DELETE', `/admin/attendees/${attendee.json.id}`);
check('admin delete attendance twice 404', delAgain.status === 404);
check(`status back to ${startStatus}`, (await setStatus(startStatus)) === startStatus);
const logout = await call('POST', '/admin/logout');
check('admin logout', logout.status === 200);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
