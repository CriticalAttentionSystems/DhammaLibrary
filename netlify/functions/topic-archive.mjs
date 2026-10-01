import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getStore } from '@netlify/blobs';
import { createArchiveService } from '../../scripts/topic-archive-service.mjs';

const CACHE_KEY = 'catalog-and-refresh-state-v1';
let snapshot;

export default async function handler(request) {
  snapshot ||= JSON.parse(await readFile(resolve(process.cwd(), 'public/data/topic-archive.json'), 'utf8'));
  // Netlify supplies credentials in the function context; no PAT or site ID is
  // configured by the user. A site-wide store survives later site deployments.
  // Keep getStore inside the handler so its automatic context is available.
  const store = {
    async read() {
      const entry = await getStore('topic-archive').getWithMetadata(CACHE_KEY, { type: 'json', consistency: 'strong' });
      return entry && { data: entry.data, etag: entry.etag };
    },
    async compareAndSet(expectedEtag, value) {
      return getStore('topic-archive').setJSON(CACHE_KEY, value, expectedEtag ? { onlyIfMatch: expectedEtag } : { onlyIfNew: true });
    },
  };
  return createArchiveService({ store, snapshot }).handle(request);
}
