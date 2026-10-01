export const BOOK_PDF = '/assets/books/Anapanasati_manuscript.pdf';
export const BOOK_VIEWER = '/assets/pdfjs/web/viewer.html';

// Accept only PDF location fields; never turn a message into an arbitrary URL.
export function bookViewHash(hash = '') {
  if (typeof hash !== 'string') hash = '';
  const params = new URLSearchParams(hash.replace(/^#/,''));
  const value = params.get('page');
  const page = /^\d+$/.test(value || '') && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 1;
  const zoom = params.get('zoom') || 'page-fit';
  const safeZoom = /^(?:auto|page-fit|page-width|page-actual|\d{1,4}(?:\.\d+)?)(?:,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?)?$/.test(zoom) ? zoom : 'page-fit';
  return `#page=${page}&zoom=${safeZoom}`;
}

export const popoutUrl = hash => '/book/' + bookViewHash(hash);
