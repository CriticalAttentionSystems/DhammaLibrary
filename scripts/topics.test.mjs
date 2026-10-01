import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ARCHIVE_API,SNAPSHOT_URL,fetchArchive,fetchSnapshot,newerCatalog,renderRecording,renderTopicCards,safeArchiveUrl,selectRecordings,validateCatalog,validateEnvelope,youtubeUrl} from '../public/assets/topic-catalog.js';

const source = 'https://bhavana-society.github.io/';
const makeCatalog = (count = 25, fetchedAt = '2026-10-01T12:00:00Z') => ({
  schemaVersion:1,
  metadata:{sourceUrl:source+'all-1.html',sourceGeneratedLabel:'August 2023',fetchedAt},
  categories:[{id:'metta',label:'Metta',sourceUrl:source+'metta-1.html',count:999},{id:'meditation',label:'Meditation',sourceUrl:source+'meditation-1.html',count:999}],
  talks:Array.from({length:count},(_,index) => ({id:`test${String(index).padStart(7,'0')}`,videoId:`test${String(index).padStart(7,'0')}`,title:`Mettā listening ${index}${index < count-4 ? ' Q&A' : ''}`,url:'javascript:alert(1)',topicIds:index%2 ? ['metta'] : ['metta','meditation'],date:index === 0 ? '2024-02-29' : null}))
});
const response = value => ({ok:true,json:async () => structuredClone(value)});

test('the bundled archive validates and recording memberships determine card counts',async () => {
  const input = JSON.parse(await readFile(new URL('../public/data/topic-archive.json',import.meta.url),'utf8'));
  const catalog = validateCatalog(input);
  assert.equal(catalog.talks.length,input.talks.length);
  assert.equal(catalog.categories.length,11);
  assert.ok(catalog.talks.length > 600);
  for (const category of catalog.categories) assert.equal(category.count,catalog.talks.filter(talk => talk.topicIds.includes(category.id)).length);
  const small = validateCatalog(makeCatalog());
  assert.equal(small.categories[0].count,25);
  assert.equal(small.categories[1].count,13);
});

test('source links stay on approved archive pages and videos use validated fixed IDs',() => {
  assert.equal(safeArchiveUrl(source+'q%26a-1.html'),source+'q%26a-1.html');
  assert.equal(safeArchiveUrl(source+'dependent%20origination-1.html'),source+'dependent%20origination-1.html');
  for (const url of ['javascript:alert(1)','https://evil.example/all-1.html','https://bhavana-society.github.io.evil.example/all-1.html','https://evil@bhavana-society.github.io/all-1.html','http://bhavana-society.github.io/all-1.html',source+'all-1.html?redirect=evil',source+'all-1.html#evil',source+'admin.html',source+'%2F%2Fevil-1.html']) assert.equal(safeArchiveUrl(url),null,url);
  assert.equal(youtubeUrl('aB_cD-01234'),'https://www.youtube.com/watch?v=aB_cD-01234');
  assert.throws(() => youtubeUrl('bad"><svg>'));
  const catalog = validateCatalog(makeCatalog());
  assert.equal(catalog.talks[0].url,'https://www.youtube.com/watch?v=test0000000');
  assert.ok(!renderRecording(catalog.talks[0],catalog).includes('javascript:'));
});

test('invalid relationships, malformed dates, and duplicate IDs reject an update',() => {
  for (const mutate of [
    value => value.talks[0].topicIds.push('unlisted'),
    value => value.talks[0].videoId = 'different01',
    value => value.talks[0].id = 'not a video',
    value => value.talks.push(value.talks[0]),
    value => value.categories.push(value.categories[0]),
    value => value.talks[0].date = '2024-02-30',
    value => value.categories[0].sourceUrl = 'https://evil.example/metta-1.html',
    value => value.metadata.fetchedAt = 'not a date',
    value => value.talks = []
  ]) {const input = makeCatalog(); mutate(input); assert.throws(() => validateCatalog(input));}
});

test('new source categories and an absent source footer date remain usable',() => {
  const input = makeCatalog();
  input.metadata.sourceGeneratedLabel = null;
  input.categories.push({id:'2026-retreat',label:'2026 Retreat',sourceUrl:source+'2026%20retreat-1.html'});
  input.talks[0].topicIds.push('2026-retreat');
  const catalog = validateCatalog(input);
  assert.equal(catalog.metadata.sourceGeneratedLabel,null);
  assert.equal(selectRecordings(catalog,{topic:'2026-retreat'}).total,1);
  assert.ok(renderTopicCards(catalog).includes('#talks/2026-retreat'));
});

test('title search folds accents, combines words and filters categories/type before pagination',() => {
  const catalog = validateCatalog(makeCatalog());
  const qa = selectRecordings(catalog,{topic:'metta',search:'  listening   metta ',format:'qa',page:2});
  assert.equal(qa.total,21); assert.equal(qa.pages,3); assert.equal(qa.page,2); assert.equal(qa.items.length,10); assert.equal(qa.items[0].id,'test0000010');
  assert.equal(selectRecordings(catalog,{topic:'meditation',format:'other'}).total,2);
  const empty = selectRecordings(catalog,{search:'no such talk',page:999});
  assert.equal(empty.total,0); assert.equal(empty.pages,1); assert.equal(empty.page,1);
  assert.equal(selectRecordings(catalog,{page:-5}).page,1);
  assert.equal(selectRecordings(catalog,{page:999}).page,3);
});

test('HTML renders archive text as text and static cards remain usable without scripts',() => {
  const input = makeCatalog();
  input.categories[1].label = '<img src=x onerror="alert(1)">';
  input.talks[0].title = '<svg/onload=alert(1)> & "quoted"';
  const catalog = validateCatalog(input);
  const row = renderRecording(catalog.talks[0],catalog);
  assert.ok(row.includes('&lt;svg/onload=alert(1)&gt; &amp; &quot;quoted&quot;'));
  assert.ok(!row.includes('<svg/onload'));
  assert.ok(row.includes('target="_blank" rel="noopener noreferrer"'));
  const cards = renderTopicCards(catalog,{external:true});
  assert.ok(cards.includes('href="'+source+'metta-1.html"'));
  assert.ok(cards.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(!cards.includes('<img'));
  assert.ok(renderTopicCards(catalog).includes('href="#talks/metta"'));
});

test('network interface uses same-origin paths and body-free manual refresh; invalid updates preserve fallback',async () => {
  const calls = [],raw = makeCatalog(),envelope = {catalog:raw,status:{refreshing:false,lastSuccess:raw.metadata.fetchedAt,lastError:null}};
  const fetcher = async (url,options) => {calls.push({url,options}); return response(url === SNAPSHOT_URL ? raw : envelope);};
  const fallback = await fetchSnapshot(fetcher);
  const live = await fetchArchive(fetcher,'POST');
  assert.deepEqual(calls.map(call => call.url),[SNAPSHOT_URL,ARCHIVE_API]);
  assert.equal(calls[1].options.method,'POST'); assert.ok(!('body' in calls[1].options));
  assert.equal(live.catalog.talks.length,25);
  await assert.rejects(fetchArchive(async () => {throw new Error('offline');}));
  await assert.rejects(fetchArchive(async () => response({catalog:{},status:{refreshing:false}})));
  assert.equal(fallback.talks.length,25);
  assert.equal(newerCatalog(fallback,validateCatalog(makeCatalog(24,'2026-09-01T12:00:00Z'))),fallback);
  assert.throws(() => validateEnvelope({catalog:raw,status:{refreshing:false,lastSuccess:'bad'}}));
});

test('template keeps main site chrome, approved listening copy, and only scoped component classes',async () => {
  const html = await readFile(new URL('../templates/topics.html',import.meta.url),'utf8');
  assert.ok(html.includes('Discover the Dhamma,<br>one topic at a time'));
  assert.ok(html.includes('href="/assets/site.css"'));
  assert.ok(html.includes('<header class="site-header wrap">'));
  assert.ok(html.includes('href="/topics/" aria-current="page"'));
  assert.ok(html.includes('{{FOOTER}}'));
  assert.ok(html.includes('{{TOPIC_CARDS}}'));
  assert.doesNotMatch(html,/test bench|about this preview|StillWord|contributor accounts|test-strip/i);
  const css = await readFile(new URL('../public/assets/topics.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/(?:^|\})\s*(?:body|html|\.hero|\.talk-row|\.site-header|nav)\s*[{,]/m);
});

test('browser flow renders fallback first, preserves filters/page on refresh, and stays usable offline',async () => {
  const html = await readFile(new URL('../templates/topics.html',import.meta.url),'utf8');
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id]) => [id,{hidden:false,disabled:false,value:'',innerHTML:'',textContent:'',href:'',events:{},focusCount:0,scrollCount:0,addEventListener(name,handler){this.events[name]=handler;},focus(){this.focusCount++;},scrollIntoView(){this.scrollCount++;}}]));
  const globals = Object.fromEntries(['document','window','location','fetch','setTimeout','clearTimeout'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const old = makeCatalog(),updated = makeCatalog(26,'2026-10-01T13:00:00Z');
  let finishInitial,calls = [];
  const pending = new Promise(resolve => {finishInitial=resolve;});
  globalThis.document = {getElementById:id => nodes.get(id),title:''};
  globalThis.location = {hash:'#talks/metta'};
  globalThis.window = {events:{},addEventListener(name,handler){this.events[name]=handler;},scrollTo(){}};
  globalThis.setTimeout = () => 1; globalThis.clearTimeout = () => {};
  globalThis.fetch = async (url,options) => {
    calls.push({url,options});
    if (url === SNAPSHOT_URL) return response(old);
    if (calls.length === 2) return pending;
    throw new Error('offline');
  };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  try {
    await import('../public/assets/topics.js?integration-test');
    await tick();
    assert.equal(nodes.get('topics-view').hidden,true);
    assert.equal(nodes.get('topics-title').textContent,'Mettā');
    assert.equal(nodes.get('topics-result-count').textContent,'25 recordings');
    assert.equal((nodes.get('topics-talk-list').innerHTML.match(/class="topics-recording"/g)||[]).length,10);
    assert.match(nodes.get('topics-refresh-status').textContent,/Saved topic index.*Checking/);
    nodes.get('topics-search').value = 'metta listening';
    nodes.get('topics-search').events.input({target:nodes.get('topics-search')});
    nodes.get('topics-format').value = 'qa';
    nodes.get('topics-format').events.change({target:nodes.get('topics-format')});
    nodes.get('topics-next-page').events.click();
    assert.equal(nodes.get('topics-page-status').textContent,'Page 2 of 3');
    const focusBefore = nodes.get('topics-title').focusCount;
    finishInitial(response({catalog:updated,status:{refreshing:false,lastSuccess:updated.metadata.fetchedAt,lastError:null}}));
    await tick();
    assert.equal(nodes.get('topics-search').value,'metta listening');
    assert.equal(nodes.get('topics-format').value,'qa');
    assert.equal(nodes.get('topics-result-count').textContent,'22 recordings matching your filters');
    assert.equal(nodes.get('topics-page-status').textContent,'Page 2 of 3');
    assert.equal(nodes.get('topics-title').focusCount,focusBefore);
    await nodes.get('topics-refresh-button').events.click();
    assert.equal(calls.at(-1).options.method,'POST');
    assert.match(nodes.get('topics-refresh-status').textContent,/Could not check.*Saved topic index/);
    assert.equal(nodes.get('topics-result-count').textContent,'22 recordings matching your filters');
    assert.equal(nodes.get('topics-refresh-button').disabled,false);
    location.hash = '#talks/meditation';
    window.events.hashchange();
    assert.equal(nodes.get('topics-search').value,'');
    assert.equal(nodes.get('topics-format').value,'all');
    assert.equal(nodes.get('topics-title').textContent,'Meditation');
    assert.equal(nodes.get('topics-page-status').textContent,'Page 1 of 2');
  } finally {
    for (const [key,descriptor] of Object.entries(globals)) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key];
    }
  }
});
