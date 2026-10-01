import { BOOK_VIEWER, bookViewHash, popoutUrl } from './book-view.js';

const reader = document.querySelector('[data-book-reader]');
if (reader) {
  const frame = reader.querySelector('iframe');
  const status = reader.querySelector('[data-reader-status]');
  const popout = reader.querySelector('[data-book-popout]');
  const standalone = document.body.classList.contains('book-page');
  let started = false, timer, opener, currentHash = bookViewHash(standalone ? location.hash : '');
  function open(event) {
    if (event?.metaKey || event?.ctrlKey || event?.shiftKey || event?.altKey) return;
    event?.preventDefault();
    if (event) opener = event.currentTarget;
    reader.hidden = false;
    document.querySelectorAll('[data-open-book]').forEach(link => link.setAttribute('aria-expanded','true'));
    if (!started) {
      started = true;
      status.textContent = 'Loading the book…';
      frame.src = BOOK_VIEWER + currentHash;
      timer = setTimeout(() => { status.textContent = 'Still loading. You can also open or download the PDF below.'; },20000);
    }
    if (!standalone && event) {
      reader.scrollIntoView({behavior:'instant',block:'start'});
      reader.querySelector('[data-reader-heading]').focus({preventScroll:true});
    }
  }
  document.querySelectorAll('[data-open-book]').forEach(link => {
    link.setAttribute('aria-controls','book-reader'); link.setAttribute('aria-expanded','false');
    link.addEventListener('click',open);
  });
  reader.querySelector('[data-close-reader]')?.addEventListener('click',() => {
    reader.hidden = true;
    document.querySelectorAll('[data-open-book]').forEach(link => link.setAttribute('aria-expanded','false'));
    opener?.focus();
  });
  window.addEventListener('message',event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.source !== 'dhamma-book-reader') return;
    const message = event.data;
    if (message.kind === 'error') {
      clearTimeout(timer); status.textContent = 'The reader could not load the book. Open or download the PDF below.';
    } else if (message.kind === 'location') {
      clearTimeout(timer);
      currentHash = bookViewHash(message.hash);
      if (popout) popout.href = popoutUrl(currentHash);
      if (Number.isSafeInteger(message.pages) && message.pages > 0) status.textContent = `${message.pages} pages · Use the arrows or enter a page number`;
      if (standalone && location.hash !== currentHash) history.replaceState(null,'',currentHash);
    }
  });
  if (standalone) {
    open();
    window.addEventListener('hashchange',() => {
      currentHash = bookViewHash(location.hash);
      frame.contentWindow.postMessage({source:'dhamma-book-host',hash:currentHash},location.origin);
    });
  }
}
