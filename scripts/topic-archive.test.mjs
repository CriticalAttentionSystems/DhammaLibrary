import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOURCE_URL, crawlArchive, dateFromTitle, listingUrl, validateCatalog } from './topic-archive-core.mjs';
import { CACHE_TTL_MS, REFRESH_COOLDOWN_MS, createArchiveService, createFileStore } from './topic-archive-service.mjs';

const ORIGIN = 'https://library.example';
const NOW = Date.parse('2026-10-01T12:00:00Z');
const A = 'aaaaaaaaaaa', B = 'bbbbbbbbbbb', C = 'ccccccccccc';
const url = name => new URL(name, SOURCE_URL).href;
const escape = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const menu = '<ul class="vertical-menu"><li><a href="all-1.html">All</a></li><li><a href="metta-1.html">Metta</a></li><li><a href="q%26a-1.html">Q&amp;A</a></li><li><a href="books-1.html">Books</a></li></ul>';
function page(rows, links = [], extra = '', navigation = menu) {
  return `${navigation}<ul class="horizontal-menu">${links.map(link => `<li><a href="${escape(link)}">Next</a></li>`).join('')}</ul><table><tr><th>Title</th><th>Number</th><th>Audio</th></tr>${rows.map(([id, title], index) => `<tr><th>${escape(title)}</th><th>${index}</th><th><div class="youtube-audio" data-video="${id}"></div></th></tr>`).join('')}</table>${extra}<p>This website was generated August 2023.</p>`;
}
function fixtures({ added = false } = {}) {
  return new Map([
    [SOURCE_URL, page([[A, 'Metta — May 3, 2020']], ['all-2.html'])],
    [url('all-2.html'), page([[B, 'Questions 04/05/2020'], ...(added ? [[C, 'New talk — 2022-09-30']] : [])])],
    [url('metta-1.html'), page([[A, 'A category title — May 3, 2020']])],
    [url('q%26a-1.html'), page([[A, 'Metta — May 3, 2020'], [B, 'Questions 04/05/2020']])],
  ]);
}
function mockFetch(pages, calls = []) {
  return async (target, options) => {
    calls.push({ target, options });
    assert.ok(pages.has(target), `Unexpected fetch: ${target}`);
    return new Response(pages.get(target), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
}
async function catalog(added = false) { return crawlArchive({ fetchImpl: mockFetch(fixtures({ added })), now: () => NOW }); }
function memoryStore(initial = null) {
  let current = initial ? { data: structuredClone(initial), etag: '1' } : null;
  let version = 1;
  return {
    async read() { return structuredClone(current); },
    async compareAndSet(expected, data) {
      if ((current?.etag || null) !== expected) return { modified: false };
      current = { data: structuredClone(data), etag: String(++version) };
      return { modified: true, etag: current.etag };
    },
  };
}
const request = (method = 'GET', headers = {}) => new Request(`${ORIGIN}/.netlify/functions/topic-archive`, { method, headers: method === 'POST' ? { Origin: ORIGIN, ...headers } : headers });
const body = async (service, req = request()) => (await service.handle(req)).json();

test('crawl deduplicates YouTube IDs while preserving category membership, source titles, and explicit dates', async () => {
  const result = await catalog();
  assert.equal(result.talks.length, 2);
  const talk = result.talks.find(talk => talk.id === A);
  assert.equal(talk.title, 'Metta — May 3, 2020');
  assert.equal(talk.date, '2020-05-03');
  assert.deepEqual(talk.topicIds, ['metta', 'q-and-a']);
  assert.equal(talk.sourceUrls.length, 3);
  assert.deepEqual(talk.alternateSourceTitles, ['A category title — May 3, 2020']);
  assert.equal(result.talks.find(talk => talk.id === B).date, null);
  assert.equal(result.metadata.fetchedPageCount, 4);
  assert.equal(result.metadata.sourceGeneratedLabel, 'August 2023');
});

test('dates remain unknown for ambiguous, impossible, conflicting, or absent title dates', () => {
  for (const title of ['Practice 04/05/2020', 'Practice February 30, 2020', 'May 3, 2020 and May 4, 2020', 'Practice in 2020']) assert.equal(dateFromTitle(title).date, null, title);
  assert.equal(dateFromTitle('Retreat 13/04/2020').date, '2020-04-13');
  assert.equal(dateFromTitle('Retreat 04/13/2020').date, '2020-04-13');
  assert.equal(dateFromTitle('Retreat 20200413').date, '2020-04-13');
  assert.equal(dateFromTitle('Retreat 29 February 2020').date, '2020-02-29');
});

test('only observed allowed archive navigation is fetched, never external, media, or unknown sections', async () => {
  const pages = fixtures();
  pages.set(SOURCE_URL, page([[A, 'Metta — May 3, 2020']], [
    'all-2.html', '//evil.example/all-1.html', 'http://bhavana-society.github.io/all-2.html',
    'https://bhavana-society.github.io.evil.example/all-1.html', 'https://user:pass@bhavana-society.github.io/all-2.html',
    '/%2f%2fevil.example-1.html', '/%2e%2e/secrets', 'javascript:alert(1)', 'other-1.html', 'books-1.html', '/talk.mp3',
  ], '<a href="all-3.html">Outside navigation</a><script>fetch("https://evil.example")</script>'));
  const calls = [];
  await crawlArchive({ fetchImpl: mockFetch(pages, calls), now: () => NOW });
  assert.deepEqual(new Set(calls.map(call => call.target)), new Set(fixtures().keys()));
  assert.ok(calls.every(call => call.options.redirect === 'error' && call.options.signal instanceof AbortSignal));
  assert.equal(listingUrl('https://bhavana-society.github.io/all-1.html?url=https://evil.example#x'), SOURCE_URL);
});

test('any failed page, invalid video ID, category collision, or unsupported layout rejects the whole crawl', async () => {
  const failedPages = fixtures(); failedPages.delete(url('all-2.html'));
  await assert.rejects(crawlArchive({ fetchImpl: mockFetch(failedPages) }));
  const invalid = fixtures(); invalid.set(url('metta-1.html'), page([['invalid!id', 'Broken']]));
  await assert.rejects(crawlArchive({ fetchImpl: mockFetch(invalid) }), /invalid talk row/);
  const collision = fixtures(); collision.set(SOURCE_URL, page([[A, 'Title']], [], '', `${menu}<ul class="vertical-menu"><li><a href="q-and-a-1.html">Collision</a></li></ul>`));
  await assert.rejects(crawlArchive({ fetchImpl: mockFetch(collision) }), /categories/);
  const unsupported = fixtures(); unsupported.set(url('metta-1.html'), 'A redesigned page');
  await assert.rejects(crawlArchive({ fetchImpl: mockFetch(unsupported) }), /format has changed/);
});

test('crawl caps concurrency at three and rejects discovery beyond 120 pages', async () => {
  const pages = fixtures();
  const calls = []; let active = 0, maximum = 0;
  await crawlArchive({ fetchImpl: async (target, options) => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    return mockFetch(pages, calls)(target, options);
  } });
  assert.equal(maximum, 3);
  pages.set(SOURCE_URL, page([[A, 'Title']], Array.from({ length: 119 }, (_, index) => `all-${index + 2}.html`)));
  await assert.rejects(crawlArchive({ fetchImpl: mockFetch(pages) }), /page limit/);
});

test('crawl rejects redirects and oversized documents, and times out a hung fetch', async () => {
  await assert.rejects(crawlArchive({ fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://evil.example' } }) }), /could not be loaded/);
  await assert.rejects(crawlArchive({ fetchImpl: async () => new Response('x', { headers: { 'content-length': '2000001', 'content-type': 'text/html' } }) }), /size limit/);
  await assert.rejects(crawlArchive({ fetchImpl: async () => new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'text/html' } }) }), /size limit/);
  let signal;
  await assert.rejects(crawlArchive({ timeoutMs: 10, fetchImpl: async (_, options) => { signal = options.signal; return new Promise(() => {}); } }), /timed out/);
  assert.equal(signal.aborted, true);
});

test('catalog validation rejects duplicate IDs, unknown categories, fabricated dates, and external URLs', async () => {
  const valid = await catalog();
  for (const modify of [
    copy => copy.talks.push(copy.talks[0]),
    copy => copy.talks[0].topicIds.push('fabricated'),
    copy => copy.talks[0].url = 'javascript:alert(1)',
    copy => copy.talks[0].date = '2020-01-01',
    copy => copy.categories[0].sourceUrl = 'https://evil.example/metta-1.html',
    copy => copy.metadata.sourcePages.push('https://evil.example/all-1.html'),
    copy => copy.categories[0].count = 999,
  ]) {
    const copy = structuredClone(valid); modify(copy);
    assert.throws(() => validateCatalog(copy));
  }
});

test('fresh GET serves snapshot and stale GET imports new archive metadata into persistent cache', async () => {
  const snapshot = await catalog(); const updated = await catalog(true);
  const store = memoryStore(); let currentTime = NOW; let calls = 0;
  const service = createArchiveService({ store, snapshot, now: () => currentTime, crawl: async () => { calls += 1; return updated; } });
  const firstResponse = await service.handle(request());
  assert.equal(firstResponse.headers.get('cache-control'), 'no-store');
  assert.equal((await firstResponse.json()).catalog.talks.length, 2);
  assert.equal(calls, 0);
  currentTime += CACHE_TTL_MS + 1;
  const refreshed = await body(service);
  assert.equal(calls, 1);
  assert.equal(refreshed.catalog.talks.length, 3);
  assert.equal(refreshed.status.refreshing, false);
  assert.equal(refreshed.status.lastError, null);
  assert.equal((await store.read()).data.catalog.talks.length, 3);
  // A new service instance uses the persisted cache, not its older snapshot.
  const restarted = createArchiveService({ store, snapshot, now: () => currentTime, crawl: async () => { throw new Error('Must remain cached'); } });
  assert.equal((await body(restarted)).catalog.talks.length, 3);
});

test('manual refresh is global, cooldown applies across service instances, and URLs cannot be supplied', async () => {
  const snapshot = await catalog(); const store = memoryStore(); let calls = 0;
  const options = { store, snapshot, now: () => NOW, crawl: async () => { calls += 1; return snapshot; } };
  const service = createArchiveService(options);
  const req = new Request(`${ORIGIN}/.netlify/functions/topic-archive?url=https://evil.example`, { method: 'POST', headers: { Origin: ORIGIN }, body: '{"url":"https://evil.example"}' });
  await body(service, req);
  const second = await body(createArchiveService(options), request('POST'));
  assert.equal(calls, 1);
  assert.equal(Date.parse(second.status.refreshAllowedAt), NOW + REFRESH_COOLDOWN_MS);
});

test('a failed refresh keeps all previous catalog data and delays retries', async () => {
  const snapshot = await catalog(); const store = memoryStore(); let calls = 0;
  const service = createArchiveService({ store, snapshot, now: () => NOW + CACHE_TTL_MS, crawl: async () => { calls += 1; throw new Error('private upstream detail'); } });
  const failed = await body(service);
  assert.deepEqual(failed.catalog, snapshot);
  assert.match(failed.status.lastError, /saved catalog has been kept/);
  assert.ok(!failed.status.lastError.includes('private'));
  assert.equal(failed.status.lastSuccess, snapshot.metadata.fetchedAt);
  assert.equal(failed.status.refreshing, false);
  await body(service); await body(service, request('POST'));
  assert.equal(calls, 1);
  assert.deepEqual((await store.read()).data.catalog, snapshot);
});

test('conditional leases allow exactly one crawler across simultaneous instances', async () => {
  const snapshot = await catalog(); const store = memoryStore(); let calls = 0, finish;
  const gate = new Promise(resolve => { finish = resolve; });
  let started; const hasStarted = new Promise(resolve => { started = resolve; });
  const options = { store, snapshot, now: () => NOW + CACHE_TTL_MS, crawl: async () => { calls += 1; started(); await gate; return snapshot; } };
  const running = body(createArchiveService(options));
  await hasStarted;
  const readers = await Promise.all(Array.from({ length: 8 }, () => body(createArchiveService(options), request('POST'))));
  assert.equal(calls, 1);
  assert.ok(readers.every(value => value.status.refreshing && value.catalog.talks.length === 2));
  finish();
  assert.equal((await running).status.refreshing, false);
});

test('an old worker cannot overwrite a replacement after its lease and cooldown expire', async () => {
  const snapshot = await catalog(); const updated = await catalog(true); const store = memoryStore();
  let currentTime = NOW + CACHE_TTL_MS, finish, started;
  const gate = new Promise(resolve => { finish = resolve; });
  const hasStarted = new Promise(resolve => { started = resolve; });
  const old = createArchiveService({ store, snapshot, now: () => currentTime, crawl: async () => { started(); await gate; return snapshot; } });
  const running = body(old); await hasStarted;
  currentTime += REFRESH_COOLDOWN_MS + 1;
  const replacement = createArchiveService({ store, snapshot, now: () => currentTime, crawl: async () => updated });
  await body(replacement); finish();
  assert.equal((await running).catalog.talks.length, 3);
  assert.equal((await store.read()).data.catalog.talks.length, 3);
});

test('unavailable or corrupt storage fails closed without any public crawl', async () => {
  const snapshot = await catalog(); let calls = 0;
  for (const read of [async () => { throw new Error('storage unavailable'); }, async () => ({ etag: 'x', data: {} })]) {
    const service = createArchiveService({ snapshot, store: { read }, now: () => NOW + CACHE_TTL_MS, crawl: async () => { calls += 1; } });
    const result = await body(service, request('POST'));
    assert.deepEqual(result.catalog, snapshot);
    assert.match(result.status.lastError, /temporarily unavailable/);
  }
  assert.equal(calls, 0);
});

test('failed cache write does not report or expose an unsaved replacement as current', async () => {
  const snapshot = await catalog(); const updated = await catalog(true); const store = memoryStore();
  const save = store.compareAndSet; let writes = 0;
  store.compareAndSet = async (...args) => { if (++writes === 2) throw new Error('save failed'); return save(...args); };
  const result = await body(createArchiveService({ store, snapshot, now: () => NOW, crawl: async () => updated }), request('POST'));
  assert.deepEqual(result.catalog, snapshot);
  assert.match(result.status.lastError, /could not be saved/);
  assert.deepEqual((await store.read()).data.catalog, snapshot);
});

test('endpoint rejects unsupported methods and missing or cross-origin POSTs before reading storage', async () => {
  const service = createArchiveService({ snapshot: await catalog(), store: { read() { assert.fail('No cache access expected'); } } });
  assert.equal((await service.handle(request('DELETE'))).status, 405);
  for (const headers of [{}, { Origin: 'https://other.example' }, { Origin: ORIGIN, 'Sec-Fetch-Site': 'cross-site' }, { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-site' }]) {
    const response = await service.handle(new Request(`${ORIGIN}/.netlify/functions/topic-archive`, { method: 'POST', headers }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});

test('local file cache uses conditional revisions and survives a new adapter instance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'topic-archive-test-'));
  try {
    const path = join(directory, 'cache.json'); const store = createFileStore(path);
    assert.equal(await store.read(), null);
    const result = await store.compareAndSet(null, { catalog: 'first' });
    assert.equal(result.modified, true);
    assert.equal((await store.compareAndSet(null, { catalog: 'wrong' })).modified, false);
    const simultaneous = await Promise.all([
      store.compareAndSet(result.etag, { catalog: 'next' }),
      createFileStore(path).compareAndSet(result.etag, { catalog: 'other' }),
    ]);
    assert.equal(simultaneous.filter(value => value.modified).length, 1);
    assert.deepEqual(await createFileStore(path).read(), JSON.parse(await readFile(path, 'utf8')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
