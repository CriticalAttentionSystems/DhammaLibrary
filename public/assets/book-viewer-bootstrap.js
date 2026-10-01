// Loaded before the vendored viewer modules. Keep custom behavior outside PDF.js.
(() => {
  let eventDocument = document;
  try { eventDocument = parent.document; } catch {}
  eventDocument.addEventListener('webviewerloaded', function configure(event) {
    if (event.detail?.source !== window) return;
    eventDocument.removeEventListener('webviewerloaded',configure);
    const options = window.PDFViewerApplicationOptions;
    options.setAll({
      defaultUrl:'/assets/books/Anapanasati_manuscript.pdf',
      disablePreferences:true, viewOnLoad:1, disableHistory:true,
      scrollModeOnLoad:3, spreadModeOnLoad:0, sidebarViewOnLoad:0,
      defaultZoomValue:'page-fit', viewerCssTheme:1, toolbarDensity:2,
      annotationEditorMode:-1, enableScripting:false,
      enableAltTextModelDownload:false, enableGuessAltText:false,
      externalLinkTarget:2, enablePrintAutoRotate:true
    });
    const app = window.PDFViewerApplication;
    app.initializedPromise.then(() => {
      const notify = (kind,details = {}) => {
        if (parent !== window) parent.postMessage({source:'dhamma-book-reader',kind,...details},location.origin);
      };
      app.eventBus.on('updateviewarea',event => notify('location',{
        hash:event.location.pdfOpenParams,pages:app.pdfDocument?.numPages
      }));
      app.eventBus.on('documenterror',() => notify('error'));
      window.addEventListener('message',event => {
        if (event.origin !== location.origin || event.source !== parent || event.data?.source !== 'dhamma-book-host') return;
        if (typeof event.data.hash === 'string' && /^#page=\d+&zoom=[\w.,-]+$/.test(event.data.hash)) app.pdfLinkService.setHash(event.data.hash.slice(1));
      });
    });
  });
})();
