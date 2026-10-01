# Topic listening archive

The Topics browser imports the public listing metadata at
https://bhavana-society.github.io/all-1.html. Its topic labels represent the
archive's category membership, not verified subjects discussed in a recording.
Dates are taken only from unambiguous dates explicitly written in source titles;
other dates remain unknown. The source currently identifies itself as an August
2023 archive, so importing it does not promise a complete current YouTube channel.

## Serving and refreshing

`public/data/topic-archive.json` is the bundled fallback catalog. The browser can
show it immediately, then requests `/.netlify/functions/topic-archive`. Both GET
and POST return `{ catalog, status }`; status includes `refreshing`, `lastError`,
`lastSuccess`, and `refreshAllowedAt` as ISO timestamps or null where applicable.
GET checks whether the last successful import is at least 24 hours old. POST
requests an explicit refresh. A refresh runs within that request; another visitor
can continue to receive the saved catalog while it runs. No scheduled job is needed.

Refresh starts are limited to one per five minutes across visitors. A failed
refresh also delays retries for five minutes. POST requires an exact same-origin
Origin header, rejects cross-origin fetch metadata, and accepts no configurable
source URL. JSON responses use `Cache-Control: no-store`. The source URL and blob
key are fixed in server code; query parameters and request bodies are ignored.

Only navigation links observed in the archive's category and pagination menus are
followed. The importer requests HTML metadata only, with at most three requests
running concurrently, at most 120 pages, at most 2 MB per page, and a 40-second
overall deadline. Redirects, unexpected document structures, invalid IDs,
category collisions, incomplete requests, and validation failures reject the
entire replacement. Video IDs are deduplicated; alternate source titles and page
provenance are retained. No audio, video, transcript, or unlinked media is fetched.

## Persistence on Netlify

The Node 22 function uses the site-wide `topic-archive` Netlify Blobs store. This
requires no user-supplied secret, site ID, or personal token: Netlify provides
the function context automatically. Site-wide data persists across deploys.
Strongly consistent reads and conditional `setJSON` writes (`onlyIfNew` or
`onlyIfMatch`) protect one combined catalog/refresh-state record. A 50-second
lease prevents overlapping refreshes, and its conditional revision prevents an
expired worker from overwriting newer data. Failures retain the preceding
catalog; if storage is unavailable, the function serves the bundled fallback
without attempting an uncoordinated crawl.

See the official [Netlify Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
for automatic credentials, site-wide stores, strong consistency, and conditional
writes. The project pins `@netlify/blobs` and `parse5` in its npm lockfile. Node
22.12 or later is required by the Blobs dependency. Netlify configuration must
include `public/data/topic-archive.json` in the function bundle because the
function reads it from `process.cwd()`.

## Local preview and tests

The local preview reuses `createArchiveService` with `createFileStore`, which
atomically writes a JSON cache without Netlify credentials. Its cache file is
separate from the bundled catalog and the library's editorial data. Stop the
preview before manually clearing its cache. If the preview is forcibly terminated
during a file write and leaves a `.lock` file, remove that lock while the preview
is stopped. The deployed service uses Blobs leases rather than filesystem locks.

`node --test scripts/topic-archive.test.mjs` uses mocked HTML and storage: it makes
no external requests. Coverage includes category membership, conservative dates,
new archive records, bounded concurrency, malicious links, invalid source data,
timeouts, failed refreshes, failed writes, simultaneous visitors, lease expiry,
same-origin refresh requests, and local persistent cache revisions.

Topic refreshes do not alter the main talk library, new-talk discovery,
contributor queue, or contributor approval state. Updating this feature does
not itself deploy the website.
