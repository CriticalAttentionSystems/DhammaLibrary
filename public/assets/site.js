(() => {
  const rows = [...document.querySelectorAll('.talk-row')];
  const filters = [...document.querySelectorAll('[data-filter]')];
  const search = document.querySelector('#talk-search');
  const dialog = document.querySelector('#summary-dialog');
  let type = 'all', data, opener;
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function filter() {
    const query = normalize(search.value.trim());
    let visible = 0;
    for (const row of rows) {
      row.hidden = !(type === 'all' || row.dataset.type === type) || !normalize(row.textContent).includes(query);
      if (!row.hidden) visible++;
    }
    document.querySelector('#result-count').textContent = visible + (visible === 1 ? ' talk' : ' talks') + (query || type !== 'all' ? ' found' : ' in the collection');
    document.querySelector('#empty-state').hidden = visible !== 0;
  }
  filters.forEach(button => button.addEventListener('click', () => {
    type = button.dataset.filter;
    filters.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    filter();
  }));
  search?.addEventListener('input', filter);
  async function loadTalks() {
    if (!data) {
      const response = await fetch('/data/talks.json');
      if (!response.ok) throw new Error('Could not load summaries');
      data = await response.json();
    }
    return data;
  }
  document.querySelectorAll('[data-summary]').forEach(link => link.addEventListener('click', async event => {
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
  }));
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
