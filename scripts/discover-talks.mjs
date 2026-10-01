#!/usr/bin/env node
/** Refresh public YouTube metadata only: never downloads media or subtitles. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNEL, sixMonthScope, candidateForScope, uniqueEntries, videoRecord, inScope } from './discovery-core.mjs';
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function parseArgs(argv) {
  const options = { months: 6, asOf: new Date().toISOString().slice(0, 10), maxItems: 400, concurrency: 3, output: path.join(root, 'content/discovery.json'), ytDlp: process.env.YT_DLP_PATH || 'yt-dlp' };
  const numeric = new Map([['--months', 'months'], ['--max-items', 'maxItems'], ['--concurrency', 'concurrency']]);
  const strings = new Map([['--as-of', 'asOf'], ['--output', 'output'], ['--yt-dlp', 'ytDlp']]);
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (name === '--help') return { help: true };
    if (!numeric.has(name) && !strings.has(name)) throw new Error(`Unknown option: ${name}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
    options[numeric.get(name) || strings.get(name)] = numeric.has(name) ? Number(value) : value;
  }
  sixMonthScope(options.asOf, options.months);
  if (!Number.isSafeInteger(options.maxItems) || options.maxItems < 1 || options.maxItems > 2000) throw new Error('--max-items must be between 1 and 2000 per channel tab.');
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 4) throw new Error('--concurrency must be between 1 and 4.');
  return options;
}
async function jsonFromYtDlp(binary, extra) {
  const args = ['--ignore-config', '--skip-download', '--no-warnings', '--socket-timeout', '20', '--retries', '1', '--extractor-retries', '1', ...extra];
  const { stdout } = await run(binary, args, { timeout: 90_000, maxBuffer: 30 * 1024 * 1024, encoding: 'utf8' });
  return JSON.parse(stdout);
}
export async function collect(options, dependencies = {}) {
  const getJson = dependencies.getJson || ((args) => jsonFromYtDlp(options.ytDlp, args));
  const progress = dependencies.progress || (message => process.stderr.write(`${message}\n`));
  const scope = sixMonthScope(options.asOf, options.months);
  const warnings = [];
  let complete = true;
  const tabs = await Promise.all(['videos', 'streams'].map(async tab => {
    try {
      const result = await getJson(['--flat-playlist', '--extractor-args', 'youtubetab:approximate_date=1', '--playlist-end', String(options.maxItems), '--dump-single-json', `${CHANNEL.url}/${tab}`]);
      if (result.channel_id !== CHANNEL.id && result.id !== CHANNEL.id) throw new Error('The returned channel ID does not match Bhavana Society.');
      if (!Array.isArray(result.entries)) throw new Error('YouTube returned no readable entry list.');
      const entries = result.entries.filter(Boolean);
      const olderBoundary = entries.some(entry => !candidateForScope(entry, scope));
      if (entries.length >= options.maxItems && !olderBoundary) {
        complete = false;
        warnings.push(`The ${tab} tab reached the ${options.maxItems}-item limit before the buffered date boundary; older eligible videos may be missing. Increase --max-items.`);
      }
      progress(`Read ${entries.length} entries from ${tab}.`);
      return { tab, entries, listed: entries.length, boundaryReached: olderBoundary || entries.length < options.maxItems };
    } catch (error) {
      complete = false;
      warnings.push(`Could not read the ${tab} tab: ${String(error.message).split('\n')[0].slice(0, 240)}`);
      return { tab, entries: [], listed: 0, boundaryReached: false };
    }
  }));
  const candidates = uniqueEntries(tabs).filter(({ entry }) => candidateForScope(entry, scope));
  if (tabs.every(tab => tab.entries.length === 0)) {
    complete = false;
    warnings.push('Both channel tabs returned no entries. This unexpected empty result is incomplete and must not replace an existing catalog.');
  }
  progress(`Checking exact public metadata for ${candidates.length} possible recent videos.`);
  const videos = [];
  const failed = [];
  let next = 0;
  let processed = 0;
  await Promise.all(Array.from({ length: Math.min(options.concurrency, candidates.length) }, async () => {
    while (next < candidates.length) {
      const { entry, tabs: sourceTabs } = candidates[next++];
      let metadata = null;
      try {
        metadata = await getJson(['--ignore-no-formats-error', '--dump-single-json', `https://www.youtube.com/watch?v=${entry.id}`]);
        if (metadata.id !== entry.id || metadata.channel_id !== CHANNEL.id) throw new Error('Metadata ID or channel did not match.');
      } catch { failed.push(entry.id); }
      const video = videoRecord(entry, metadata, sourceTabs);
      if (!video.metadataVerified && !failed.includes(entry.id)) failed.push(entry.id);
      if (inScope(video, scope)) videos.push(video);
      processed++;
      if (processed % 10 === 0 || processed === candidates.length) progress(`Verified metadata ${processed}/${candidates.length}.`);
    }
  }));
  if (failed.length) {
    complete = false;
    warnings.push(`${failed.length} video dates could not be verified. Undated entries remain for review; IDs: ${failed.join(', ')}`);
  }
  warnings.push('Discovery covers publicly listed Videos and Live tabs only. Private, unlisted, deleted, and members-only recordings cannot be guaranteed. Titles determine eligibility; ambiguous speakers or subjects need human review.');
  warnings.push('Exact dates are YouTube broadcast dates when available, otherwise upload dates, in UTC. Approximate channel-list dates are used only to find candidates, with a 62-day buffer.');
  videos.sort((a, b) => (b.date || b.approximateDate || '').localeCompare(a.date || a.approximateDate || '') || a.youtubeId.localeCompare(b.youtubeId));
  return {
    version: 1, channel: CHANNEL, scope, checkedAt: new Date().toISOString(), complete, warnings,
    scan: { maxItemsPerTab: options.maxItems, candidateCount: candidates.length, verifiedCount: candidates.length - failed.length, tabs: tabs.map(({ tab, listed, boundaryReached }) => ({ tab, listed, boundaryReached })) },
    videos,
  };
}
export async function saveCatalog(catalog, output) {
  let previous;
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!catalog.complete && previous) throw new Error('Incomplete scan: existing catalog was preserved. Resolve the reported failures and retry, or use --output with a separate review filename.');
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await rename(temporary, output);
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node scripts/discover-talks.mjs [--months 6] [--as-of YYYY-MM-DD] [--max-items 400] [--concurrency 3] [--yt-dlp PATH] [--output FILE]\nReads public metadata only. No audio, video, or subtitles are downloaded. An incomplete refresh never replaces an existing catalog.');
    return;
  }
  const catalog = await collect(options);
  for (const warning of catalog.warnings) console.error(warning);
  await saveCatalog(catalog, options.output);
  const counts = Object.fromEntries(['eligible', 'review', 'excluded'].map(kind => [kind, catalog.videos.filter(video => video.classification === kind).length]));
  console.log(JSON.stringify({ output: options.output, complete: catalog.complete, ...counts }));
  if (!catalog.complete) process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
