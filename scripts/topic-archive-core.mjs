import { parse } from 'parse5';

export const SOURCE_URL = 'https://bhavana-society.github.io/all-1.html';
export const SOURCE_NAME = "Bhante Gunaratana's Talks and Books — Bhavana Society archive";
export const MAX_PAGES = 120;
export const CRAWL_TIMEOUT_MS = 40_000;
const MAX_PAGE_BYTES = 2_000_000;
const MAX_TALKS = 12_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LISTING_PATH = /^\/([a-zA-Z0-9 &_-]+)-([1-9]\d*)\.html$/;
const NON_VIDEO_SECTIONS = new Set(['about', 'books', 'reactions']);
const ORIGIN = new URL(SOURCE_URL).origin;
const compact = value => value.replace(/\s+/gu, ' ').trim();
const categoryId = stem => stem.toLowerCase().replaceAll('&', ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Only listing pages on this one public origin can enter the fetch queue.
export function listingUrl(href, base = SOURCE_URL) {
  try {
    const url = new URL(href, base);
    if (url.origin !== ORIGIN || url.username || url.password) return null;
    const path = decodeURIComponent(url.pathname);
    const match = path.match(LISTING_PATH);
    if (!match || Number(match[2]) > MAX_PAGES || path.includes('\\')) return null;
    return `${ORIGIN}/${encodeURIComponent(match[1])}-${match[2]}.html`;
  } catch { return null; }
}

const listingStem = url => decodeURIComponent(new URL(url).pathname).match(LISTING_PATH)?.[1];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value || '';
const classes = node => attr(node, 'class').split(/\s+/u);
function descendants(node, match) {
  const result = [];
  function visit(current) {
    if (match(current)) result.push(current);
    for (const child of current.childNodes || []) visit(child);
  }
  visit(node);
  return result;
}
function nodeText(node) {
  if (node.nodeName === '#text') return node.value;
  if (['script', 'style', 'template'].includes(node.tagName)) return '';
  return (node.childNodes || []).map(nodeText).join('');
}

export function parseListing(html) {
  const document = parse(html);
  const menus = descendants(document, node => node.tagName === 'ul' && classes(node).includes('vertical-menu'));
  const audioNodes = descendants(document, node => node.tagName === 'div' && classes(node).includes('youtube-audio'));
  if (!menus.length || !audioNodes.length) throw new Error('The archive listing format has changed.');
  const rows = [];
  for (const row of descendants(document, node => node.tagName === 'tr')) {
    const players = descendants(row, node => node.tagName === 'div' && classes(node).includes('youtube-audio'));
    if (!players.length) continue;
    const cells = (row.childNodes || []).filter(node => ['td', 'th'].includes(node.tagName)).map(node => compact(nodeText(node)));
    const id = attr(players[0], 'data-video');
    if (players.length !== 1 || !VIDEO_ID.test(id) || !cells[0] || cells[0].length > 2_000) {
      throw new Error('The archive contains an invalid talk row.');
    }
    rows.push({ id, cells });
  }
  if (audioNodes.length !== rows.length) throw new Error('The archive contains an unsupported player layout.');
  const links = [];
  for (const anchor of descendants(document, node => node.tagName === 'a' && attr(node, 'href'))) {
    let parent = anchor.parentNode;
    while (parent && parent.tagName !== 'ul') parent = parent.parentNode;
    const menu = classes(parent || {});
    if (menu.includes('vertical-menu') || menu.includes('horizontal-menu')) {
      links.push({ href: attr(anchor, 'href'), label: compact(nodeText(anchor)), vertical: menu.includes('vertical-menu') });
    }
  }
  return { rows, links };
}

const MONTHS = new Map();
['jan january', 'feb february', 'mar march', 'apr april', 'may', 'jun june', 'jul july', 'aug august', 'sep sept september', 'oct october', 'nov november', 'dec december'].forEach((names, index) => {
  names.split(' ').forEach(name => MONTHS.set(name, index + 1));
});
const MONTH_PATTERN = [...MONTHS.keys()].sort((a, b) => b.length - a.length).join('|');

export function dateFromTitle(title, currentYear = new Date().getUTCFullYear()) {
  const candidates = [];
  function add(year, month, day, evidence) {
    year = Number(year); month = Number(month); day = Number(day);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || year > currentYear || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return;
    candidates.push({ date: date.toISOString().slice(0, 10), dateEvidence: evidence });
  }
  for (const m of title.matchAll(new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?[,.]?\\s+((?:19|20)\\d{2})\\b`, 'gi'))) add(m[3], MONTHS.get(m[1].toLowerCase()), m[2], m[0]);
  for (const m of title.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\.?[,.]?\\s+((?:19|20)\\d{2})\\b`, 'gi'))) add(m[3], MONTHS.get(m[2].toLowerCase()), m[1], m[0]);
  for (const m of title.matchAll(/(?<!\d)((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g)) add(m[1], m[2], m[3], m[0]);
  for (const m of title.matchAll(/(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/g)) add(m[1], m[2], m[3], m[0]);
  for (const m of title.matchAll(/(?<![\d/-])(\d{1,2})[-/](\d{1,2})[-/]((?:19|20)\d{2})(?!\d)/g)) {
    const first = Number(m[1]), second = Number(m[2]);
    if (first > 12 && second <= 12) add(m[3], second, first, m[0]);
    else if ((second > 12 && first <= 12) || first === second) add(m[3], first, second, m[0]);
  }
  return new Set(candidates.map(value => value.date)).size === 1 ? candidates[0] : { date: null, dateEvidence: null };
}

async function fetchListing(url, fetchImpl, signal) {
  // Redirects fail closed: even an unexpected redirect on this host must be reviewed.
  const response = await fetchImpl(url, { redirect: 'error', signal, headers: {
    'User-Agent': 'BhanteGDhammaLibrary/1.0 (public archive metadata)',
    Accept: 'text/html',
  } });
  if (!response.ok || (response.url && listingUrl(response.url) !== url)) throw new Error('An archive listing could not be loaded.');
  if (response.headers.get('content-type') && !/\btext\/html\b/i.test(response.headers.get('content-type'))) throw new Error('The archive returned an unexpected document type.');
  if (Number(response.headers.get('content-length')) > MAX_PAGE_BYTES) throw new Error('An archive listing exceeded the size limit.');
  if (!response.body) throw new Error('An archive listing was empty.');
  const reader = response.body.getReader();
  const parts = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PAGE_BYTES) throw new Error('An archive listing exceeded the size limit.');
      parts.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
  const html = new TextDecoder('utf-8', { fatal: true }).decode(body);
  return { ...parseListing(html), html };
}

export async function crawlArchive({ fetchImpl = fetch, timeoutMs = CRAWL_TIMEOUT_MS, now = () => Date.now() } = {}) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
    controller.abort();
    reject(new Error('The archive refresh timed out.'));
  }, Math.min(timeoutMs, CRAWL_TIMEOUT_MS)); });
  try {
    return await Promise.race([crawl(), timeout]);
  } finally { clearTimeout(timer); controller.abort(); }

  async function crawl() {
    const first = await fetchListing(SOURCE_URL, fetchImpl, controller.signal);
    const categories = new Map();
    for (const link of first.links.filter(link => link.vertical)) {
      const url = listingUrl(link.href);
      const stem = url && listingStem(url);
      if (!stem || stem === 'all' || NON_VIDEO_SECTIONS.has(stem)) continue;
      if (!link.label || link.label.length > 120 || !categoryId(stem)) throw new Error('The archive category navigation is invalid.');
      const category = { id: categoryId(stem), label: link.label, sourceUrl: url };
      const prior = categories.get(stem);
      if (prior && (prior.label !== category.label || prior.sourceUrl !== category.sourceUrl)) throw new Error('The archive category navigation is inconsistent.');
      categories.set(stem, category);
    }
    if (!categories.size || categories.size > 40 || new Set([...categories.values()].map(category => category.id)).size !== categories.size) throw new Error('The archive categories could not be validated.');
    const allowed = new Set(['all', ...categories.keys()]);
    const pages = new Map([[SOURCE_URL, first]]);
    const discovered = new Set([SOURCE_URL]);
    const pending = [];
    function discover(url, page) {
      for (const link of page.links) {
        const linked = listingUrl(link.href, url);
        if (linked && allowed.has(listingStem(linked)) && !discovered.has(linked)) {
          discovered.add(linked);
          if (discovered.size > MAX_PAGES) throw new Error('The archive exceeded the listing page limit.');
          pending.push(linked);
        }
      }
    }
    discover(SOURCE_URL, first);
    while (pending.length) {
      controller.signal.throwIfAborted();
      const batch = pending.splice(0, 3);
      const fetched = await Promise.all(batch.map(async url => [url, await fetchListing(url, fetchImpl, controller.signal)]));
      for (const [url, page] of fetched) { pages.set(url, page); discover(url, page); }
    }
    const records = new Map();
    const orderedPages = [...pages].sort(([a], [b]) => Number(listingStem(a) !== 'all') - Number(listingStem(b) !== 'all') || a.localeCompare(b));
    for (const [url, page] of orderedPages) {
      const stem = listingStem(url);
      if (!page.rows.length) throw new Error('An archive listing contains no talks.');
      for (const { id, cells } of page.rows) {
        const originalTitle = cells[0];
        if (!records.has(id)) records.set(id, {
          id, videoId: id, title: originalTitle, originalTitle,
          url: `https://www.youtube.com/watch?v=${id}`, sourceUrls: [], topicIds: [], categoryLabels: [],
          ...dateFromTitle(originalTitle, new Date(now()).getUTCFullYear()), sourceRecords: [],
        });
        if (records.size > MAX_TALKS) throw new Error('The archive exceeded the talk limit.');
        const talk = records.get(id);
        if (!talk.sourceUrls.includes(url)) talk.sourceUrls.push(url);
        const sourceRecord = { url };
        if (/^\d+$/.test(cells[1] || '') && Number.isSafeInteger(Number(cells[1]))) sourceRecord.recordNumber = Number(cells[1]);
        talk.sourceRecords.push(sourceRecord);
        if (originalTitle !== talk.originalTitle) {
          talk.alternateSourceTitles ||= [];
          if (!talk.alternateSourceTitles.includes(originalTitle)) talk.alternateSourceTitles.push(originalTitle);
        }
        if (stem !== 'all' && !talk.topicIds.includes(categories.get(stem).id)) {
          talk.topicIds.push(categories.get(stem).id);
          talk.categoryLabels.push(categories.get(stem).label);
        }
      }
    }
    const talks = [...records.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || a.id.localeCompare(b.id));
    const categoryList = [...categories].map(([stem, category]) => ({ ...category,
      count: talks.filter(talk => talk.topicIds.includes(category.id)).length,
      pageCount: [...pages.keys()].filter(url => listingStem(url) === stem).length,
    }));
    const catalog = {
      schemaVersion: 1,
      metadata: {
        fetchedAt: new Date(now()).toISOString(), sourceName: SOURCE_NAME, sourceUrl: SOURCE_URL,
        sourceGeneratedLabel: first.html.match(/This website was generated\s+([^<]+?)\./)?.[1] || null,
        currentChannelUrl: 'https://www.youtube.com/@BhavanasocietyOrg/videos',
        categoryMeaning: "Membership in the source archive's categories; not verified discussion topics.",
        dateMeaning: 'Unambiguous dates explicitly written in source titles; unknown dates are null.',
        contentScope: 'Public listing metadata only. No audio, video, or transcripts downloaded.',
        sourceRightsNotice: 'These talks are free to use for by anyone except for commerical purposes',
        talkCount: talks.length, datedTalkCount: talks.filter(talk => talk.date !== null).length,
        allPageCount: [...pages.keys()].filter(url => listingStem(url) === 'all').length,
        fetchedPageCount: pages.size, sourcePages: [...pages.keys()].sort(),
      },
      categories: categoryList, talks,
    };
    validateCatalog(catalog);
    return catalog;
  }
}

export function validateCatalog(catalog) {
  const fail = () => { throw new Error('The archive catalog could not be validated.'); };
  if (catalog?.schemaVersion !== 1 || !catalog.metadata || !Array.isArray(catalog.categories) || !Array.isArray(catalog.talks)) fail();
  const { metadata, categories, talks } = catalog;
  if (metadata.sourceUrl !== SOURCE_URL || !Number.isFinite(Date.parse(metadata.fetchedAt)) || !talks.length || talks.length > MAX_TALKS || !categories.length || categories.length > 40) fail();
  if (!Array.isArray(metadata.sourcePages) || !metadata.sourcePages.length || metadata.sourcePages.length > MAX_PAGES || new Set(metadata.sourcePages).size !== metadata.sourcePages.length || metadata.sourcePages.some(url => listingUrl(url) !== url)) fail();
  const pageSet = new Set(metadata.sourcePages);
  const categoryMap = new Map();
  for (const category of categories) {
    if (!category || typeof category.id !== 'string' || !category.id || categoryMap.has(category.id) || typeof category.label !== 'string' || !category.label.trim() || category.label.length > 120 || listingUrl(category.sourceUrl) !== category.sourceUrl || category.id !== categoryId(listingStem(category.sourceUrl)) || !pageSet.has(category.sourceUrl) || !Number.isSafeInteger(category.count) || category.count < 0 || !Number.isSafeInteger(category.pageCount) || category.pageCount < 1) fail();
    categoryMap.set(category.id, category);
  }
  const ids = new Set();
  for (const talk of talks) {
    if (!talk || !VIDEO_ID.test(talk.videoId) || talk.id !== talk.videoId || ids.has(talk.id) || typeof talk.title !== 'string' || !talk.title.trim() || talk.title.length > 2_000 || talk.originalTitle !== talk.title || talk.url !== `https://www.youtube.com/watch?v=${talk.videoId}`) fail();
    if (!Array.isArray(talk.topicIds) || new Set(talk.topicIds).size !== talk.topicIds.length || talk.topicIds.some(id => !categoryMap.has(id)) || !Array.isArray(talk.categoryLabels) || talk.categoryLabels.length !== talk.topicIds.length || talk.categoryLabels.some((label, index) => categoryMap.get(talk.topicIds[index]).label !== label)) fail();
    if (!Array.isArray(talk.sourceUrls) || !talk.sourceUrls.length || talk.sourceUrls.some(url => !pageSet.has(url)) || !Array.isArray(talk.sourceRecords) || !talk.sourceRecords.length || talk.sourceRecords.some(record => !record || !talk.sourceUrls.includes(record.url) || (record.recordNumber !== undefined && (!Number.isSafeInteger(record.recordNumber) || record.recordNumber < 0)))) fail();
    const parsed = dateFromTitle(talk.originalTitle);
    if (talk.date !== parsed.date || talk.dateEvidence !== parsed.dateEvidence) fail();
    ids.add(talk.id);
  }
  if (metadata.talkCount !== talks.length || metadata.datedTalkCount !== talks.filter(talk => talk.date !== null).length || metadata.fetchedPageCount !== pageSet.size || metadata.allPageCount !== [...pageSet].filter(url => listingStem(url) === 'all').length || !pageSet.has(SOURCE_URL)) fail();
  for (const category of categories) if (category.count !== talks.filter(talk => talk.topicIds.includes(category.id)).length || category.pageCount !== [...pageSet].filter(url => categoryId(listingStem(url)) === category.id).length) fail();
  return catalog;
}
