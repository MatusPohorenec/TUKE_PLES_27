// node tools/api-smoke.mjs [baseUrl] [origin]
// Smoke test of every API route against a running local API (default http://localhost:8787/api, e.g. npm run dev):
// globe, place detail, search, submit + undo, live/summary, feedback, admin login, moderation, scene, access code.
// With an origin (e.g. http://localhost:4173, the cross-origin setup in CLAUDE.md) every response must carry CORS
// headers. It writes test lights (undone again), a feedback row and audit rows, so it refuses non-local servers.
// The admin password comes from the repository .env and is never printed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:8787/api';
const origin = process.argv[3];
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(base)) {
  console.error(`refusing ${base}: the smoke test writes data, run it against a local API only`);
  process.exit(2);
}
const env = Object.fromEntries(readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const device = 'abcdef0123456789abcdef0123456789';
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
function check(label, ok, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` – ${extra}` : ''}`);
}

const health = await call('GET', '/health');
check('health', health.status === 200 && health.json.database === 'up', JSON.stringify(health.json));

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

const event = await call('GET', '/events/ples-2027');
check('event', event.status === 200 && event.json.slug === 'ples-2027', JSON.stringify(event.json));

const before = await call('GET', '/events/ples-2027/summary');
check('summary', before.status === 200 && before.json.totals, JSON.stringify(before.json.totals));

const kosice = (await call('GET', '/gazetteer/search?q=kosice')).json.hits.find(h => h.kind === 'city');
const submit = await call('POST', '/events/ples-2027/pins', { places: [{ geonameId: kosice.geonameId }, { countryCode: 'NP' }], visitKind: 'erasmus_study', role: 'student', faculty: 'FEI' }, { 'x-device-id': device });
check('submit 2 lights', submit.status === 201 && submit.json.pins?.length === 2 && /^[0-9a-f-]{36}$/.test(submit.json.submissionId), `${submit.status} ${JSON.stringify(submit.json).slice(0, 200)}`);

await new Promise(r => setTimeout(r, 2100)); // the live feed is shared for 2 s
const live = await call('GET', '/events/ples-2027/live');
check('live has the new lights', live.status === 200 && live.json.pins.some(p => p.id === submit.json.pins?.[0]?.id), `cursor ${live.json.cursor}, totals ${JSON.stringify(live.json.totals)}`);
const after = await call('GET', `/events/ples-2027/live?after=${(submit.json.pins?.[0]?.id ?? 1) - 1}`);
check('live after cursor', after.status === 200 && after.json.pins.length >= 2, `${after.json.pins.length} pins`);
await new Promise(r => setTimeout(r, 5200)); // summary is shared for 5 s
const summary = await call('GET', '/events/ples-2027/summary');
check('summary counts the lights', summary.json.totals.pins === before.json.totals.pins + 2, `${JSON.stringify(summary.json.totals)}, keys ${summary.json.places.map(p => p.key).join(' ')}`);

const badUndo = await call('DELETE', '/events/ples-2027/submissions/------------------------------------', undefined, { 'x-device-id': device });
check('undo invalid id 400', badUndo.status === 400);
const otherDevice = await call('DELETE', `/events/ples-2027/submissions/${submit.json.submissionId}`, undefined, { 'x-device-id': 'fedcba9876543210fedcba9876543210' });
check('undo from another device 404', otherDevice.status === 404);
const undo = await call('DELETE', `/events/ples-2027/submissions/${submit.json.submissionId}`, undefined, { 'x-device-id': device });
check('undo', undo.status === 200 && undo.json.ok === true);
const undoAgain = await call('DELETE', `/events/ples-2027/submissions/${submit.json.submissionId}`, undefined, { 'x-device-id': device });
check('undo twice 404', undoAgain.status === 404);

const unknown = await call('POST', '/events/ples-2027/pins', { places: [{ geonameId: 999999999 }], visitKind: 'erasmus_study' }, { 'x-device-id': device });
check('unknown place 400', unknown.status === 400 && unknown.json.error.code === 'unknown_place');

const feedback = await call('POST', '/feedback', { page: '/test', message: 'Skúšobná pripomienka – ľščťžýáíé', author: 'test' });
check('feedback', feedback.status === 201 && typeof feedback.json.id === 'number', JSON.stringify(feedback.json));

const noSession = await call('GET', '/admin/me');
check('admin without session 401', noSession.status === 401);
const wrong = await call('POST', '/admin/login', { password: 'definitely-wrong' });
check('admin wrong password 401', wrong.status === 401);
const login = await call('POST', '/admin/login', { password: env.ADMIN_PASSWORD });
check('admin login', login.status === 200 && cookie.startsWith('ples_admin='), `cookie ${cookie ? 'set' : 'missing'}; ${login.headers.get('set-cookie')?.replace(/ples_admin=[^;]+/, 'ples_admin=…')}`);
const me = await call('GET', '/admin/me');
check('admin me', me.status === 200);
const ev = await call('GET', '/admin/events/ples-2027');
check('admin event', ev.status === 200, JSON.stringify(ev.json));
const scene = await call('PATCH', '/admin/events/ples-2027', { displayScene: 'live' });
check('admin scene switch to live', scene.status === 200 && scene.json.displayScene === 'live');
const sceneBack = await call('PATCH', '/admin/events/ples-2027', { displayScene: 'cooperation', status: 'open' });
check('admin scene back to cooperation', sceneBack.status === 200 && sceneBack.json.displayScene === 'cooperation');
const codeSet = await call('PATCH', '/admin/events/ples-2027', { code: 'TEST' });
check('admin access code set', codeSet.status === 200 && codeSet.json.requiresCode === true);
const needsCode = await call('POST', '/events/ples-2027/pins', { places: [{ countryCode: 'NP' }], visitKind: 'erasmus_study' }, { 'x-device-id': device });
check('submit without code 403', needsCode.status === 403);
const codeOff = await call('PATCH', '/admin/events/ples-2027', { code: '' });
check('admin access code removed', codeOff.status === 200 && codeOff.json.requiresCode === false);

const sub2 = await call('POST', '/events/ples-2027/pins', { places: [{ countryCode: 'NP' }], visitKind: 'erasmus_study' }, { 'x-device-id': device });
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
const undo2 = await call('DELETE', `/events/ples-2027/submissions/${sub2.json.submissionId}`, undefined, { 'x-device-id': device });
check('cleanup undo', undo2.status === 200);
const logout = await call('POST', '/admin/logout');
check('admin logout', logout.status === 200);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
