import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateTalk } from './content.mjs';

const TALK_PATH = /^content\/talks\/[^/]+\.json$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SHA = /^[a-f0-9]{40}$/;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const allowedStatuses = new Set(['added', 'modified', 'renamed', 'removed', 'copied', 'changed', 'unchanged']);

export function parseTalkJson(text, path, validate = true) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_JSON_BYTES) throw new Error('Talk JSON is missing or too large.');
  let talk;
  try { talk = JSON.parse(text); } catch { throw new Error(`Invalid JSON in ${path}.`); }
  if (!talk || typeof talk !== 'object' || Array.isArray(talk) || !VIDEO_ID.test(talk.youtubeId)) throw new Error(`Missing or invalid YouTube video ID in ${path}.`);
  return validate ? validateTalk(talk, path) : talk;
}

function assertUnique(records) {
  const videos = new Map(), ids = new Map();
  for (const [path, talk] of records) {
    validateTalk(talk, path);
    if (videos.has(talk.youtubeId)) throw new Error(`Duplicate video ${talk.youtubeId}: ${videos.get(talk.youtubeId)} and ${path}.`);
    if (ids.has(talk.id)) throw new Error(`Duplicate entry ID ${talk.id}: ${ids.get(talk.id)} and ${path}.`);
    videos.set(talk.youtubeId, path); ids.set(talk.id, path);
  }
}

// Only already-parsed data enters this core; contributor code is never imported.
export function evaluateContributions({ mainRecords, changes, currentNumber, others = [] }) {
  if (!Number.isSafeInteger(currentNumber) || currentNumber < 1) throw new Error('Invalid pull request number.');
  const current = new Map(mainRecords.map(({ path, talk }) => [path, talk]));
  assertUnique(current);
  const existingVideos = new Set([...current.values()].map(talk => talk.youtubeId));
  const updates = changes.filter(file => TALK_PATH.test(file.filename) || TALK_PATH.test(file.previous_filename || ''));
  // Remove old paths first, so a legitimate move/rename is not a duplicate.
  for (const file of updates) {
    if (!allowedStatuses.has(file.status)) throw new Error('Unsupported file change status.');
    if (file.status === 'removed') current.delete(file.filename);
    if (file.status === 'renamed') current.delete(file.previous_filename);
  }
  for (const file of updates) {
    if (file.status === 'removed' || !TALK_PATH.test(file.filename)) continue;
    current.set(file.filename, validateTalk(file.talk, file.filename));
  }
  assertUnique(current);
  const addedVideos = new Set(updates.filter(file => file.status !== 'removed' && TALK_PATH.test(file.filename))
    .map(file => file.talk.youtubeId).filter(id => !existingVideos.has(id)));
  for (const other of others) {
    if (!Number.isSafeInteger(other.number) || other.number < 1) throw new Error('Invalid competing pull request number.');
    if (other.number >= currentNumber) continue;
    for (const file of other.changes) {
      if (file.status === 'removed' || !TALK_PATH.test(file.filename)) continue;
      if (!file.talk || !VIDEO_ID.test(file.talk.youtubeId)) throw new Error(`Cannot determine the video in pull request #${other.number}.`);
      if (addedVideos.has(file.talk.youtubeId)) throw new Error(`Video ${file.talk.youtubeId} is already proposed in earlier pull request #${other.number}. Coordinate with that contributor before adding it again.`);
    }
  }
  return { checkedTalks: updates.filter(file => file.status !== 'removed' && TALK_PATH.test(file.filename)).length, addedVideos: [...addedVideos] };
}

function repositoryPath(repository) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid GitHub repository.');
  return `/repos/${repository}`;
}

export function createGitHubClient({ token, fetchImpl = fetch }) {
  return async function get(path) {
    // API paths are built here from validated identifiers, never PR-supplied URLs.
    if (typeof path !== 'string' || !path.startsWith('/repos/') || path.includes('\\') || path.includes('#')) throw new Error('Invalid GitHub API path.');
    const url = new URL(path, 'https://api.github.com');
    if (url.origin !== 'https://api.github.com' || !url.pathname.startsWith('/repos/')) throw new Error('Invalid GitHub API destination.');
    let response;
    try {
      response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'DhammaLibrary-contribution-check', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(20_000) });
    } catch { throw new Error('GitHub could not be reached. The duplicate check is incomplete; rerun it when connectivity returns.'); }
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}. The duplicate check is incomplete; rerun it after resolving access or rate limits.`);
    try { return await response.json(); } catch { throw new Error('GitHub returned invalid JSON. The duplicate check is incomplete.'); }
  };
}

export async function listAll(get, path, { fileList = false } = {}) {
  const records = [];
  for (let page = 1; page <= 100; page++) {
    const separator = path.includes('?') ? '&' : '?';
    const items = await get(`${path}${separator}per_page=100&page=${page}`);
    if (!Array.isArray(items)) throw new Error('GitHub returned an invalid paginated collection.');
    records.push(...items);
    // GitHub caps PR files at 3,000, so never pass a possibly truncated list.
    if (fileList && records.length >= 3000) throw new Error('This pull request reaches GitHub’s 3,000-file API limit and needs a smaller change for a complete check.');
    if (items.length < 100) return records;
  }
  throw new Error('GitHub pagination exceeded the check limit; the check is incomplete.');
}

async function mapLimited(items, mapper) {
  const output = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; output[index] = await mapper(items[index]); }
  }));
  return output;
}

async function readBlob(get, repository, sha, path, validate) {
  if (!SHA.test(sha)) throw new Error('GitHub returned an invalid content SHA.');
  const blob = await get(`${repositoryPath(repository)}/git/blobs/${sha}`);
  if (blob.encoding !== 'base64' || !Number.isSafeInteger(blob.size) || blob.size > MAX_JSON_BYTES || typeof blob.content !== 'string') throw new Error(`Cannot safely read talk JSON in ${path}.`);
  const bytes = Buffer.from(blob.content, 'base64');
  if (bytes.length !== blob.size) throw new Error(`Incomplete talk JSON in ${path}.`);
  return parseTalkJson(bytes.toString('utf8'), path, validate);
}

function validatePullRequest(pr, number, defaultBranch) {
  if (pr.number !== number || pr.state !== 'open' || pr.base?.ref !== defaultBranch || !SHA.test(pr.head?.sha)) throw new Error('The pull request changed or is not open against the default branch. Rerun the check.');
  repositoryPath(pr.head?.repo?.full_name);
  return pr;
}

async function loadChanges(get, repoPath, pr, validate) {
  const files = await listAll(get, `${repoPath}/pulls/${pr.number}/files`, { fileList: true });
  if (Number.isSafeInteger(pr.changed_files) && files.length !== pr.changed_files) throw new Error('The pull request file list changed while checking. Rerun the check.');
  return mapLimited(files.filter(file => TALK_PATH.test(file.filename) || TALK_PATH.test(file.previous_filename || '')), async file => {
    if (!allowedStatuses.has(file.status)) throw new Error('GitHub returned an unsupported file change status.');
    if (file.status === 'removed' || !TALK_PATH.test(file.filename)) return file;
    return { ...file, talk: await readBlob(get, pr.head.repo.full_name, file.sha, file.filename, validate) };
  });
}

export async function checkPullRequest({ repository, number, get }) {
  const repoPath = repositoryPath(repository);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid pull request number.');
  const info = await get(repoPath);
  if (typeof info.default_branch !== 'string' || !info.default_branch) throw new Error('Cannot determine the default branch.');
  const branchPath = `${repoPath}/git/ref/heads/${encodeURIComponent(info.default_branch)}`;
  const base = await get(branchPath);
  if (!SHA.test(base.object?.sha)) throw new Error('Cannot determine the current default-branch commit.');
  const commit = await get(`${repoPath}/git/commits/${base.object.sha}`);
  if (!SHA.test(commit.tree?.sha)) throw new Error('Cannot determine the current content tree.');
  const tree = await get(`${repoPath}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated !== false || !Array.isArray(tree.tree)) throw new Error('The repository tree is incomplete; the duplicate check cannot proceed.');
  const mainRecords = await mapLimited(tree.tree.filter(item => TALK_PATH.test(item.path)), async item => {
    if (item.type !== 'blob' || item.mode === '120000') throw new Error('Talk records must be regular JSON files.');
    return { path: item.path, talk: await readBlob(get, repository, item.sha, item.path, true) };
  });
  const pr = validatePullRequest(await get(`${repoPath}/pulls/${number}`), number, info.default_branch);
  const changes = await loadChanges(get, repoPath, pr, true);
  const open = await listAll(get, `${repoPath}/pulls?state=open&base=${encodeURIComponent(info.default_branch)}`);
  const others = await mapLimited(open.filter(other => other.number < number), async other => {
    const detail = validatePullRequest(await get(`${repoPath}/pulls/${other.number}`), other.number, info.default_branch);
    return { number: other.number, sha: detail.head.sha, changes: await loadChanges(get, repoPath, detail, false) };
  });
  const result = evaluateContributions({ mainRecords, changes, currentNumber: number, others });
  // Fail instead of reporting success for data that changed during the scan.
  for (const checked of [{ number, sha: pr.head.sha }, ...others]) {
    const latest = validatePullRequest(await get(`${repoPath}/pulls/${checked.number}`), checked.number, info.default_branch);
    if (latest.head.sha !== checked.sha) throw new Error('A pull request changed during the check. Rerun it.');
  }
  if ((await get(branchPath)).object?.sha !== base.object.sha) throw new Error('The default branch changed during the check. Rerun it against the latest content.');
  const latestOpen = await listAll(get, `${repoPath}/pulls?state=open&base=${encodeURIComponent(info.default_branch)}`);
  const earlier = list => list.filter(item => item.number < number).map(item => item.number).sort((a, b) => a - b).join(',');
  if (earlier(latestOpen) !== earlier(open)) throw new Error('The open contribution list changed during the check. Rerun it.');
  return result;
}

async function main() {
  if (!process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_REPOSITORY || !process.env.GITHUB_TOKEN) throw new Error('Run this check in its configured GitHub workflow.');
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const result = await checkPullRequest({ repository: process.env.GITHUB_REPOSITORY, number: event.pull_request?.number,
    get: createGitHubClient({ token: process.env.GITHUB_TOKEN }) });
  console.log(`Contribution check passed: ${result.checkedTalks} changed talk records; ${result.addedVideos.length} new videos.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Keep untrusted filenames/content out of GitHub workflow command syntax.
  console.error(`Contribution check failed: ${String(error.message).replace(/[\r\n\u001b]/g, ' ')}`);
  process.exitCode = 1;
});
