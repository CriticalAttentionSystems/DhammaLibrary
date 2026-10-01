import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CHANNEL, isoDate, sixMonthScope, approximateDate, candidateForScope, verifiedDate, classifyVideo, videoRecord, uniqueEntries, inScope } from './discovery-core.mjs';
import { parseArgs, collect, saveCatalog } from './discover-talks.mjs';
const valid = { date: '2026-09-01', metadataVerified: true, durationSeconds: 3000 };
const classify = (title, extra = {}) => classifyVideo({ ...valid, title, ...extra });
const timestamp = date => Date.parse(`${date}T00:00:00Z`) / 1000;
const entry = (id = 'abcdefghijk', date = '2026-09-01', title = 'Dhamma Talk with Bhante G') => ({ id, title, timestamp: timestamp(date), duration: 3000 });
const metadata = (id = 'abcdefghijk', extra = {}) => ({ id, title: 'Dhamma Talk with Bhante G', channel_id: CHANNEL.id, upload_date: '20260902', release_date: '20260901', duration: 3001, ...extra });
const options = () => ({ ...parseArgs(['--as-of', '2026-10-01']), maxItems: 4, concurrency: 2 });

test('six calendar months use the requested date and clamp end-of-month safely', () => {
  assert.deepEqual(sixMonthScope('2026-10-01'), { months: 6, since: '2026-04-01', until: '2026-10-01' });
  assert.equal(sixMonthScope('2026-08-31', 6).since, '2026-02-28');
  assert.equal(sixMonthScope('2024-08-31', 6).since, '2024-02-29');
  for (const value of ['2026-02-30', 'no date', '2026-2-1']) assert.throws(() => sixMonthScope(value));
  for (const value of [0, -1, 25, 1.5]) assert.throws(() => sixMonthScope('2026-10-01', value));
});
test('YouTube dates are exact valid calendar dates only', () => {
  assert.equal(isoDate('20260901'), '2026-09-01');
  assert.equal(isoDate('20260230'), null);
  assert.deepEqual(verifiedDate({ release_date: '20260901', upload_date: '20260902' }), { date: '2026-09-01', dateSource: 'YouTube broadcast metadata' });
  assert.deepEqual(verifiedDate({ release_date: 'bad', upload_date: '20260902' }), { date: '2026-09-02', dateSource: 'YouTube upload metadata' });
  assert.deepEqual(verifiedDate({ timestamp: timestamp('2026-09-01') }), { date: null, dateSource: 'Not verified' });
});
test('approximate dates are only candidate hints, include the 62-day buffer and undated entries', () => {
  const scope = sixMonthScope('2026-10-01');
  assert.equal(approximateDate(entry()), '2026-09-01');
  assert.equal(candidateForScope(entry('abcdefghijk', '2026-02-01'), scope), true);
  assert.equal(candidateForScope(entry('abcdefghijk', '2026-01-01'), scope), false);
  assert.equal(candidateForScope({ id: 'abcdefghijk' }, scope), true);
  assert.equal(inScope({ date: null }, scope), true);
  assert.equal(inScope({ date: '2026-03-31' }, scope), false);
  assert.equal(inScope({ date: '2026-04-01' }, scope), true);
  assert.equal(inScope({ date: '2026-10-01' }, scope), true);
  assert.equal(inScope({ date: '2026-10-02' }, scope), false);
});
test('explicit Bhante G Dhamma and Q&A titles are eligible, including spelling variants', () => {
  for (const title of ['Dhamma Talk with Bhante G', 'Bhante Gunaratana - Right View', 'Bhante G talk on Monastic Retreat', 'Bhaten G talks about Cittanupassi']) assert.deepEqual(classify(title).classification, 'eligible');
  for (const title of ['Q&A with Bhante G', 'Bhante G Q and A', 'Q-A with Bhante G', 'QnA Bhante G', 'Questions and Answers with Bhante Gunaratana']) {
    assert.equal(classify(title).classification, 'eligible');
    assert.equal(classify(title).type, 'Q&A');
  }
});
test('Pali classes and other named teachers are excluded without using generic description hashtags', () => {
  assert.equal(classify('Pāli class with Bhante G').classification, 'excluded');
  for (const title of ['Samma - Sati - Bhante S', 'Bhante Saddhajeewa - guided meditation', 'How does self view arise? by Bhante Jinananda', 'Feeling and Perception - Prof. Chinthaka']) assert.equal(classify(title).classification, 'excluded');
  assert.equal(classify('Bhante S and Bhante G - Dhamma Talk').classification, 'review');
  assert.equal(classify('Bhavana Society Dhamma Meetings', { description: '#BhanteGunaratana' }).classification, 'review');
});
test('aborted clips, standalone meditation, live sessions and ambiguous talks are handled conservatively', () => {
  assert.equal(classify('Q&A with Bhante G', { durationSeconds: 16 }).classification, 'excluded');
  assert.equal(classify('Q&A with Bhante G', { durationSeconds: 60 }).classification, 'eligible');
  for (const title of ['Meditation with Bhante G', 'Guiding Meditation by Bhante G', 'Bhante G - Meditation - Retreat July 2026']) assert.equal(classify(title).classification, 'excluded');
  for (const title of ['Closing Talk', 'Q&A Noble 8 fold Path 2026 Retreat', 'Bhavana Society Dhamma Meetings', 'Bhante G - Anapanasati']) assert.equal(classify(title).classification, 'review');
  assert.equal(classify('Dhamma Talk with Bhante G', { liveStatus: 'is_upcoming' }).classification, 'review');
  assert.equal(classify('Q&A with Bhante G', { metadataVerified: false, date: null }).classification, 'review');
});
test('video record never presents approximate timestamps as exact dates or trusts a different channel', () => {
  const record = videoRecord(entry(), metadata(), ['streams', 'videos', 'streams']);
  assert.equal(record.date, '2026-09-01');
  assert.equal(record.dateTimezone, 'UTC');
  assert.equal(record.durationSeconds, 3001);
  assert.deepEqual(record.sourceTabs, ['streams', 'videos']);
  const unknown = videoRecord(entry(), null, ['streams']);
  assert.equal(unknown.date, null);
  assert.equal(unknown.approximateDate, '2026-09-01');
  assert.equal(unknown.metadataVerified, false);
  assert.equal(unknown.classification, 'review');
  const mismatch = videoRecord(entry(), metadata('abcdefghijk', { channel_id: 'another-channel' }));
  assert.equal(mismatch.metadataVerified, false);
  assert.equal(mismatch.date, null);
});
test('channel tabs are deduplicated by video ID and invalid IDs are ignored', () => {
  const results = uniqueEntries([{ tab: 'videos', entries: [entry(), { id: 'bad' }] }, { tab: 'streams', entries: [entry(), entry('lmnopqrstuv')] }]);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0].tabs, ['videos', 'streams']);
});
test('CLI rejects invalid and unknown settings and never permits arbitrary extra yt-dlp flags', () => {
  assert.equal(parseArgs(['--months', '3', '--as-of', '2026-10-01']).months, 3);
  for (const args of [['--months'], ['--no-skip-download'], ['--concurrency', '9'], ['--max-items', '0'], ['--months', 'foo']]) assert.throws(() => parseArgs(args));
});
test('collector verifies exact dates, drops out-of-scope broadcasts and merges duplicate tabs', async () => {
  const a = entry();
  const b = entry('lmnopqrstuv', '2026-04-02');
  const calls = [];
  const result = await collect(options(), { progress() {}, async getJson(args) {
    calls.push(args);
    if (args.includes('--flat-playlist')) return { channel_id: CHANNEL.id, entries: [a, b] };
    return metadata(args.at(-1).split('=')[1], args.at(-1).includes(b.id) ? { release_date: '20260321' } : {});
  } });
  assert.equal(result.complete, true);
  assert.equal(result.videos.length, 1);
  assert.equal(result.scan.candidateCount, 2);
  assert.equal(calls.length, 4);
  assert.equal(result.videos[0].sourceTabs.length, 2);
});
test('partial tab failures and missing metadata are explicit; failed video remains in review', async () => {
  const result = await collect(options(), { progress() {}, async getJson(args) {
    if (args.at(-1).endsWith('/streams')) throw new Error('Network timeout');
    if (args.includes('--flat-playlist')) return { channel_id: CHANNEL.id, entries: [entry()] };
    throw new Error('Video unavailable');
  } });
  assert.equal(result.complete, false);
  assert.equal(result.videos[0].classification, 'review');
  assert.equal(result.videos[0].date, null);
  assert.ok(result.warnings.some(message => message.includes('streams')));
  assert.ok(result.warnings.some(message => message.includes('could not be verified')));
});
test('a cap without an older boundary is marked incomplete and a wrong channel is rejected', async () => {
  const capped = await collect({ ...options(), maxItems: 1 }, { progress() {}, async getJson(args) {
    if (args.includes('--flat-playlist')) return { channel_id: CHANNEL.id, entries: [entry()] };
    return metadata();
  } });
  assert.equal(capped.complete, false);
  assert.ok(capped.warnings.some(message => message.includes('item limit')));
  const wrong = await collect(options(), { progress() {}, async getJson() { return { channel_id: 'wrong', entries: [entry()] }; } });
  assert.equal(wrong.complete, false);
  assert.equal(wrong.videos.length, 0);
});
test('an incomplete refresh cannot replace an existing catalog; complete saves are atomic', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dhamma-discovery-test-'));
  const output = path.join(directory, 'discovery.json');
  try {
    await writeFile(output, '{"complete":true,"videos":["preserved"]}\n');
    await assert.rejects(saveCatalog({ complete: false, videos: [] }, output), /preserved/);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).videos, ['preserved']);
    await saveCatalog({ complete: true, videos: ['new'] }, output);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).videos, ['new']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unexpected empty tabs cannot erase a previously populated catalog', async () => {
  const empty = await collect(options(), { progress() {}, async getJson() { return { channel_id: CHANNEL.id, entries: [] }; } });
  assert.equal(empty.complete, false);
  assert.ok(empty.warnings.some(message => message.includes('unexpected empty')));
});
