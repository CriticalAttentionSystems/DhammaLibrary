import { readFilters, selectTalks, talkRow, pagination, archiveUrl } from './talks.js';

(() => {
  const dialog = document.querySelector('#summary-dialog');
  let data, pendingData, opener;
  async function loadTalks() {
    if (data) return data;
    if (pendingData) return pendingData;
    pendingData = (async () => {
      const response = await fetch('/data/talks.json');
      if (!response.ok) throw new Error('Could not load summaries');
      data = await response.json();
      return data;
    })();
    try { return await pendingData; } finally { pendingData = null; }
  }

  if (document.querySelector('[data-archive]')) {
    const $ = selector => document.querySelector(selector);
    const search = $('#talk-search'), from = $('#date-from'), to = $('#date-to');
    const typeButtons = [...document.querySelectorAll('[data-filter]')];
    let filters = readFilters(location.search, location.pathname);
    let ready = false;
    function render({historyMode = 'replace', scroll = false} = {}) {
      if (!ready) return;
      const result = selectTalks(data, filters);
      filters.page = result.page;
      $('#date-error').hidden = !result.invalidRange;
      from.setAttribute('aria-invalid',String(result.invalidRange));
      to.setAttribute('aria-invalid',String(result.invalidRange));
      typeButtons.forEach(button => button.setAttribute('aria-pressed',String(button.dataset.filter === filters.type)));
      $('#talk-list').innerHTML = result.items.map(talkRow).join('');
      $('#empty-state').hidden = result.total > 0 || result.invalidRange;
      const filtered = !!(filters.q || filters.from || filters.to || filters.type !== 'all');
      $('#clear-filters').hidden = !filtered;
      $('#result-count').textContent = `${result.total} ${result.total === 1 ? 'talk' : 'talks'}${filtered ? ' found' : ''} · Newest first`;
      $('#page-status').textContent = result.total ? `${result.start+1}–${result.start+result.items.length} of ${result.total} talks · Page ${result.page} of ${result.pages}` : '';
      $('#talk-pagination').innerHTML = pagination(result,filters);
      const url = archiveUrl(filters);
      document.title = `All talks${result.page > 1 ? ' · Page '+result.page : ''} · Dhamma Library`;
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) canonical.href = new URL(filtered ? '/talks/' : url,canonical.href).href;
      if (historyMode && url !== location.pathname + location.search) history[historyMode+'State'](null,'',url);
      if (scroll) {
        $('#talks-title').focus({preventScroll:true});
        $('#talks').scrollIntoView({behavior:'instant',block:'start'});
      }
    }
    function syncInputs() { search.value = filters.q; from.value = filters.from; to.value = filters.to; }
    function clear() {
      filters = readFilters(); syncInputs(); render(); search.focus();
    }
    async function startArchive() {
      $('#archive-error').hidden = true;
      try {
        await loadTalks(); ready = true;
        syncInputs(); render();
        $('#archive-search').hidden = false; $('#archive-types').hidden = false;
      } catch { $('#archive-error').hidden = false; }
    }
    for (const [input,key] of [[search,'q'],[from,'from'],[to,'to']]) input.addEventListener('input',() => {
      filters[key] = input.value; filters.page = 1; render();
    });
    $('#archive-search').addEventListener('submit',event => { event.preventDefault(); filters.page = 1; render(); });
    typeButtons.forEach(button => button.addEventListener('click',() => { filters.type = button.dataset.filter; filters.page = 1; render(); }));
    $('#clear-filters').addEventListener('click',clear);
    $('#reset-filters').addEventListener('click',clear);
    $('#retry-archive').addEventListener('click',startArchive);
    $('#talk-pagination').addEventListener('click',event => {
      const link = event.target.closest('[data-page]');
      if (!link || !ready || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); filters.page = Number(link.dataset.page); render({historyMode:'push',scroll:true});
    });
    window.addEventListener('popstate',() => { filters = readFilters(location.search,location.pathname); syncInputs(); render({historyMode:null}); });
    startArchive();
  }

  // Delegation keeps summary links working after search or pagination replaces rows.
  document.querySelector('#talk-list')?.addEventListener('click', async event => {
    const link = event.target.closest('[data-summary]');
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !dialog?.showModal) return;
    event.preventDefault();
    try {
      const talk = (await loadTalks()).find(item => item.id === link.dataset.summary);
      if (!talk) throw new Error('Missing summary');
      opener = link;
      document.querySelector('#dialog-title').textContent = talk.title;
      document.querySelector('#dialog-meta').textContent = `${talk.type} · ${talk.dateLabel}`;
      document.querySelector('#dialog-video').href = talk.url;
      document.querySelector('#dialog-permalink').href = talk.readingUrl;
      document.querySelector('#dialog-content').innerHTML = talk.summaryHtml;
      document.querySelector('#copy-link').dataset.url = talk.readingUrl;
      dialog.showModal(); dialog.scrollTop = 0; document.body.style.overflow = 'hidden';
      document.querySelector('#close-dialog').focus();
    } catch { window.location.assign(link.href); }
  });
  document.querySelector('#close-dialog')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog?.addEventListener('close', () => { document.body.style.overflow = ''; opener?.focus(); });
  document.querySelector('#copy-link')?.addEventListener('click', async event => {
    const address = new URL(event.currentTarget.dataset.url, location.origin).href;
    try { await navigator.clipboard.writeText(address); showToast('Link copied'); }
    catch { showToast('Use Open reading page to copy its address.'); }
  });
  let toastTimer;
  function showToast(message) {
    const toast = document.querySelector('#toast'); toast.textContent = message; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
  }
})();
