import test from 'node:test';
import assert from 'node:assert/strict';
import { markdown, prepareTalks } from './content.mjs';
import { byteRange } from './serve.mjs';
const talk = {id:'example',youtubeId:'taRyL5LYM3Y',url:'https://www.youtube.com/watch?v=taRyL5LYM3Y',title:'Example',originalTitle:'Example',date:'2026-09-27',type:'Q&A',durationSeconds:3985,topics:['Practice'],brief:'Overview.',summaryMarkdown:'## Practice\n\nReturn to the breath.',published:true};
test('content HTML and unsafe links never execute',()=>{
  const rendered=markdown('<img src=x onerror="alert(1)">\n\n[bad](javascript:alert) [good](https://bhavanasociety.org/)');
  assert.ok(!rendered.includes('<img'));assert.ok(!rendered.includes('href="javascript:'));assert.ok(rendered.includes('href="https://bhavanasociety.org/"'));
});
test('supported paragraphs, lists, headings, and emphasis render',()=>{
  assert.equal(markdown('## Practice\n\n**Be kind** and *patient*.\n\n- Sit\n- Breathe'),'<h2>Practice</h2>\n<p><strong>Be kind</strong> and <em>patient</em>.</p>\n<ul><li>Sit</li><li>Breathe</li></ul>');
});
test('drafts excluded, duplicate video IDs rejected',()=>{
  assert.equal(prepareTalks([{...talk,published:false}]).length,0);
  assert.throws(()=>prepareTalks([talk,{...talk,id:'another'}]),/Duplicate/);
});
test('incorrect dates, mismatched URLs, and hostile thumbnail hosts rejected',()=>{
  for(const mutation of [{date:'2026-02-30'},{url:'https://youtube.com.evil.test/watch?v=taRyL5LYM3Y'},{url:'https://www.youtube.com/watch?v=XXXXXXXXXXX'},{thumbnailUrl:'https://evil.test/x.jpg'},{type:'Pali class'}]) assert.throws(()=>prepareTalks([{...talk,...mutation}]));
});
test('source-derived content has safe reading URLs and date labels',()=>{
  const result=prepareTalks([talk])[0]; assert.equal(result.readingUrl,'/talks/example/');assert.equal(result.dateLabel,'Sep 27, 2026');assert.match(result.summaryHtml,/<h2>Practice/);
});
test('timestamped video links and local frames retain the same video identity',()=>{
  const result=prepareTalks([{...talk,url:talk.url+'&t=45s',thumbnailUrl:'/assets/images/talks/taRyL5LYM3Y.jpg'}])[0];
  assert.equal(new URL(result.url).searchParams.get('t'),'45s');
  assert.equal(result.thumbnailUrl,'/assets/images/talks/taRyL5LYM3Y.jpg');
  for (const thumbnailUrl of ['/assets/images/talks/XXXXXXXXXXX.jpg','//evil.test/image.jpg','/assets/images/talks/../private.jpg']) assert.throws(()=>prepareTalks([{...talk,thumbnailUrl}]));
});
test('video seeking supports bounded, open-ended, and suffix byte ranges',()=>{
  assert.deepEqual(byteRange('bytes=0-99',1000),{start:0,end:99});
  assert.deepEqual(byteRange('bytes=950-',1000),{start:950,end:999});
  assert.deepEqual(byteRange('bytes=-50',1000),{start:950,end:999});
  assert.equal(byteRange('bytes=1000-',1000),null);assert.equal(byteRange('bytes=90-20',1000),null);assert.equal(byteRange('bytes=-0',1000),null);
});
