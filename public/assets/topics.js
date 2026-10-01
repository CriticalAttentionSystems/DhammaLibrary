import {escapeHtml,fetchArchive,fetchSnapshot,friendlyName,newerCatalog,renderRecording,renderTopicCards,selectRecordings} from './topic-catalog.js';

const $ = id => document.getElementById(id);
let catalog,topic = 'all',search = '',format = 'all',page = 1;
let checking = false,refreshTimer,buttonTimer,lastStatus;
const dateLabel = value => new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
const savedLabel = () => catalog ? `Saved topic index from ${dateLabel(catalog.metadata.fetchedAt)}.` : '';

function renderTopics() {
  $('topic-directory').innerHTML = renderTopicCards(catalog);
  $('topics-loading').hidden = true;
  $('topics-error').hidden = true;
  $('topics-browse-all').hidden = false;
  const sourceDate = catalog.metadata.sourceGeneratedLabel ? ` Its footer dates the archive to ${escapeHtml(catalog.metadata.sourceGeneratedLabel)}.` : '';
  $('topics-catalog-credit').innerHTML = `Topic labels and links from the <a href="${escapeHtml(catalog.metadata.sourceUrl)}" target="_blank" rel="noopener noreferrer">Bhavana Society archive</a> · ${catalog.talks.length} distinct recordings.${sourceDate} Categories can overlap; recordings stay on YouTube.`;
}

function renderTalks() {
  const category = catalog.categories.find(category => category.id === topic);
  const results = selectRecordings(catalog,{topic,search,format,page});
  page = results.page;
  $('topics-title').textContent = category ? friendlyName(category) : 'All talks';
  $('topics-description').textContent = category ? 'Recordings listed under this subject in the Bhavana archive.' : 'Browse the complete archive index, with each recording listed once.';
  $('topics-original-category').href = category ? category.sourceUrl : catalog.metadata.sourceUrl;
  $('topics-original-category').textContent = category ? 'Original archive category ↗' : 'Original archive ↗';
  $('topics-result-count').textContent = `${results.total} ${results.total === 1 ? 'recording' : 'recordings'}${search || format !== 'all' ? ' matching your filters' : ''}`;
  $('topics-talk-list').innerHTML = results.items.map(talk => renderRecording(talk,catalog)).join('') || '<div class="topics-empty"><h3>No matching talk titles</h3><p>Try fewer words or clear the filters.</p></div>';
  $('topics-page-status').textContent = `Page ${page} of ${results.pages}`;
  $('topics-previous-page').disabled = page === 1;
  $('topics-next-page').disabled = page === results.pages;
}

function route(navigate = false) {
  if (!catalog) return;
  const match = location.hash.match(/^#talks\/([a-z0-9][a-z0-9-]{0,199})$/),nextTopic = match?.[1];
  const listing = !!match && (nextTopic === 'all' || catalog.categories.some(category => category.id === nextTopic));
  $('topics-view').hidden = listing;
  $('topics-talks-view').hidden = !listing;
  if (listing) {
    if (topic !== nextTopic) {
      search = ''; format = 'all'; page = 1;
      $('topics-search').value = ''; $('topics-format').value = 'all';
    }
    topic = nextTopic;
    renderTalks();
    document.title = `${$('topics-title').textContent} · Dhamma Library`;
  } else document.title = 'Explore topics · Dhamma Library';
  if (navigate) {
    (listing ? $('topics-title') : $('topics-heading')).focus({preventScroll:true});
    window.scrollTo({top:0});
  }
}

function applyCatalog(incoming) {
  const selected = newerCatalog(catalog,incoming);
  if (selected === catalog) return;
  catalog = selected;
  renderTopics();
  // Reconcile refreshed results without changing the current query or moving focus.
  route();
}

function updateRefreshButton() {
  clearTimeout(buttonTimer);
  const wait = lastStatus?.refreshAllowedAt ? Date.parse(lastStatus.refreshAllowedAt)-Date.now() : 0;
  $('topics-refresh-button').disabled = checking || !!lastStatus?.refreshing || wait > 0;
  $('topics-refresh-button').textContent = checking || lastStatus?.refreshing ? 'Checking archive…' : 'Refresh archive';
  if (wait > 0) buttonTimer = setTimeout(updateRefreshButton,Math.min(wait+100,2147483647));
}

function showStatus(status) {
  lastStatus = status;
  if (status.refreshing) {
    $('topics-refresh-status').textContent = 'Checking the original archive. You can keep browsing.';
    refreshTimer = setTimeout(() => checkArchive(),3000);
  } else {
    const message = status.lastError ? `The archive check could not finish. ${savedLabel()}` : status.lastSuccess ? `Archive checked ${dateLabel(status.lastSuccess)}. Checks for updates when revisited after 24 hours.` : `${savedLabel()} A live archive check has not completed.`;
    const cooldown = status.refreshAllowedAt && Date.parse(status.refreshAllowedAt) > Date.now() ? ` Another manual check is available after ${dateLabel(status.refreshAllowedAt)}.` : '';
    $('topics-refresh-status').textContent = message + cooldown;
  }
}

async function checkArchive(method = 'GET') {
  if (checking) return;
  clearTimeout(refreshTimer);
  checking = true;
  updateRefreshButton();
  $('topics-refresh-status').textContent = `${savedLabel()} Checking the original archive. You can keep browsing.`.trim();
  try {
    const result = await fetchArchive(fetch,method);
    applyCatalog(result.catalog);
    showStatus(result.status);
  } catch {
    lastStatus = null;
    $('topics-refresh-status').textContent = `Could not check the original archive. ${savedLabel()}${catalog ? ' You can keep browsing and try again later.' : ' Try refreshing again later.'}`;
    if (!catalog) {
      $('topics-loading').hidden = true;
      $('topics-error').hidden = false;
      $('topics-error').textContent = 'The searchable index could not load. The topic links above still open the original archive.';
    }
  } finally {
    checking = false;
    updateRefreshButton();
  }
}

function clearFilters() {
  search = ''; format = 'all'; page = 1;
  $('topics-search').value = ''; $('topics-format').value = 'all';
  renderTalks();
}
$('topics-filters').addEventListener('submit',event => event.preventDefault());
$('topics-search').addEventListener('input',event => {search = event.target.value; page = 1; renderTalks();});
$('topics-format').addEventListener('change',event => {format = event.target.value; page = 1; renderTalks();});
$('topics-clear-search').addEventListener('click',clearFilters);
for (const [id,increment] of [['topics-previous-page',-1],['topics-next-page',1]]) {
  $(id).addEventListener('click',() => {page += increment; renderTalks(); $('topics-result-count').focus({preventScroll:true}); $('topics-result-count').scrollIntoView({block:'start'});});
}
$('topics-refresh-button').addEventListener('click',() => checkArchive('POST'));
window.addEventListener('hashchange',() => route(true));

async function start() {
  $('topics-loading').hidden = false;
  $('topics-refresh-button').hidden = false;
  $('topics-refresh-button').disabled = true;
  try {
    applyCatalog(await fetchSnapshot());
    $('topics-refresh-status').textContent = savedLabel();
  } catch {
    $('topics-refresh-status').textContent = 'The saved topic index could not load. Checking the original archive…';
  }
  await checkArchive();
}
start();
