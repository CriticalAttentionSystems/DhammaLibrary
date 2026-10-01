/** Public-metadata helpers for the Bhavana Society contribution queue. */
export const CHANNEL = Object.freeze({
  id: 'UCjUZp1wSbSNkxP7SspfCf5w',
  url: 'https://www.youtube.com/@BhavanasocietyOrg',
  name: 'The Bhavana Society of West Virginia',
});
export const VALID_ID = /^[A-Za-z0-9_-]{11}$/;
export const normalize = text => String(text || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function isoDate(value) {
  const s = String(value || '');
  const normalized = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === normalized ? normalized : null;
}
export function sixMonthScope(asOf, months = 6) {
  const until = isoDate(asOf);
  if (!until || !Number.isSafeInteger(months) || months < 1 || months > 24) throw new Error('Use a valid --as-of YYYY-MM-DD and --months between 1 and 24.');
  const end = new Date(`${until}T00:00:00Z`);
  const start = new Date(end);
  const day = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(day, lastDay));
  return { months, since: start.toISOString().slice(0, 10), until };
}
export function approximateDate(entry) {
  return Number.isFinite(entry?.timestamp) ? new Date(entry.timestamp * 1000).toISOString().slice(0, 10) : null;
}
export function candidateForScope(entry, scope) {
  const approximate = approximateDate(entry);
  // Month-rounded flat-list dates can lag actual broadcasts by several weeks.
  // Inspect a full 62-day buffer, and retain undated entries for review.
  const buffered = new Date(`${scope.since}T00:00:00Z`);
  buffered.setUTCDate(buffered.getUTCDate() - 62);
  return !approximate || approximate >= buffered.toISOString().slice(0, 10);
}
export function verifiedDate(metadata) {
  const broadcast = isoDate(metadata?.release_date);
  if (broadcast) return { date: broadcast, dateSource: 'YouTube broadcast metadata' };
  const upload = isoDate(metadata?.upload_date);
  if (upload) return { date: upload, dateSource: 'YouTube upload metadata' };
  return { date: null, dateSource: 'Not verified' };
}
export function classifyVideo(video) {
  const title = normalize(video.title);
  if (Number.isFinite(video.durationSeconds) && video.durationSeconds < 60) return { classification: 'excluded', type: null, reason: 'Short or aborted recording (under one minute).' };
  if (/\bpali\b/.test(title)) return { classification: 'excluded', type: null, reason: 'Pali class or language lesson.' };
  const bhanteG = /\b(?:bhante|bhaten|bhnate)\s+(?:g(?:unaratana)?|henepola gunaratana)\b|\b(?:henepola )?gunaratana\b/.test(title);
  const otherTeacher = /\bbhante\s+(?:s|saddhajeewa|saddhajiva|jinananda|rahula|yogavacara)\b|\b(?:prof(?:essor)?\.?\s+chinthaka|(?:mr\.?\s+)?don gunasekara)\b/.test(title);
  if (otherTeacher && bhanteG) return { classification: 'review', type: null, reason: 'More than one teacher is named; confirm Bhante G’s contribution.' };
  if (otherTeacher) return { classification: 'excluded', type: null, reason: 'A different teacher is named in the title.' };
  const qa = /\bq\s*(?:&|and|-|n)?\s*a\b|\bquestions?\s*(?:&|and)\s*answers?\b/.test(title);
  const explicitTalk = /\b(?:dhamma|talks?|sutta|speech|contemplation|right view|right action|right livelihood|right concentration|hindrances)\b/.test(title);
  const guided = /\b(?:guided|guiding|guide)\s+meditation\b/.test(title);
  const justMeditation = !qa && !explicitTalk && (/^(?:bhante g\s*[-:—]?\s*)?meditation(?: with| by| -|$)/.test(title) || /\bmeditation\s*[-:—]\s*bhante g\b/.test(title));
  if (guided || justMeditation) return { classification: 'excluded', type: null, reason: 'Standalone guided meditation rather than a Dhamma or Q&A talk.' };
  if (video.metadataVerified === false || !isoDate(video.date)) return { classification: 'review', type: qa ? 'Q&A' : explicitTalk ? 'Dhamma talk' : null, reason: 'The broadcast or upload date could not be verified; check the video.' };
  if (video.liveStatus === 'is_live' || video.liveStatus === 'is_upcoming' || video.liveStatus === 'post_live') return { classification: 'review', type: null, reason: 'Live or upcoming recording; wait until the complete video is available.' };
  if (bhanteG && qa) return { classification: 'eligible', type: 'Q&A', reason: 'The title identifies a Q&A session with Bhante G.' };
  if (bhanteG && explicitTalk) return { classification: 'eligible', type: 'Dhamma talk', reason: 'The title identifies a Dhamma teaching by Bhante G.' };
  if (bhanteG) return { classification: 'review', type: null, reason: 'Bhante G is named; confirm this is a Dhamma or Q&A talk rather than meditation or a ceremony.' };
  return { classification: 'review', type: qa ? 'Q&A' : explicitTalk ? 'Dhamma talk' : null, reason: 'The title does not identify Bhante G clearly; confirm the speaker and subject.' };
}
export function videoRecord(flat, metadata, tabs = []) {
  const verified = metadata && metadata.id === flat.id && metadata.channel_id === CHANNEL.id;
  const dates = verifiedDate(verified ? metadata : null);
  const video = {
    youtubeId: flat.id, title: String((verified && metadata.title) || flat.title || 'Untitled video'),
    url: `https://www.youtube.com/watch?v=${flat.id}`, ...dates,
    dateTimezone: 'UTC', approximateDate: approximateDate(flat),
    durationSeconds: Number.isFinite(verified && metadata.duration) ? metadata.duration : Number.isFinite(flat.duration) ? flat.duration : null,
    metadataVerified: Boolean(verified && dates.date),
    liveStatus: (verified && metadata.live_status) || flat.live_status || null,
    sourceTabs: [...new Set(tabs)].sort(),
    thumbnailUrl: `https://i.ytimg.com/vi/${flat.id}/hqdefault.jpg`,
  };
  return { ...video, ...classifyVideo(video) };
}
export function uniqueEntries(tabResults) {
  const found = new Map();
  for (const { tab, entries } of tabResults) for (const entry of entries || []) {
    if (!VALID_ID.test(entry?.id || '')) continue;
    const current = found.get(entry.id);
    if (current) current.tabs.push(tab);
    else found.set(entry.id, { entry, tabs: [tab] });
  }
  return [...found.values()];
}
export function inScope(video, scope) { return !video.date || (video.date >= scope.since && video.date <= scope.until); }
