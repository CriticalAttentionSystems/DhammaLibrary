import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { BOOK_PDF, BOOK_VIEWER, bookViewHash, popoutUrl } from '../public/assets/book-view.js';

const project = new URL('../',import.meta.url);
const read = file => readFile(new URL(file,project),'utf8');
const [hostCode,bootstrapCode,home,standalone,viewer] = await Promise.all([
  'public/assets/book-reader.js','public/assets/book-viewer-bootstrap.js',
  'templates/index.html','public/book/index.html','public'+BOOK_VIEWER
].map(read));
const origin = 'https://library.example';

test('pop-out locations round-trip page, zoom, and PDF coordinates',() => {
  for (const hash of [
    '#page=1&zoom=page-fit', '#page=154&zoom=page-width',
    '#page=12&zoom=125.5,-20,764', '#page=8&zoom=auto,0,0',
    '#page=4&zoom=page-actual', '#page=90&zoom=75,10.25,-1.5'
  ]) {
    assert.equal(bookViewHash(hash),hash);
    const url = new URL(popoutUrl(hash),origin);
    assert.equal(url.origin,origin);
    assert.equal(url.pathname,'/book/');
    assert.equal(url.search,'');
    assert.equal(bookViewHash(url.hash),hash);
  }
  assert.equal(bookViewHash('zoom=page-width&page=0012'),'#page=12&zoom=page-width');
});

test('malformed page and zoom values fall back without accepting URL or PDF commands',() => {
  for (const page of ['','0','-1','1.5','NaN','Infinity','9007199254740992','12evil']) {
    assert.equal(bookViewHash('#page='+page),'#page=1&zoom=page-fit');
  }
  for (const zoom of ['javascript:alert(1)','https://evil.example/','page-fit,1','125,0,0,1','NaN','1e9','<img>']) {
    assert.equal(bookViewHash('#page=12&zoom='+encodeURIComponent(zoom)),'#page=12&zoom=page-fit');
  }
  assert.equal(bookViewHash('#page=12&zoom=150&file=https://evil.example/book.pdf&nameddest=Launch&search=private'),
    '#page=12&zoom=150');
  for (const hash of [undefined,null,123,{},[],true]) {
    assert.equal(bookViewHash(hash),'#page=1&zoom=page-fit');
  }
  assert.equal(new URL(popoutUrl('//evil.example/#page=12'),origin).origin,origin);
});

function eventTarget(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type,listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener); listeners.set(type,entries);
    },
    removeEventListener(type,listener) {
      listeners.set(type,(listeners.get(type) || []).filter(value => value !== listener));
    },
    dispatch(type,event = {}) { for (const listener of [...(listeners.get(type) || [])]) listener(event); }
  };
}

// Run the host against a small DOM boundary: network loading is represented by
// assigning iframe.src, while actual PDF rendering is covered in the browser.
function runHost({isStandalone = false,hash = ''} = {}) {
  const attributes = new Map(), loads = [], sent = [], replaced = [], timers = new Set();
  const link = eventTarget({setAttribute:(key,value) => attributes.set(key,value),focus(){}});
  const close = eventTarget();
  const status = {textContent:'Unopened'}, popout = {href:'/book/'};
  const frameWindow = {postMessage:(...args) => sent.push(args)};
  const reader = {hidden:!isStandalone,scrollIntoView(){},querySelector:selector => ({
    iframe:frame,'[data-reader-status]':status,'[data-book-popout]':popout,
    '[data-close-reader]':close,'[data-reader-heading]':{focus(){}}
  })[selector]};
  const frame = {contentWindow:frameWindow,set src(value) {
    assert.equal(reader.hidden,false,'reveal the reader before starting PDF.js');
    loads.push(value);
  }};
  const document = {
    body:{classList:{contains:value => value === 'book-page' && isStandalone}},
    querySelector:selector => selector === '[data-book-reader]' ? reader : null,
    querySelectorAll:selector => selector === '[data-open-book]' ? [link] : []
  };
  const window = eventTarget(), location = {origin,hash};
  const code = hostCode.replace(/^import\s+[^;]+;\s*/,'');
  vm.runInNewContext(code,{
    BOOK_VIEWER,bookViewHash,popoutUrl,document,window,location,
    history:{replaceState:(_state,_title,value) => { replaced.push(value); location.hash = value; }},
    setTimeout:callback => {timers.add(callback);return callback;},
    clearTimeout:callback => timers.delete(callback)
  });
  const click = (modifiers = {}) => {
    const event = {currentTarget:link,prevented:false,preventDefault(){this.prevented = true;},...modifiers};
    link.dispatch('click',event);return event;
  };
  const message = (data,overrides = {}) => window.dispatch('message',{
    origin,source:frameWindow,data:{source:'dhamma-book-reader',...data},...overrides
  });
  return {reader,loads,status,popout,attributes,close,click,message,window,location,sent,replaced,timers};
}

test('embedded reader stays unloaded until an ordinary click and reuses its frame on reopening',() => {
  const host = runHost();
  assert.equal(host.reader.hidden,true);
  assert.deepEqual(host.loads,[]);
  for (const key of ['metaKey','ctrlKey','shiftKey','altKey']) {
    assert.equal(host.click({[key]:true}).prevented,false);
  }
  assert.deepEqual(host.loads,[]);
  assert.equal(host.click().prevented,true);
  assert.deepEqual(host.loads,[BOOK_VIEWER+'#page=1&zoom=page-fit']);
  assert.equal(host.attributes.get('aria-expanded'),'true');
  host.close.dispatch('click');
  assert.equal(host.reader.hidden,true);
  host.click();
  assert.equal(host.reader.hidden,false);
  assert.equal(host.loads.length,1);
});

test('host accepts location only from its own same-origin viewer and sanitizes message hashes',() => {
  const host = runHost();host.click();
  const location = {kind:'location',hash:'#page=12&zoom=125,0,700',pages:154};
  for (const overrides of [
    {origin:'https://evil.example'}, {source:{}},
    {data:{...location,source:'unrelated-frame'}}
  ]) host.message(location,overrides);
  assert.equal(host.popout.href,'/book/');
  assert.equal(host.status.textContent,'Loading the book…');
  host.message(location);
  assert.equal(host.popout.href,'/book/#page=12&zoom=125,0,700');
  assert.match(host.status.textContent,/154 pages/);
  assert.equal(host.timers.size,0);
  host.message({kind:'location',hash:'#page=8&zoom=page-fit&file=https://evil.example/x.pdf'});
  assert.equal(host.popout.href,'/book/#page=8&zoom=page-fit');
  for (const hash of [null,{},42]) {
    assert.doesNotThrow(() => host.message({kind:'location',hash}));
    assert.equal(host.popout.href,'/book/#page=1&zoom=page-fit');
  }
  host.message({kind:'error'},{origin:'https://evil.example'});
  assert.match(host.status.textContent,/154 pages/);
  host.message({kind:'error'});
  assert.match(host.status.textContent,/could not load/);
});

test('standalone reader starts at the shared location and forwards later hash navigation',() => {
  const host = runHost({isStandalone:true,hash:'#page=12&zoom=150,0,700'});
  assert.deepEqual(host.loads,[BOOK_VIEWER+'#page=12&zoom=150,0,700']);
  host.message({kind:'location',hash:'#page=13&zoom=150,0,700',pages:154});
  assert.deepEqual(host.replaced,['#page=13&zoom=150,0,700']);
  host.location.hash = '#page=24&zoom=page-width&file=https://evil.example/';
  host.window.dispatch('hashchange');
  assert.equal(host.sent.length,1);
  assert.equal(host.sent[0][0].hash,'#page=24&zoom=page-width');
  assert.equal(host.sent[0][1],origin);
  assert.equal(host.loads.length,1);
});

async function runBootstrap(embedded = true) {
  const document = eventTarget(), parentDocument = embedded ? eventTarget() : document;
  const options = {}, bus = new Map(), sent = [], hashes = [];
  const app = {
    initializedPromise:Promise.resolve(),pdfDocument:{numPages:154},
    eventBus:{on:(name,handler) => bus.set(name,handler)},
    pdfLinkService:{setHash:hash => hashes.push(hash)}
  };
  const window = eventTarget({document,PDFViewerApplication:app,
    PDFViewerApplicationOptions:{setAll:value => Object.assign(options,value)}});
  const parent = embedded ? {document:parentDocument,postMessage:(...args) => sent.push(args)} : window;
  vm.runInNewContext(bootstrapCode,{window,document,parent,location:{origin}});
  parentDocument.dispatch('webviewerloaded',{detail:{source:{}}});
  assert.equal(Object.keys(options).length,0,'ignore another viewer initialization');
  parentDocument.dispatch('webviewerloaded',{detail:{source:window}});
  await Promise.resolve();
  return {window,parent,options,bus,sent,hashes};
}

test('viewer bootstrap configures embedded and standalone reading before document startup',async() => {
  for (const embedded of [true,false]) {
    const reader = await runBootstrap(embedded);
    assert.equal(reader.options.defaultUrl,BOOK_PDF);
    assert.equal(reader.options.scrollModeOnLoad,3);
    assert.equal(reader.options.spreadModeOnLoad,0);
    assert.equal(reader.options.annotationEditorMode,-1);
    assert.notEqual(reader.options.textLayerMode,0,'text remains selectable');
    assert.notEqual(reader.options.annotationMode,0,'TOC links remain enabled');
    assert.equal(reader.options.enableScripting,false);
    reader.bus.get('updateviewarea')({location:{pdfOpenParams:'#page=12&zoom=125,0,700'}});
    assert.equal(reader.sent.length,embedded ? 1 : 0);
    if (embedded) {
      assert.equal(reader.sent[0][0].hash,'#page=12&zoom=125,0,700');
      assert.equal(reader.sent[0][0].pages,154);
      assert.equal(reader.sent[0][1],origin);
    }
  }
});

test('viewer ignores foreign or malformed host messages and accepts a valid page location',async() => {
  const reader = await runBootstrap();
  const data = {source:'dhamma-book-host',hash:'#page=24&zoom=page-width'};
  for (const overrides of [
    {origin:'https://evil.example'}, {source:{}},
    {data:{source:'different-host',hash:data.hash}},
    ...[null,{},12,'javascript:alert(1)','#page=12&zoom=125&file=evil.pdf'].map(hash => ({data:{...data,hash}}))
  ]) reader.window.dispatch('message',{origin,source:reader.parent,data,...overrides});
  assert.deepEqual(reader.hashes,[]);
  reader.window.dispatch('message',{origin,source:reader.parent,data});
  assert.deepEqual(reader.hashes,['page=24&zoom=page-width']);
});

test('HTML loads the bootstrap before PDF.js and keeps the PDF and viewer on the same origin',async() => {
  const scripts = [...viewer.matchAll(/<script\b([^>]*)>/g)].map(match => ({
    tag:match[1],src:match[1].match(/\bsrc="([^"]+)"/)?.[1]
  }));
  const bootstrapIndex = scripts.findIndex(script => script.src === '/assets/book-viewer-bootstrap.js');
  const moduleIndex = scripts.findIndex(script => /\btype="module"/.test(script.tag));
  assert.ok(bootstrapIndex >= 0 && bootstrapIndex < moduleIndex);
  assert.doesNotMatch(scripts[bootstrapIndex].tag,/\b(?:async|defer|type)\b/);
  for (const script of scripts) {
    const url = new URL(script.src,new URL(BOOK_VIEWER,origin));
    assert.equal(url.origin,origin);
    await readFile(new URL('public'+url.pathname,project));
  }
  assert.equal(new URL(BOOK_PDF,origin).origin,origin);
  await readFile(new URL('public'+BOOK_PDF,project));
  for (const html of [home,standalone]) {
    const pdfLinks = [...html.matchAll(/href="([^"]+\.pdf)"/g)].map(match => match[1]);
    assert.ok(pdfLinks.length > 0);
    assert.ok(pdfLinks.every(url => url === BOOK_PDF));
    assert.match(html,/<script\b[^>]*src="\/assets\/book-reader\.js"/);
    const frame = html.match(/<iframe\b[^>]*class="book-reader-frame"[^>]*>/)?.[0];
    assert.ok(frame);
    assert.doesNotMatch(frame,/\b(?:src|srcdoc)\s*=/,'HTML must not fetch the PDF before activation');
  }
  assert.match(home,/<section\b[^>]*data-book-reader[^>]*\bhidden\b/);
});

test('every bundled PDF.js asset matches its integrity manifest',async() => {
  const vendorRoot = new URL('public/assets/pdfjs/',project);
  const manifest = JSON.parse(await readFile(new URL('integrity.json',vendorRoot),'utf8'));
  for (const required of ['LICENSE','build/pdf.mjs','build/pdf.worker.mjs','web/viewer.mjs','web/viewer.html','web/viewer.css','web/locale/locale.json']) {
    assert.ok(Object.hasOwn(manifest,required),`missing integrity entry: ${required}`);
  }
  const files = await readdir(vendorRoot,{recursive:true,withFileTypes:true});
  const bundled = files.filter(entry => entry.isFile())
    .map(entry => path.relative(fileURLToPath(vendorRoot),path.join(entry.parentPath,entry.name)).split(path.sep).join('/'))
    .filter(file => file !== 'integrity.json' && file !== 'README.txt');
  assert.deepEqual(Object.keys(manifest).sort(),bundled.sort(),'manifest covers the entire bundle');
  for (const [file,expected] of Object.entries(manifest)) {
    assert.match(expected,/^[a-f0-9]{64}$/);
    assert.ok(!file.startsWith('/') && !file.split('/').includes('..'));
    const actual = createHash('sha256').update(await readFile(new URL(file,vendorRoot))).digest('hex');
    assert.equal(actual,expected,`modified vendored asset: ${file}`);
  }
});
