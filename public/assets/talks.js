// Shared by the static build and the browser so the two views stay consistent.
export const PAGE_SIZE = 10;
const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

export function latestTalks(talks) {
  return talks.filter(talk => talk.published).sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, PAGE_SIZE);
}

export function readFilters(search = '', pathname = '/talks/') {
  const params = new URLSearchParams(search);
  const page = params.get('page') ?? pathname.match(/^\/talks\/page\/(\d+)\/?$/)?.[1] ?? '1';
  return {
    q: (params.get('q') || '').trim(),
    from: validDate(params.get('from')) ? params.get('from') : '',
    to: validDate(params.get('to')) ? params.get('to') : '',
    type: ['Dhamma talk','Q&A'].includes(params.get('type')) ? params.get('type') : 'all',
    page: /^\d+$/.test(page) && Number.isSafeInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1
  };
}

export function selectTalks(talks, filters) {
  const invalidRange = !!(filters.from && filters.to && filters.from > filters.to);
  const words = normalize(filters.q || '').split(/\s+/).filter(Boolean);
  const matched = invalidRange ? [] : talks.filter(talk => talk.published &&
    (!filters.from || talk.date >= filters.from) && (!filters.to || talk.date <= filters.to) &&
    (filters.type === 'all' || talk.type === filters.type) &&
    words.every(word => normalize([talk.title,talk.originalTitle,talk.brief,talk.summaryMarkdown,...talk.topics].join(' ')).includes(word))
  ).sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const page = Math.max(1, Math.min(Number.isSafeInteger(filters.page) ? filters.page : 1, pages));
  const start = (page - 1) * PAGE_SIZE;
  return {items:matched.slice(start,start + PAGE_SIZE),total:matched.length,page,pages,start,invalidRange};
}

export function archiveUrl(filters) {
  const params = new URLSearchParams();
  for (const key of ['q','from','to']) if (filters[key]) params.set(key, filters[key]);
  if (filters.type !== 'all' && filters.type) params.set('type',filters.type);
  // Unfiltered links also work without JavaScript.
  if (!params.size) return filters.page > 1 ? `/talks/page/${filters.page}/` : '/talks/';
  if (filters.page > 1) params.set('page',String(filters.page));
  return '/talks/?' + params;
}

export function talkRow(talk) {
  const e = escape;
  const duration = `${Math.floor(talk.durationSeconds/60)}:${String(talk.durationSeconds%60).padStart(2,'0')}`;
  return `<article class="talk-row" data-type="${e(talk.type)}">
    <div class="talk-source"><a class="thumbnail" href="${e(talk.url)}" target="_blank" rel="noopener" aria-label="Watch ${e(talk.title)}">${talk.thumbnailUrl ? `<img src="${e(talk.thumbnailUrl)}" width="320" height="180" loading="lazy" alt="">` : ''}<span class="duration">${duration}</span></a>
    <div><p class="talk-meta"><span class="talk-kind">${e(talk.type)}</span><time datetime="${e(talk.date)}">${e(talk.dateLabel)}</time></p><h3><a href="${e(talk.url)}" target="_blank" rel="noopener">${e(talk.title)}</a></h3><a class="watch-link" href="${e(talk.url)}" target="_blank" rel="noopener">Watch on YouTube ↗</a></div></div>
    <div class="talk-brief"><p>${e(talk.brief)}</p><div class="row-footer"><a class="summary-button" href="${e(talk.readingUrl)}" data-summary="${e(talk.id)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3h12v14H4zM7 7h6M7 10h6M7 13h4"/></svg> Read full summary</a><span class="topic-list">${talk.topics.map(e).join(' · ')}</span></div></div>
  </article>`;
}

export function pagination(result, filters) {
  if (result.pages < 2) return '';
  const link = (page,label,current=false) => `<a href="${escape(archiveUrl({...filters,page}))}" data-page="${page}"${current ? ' aria-current="page" aria-label="Page '+page+'"' : ''}>${label}</a>`;
  const numbers = [...new Set([1,result.page-1,result.page,result.page+1,result.pages])].filter(n => n >= 1 && n <= result.pages).sort((a,b)=>a-b);
  const links = numbers.map((n,i) => `${i && n > numbers[i-1]+1 ? '<span aria-hidden="true">…</span>' : ''}${link(n,n,n===result.page)}`).join('');
  return `<nav class="pagination" aria-label="Talk pages">${result.page>1 ? link(result.page-1,'← Previous') : '<span class="page-disabled">← Previous</span>'}<div class="page-numbers">${links}</div>${result.page<result.pages ? link(result.page+1,'Next →') : '<span class="page-disabled">Next →</span>'}</nav>`;
}
