// Public metadata only. No authentication token belongs in this browser module.
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const safeRepo = repo => { if (!REPOSITORY.test(repo)) throw new Error('The contribution repository is not configured.'); return repo; };
export function claimVideoId(issue) {
  if (issue.state !== 'open' || issue.pull_request) return null;
  const title = String(issue.title ?? '').match(/^\[Talk claim\]\s+([A-Za-z0-9_-]{11})\s*$/);
  const field = String(issue.body ?? '').match(/(?:^|\n)### YouTube video ID\s*\n+\s*([A-Za-z0-9_-]{11})\s*(?:\n|$)/);
  if (!title || (field && title[1] !== field[1])) return null;
  return title[1];
}
export function claimUrl(repo, video) {
  safeRepo(repo); if (!VIDEO_ID.test(video.youtubeId)) throw new Error('Invalid video ID.');
  const query = new URLSearchParams({template:'talk-claim.yml',title:`[Talk claim] ${video.youtubeId}`,'youtube-id':video.youtubeId,'video-link':`https://www.youtube.com/watch?v=${video.youtubeId}`,'video-title':String(video.title).slice(0,180)});
  return `https://github.com/${repo}/issues/new?${query}`;
}
export function groupClaims(issues,repo) {
  safeRepo(repo); const grouped = new Map();
  for (const issue of issues) {
    const id = claimVideoId(issue);
    if (!id || !Number.isSafeInteger(issue.number) || issue.number < 1 || !/^[A-Za-z0-9-]+$/.test(issue.user?.login ?? '')) continue;
    const item={number:issue.number,owner:issue.user.login,createdAt:issue.created_at,url:`https://github.com/${repo}/issues/${issue.number}`};
    if (!grouped.has(id)) grouped.set(id,[]); grouped.get(id).push(item);
  }
  for (const claims of grouped.values()) claims.sort((a,b)=>a.number-b.number);
  return grouped;
}
export function queueRows(catalog, library, live = null, reviews = []) {
  const records = new Map(library.map(t=>[t.youtubeId,t]));
  const decisions = new Map(reviews.map(r=>[r.youtubeId,r]));
  return catalog.videos.map(video => {
    const decision=decisions.get(video.youtubeId);
    const item={...video,...(decision ? {classification:decision.decision,type:decision.type || video.type,reason:decision.reason,duplicateOf:decision.duplicateOf} : {})};
    const record=records.get(video.youtubeId), prs=live?.reviews.get(video.youtubeId) || [], claims=live?.claims.get(video.youtubeId) || [];
    let state=record ? (record.published ? 'published' : 'draft') : prs.length ? 'in-review' : item.classification==='excluded' ? 'excluded' : claims.length ? 'claimed' : item.classification==='eligible' ? 'available' : 'needs-review';
    return {...item,...(record?.published ? {type:record.type || item.type,reason:'This talk already has a summary in the library.'} : {}),state,record,prs,claim:claims[0] ?? null,claimCount:claims.length,canClaim:!!live && catalog.complete !== false && ['available','needs-review'].includes(state)};
  }).sort((a,b)=>(b.date||b.approximateDate||'').localeCompare(a.date||a.approximateDate||'') || a.youtubeId.localeCompare(b.youtubeId));
}
export function selectQueue(rows,{q='',status='available',type='all',page=1}={}) {
  const words=normalize(q).trim().split(/\s+/).filter(Boolean);
  const matches=rows.filter(row=>(status==='all' || row.state===status) && (type==='all' || row.type===type) && words.every(w=>normalize([row.title,row.reason,row.youtubeId,row.type,row.claim?.owner].join(' ')).includes(w)));
  const pages=Math.max(1,Math.ceil(matches.length/12)); const current=Math.min(pages,Math.max(1,Math.floor(Number(page)||1)));
  return {items:matches.slice((current-1)*12,current*12),total:matches.length,page:current,pages};
}
export async function githubJson(path,{signal}={}) {
  if (!/^\/repos\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\//.test(path) || path.includes('..')) throw new Error('Invalid GitHub request.');
  const response=await fetch(`https://api.github.com${path}`,{headers:{Accept:'application/vnd.github+json'},credentials:'omit',cache:'no-store',signal});
  if (!response.ok) throw new Error(response.status===403 || response.status===429 ? 'GitHub is limiting requests. Try again later, or check the claims on GitHub.' : 'GitHub could not provide the current contribution status.');
  return response.json();
}
export async function allPages(path,get) {
  const all=[]; let page=1;
  while (page<=50) {
    const values=await get(`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);
    if (!Array.isArray(values)) throw new Error('GitHub returned an incomplete list.');
    all.push(...values); if (values.length<100) return all; page++;
  }
  throw new Error('The contribution list is too large to check completely. Ask the owner to review it.');
}
function parseBlob(blob) {
  if (blob.encoding!=='base64' || typeof blob.content!=='string' || blob.size>1000000) throw new Error('A contribution record could not be read.');
  let entry;try {entry=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));} catch {throw new Error('A contribution contains invalid JSON; status cannot be confirmed yet.');}
  if (!VIDEO_ID.test(entry.youtubeId) || typeof entry.published!=='boolean') throw new Error('A contribution contains an invalid video ID or publication flag.');
  return entry;
}
async function mapLimit(items,fn) {
  const results=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(next<items.length){const i=next++;results[i]=await fn(items[i]);}}));
  return results;
}
export async function loadContributionState(repo,baseline,get=githubJson) {
  safeRepo(repo);const api=`/repos/${repo}`;
  const [tree,issues,pulls]=await Promise.all([get(`${api}/git/trees/main?recursive=1`),allPages(`${api}/issues?state=open`,get),allPages(`${api}/pulls?state=open`,get)]);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('The library inventory is incomplete.');
  const known=new Map(baseline.map(t=>[t.path,t]));
  const files=tree.tree.filter(f=>f.type==='blob' && /^content\/talks\/[^/]+\.json$/.test(f.path));
  const library=await mapLimit(files,async file=>{
    const existing=known.get(file.path);
    if (existing?.blobSha===file.sha) return existing;
    if (!/^[a-f0-9]{40,64}$/.test(file.sha)) throw new Error('Invalid library revision.');
    const entry=parseBlob(await get(`${api}/git/blobs/${file.sha}`));
    return {youtubeId:entry.youtubeId,published:entry.published,path:file.path,blobSha:file.sha,...(entry.published ? {id:entry.id,title:entry.title,type:entry.type} : {})};
  });
  const reviews=new Map();
  await mapLimit(pulls,async pr=>{
    if (!Number.isSafeInteger(pr.number) || pr.number < 1 || !REPOSITORY.test(pr.head?.repo?.full_name || '')) throw new Error('A pending contribution could not be checked.');
    const changed=await allPages(`${api}/pulls/${pr.number}/files`,get);
    // GitHub caps this endpoint at 3,000 files; never silently accept a partial response.
    if (!Number.isInteger(pr.changed_files)) {
      const detail=await get(`${api}/pulls/${pr.number}`);
      if (!Number.isInteger(detail.changed_files) || detail.changed_files!==changed.length || changed.length>=3000) throw new Error('A pending contribution file list is incomplete.');
    } else if (pr.changed_files!==changed.length || changed.length>=3000) throw new Error('A pending contribution file list is incomplete.');
    for (const file of changed.filter(f=>f.status!=='removed' && /^content\/talks\/[^/]+\.json$/.test(f.filename))) {
      if (!/^[a-f0-9]{40,64}$/.test(file.sha)) throw new Error('Invalid contribution revision.');
      const record=parseBlob(await get(`/repos/${pr.head.repo.full_name}/git/blobs/${file.sha}`));
      if (!reviews.has(record.youtubeId)) reviews.set(record.youtubeId,[]);
      reviews.get(record.youtubeId).push({number:pr.number,owner:pr.user?.login || 'contributor',url:`https://github.com/${repo}/pull/${pr.number}`});
    }
  });
  return {library,claims:groupClaims(issues,repo),reviews,checkedAt:new Date().toISOString()};
}
