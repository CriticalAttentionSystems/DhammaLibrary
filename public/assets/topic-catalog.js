// Shared by the static build and browser. Catalog text and URLs are untrusted.
export const SNAPSHOT_URL = '/data/topic-archive.json';
export const ARCHIVE_API = '/.netlify/functions/topic-archive';
export const PAGE_SIZE = 10;
const names = {metta:'Mettā',jhana:'Jhāna','q-and-a':'Questions & answers',sutta:'Suttas',kids:'Teachings for children',periodic:'Regular talks',misc:'Other teachings'};
const order = ['metta','meditation','jhana','dependent-origination','noble-eightfold-path','sutta','q-and-a','enlightenment','kids','periodic','misc'];
const archivePath = /^\/([a-zA-Z0-9 &_-]+)-([1-9]\d*)\.html$/;
const videoId = /^[A-Za-z0-9_-]{11}$/;
const invalid = () => { throw new Error('The archive index could not be read.'); };
const boundedText = (value, max = 2000) => typeof value === 'string' && value.trim() && value.length <= max ? value : invalid();
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const friendlyName = category => names[category.id] || category.label;
export const isQA = talk => /q\s*&\s*a|question[s]?\s*(?:and|&)\s*answer|q\/a/i.test(talk.title);

export function safeArchiveUrl(value) {
  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname).match(archivePath);
    if (url.protocol !== 'https:' || url.hostname !== 'bhavana-society.github.io' || url.port || url.username || url.password || url.search || url.hash || !path || Number(path[2]) > 120) return null;
    return `${url.origin}/${encodeURIComponent(path[1])}-${path[2]}.html`;
  } catch { return null; }
}

export function youtubeUrl(id) {
  if (!videoId.test(id)) return invalid();
  return `https://www.youtube.com/watch?v=${id}`;
}

function validDate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
  const date = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) return invalid();
  return value;
}

export function validateCatalog(input) {
  if (!input || input.schemaVersion !== 1 || !input.metadata || !Array.isArray(input.categories) || !input.categories.length || input.categories.length > 100 || !Array.isArray(input.talks) || !input.talks.length || input.talks.length > 20000) return invalid();
  const sourceUrl = safeArchiveUrl(input.metadata.sourceUrl), fetchedAt = timestamp(input.metadata.fetchedAt);
  if (!sourceUrl || !fetchedAt) return invalid();
  const categoryIds = new Set();
  const categories = input.categories.map(category => {
    if (!category || typeof category.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(category.id) || category.id === 'all' || categoryIds.has(category.id)) return invalid();
    const sourceUrl = safeArchiveUrl(category.sourceUrl);
    if (!sourceUrl) return invalid();
    categoryIds.add(category.id);
    return {id:category.id,label:boundedText(category.label,200),sourceUrl,count:0};
  });
  const ids = new Set();
  const talks = input.talks.map(talk => {
    if (!talk || typeof talk.id !== 'string' || !videoId.test(talk.id) || (talk.videoId !== undefined && talk.videoId !== talk.id) || ids.has(talk.id) || !Array.isArray(talk.topicIds) || talk.topicIds.length > categories.length || talk.topicIds.some(id => !categoryIds.has(id)) || new Set(talk.topicIds).size !== talk.topicIds.length) return invalid();
    ids.add(talk.id);
    // Never use a URL supplied by the archive for the recording link.
    return {id:talk.id,videoId:talk.id,title:boundedText(talk.title),url:youtubeUrl(talk.id),topicIds:[...talk.topicIds],date:validDate(talk.date)};
  });
  const counts = new Map(categories.map(category => [category.id,0]));
  for (const talk of talks) for (const id of talk.topicIds) counts.set(id,counts.get(id)+1);
  for (const category of categories) category.count = counts.get(category.id);
  return {schemaVersion:1,metadata:{sourceUrl,fetchedAt,sourceGeneratedLabel:input.metadata.sourceGeneratedLabel == null ? null : boundedText(input.metadata.sourceGeneratedLabel,200)},categories,talks};
}

export function renderTopicCards(catalog, {external = false} = {}) {
  const rank = id => { const index = order.indexOf(id); return index < 0 ? order.length : index; };
  return [...catalog.categories].sort((a,b) => rank(a.id)-rank(b.id) || a.label.localeCompare(b.label)).map(category => `<a class="topics-card${category.id === 'metta' ? ' topics-featured' : ''}" href="${escapeHtml(external ? category.sourceUrl : '#talks/' + category.id)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}><span class="topics-eyebrow">${category.count} RECORDINGS</span><h3>${escapeHtml(friendlyName(category))}</h3><span class="topics-card-bottom">Browse talks <span class="topics-card-arrow" aria-hidden="true">→</span></span></a>`).join('');
}

export function selectRecordings(catalog, {topic = 'all',search = '',format = 'all',page = 1} = {}) {
  const words = normalize(search).trim().split(/\s+/).filter(Boolean);
  const matches = catalog.talks.filter(talk => (topic === 'all' || talk.topicIds.includes(topic)) && (format === 'all' || (format === 'qa' ? isQA(talk) : !isQA(talk))) && words.every(word => normalize(talk.title).includes(word)));
  const pages = Math.max(1,Math.ceil(matches.length/PAGE_SIZE));
  const selectedPage = Math.min(pages,Math.max(1,Number.isFinite(Number(page)) ? Math.floor(Number(page)) : 1));
  return {total:matches.length,pages,page:selectedPage,items:matches.slice((selectedPage-1)*PAGE_SIZE,selectedPage*PAGE_SIZE)};
}

const audioIcon = '<span class="topics-audio-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v7h4v-7H4m16 0h1v7h-4v-7h3"/></svg></span>';
export function renderRecording(talk, catalog) {
  const date = talk.date ? new Date(talk.date + 'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}) : '';
  return `<article class="topics-recording">${audioIcon}<div><div class="topics-recording-meta"><span class="topics-kind">${isQA(talk) ? 'Q&amp;A IN TITLE' : 'BHANTE G · RECORDING'}</span>${date ? `<span>${escapeHtml(date)}</span>` : ''}</div><h3>${escapeHtml(talk.title)}</h3><div class="topics-tags">${talk.topicIds.slice(0,5).map(id => catalog.categories.find(category => category.id === id)).filter(Boolean).map(category => `<a class="topics-tag" href="#talks/${escapeHtml(category.id)}">${escapeHtml(friendlyName(category))}</a>`).join('')}</div></div><a class="topics-listen-link" href="${youtubeUrl(talk.id)}" target="_blank" rel="noopener noreferrer" aria-label="Listen on YouTube: ${escapeHtml(talk.title)}"><span aria-hidden="true">▶</span> Listen on YouTube ↗</a></article>`;
}

export function validateEnvelope(input) {
  if (!input || !input.status || typeof input.status.refreshing !== 'boolean') return invalid();
  const status = input.status;
  if (status.lastSuccess != null && !timestamp(status.lastSuccess)) return invalid();
  if (status.refreshAllowedAt != null && !timestamp(status.refreshAllowedAt)) return invalid();
  return {catalog:validateCatalog(input.catalog),status:{refreshing:status.refreshing,lastError:typeof status.lastError === 'string' && status.lastError ? status.lastError.slice(0,1000) : null,lastSuccess:timestamp(status.lastSuccess),refreshAllowedAt:timestamp(status.refreshAllowedAt)}};
}

export async function fetchSnapshot(fetcher = fetch) {
  const response = await fetcher(SNAPSHOT_URL,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('The saved topic index could not load.');
  return validateCatalog(await response.json());
}

export async function fetchArchive(fetcher = fetch, method = 'GET') {
  if (method !== 'GET' && method !== 'POST') throw new Error('Unsupported archive request.');
  const response = await fetcher(ARCHIVE_API,{method,cache:'no-store',signal:AbortSignal.timeout(55000)});
  if (!response.ok) throw new Error('The archive service is unavailable.');
  return validateEnvelope(await response.json());
}

// An unavailable or malformed update must never replace a usable index.
export function newerCatalog(current, incoming) {
  return !current || Date.parse(incoming.metadata.fetchedAt) >= Date.parse(current.metadata.fetchedAt) ? incoming : current;
}
