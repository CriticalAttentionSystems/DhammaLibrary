import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PAGE_SIZE, latestTalks, readFilters, selectTalks, archiveUrl, talkRow, pagination } from '../public/assets/talks.js';

const defaults = {q:'',from:'',to:'',type:'all',page:1};
const makeTalk = (number, overrides = {}) => ({
  id:`talk-${String(number).padStart(2,'0')}`,
  title:`Teaching ${number}`,
  originalTitle:`Original teaching ${number}`,
  brief:'An introduction to practice.',
  summaryMarkdown:'## The practice\n\nA detailed explanation of mindfulness.',
  topics:['Practice'],
  date:`2026-09-${String(number).padStart(2,'0')}`,
  dateLabel:`Sep ${number}, 2026`,
  type:number % 2 ? 'Dhamma talk' : 'Q&A',
  published:true,
  durationSeconds:3985,
  url:`https://www.youtube.com/watch?v=example${number}`,
  readingUrl:`/talks/talk-${String(number).padStart(2,'0')}/`,
  thumbnailUrl:`/assets/images/talks/example${number}.jpg`,
  ...overrides
});
// Intentionally oldest-first and longer than two pages, with a newer draft.
const records = [makeTalk(30,{published:false}), ...Array.from({length:24},(_,index)=>makeTalk(index+1))];
const ids = talks => talks.map(talk=>talk.id);
const filtered = (overrides = {}, talks = records) => selectTalks(talks,{...defaults,...overrides});
const parseArchiveUrl = url => {
  const parsed = new URL(url,'https://library.example');
  return readFilters(parsed.search,parsed.pathname);
};
const links = html => [...html.matchAll(/<a href="([^"]+)" data-page="(\d+)"([^>]*)>([^<]*)<\/a>/g)].map(match=>({
  href:match[1].replaceAll('&amp;','&'),page:Number(match[2]),attributes:match[3],label:match[4]
}));

test('the latest list is ten published talks while the archive keeps every published talk',()=>{
  assert.equal(PAGE_SIZE,10);
  assert.deepEqual(ids(latestTalks(records)),Array.from({length:10},(_,index)=>`talk-${24-index}`));
  const archive = filtered();
  assert.equal(archive.total,24);
  assert.equal(archive.pages,3);
  assert.deepEqual(ids(archive.items),ids(latestTalks(records)));
  const allPages = [1,2,3].flatMap(page=>filtered({page}).items);
  assert.equal(new Set(ids(allPages)).size,24);
  assert.deepEqual(ids(allPages),records.slice(1).reverse().map(talk=>talk.id));
  assert.ok(allPages.every(talk=>talk.published));
});

test('sorting is newest-first with deterministic IDs for equal dates and never mutates input',()=>{
  const input = [makeTalk(2,{id:'z'}),makeTalk(1),makeTalk(2,{id:'a'}),makeTalk(3)];
  const original = structuredClone(input);
  const expected = ['talk-03','a','z','talk-01'];
  assert.deepEqual(ids(latestTalks(input)),expected);
  assert.deepEqual(ids(filtered({},input).items),expected);
  assert.deepEqual(input,original);
});

test('search indexes full summaries and combines words across all searchable fields',()=>{
  const target = makeTalk(1,{
    title:'Loving attention',originalTitle:'Cultivating compassion',brief:'A practical introduction.',
    summaryMarkdown:'## A full account\n\nThe rarely mentioned chrysanthemum illustrates patience.',topics:['Generosity']
  });
  const input = [makeTalk(2),target,makeTalk(3,{...target,id:'unpublished',published:false})];
  assert.deepEqual(ids(filtered({q:'chrysanthemum'},input).items),['talk-01']);
  assert.deepEqual(ids(filtered({q:'LOVING compassion practical chrysanthemum generosity'},input).items),['talk-01']);
  assert.equal(filtered({q:'chrysanthemum absent'},input).total,0);
});

test('search ignores case, extra whitespace, and accents in both content and queries',()=>{
  const input = [makeTalk(1,{title:'Mettā and equanimity',summaryMarkdown:'A café reflection on SĀTI.',topics:['Karuṇā']})];
  for (const q of ['metta','MÉTTĀ','  cafe\tSATI\nkaruna  ','café sāṭi karuṇā']) {
    assert.deepEqual(ids(filtered({q},input).items),['talk-01'],q);
  }
  assert.equal(filtered({q:'  \n\t '},input).total,1);
});

test('date boundaries are inclusive and either date boundary works independently',()=>{
  assert.deepEqual(ids(filtered({from:'2026-09-08',to:'2026-09-10'}).items),['talk-10','talk-09','talk-08']);
  assert.deepEqual(ids(filtered({from:'2026-09-24'}).items),['talk-24']);
  assert.deepEqual(ids(filtered({to:'2026-09-01'}).items),['talk-01']);
  assert.deepEqual(ids(filtered({from:'2026-09-12',to:'2026-09-12'}).items),['talk-12']);
});

test('an inverted date range is reported and has no results',()=>{
  assert.deepEqual(filtered({from:'2026-09-20',to:'2026-09-10',page:5}),{
    items:[],total:0,page:1,pages:1,start:0,invalidRange:true
  });
});

test('query, date, and talk type filters intersect and always exclude matching drafts',()=>{
  const input = records.map(talk=>({...talk,summaryMarkdown:'A reflection on stillness.'}));
  const result = filtered({q:'stillness',from:'2026-09-10',to:'2026-09-16',type:'Q&A'},input);
  assert.deepEqual(ids(result.items),['talk-16','talk-14','talk-12','talk-10']);
  assert.equal(result.total,4);
  assert.equal(filtered({type:'Dhamma talk'},input).total,12);
  assert.equal(filtered({type:'Q&A'},input).total,12);
  assert.equal(filtered({q:'stillness',from:'2026-09-30',type:'Q&A'},input).total,0);
});

test('page boundaries and counts are correct for empty, exact, and partial pages',()=>{
  for (const count of [0,1,9,10,11,20,21,24]) {
    const input = records.slice(1,count+1);
    const expectedPages = Math.max(1,Math.ceil(count/10));
    const seen = [];
    for (let page=1;page<=expectedPages;page++) {
      const result = filtered({page},input);
      assert.equal(result.total,count);
      assert.equal(result.pages,expectedPages);
      assert.equal(result.page,page);
      assert.equal(result.start,(page-1)*10);
      assert.equal(result.items.length,Math.min(10,count-(page-1)*10));
      seen.push(...ids(result.items));
    }
    assert.deepEqual(seen,ids(input.toReversed()));
  }
});

test('out-of-range pages clamp after filtering, and invalid numeric pages use page one',()=>{
  assert.equal(filtered({page:999}).page,3);
  assert.equal(filtered({page:999}).items.length,4);
  assert.equal(filtered({page:3,type:'Q&A'}).page,2);
  assert.equal(filtered({page:3,q:'no match exists'}).page,1);
  for (const page of [-1,0,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'2',undefined]) {
    assert.equal(filtered({page}).page,1,String(page));
  }
});

test('URL filters round-trip Unicode, reserved characters, date bounds, type, and page',()=>{
  const filters = {q:'mettā & "kindness" + joy / ease?',from:'2024-02-29',to:'2026-09-24',type:'Q&A',page:2};
  const url = archiveUrl(filters);
  assert.ok(url.startsWith('/talks/?'));
  assert.ok(url.includes('type=Q%26A'));
  assert.deepEqual(parseArchiveUrl(url),filters);
  assert.deepEqual(parseArchiveUrl(archiveUrl({...defaults,q:'breath',type:'Dhamma talk'})),{...defaults,q:'breath',type:'Dhamma talk'});
});

test('unfiltered archive links use static page paths and filtered page one omits page',()=>{
  assert.equal(archiveUrl(defaults),'/talks/');
  assert.equal(archiveUrl({...defaults,page:3}),'/talks/page/3/');
  assert.deepEqual(parseArchiveUrl('/talks/page/3/'),{...defaults,page:3});
  assert.deepEqual(parseArchiveUrl('/talks/page/3'),{...defaults,page:3});
  assert.equal(archiveUrl({...defaults,q:'breath'}),'/talks/?q=breath');
  assert.equal(readFilters('?page=2','/talks/page/3/').page,2);
});

test('malformed and unknown query parameters are handled without widening the contract',()=>{
  assert.deepEqual(readFilters(),defaults);
  assert.deepEqual(readFilters('?q=%20%20breath%20%20&from=2026-02-30&to=bad&type=unknown&unrecognized=x'),{...defaults,q:'breath'});
  for (const date of ['2023-02-29','2026-04-31','2026-13-01','2026-00-10','2026-1-01','2026-01-01T00:00:00Z']) {
    assert.equal(readFilters(`?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`).from,'',date);
    assert.equal(readFilters(`?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`).to,'',date);
  }
  assert.equal(readFilters('?from=2024-02-29').from,'2024-02-29');
  for (const page of ['0','-1','1.5','NaN','Infinity','2e2','9007199254740992','',' 2']) {
    assert.equal(readFilters(`?page=${encodeURIComponent(page)}`,'/talks/page/3/').page,1,page);
  }
  for (const pathname of ['/talks/page/-2/','/talks/page/2/extra','/talks/example/']) {
    assert.equal(readFilters('',pathname).page,1,pathname);
  }
  assert.equal(readFilters('?q=%ZZ').q,'%ZZ');
  assert.doesNotThrow(()=>readFilters('?q=%E0%A4%A&page=%'));
  assert.equal(readFilters('?q=first&q=second&page=2&page=3').q,'first');
  assert.equal(readFilters('?q=first&q=second&page=2&page=3').page,2);
});

test('talk rows escape every interpolated text and attribute and keep the summary link usable',()=>{
  const hostile = `A & <script> "quote" 'single'`;
  const escaped = 'A &amp; &lt;script&gt; &quot;quote&quot; &#39;single&#39;';
  const row = talkRow(makeTalk(1,{
    id:hostile,title:hostile,type:hostile,date:hostile,dateLabel:hostile,brief:hostile,topics:[hostile],
    url:`https://example.test/?q=${hostile}`,readingUrl:`/talks/${hostile}/`,thumbnailUrl:`/images/${hostile}.jpg`
  }));
  assert.ok(!row.includes('<script>'));
  for (const fragment of [
    `data-type="${escaped}"`,`aria-label="Watch ${escaped}"`,`datetime="${escaped}"`,
    `data-summary="${escaped}"`,`<p>${escaped}</p>`,`<span class="topic-list">${escaped}</span>`,
    `href="/talks/${escaped}/"`,`src="/images/${escaped}.jpg"`,`href="https://example.test/?q=${escaped}"`
  ]) assert.ok(row.includes(fragment),fragment);
  assert.match(row,/<span class="duration">66:25<\/span>/);
  assert.match(row,/target="_blank" rel="noopener"/);
  assert.match(row,/Read full summary<\/a>/);
});

test('talk rows support missing thumbnails, short durations, and multiple topics',()=>{
  const row = talkRow(makeTalk(1,{thumbnailUrl:'',durationSeconds:65,topics:['Mindfulness','Kindness']}));
  assert.ok(!row.includes('<img'));
  assert.match(row,/<span class="duration">1:05<\/span>/);
  assert.match(row,/Mindfulness · Kindness/);
  assert.match(row,/href="\/talks\/talk-01\/" data-summary="talk-01"/);
});

test('zero results and single-page archives have no pagination controls',()=>{
  assert.equal(pagination(filtered({q:'missing'}),defaults),'');
  assert.equal(pagination(filtered({},records.slice(1,11)),defaults),'');
});

test('pagination stays navigable at every page, including both ellipsis gaps',()=>{
  for (let pages=2;pages<=30;pages++) {
    for (let page=1;page<=pages;page++) {
      const filters = {...defaults,q:'mettā & kindness',from:'2024-02-29',to:'2026-09-30',type:'Q&A',page};
      const html = pagination({page,pages},filters);
      const allLinks = links(html);
      const numberLinks = allLinks.filter(link=>/^\d+$/.test(link.label));
      const numberPages = numberLinks.map(link=>link.page);
      assert.equal(numberPages[0],1);
      assert.equal(numberPages.at(-1),pages);
      assert.equal(new Set(numberPages).size,numberPages.length);
      assert.ok(numberPages.length<=5);
      assert.deepEqual([...numberPages].sort((a,b)=>a-b),numberPages);
      const current = numberLinks.filter(link=>link.attributes.includes('aria-current="page"'));
      assert.equal(current.length,1);
      assert.equal(current[0].page,page);
      assert.match(current[0].attributes,new RegExp(`aria-label="Page ${page}"`));
      for (const neighbor of [page-1,page+1].filter(value=>value>=1 && value<=pages)) assert.ok(numberPages.includes(neighbor));
      const previous = allLinks.find(link=>link.label==='← Previous');
      const next = allLinks.find(link=>link.label==='Next →');
      if (page===1) { assert.equal(previous,undefined); assert.match(html,/<span class="page-disabled">← Previous<\/span>/); }
      else assert.equal(previous.page,page-1);
      if (page===pages) { assert.equal(next,undefined); assert.match(html,/<span class="page-disabled">Next →<\/span>/); }
      else assert.equal(next.page,page+1);
      const gaps = numberPages.slice(1).filter((value,index)=>value-numberPages[index]>1).length;
      assert.equal((html.match(/<span aria-hidden="true">…<\/span>/g)||[]).length,gaps);
      assert.match(html,/<nav class="pagination" aria-label="Talk pages">/);
      assert.ok(html.includes('&amp;'));
      for (const link of allLinks) {
        assert.ok(link.page>=1 && link.page<=pages);
        assert.deepEqual(parseArchiveUrl(link.href),{...filters,page:link.page});
      }
    }
  }
});

test('unfiltered pagination links resolve to the correct archive slice without query parameters',()=>{
  for (let page=1;page<=3;page++) {
    const filters = {...defaults,page};
    for (const link of links(pagination(filtered({page}),filters))) {
      assert.ok(!link.href.includes('?'));
      const destination = selectTalks(records,parseArchiveUrl(link.href));
      assert.equal(destination.page,link.page);
      assert.deepEqual(ids(destination.items),ids(records.slice(1).reverse().slice((link.page-1)*10,link.page*10)));
    }
  }
});

test('the production build keeps ten latest talks, three complete archive pages, and all reading pages',async()=>{
  const temporaryRoot = await mkdtemp(path.join(tmpdir(),'dhamma-archive-test-'));
  try {
    await Promise.all(['scripts','templates','public/assets','public/data','public/admin','content/talks'].map(directory=>mkdir(path.join(temporaryRoot,directory),{recursive:true})));
    await Promise.all([
      'scripts/build.mjs','scripts/content.mjs','scripts/contribution-data.mjs','public/assets/talks.js','templates/contribute-talks.html',
      'templates/index.html','templates/talks.html','templates/admin-config.yml',
      'templates/topics.html','public/assets/topic-catalog.js','public/data/topic-archive.json'
    ].map(file=>copyFile(new URL(`../${file}`,import.meta.url),path.join(temporaryRoot,file))));
    await writeFile(path.join(temporaryRoot,'package.json'),JSON.stringify({type:'module'}));
    await writeFile(path.join(temporaryRoot,'content/discovery.json'),JSON.stringify({version:1,complete:true,warnings:[],checkedAt:'2026-10-01T12:00:00Z',scope:{months:6,since:'2026-04-01',until:'2026-10-01'},videos:[{youtubeId:'AbCdEfGhI_1',title:'A </script><script>alert(1)</script> teaching',reason:'Uncertain title',classification:'review',type:null,date:'2026-09-20',url:'https://www.youtube.com/watch?v=AbCdEfGhI_1'}]}));
    const fixtures = records.map((talk,index)=>{
      const youtubeId = String(index+1).padStart(11,'0');
      return {...talk,youtubeId,url:`https://www.youtube.com/watch?v=${youtubeId}`,thumbnailUrl:'',
        title:talk.published ? talk.title : 'Unpublished integration fixture',
        summaryMarkdown:`## A complete teaching\n\nSummary for ${talk.id}.`
      };
    });
    await Promise.all(fixtures.map(talk=>writeFile(path.join(temporaryRoot,'content/talks',`${talk.id}.json`),JSON.stringify(talk))));
    await promisify(execFile)(process.execPath,[path.join(temporaryRoot,'scripts/build.mjs')],{
      cwd:temporaryRoot,env:{...process.env,SITE_URL:'https://example.test',GITHUB_REPOSITORY:'test/library'}
    });
    const dist = path.join(temporaryRoot,'dist');
    const built = file=>readFile(path.join(dist,file),'utf8');
    const rowIds = html=>[...html.matchAll(/data-summary="([^"]+)"/g)].map(match=>match[1]);
    const published = fixtures.filter(talk=>talk.published).sort((a,b)=>b.date.localeCompare(a.date));
    const homepage = await built('index.html');
    assert.deepEqual(rowIds(homepage),ids(published.slice(0,10)));
    assert.equal((homepage.match(/<article class="talk-row"/g)||[]).length,10);
    assert.match(homepage,/The 10 most recent teachings/);
    assert.ok(!homepage.includes('data-summary="talk-01"'));
    assert.ok(!homepage.includes('data-summary="talk-14"'));
    assert.match(homepage,/href="\/talks\/"/);
    assert.match(homepage,/href="\/topics\/">Explore topics/);
    const topicPage = await built('topics/index.html');
    assert.match(topicPage,/Discover the Dhamma/);
    assert.match(topicPage,/https:\/\/bhavana-society\.github\.io\/metta-1\.html/);
    assert.match(topicPage,/rel="canonical" href="https:\/\/example\.test\/topics\/"/);
    assert.doesNotMatch(topicPage,/test bench|Private test|No StillWord/);
    const archiveFiles = ['talks/index.html','talks/page/2/index.html','talks/page/3/index.html'];
    const archivePages = await Promise.all(archiveFiles.map(built));
    for (const [index,html] of archivePages.entries()) {
      const expected = published.slice(index*10,(index+1)*10);
      assert.deepEqual(rowIds(html),ids(expected));
      assert.equal((html.match(/<article class="talk-row"/g)||[]).length,expected.length);
      assert.match(html,/24 talks · Newest first/);
      assert.ok(html.includes(`${index*10+1}–${index*10+expected.length} of 24 talks · Page ${index+1} of 3`));
      const archivePath = index===0 ? '/talks/' : `/talks/page/${index+1}/`;
      assert.ok(html.includes(`<link rel="canonical" href="https://example.test${archivePath}">`));
    }
    assert.deepEqual(archivePages.flatMap(rowIds),ids(published));
    const queueHtml = await built('contribute/talks/index.html');
    assert.ok(!queueHtml.includes('</script><script>alert(1)</script>'));
    const queueData = JSON.parse(queueHtml.match(/id="contribution-data">([\s\S]*?)<\/script>/)[1]);
    assert.equal(queueData.library.length,25,'draft IDs are included to prevent duplicate work');
    assert.equal(queueData.library.find(record=>!record.published).title,undefined);
    assert.equal(queueData.catalog.videos[0].title,'A </script><script>alert(1)</script> teaching');
    const data = JSON.parse(await built('data/talks.json'));
    assert.deepEqual(ids(data),ids(published));
    assert.equal(data.length,24);
    for (const talk of published) {
      const html = await built(`talks/${talk.id}/index.html`);
      assert.ok(html.includes(`<h1>${talk.title}</h1>`));
      assert.ok(html.includes(`<p>Summary for ${talk.id}.</p>`));
      assert.match(html,/href="\/talks\/">← Browse all talks/);
    }
    await assert.rejects(built('talks/talk-30/index.html'),{code:'ENOENT'});
    const sitemap = await built('sitemap.xml');
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>match[1]);
    assert.deepEqual(new Set(locations),new Set([
      'https://example.test/','https://example.test/talks/','https://example.test/topics/',
      'https://example.test/talks/page/2/','https://example.test/talks/page/3/',
      ...published.map(talk=>`https://example.test/talks/${talk.id}/`)
    ]));
    assert.equal(locations.length,29);
    const config = JSON.parse(await built('admin/config.yml'));
    assert.equal(config.backend.repo,'test/library');
    assert.equal(config.site_url,'https://example.test');
    const generatedFiles = (await readdir(dist,{recursive:true})).filter(file=>/\.(html|xml|json|yml|txt)$/.test(file));
    for (const file of generatedFiles) {
      const contents = await built(file);
      assert.ok(!contents.includes('Unpublished integration fixture'),file);
      if (file !== 'contribute/talks/index.html') assert.ok(!contents.includes('talk-30'),file); // Inventory paths include drafts; their content stays hidden.
      // Lowercase CMS expressions in admin/config.yml are intentional, not build placeholders.
      assert.doesNotMatch(contents,/\{\{[A-Z_]+\}\}|__(?:GITHUB_REPOSITORY|SITE_URL)__/,file);
    }
  } finally {
    await rm(temporaryRoot,{recursive:true,force:true});
  }
});
