import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { crawlArchive, validateCatalog } from './topic-archive-core.mjs';

export const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const REFRESH_COOLDOWN_MS = 5 * 60 * 1_000;
const LEASE_MS = 50_000;
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Vary': 'Origin',
};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

function initialState(snapshot) {
  return { version: 1, catalog: snapshot, lastSuccess: snapshot.metadata.fetchedAt, lastError: null, refreshAllowedAt: null, lease: null };
}

function validateState(state) {
  if (state?.version !== 1 || (state.lastSuccess !== null && !timestamp(state.lastSuccess)) || (state.lastError !== null && typeof state.lastError !== 'string') || (state.refreshAllowedAt !== null && !timestamp(state.refreshAllowedAt)) || (state.lease && (typeof state.lease.token !== 'string' || !timestamp(state.lease.expiresAt)))) throw new Error('Invalid archive cache state.');
  validateCatalog(state.catalog);
  return state;
}

/** Store operations must be strongly consistent; compareAndSet must be atomic. */
export function createArchiveService({ store, snapshot, crawl = crawlArchive, now = () => Date.now() }) {
  validateCatalog(snapshot);
  let lastKnown = initialState(snapshot);
  function envelope(state, error = null) {
    const active = timestamp(state.lease?.expiresAt) > now();
    return {
      catalog: state.catalog,
      status: {
        refreshing: active,
        lastError: error || state.lastError || null,
        lastSuccess: state.lastSuccess || null,
        refreshAllowedAt: state.refreshAllowedAt || null,
      },
    };
  }
  async function read() {
    const entry = await store.read();
    if (!entry) return { data: initialState(snapshot), etag: null };
    if (typeof entry.etag !== 'string' || !entry.etag) throw new Error('Invalid archive cache revision.');
    validateState(entry.data);
    lastKnown = entry.data;
    return entry;
  }
  async function readAfterConflict(fallback) {
    try { return envelope((await read()).data); }
    catch { return envelope(fallback, 'The saved archive is temporarily unavailable. Please try again later.'); }
  }

  async function load(manual) {
    let entry;
    try { entry = await read(); }
    catch { return envelope(lastKnown, 'The saved archive is temporarily unavailable. Showing the last available copy.'); }
    const state = entry.data;
    const started = now();
    const active = timestamp(state.lease?.expiresAt) > started;
    const coolingDown = timestamp(state.refreshAllowedAt) > started;
    const fresh = started - timestamp(state.lastSuccess) < CACHE_TTL_MS;
    if (active || coolingDown || (!manual && fresh)) return envelope(state);

    // One CAS covers both the catalog and lease. A failed/expired worker cannot
    // overwrite a later refresh, even if it finishes after its lease expires.
    const acquired = {
      ...state,
      lease: { token: randomUUID(), expiresAt: new Date(started + LEASE_MS).toISOString() },
      refreshAllowedAt: new Date(started + REFRESH_COOLDOWN_MS).toISOString(),
    };
    let lease;
    try { lease = await store.compareAndSet(entry.etag, acquired); }
    catch { return envelope(state, 'The archive could not start a refresh. The saved copy is still available.'); }
    if (!lease.modified) return readAfterConflict(state);
    if (!lease.etag) return envelope(state, 'The archive could not verify its refresh lease. Please try again later.');
    lastKnown = acquired;

    let completed;
    try {
      const catalog = validateCatalog(await crawl());
      completed = { ...acquired, catalog, lastSuccess: new Date(now()).toISOString(), lastError: null, lease: null };
    } catch {
      completed = {
        ...acquired,
        lastError: 'The archive refresh did not complete. The saved catalog has been kept; please try again later.',
        refreshAllowedAt: new Date(now() + REFRESH_COOLDOWN_MS).toISOString(),
        lease: null,
      };
    }
    try {
      const result = await store.compareAndSet(lease.etag, completed);
      if (!result.modified) return readAfterConflict(state);
      lastKnown = completed;
      return envelope(completed);
    } catch {
      // Do not claim success when the refreshed catalog could not be persisted.
      return envelope(state, 'The refreshed archive could not be saved. The previous catalog is still available.');
    }
  }

  return {
    async handle(request) {
      if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
      if (request.method === 'POST') {
        const origin = request.headers.get('origin');
        const fetchSite = request.headers.get('sec-fetch-site');
        if (origin !== new URL(request.url).origin || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
          return json({ error: 'Refresh requests must come from this site.' }, 403);
        }
      }
      // The request body and query string never select a source or cache key.
      return json(await load(request.method === 'POST'));
    },
  };
}

/** Local preview cache: no Netlify credentials, shared safely across processes. */
export function createFileStore(path) {
  const lockPath = `${path}.lock`;
  async function read() {
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  return {
    read,
    async compareAndSet(expectedEtag, data) {
      await mkdir(dirname(path), { recursive: true });
      let lock;
      try { lock = await open(lockPath, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') return { modified: false }; throw error; }
      let temporary;
      try {
        const current = await read();
        if ((current?.etag || null) !== expectedEtag) return { modified: false };
        const etag = randomUUID();
        temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify({ data, etag })}\n`, { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
        return { modified: true, etag };
      } finally {
        if (temporary) await unlink(temporary).catch(() => {});
        await lock.close();
        await unlink(lockPath);
      }
    },
  };
}
