import { escapeHtml as e, queueRows, selectQueue, claimUrl, loadContributionState, githubJson } from './contribution-state.js';

const data = JSON.parse(document.getElementById('contribution-data').textContent);
const el = id => document.getElementById(`queue-${id}`);
const labels = {available:'Available',claimed:'Claimed','in-review':'In review',published:'Published','needs-review':'Needs review',excluded:'Excluded',draft:'Draft'};
const filters = {q:'',status:'available',type:'all',page:1};
let live=null, busy=false, checked=0, rows=[];
const dateLabel = date => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}) : 'Date needs review';
const duration = seconds => Number.isFinite(seconds) && seconds>0 ? `${Math.round(seconds/60)} min` : '';
const watch = row => `https://www.youtube.com/watch?v=${row.youtubeId}`;
function rowHtml(row) {
  const unconfirmed = !live && ['available','claimed','in-review'].includes(row.state);
  const status = unconfirmed ? 'Check needed' : labels[row.state];
  let action='';
  if (row.state==='published' && /^[a-z0-9][a-z0-9-]*$/.test(row.record?.id || '')) action=`<a class="button" href="/talks/${e(row.record.id)}/">Read summary</a>`;
  else if (row.prs.length) action=row.prs.map(pr=>`<a class="button" href="${e(pr.url)}" target="_blank" rel="noopener">Review submission #${pr.number} ↗</a>`).join('');
  else if (row.claim) action=`<a class="button" href="${e(row.claim.url)}" target="_blank" rel="noopener">View reservation ↗</a>`;
  else if (['available','needs-review'].includes(row.state)) action=`<button class="button primary" type="button" data-claim="${e(row.youtubeId)}" ${!row.canClaim || busy ? 'disabled' : ''}>${row.state==='needs-review' ? 'Reserve for review' : 'Reserve this talk'}</button>`;
  const owner=row.claim ? `Reserved by ${row.claim.owner}${row.claimCount>1 ? ` · ${row.claimCount} requests; earliest has priority` : ''}` : row.prs.length ? `Submitted by ${row.prs.map(pr=>pr.owner).join(', ')}` : '';
  return `<article class="queue-row"><div class="queue-row-main"><div class="queue-meta"><span title="${e(row.dateSource || 'Unverified date')}">Posted / broadcast ${e(dateLabel(row.date))}</span><span>${e(row.type || 'Type to confirm')}</span><span>${e(duration(row.durationSeconds))}</span></div><h2 class="queue-title"><a href="${watch(row)}" target="_blank" rel="noopener">${e(row.record?.title || row.title)}</a></h2><p class="queue-note">${e(row.reason)}</p>${row.duplicateOf ? `<p class="queue-note">Another recording of <a href="https://www.youtube.com/watch?v=${e(row.duplicateOf)}" target="_blank" rel="noopener">this talk ↗</a>.</p>` : ''}<div class="queue-status"><span class="queue-badge" data-state="${unconfirmed ? 'needs-review' : row.state}">${status}</span>${owner ? `<span class="queue-owner">${e(owner)}</span>` : ''}<span class="queue-owner">${e(row.youtubeId)}</span></div></div><div class="queue-actions">${action}<a href="${watch(row)}" target="_blank" rel="noopener">Watch on YouTube ↗</a></div></article>`;
}
function render() {
  rows=queueRows(data.catalog,live?.library || data.library,live,data.reviews);
  const result=selectQueue(rows,filters); filters.page=result.page;
  el('results').innerHTML=result.items.map(rowHtml).join('');
  el('empty').hidden=!!result.total;
  const counts=Object.fromEntries(Object.keys(labels).map(state=>[state,rows.filter(r=>r.state===state).length]));
  el('summary').textContent=`${result.total} ${result.total===1 ? 'video' : 'videos'} in this view · ${counts.published} published · ${counts['needs-review']} need identification${!live ? ' · Reservations not yet confirmed' : ''}`;
  el('page').textContent=`Page ${result.page} of ${result.pages}`;
  el('previous').disabled=result.page===1; el('next').disabled=result.page===result.pages;
  el('refresh').disabled=busy; el('refresh').textContent=busy ? 'Checking…' : 'Check contributions';
}
function status(text,state='') { el('live-status').textContent=text; el('live-status').dataset.state=state; }
async function refresh() {
  if (busy) return false;
  busy=true;live=null; render();status('Checking published talks, reservations, and submissions on GitHub…');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),30000);
  try {
    live=await loadContributionState(data.repository,data.library,path=>githubJson(path,{signal:controller.signal}));
    checked=Date.now();
    if (data.catalog.complete) status(`Contributions checked at ${new Date(checked).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}. Reserve a talk before preparing it.`);
    else status('Contributions checked. The channel scan is incomplete; reservations remain disabled until the owner refreshes it.','warning');
    return true;
  } catch(error) {
    status(`${error.name==='AbortError' ? 'The contribution check timed out.' : error.message} Reservations are disabled until a complete check succeeds.`,'error');
    return false;
  } finally { clearTimeout(timer);busy=false;render(); }
}
const dialog=document.createElement('dialog');
dialog.className='queue-claim-dialog';dialog.setAttribute('aria-labelledby','claim-title');
dialog.innerHTML='<button type="button" class="button" data-close>Close</button><h2 id="claim-title">Reserve this talk</h2><p id="claim-talk"></p><p>Submit the reservation form on GitHub, then return here and choose <strong>Check contributions</strong>. Begin only when your GitHub name appears as the claimant. The earliest open request has priority.</p><a class="button primary" id="claim-form" target="_blank" rel="noopener">Open reservation form ↗</a>';
document.body.append(dialog);
dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
el('results').addEventListener('click',async event=>{
  const button=event.target.closest('[data-claim]');if(!button || busy) return;
  const id=button.dataset.claim;
  // Refresh immediately before offering the form; reservations themselves are created by the user on GitHub.
  if (!await refresh()) return;
  const row=rows.find(r=>r.youtubeId===id);
  if (!row?.canClaim) {status('This talk now has a reservation, submission, or library entry. The list has been updated.','warning');return;}
  dialog.querySelector('#claim-talk').textContent=row.title;
  dialog.querySelector('#claim-form').href=claimUrl(data.repository,row);
  dialog.showModal();
});
el('refresh').addEventListener('click',()=>refresh());
for (const [id,key,event] of [['search','q','input'],['status','status','change'],['type','type','change']]) el(id).addEventListener(event,()=>{filters[key]=el(id).value;filters.page=1;render();});
for (const [id,step] of [['previous',-1],['next',1]]) el(id).addEventListener('click',()=>{filters.page+=step;render();el('summary').scrollIntoView({block:'start',behavior:'smooth'});});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && Date.now()-checked>60000 && !busy) refresh();});
const scope=data.catalog.scope;
el('range').textContent=scope ? `${dateLabel(scope.since)} – ${dateLabel(scope.until)}` : 'No scan available';
document.querySelector('.queue-scope>p').textContent=`Bhavana Society · Bhante G${scope ? ` · ${scope.months}-month scan` : ''}`;
el('scan').textContent=data.catalog.checkedAt ? `Channel scanned ${dateLabel(data.catalog.checkedAt.slice(0,10))}${data.catalog.complete ? '' : ' · Incomplete'}` : 'Run a channel scan to begin';
const note=document.createElement('p');note.className='queue-help';note.textContent='Dates are YouTube posting or broadcast dates; older talks may be uploaded again. Check the recording before preparing a summary. Generic titles need a person to identify the teacher and subject.';
el('scan').closest('.queue-scope').after(note);
if (!data.catalog.complete) status('The channel scan is incomplete. Reservations are disabled until the owner refreshes it.','warning');
render();refresh();
