import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkPullRequest, createGitHubClient, evaluateContributions, listAll, parseTalkJson } from './check-contributions.mjs';

const record = (youtubeId = 'taRyL5LYM3Y', id = 'example', fields = {}) => ({ id, youtubeId,
  url: `https://www.youtube.com/watch?v=${youtubeId}`, title: 'A talk', originalTitle: 'A talk',
  date: '2026-09-27', type: 'Dhamma talk', durationSeconds: 1200, topics: ['Practice'],
  brief: 'A concise introduction.', summaryMarkdown: 'A longer summary.', published: true, ...fields });
const file = (talk, filename = 'content/talks/proposed.json', status = 'added', fields = {}) => ({ filename, status, talk, ...fields });
const existing = record();
const mainRecords = [{ path: 'content/talks/existing.json', talk: existing }];
const evaluate = (changes, fields = {}) => evaluateContributions({ mainRecords, changes, currentNumber: 20, ...fields });

test('a new video is accepted while unpublished main records still reserve their IDs', () => {
  const proposed = record('ABCDEFGHIJK', 'new-talk');
  assert.deepEqual(evaluate([file(proposed)]).addedVideos, ['ABCDEFGHIJK']);
  assert.throws(() => evaluate([file({ ...existing, id: 'different-id' })], {
    mainRecords: [{ path: 'content/talks/unpublished.json', talk: { ...existing, published: false } }]
  }), /Duplicate video/);
});

test('changing a title or URL time does not evade the video ID duplicate check', () => {
  assert.throws(() => evaluate([file({ ...existing, id: 'new-title', title: 'Different title', url: `${existing.url}&t=45s` })]), /Duplicate video/);
});

test('legitimate corrections and file renames for existing videos are allowed', () => {
  assert.deepEqual(evaluate([file({ ...existing, summaryMarkdown: 'Corrected summary.' }, mainRecords[0].path, 'modified')]), { checkedTalks: 1, addedVideos: [] });
  assert.deepEqual(evaluate([file(existing, 'content/talks/renamed.json', 'renamed', { previous_filename: mainRecords[0].path })]), { checkedTalks: 1, addedVideos: [] });
  assert.deepEqual(evaluate([file(null, mainRecords[0].path, 'removed'), file(existing)]), { checkedTalks: 1, addedVideos: [] });
});

test('duplicate video IDs and entry IDs within one proposal fail', () => {
  const next = record('ABCDEFGHIJK', 'new-talk');
  assert.throws(() => evaluate([file(next), file({ ...next, id: 'another-id' }, 'content/talks/second.json')]), /Duplicate video/);
  assert.throws(() => evaluate([file(record('ABCDEFGHIJK', existing.id))]), /Duplicate entry ID/);
});

test('YouTube video IDs are case sensitive', () => {
  assert.deepEqual(evaluate([file(record('taryL5LYM3Y', 'different-video'))]).addedVideos, ['taryL5LYM3Y']);
});

test('earlier PR wins for a new video and later PR cannot block the earlier one', () => {
  const changes = [file(record('ABCDEFGHIJK', 'new-talk'))];
  assert.throws(() => evaluate(changes, { others: [{ number: 19, changes }] }), /earlier pull request #19/);
  assert.deepEqual(evaluate(changes, { others: [{ number: 21, changes }] }).addedVideos, ['ABCDEFGHIJK']);
  assert.deepEqual(evaluate(changes, { others: [{ number: 19, changes: [file(record('abcdefghijk', 'other-talk'))] }] }).addedVideos, ['ABCDEFGHIJK']);
});

test('other PR edits to an existing video do not block a legitimate correction', () => {
  const changes = [file(existing, mainRecords[0].path, 'modified')];
  assert.deepEqual(evaluate(changes, { others: [{ number: 19, changes }] }).addedVideos, []);
});

test('malformed current JSON and indeterminate competing video IDs fail closed', () => {
  assert.throws(() => parseTalkJson('{broken', 'example.json'), /Invalid JSON/);
  assert.throws(() => parseTalkJson('null', 'example.json'), /Missing or invalid/);
  assert.throws(() => parseTalkJson(JSON.stringify({ youtubeId: existing.youtubeId }), 'example.json'), /published/);
  assert.throws(() => evaluate([file({ ...record('ABCDEFGHIJK', 'new-talk'), brief: '' })]), /brief is required/);
  assert.throws(() => evaluate([file(record('ABCDEFGHIJK', 'new-talk'))], { others: [{ number: 19, changes: [file({ youtubeId: 'not-valid' })] }] }), /Cannot determine/);
});

test('pagination reads all pages and refuses GitHub’s 3000-file cap', async () => {
  const paths = [];
  const values = await listAll(async path => { paths.push(path); return path.endsWith('page=1') ? Array.from({ length: 100 }, (_, n) => n) : [100, 101]; }, '/repos/owner/repo/pulls?state=open');
  assert.equal(values.length, 102);
  assert.equal(paths[1], '/repos/owner/repo/pulls?state=open&per_page=100&page=2');
  await assert.rejects(listAll(async () => Array(100).fill({}), '/repos/owner/repo/pulls/20/files', { fileList: true }), /3,000-file/);
  await assert.rejects(listAll(async () => ({}), '/repos/owner/repo/pulls'), /invalid paginated/);
});

test('GitHub client rejects remote destinations, HTTP/API errors, redirects, and invalid JSON', async () => {
  let requested;
  const success = createGitHubClient({ token: 'test-token', fetchImpl: async (url, options) => { requested = { url, options }; return { ok: true, json: async () => ({ ok: true }) }; } });
  assert.deepEqual(await success('/repos/owner/repo'), { ok: true });
  assert.equal(requested.url.origin, 'https://api.github.com');
  assert.equal(requested.options.redirect, 'error');
  assert.equal(requested.options.headers.Authorization, 'Bearer test-token');
  await assert.rejects(success('https://other.example/repos/owner/repo'), /Invalid GitHub API path/);
  await assert.rejects(success('//other.example/repos/owner/repo'), /Invalid GitHub API path/);
  const rateLimited = createGitHubClient({ fetchImpl: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(rateLimited('/repos/owner/repo'), /incomplete/);
  const offline = createGitHubClient({ fetchImpl: async () => { throw new Error('network'); } });
  await assert.rejects(offline('/repos/owner/repo'), /incomplete/);
  const invalid = createGitHubClient({ fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('broken'); } }) });
  await assert.rejects(invalid('/repos/owner/repo'), /invalid JSON/);
});

function fixture({ proposed = record('ABCDEFGHIJK', 'new-talk'), competing, changedBase = false, changedHead = false, truncated = false, blobOverride } = {}) {
  const sha = char => char.repeat(40), prefix = '/repos/owner/library';
  const baseSha = sha('a'), treeSha = sha('b'), mainBlob = sha('c'), headSha = sha('d'), newBlob = sha('e');
  const current = { number: 20, state: 'open', changed_files: 1, base: { ref: 'main' }, head: { sha: headSha, repo: { full_name: 'contributor/library' } } };
  const old = { number: 19, state: 'open', changed_files: 1, base: { ref: 'main' }, head: { sha: sha('f'), repo: { full_name: 'first/library' } } };
  const blob = talk => { const text = JSON.stringify(talk); return { encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') }; };
  let branchReads = 0, prReads = 0;
  const requested = [];
  const get = async path => {
    requested.push(path);
    if (path === prefix) return { default_branch: 'main' };
    if (path === `${prefix}/git/ref/heads/main`) return { object: { sha: ++branchReads > 1 && changedBase ? sha('9') : baseSha } };
    if (path === `${prefix}/git/commits/${baseSha}`) return { tree: { sha: treeSha } };
    if (path === `${prefix}/git/trees/${treeSha}?recursive=1`) return { truncated, tree: [{ path: mainRecords[0].path, type: 'blob', mode: '100644', sha: mainBlob }] };
    if (path === `${prefix}/git/blobs/${mainBlob}`) return blob(existing);
    if (path === `/repos/contributor/library/git/blobs/${newBlob}`) return blobOverride || blob(proposed);
    if (path === `${prefix}/pulls/20`) return { ...current, head: { ...current.head, sha: ++prReads > 1 && changedHead ? sha('8') : headSha } };
    if (path === `${prefix}/pulls/20/files?per_page=100&page=1`) return [{ filename: 'content/talks/proposed.json', status: 'added', sha: newBlob }];
    if (path === `${prefix}/pulls?state=open&base=main&per_page=100&page=1`) return competing ? [current, old] : [current];
    if (path === `${prefix}/pulls/19`) return old;
    if (path === `${prefix}/pulls/19/files?per_page=100&page=1`) return [{ filename: 'content/talks/first.json', status: 'added', sha: newBlob }];
    if (path === `/repos/first/library/git/blobs/${newBlob}`) return blob(competing);
    throw new Error(`Unexpected fixture request ${path}`);
  };
  return { get, requested };
}
const check = config => checkPullRequest({ repository: 'owner/library', number: 20, ...config });

test('API integration reads main and fork JSON blobs as data and rechecks all snapshots', async () => {
  const config = fixture();
  assert.deepEqual(await check(config), { checkedTalks: 1, addedVideos: ['ABCDEFGHIJK'] });
  assert.equal(config.requested.filter(path => path.endsWith('/git/ref/heads/main')).length, 2);
  assert.equal(config.requested.filter(path => path.endsWith('/pulls/20')).length, 2);
  assert.ok(config.requested.every(path => path.startsWith('/repos/')));
});

test('API integration rejects unpublished main duplicates and earlier competing proposals', async () => {
  await assert.rejects(check(fixture({ proposed: { ...existing, id: 'duplicate' } })), /Duplicate video/);
  await assert.rejects(check(fixture({ competing: record('ABCDEFGHIJK', 'first-talk') })), /earlier pull request #19/);
});

test('truncated trees, incomplete blobs, and concurrent base/head changes fail closed', async () => {
  await assert.rejects(check(fixture({ truncated: true })), /tree is incomplete/);
  await assert.rejects(check(fixture({ blobOverride: { encoding: 'base64', size: 100, content: 'e30=' } })), /Incomplete talk JSON/);
  await assert.rejects(check(fixture({ changedBase: true })), /default branch changed/);
  await assert.rejects(check(fixture({ changedHead: true })), /pull request changed/);
  await assert.rejects(check({ get: async () => { throw new Error('API unavailable'); } }), /API unavailable/);
});

test('invalid repository identifiers cannot become arbitrary API routes', async () => {
  for (const repository of ['owner/../evil', '../repo', 'https://example.com/repo', 'owner/repo?x=y']) {
    await assert.rejects(checkPullRequest({ repository, number: 20, get: async () => { assert.fail('must not fetch'); } }), /Invalid GitHub repository/);
  }
});

test('workflow uses only trusted default-branch code and a read-only token', async () => {
  const workflow = await readFile(new URL('../.github/workflows/contribution-check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /ref:.*head|permissions:[\s\S]*: write|npm install|npm ci/);
  assert.match(workflow, /run: node scripts\/check-contributions\.mjs/);
});
