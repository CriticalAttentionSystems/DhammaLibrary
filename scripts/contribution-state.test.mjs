import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimVideoId, claimUrl, groupClaims, queueRows, selectQueue,
  allPages, githubJson, loadContributionState, escapeHtml
} from '../public/assets/contribution-state.js';

const repo = 'CriticalAttentionSystems/DhammaLibrary';
const prefix = `/repos/${repo}`;
const ids = ['AbCdEfGhI_1','abCdEfGhI_1','abcdefghij2','abcdefghij3','abcdefghij4','abcdefghij5'];
const sha = digit => digit.repeat(40);
const path = name => `content/talks/${name}.json`;
const entry = (youtubeId,published = true,extra = {}) => ({youtubeId,published,id:youtubeId,title:'A teaching',...extra});
const blob = value => {
  const content = JSON.stringify(value);
  return {encoding:'base64',size:Buffer.byteLength(content),content:Buffer.from(content).toString('base64')};
};
const claim = (id,number,extra = {}) => ({
  title:`[Talk claim] ${id}`,body:`### YouTube video ID\n\n${id}\n`,state:'open',number,
  created_at:'2026-09-20T12:00:00Z',user:{login:'reader'},...extra
});
const video = (youtubeId,extra = {}) => ({youtubeId,title:'Mindfulness of breathing',date:'2026-09-20',type:'Dhamma talk',classification:'eligible',...extra});

function mockGitHub({tree = {tree:[],truncated:false},issues = [],pulls = [],blobs = {},files = {},details = {}} = {}) {
  const calls = [];
  const get = async url => {
    calls.push(url);
    const request = new URL(url,'https://api.github.com');
    const pathname = request.pathname;
    const page = Number(request.searchParams.get('page') || 1);
    const list = value => value.slice((page-1)*100,page*100);
    let result;
    if (pathname === prefix+'/git/trees/main') result = tree;
    else if (pathname === prefix+'/issues') {
      assert.equal(request.searchParams.get('state'),'open'); result = list(issues);
    } else if (pathname === prefix+'/pulls') {
      assert.equal(request.searchParams.get('state'),'open'); result = list(pulls);
    } else if (/\/git\/blobs\/[a-f0-9]+$/.test(pathname)) result = blobs[pathname.split('/').at(-1)];
    else if (/\/pulls\/\d+\/files$/.test(pathname)) result = list(files[pathname.split('/').at(-2)] || []);
    else if (/\/pulls\/\d+$/.test(pathname)) result = details[pathname.split('/').at(-1)];
    if (result instanceof Error) throw result;
    assert.notEqual(result,undefined,`Unexpected GitHub request: ${url}`);
    return structuredClone(result);
  };
  return {get,calls};
}

test('claim detection rejects unrelated, closed, conflicting, and pull-request entries',() => {
  assert.equal(claimVideoId(claim(ids[0],1)),ids[0]);
  assert.equal(claimVideoId(claim(ids[0],1,{body:''})),ids[0],'a correctly titled open claim remains reserved if its body is absent');
  for (const invalid of [
    claim(ids[0],1,{state:'closed'}), claim(ids[0],1,{pull_request:{}}),
    claim(ids[0],1,{title:`Question about ${ids[0]}`}),
    claim(ids[0],1,{title:`[Talk claim] ${ids[0]} extra words`}),
    claim(ids[0],1,{body:`### YouTube video ID\n\n${ids[1]}\n`})
  ]) assert.equal(claimVideoId(invalid),null);
});

test('duplicate claims keep the earliest issue and preserve case-sensitive video identity',() => {
  const claims = groupClaims([
    claim(ids[0],40,{user:{login:'later'}}),claim(ids[1],3,{user:{login:'other-video'}}),
    claim(ids[0],9,{user:{login:'first'}}),claim(ids[0],50,{state:'closed'}),
    claim(ids[0],6,{user:{login:'<img src=x onerror=alert(1)>'}}),
    claim(ids[0],'2'),claim(ids[0],7,{pull_request:{}})
  ],repo);
  assert.deepEqual(claims.get(ids[0]).map(c=>[c.number,c.owner]),[[9,'first'],[40,'later']]);
  assert.equal(claims.get(ids[1])[0].owner,'other-video');
  assert.equal(claims.size,2);
  const rows = queueRows({videos:[video(ids[0]),video(ids[1])]},[],{claims,reviews:new Map()});
  assert.equal(rows.find(r=>r.youtubeId===ids[0]).claimCount,2);
  assert.equal(rows.find(r=>r.youtubeId===ids[0]).claim.owner,'first');
  assert.ok(rows.every(row=>row.state==='claimed' && !row.canClaim));
});

test('claim URLs and issue links stay on the configured repository despite hostile text',() => {
  const title = `A teaching & "<img src=x onerror=alert(1)>" # https://evil.example`;
  const url = new URL(claimUrl(repo,{youtubeId:ids[0],title}));
  assert.equal(url.origin,'https://github.com');
  assert.equal(url.pathname,`/${repo}/issues/new`);
  assert.equal(url.searchParams.get('video-title'),title);
  assert.equal(url.searchParams.get('video-link'),`https://www.youtube.com/watch?v=${ids[0]}`);
  const grouped = groupClaims([claim(ids[0],8,{html_url:'javascript:alert(1)',url:'https://evil.example'})],repo);
  assert.equal(grouped.get(ids[0])[0].url,`https://github.com/${repo}/issues/8`);
  for (const invalid of ['//evil.example/x','owner/repo/../private','owner/repo?token=abc','<img>/repo']) {
    assert.throws(()=>claimUrl(invalid,video(ids[0])));
  }
  assert.throws(()=>claimUrl(repo,video('javascript:alert(1)')));
  assert.equal(escapeHtml(`<a href="javascript:alert('x')">&</a>`),'&lt;a href=&quot;javascript:alert(&#39;x&#39;)&quot;&gt;&amp;&lt;/a&gt;');
});

test('pagination reads every page, including an empty final page after an exact hundred',async () => {
  const calls = [];
  const result = await allPages(prefix+'/issues?state=open',async url=>{
    calls.push(url); const page = Number(new URL(url,'https://api.github.com').searchParams.get('page'));
    return page===1 ? Array.from({length:100},(_,i)=>i) : [];
  });
  assert.equal(result.length,100);
  assert.equal(calls.length,2);
  assert.match(calls[0],/\?state=open&per_page=100&page=1$/);
  assert.match(calls[1],/page=2$/);
});

test('pagination fails closed on partial responses, request failures, or its safety cap',async () => {
  const full = Array.from({length:100},(_,i)=>i);
  await assert.rejects(allPages(prefix+'/issues',async()=>({items:[]})),/incomplete list/);
  let page = 0;
  await assert.rejects(allPages(prefix+'/issues',async()=>++page===1 ? full : Promise.reject(new Error('offline'))),/offline/);
  let calls = 0;
  await assert.rejects(allPages(prefix+'/issues',async()=>{calls++;return full;}),/too large/);
  assert.equal(calls,50);
});

test('GitHub requests omit credentials, bypass caches, and reject unsafe paths and rate limits',async t => {
  const calls = [];
  const controller = new AbortController();
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls.push({url,options});
    return {ok:true,json:async()=>({ok:true})};
  });
  assert.deepEqual(await githubJson(prefix+'/issues?state=open',{signal:controller.signal}),{ok:true});
  assert.equal(calls[0].url,`https://api.github.com${prefix}/issues?state=open`);
  assert.equal(calls[0].options.credentials,'omit');
  assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[0].options.signal,controller.signal);
  for (const unsafe of ['https://evil.example/x','//evil.example/x',prefix+'/../private']) {
    await assert.rejects(githubJson(unsafe),/Invalid GitHub request/);
  }
  assert.equal(calls.length,1);
  for (const status of [403,429]) {
    globalThis.fetch = async()=>({ok:false,status});
    await assert.rejects(githubJson(prefix+'/issues'),/limiting requests/);
  }
});

test('latest-main inventory sees new and edited unpublished records and drops deleted baseline files',async () => {
  const baseline = [
    {...entry(ids[0]),path:path('edited'),blobSha:sha('a')},
    {...entry(ids[1]),path:path('deleted'),blobSha:sha('b')},
    {...entry(ids[3]),path:path('unchanged'),blobSha:sha('e')}
  ];
  const api = mockGitHub({
    tree:{truncated:false,tree:[
      {type:'blob',path:path('edited'),sha:sha('c')},
      {type:'blob',path:path('new'),sha:sha('d')},
      {type:'blob',path:path('unchanged'),sha:sha('e')},
      {type:'blob',path:'README.md',sha:sha('f')}
    ]},blobs:{[sha('c')]:blob(entry(ids[0],false)),[sha('d')]:blob(entry(ids[2],false))}
  });
  const live = await loadContributionState(repo,baseline,api.get);
  assert.deepEqual(live.library.map(r=>[r.youtubeId,r.published]),[[ids[0],false],[ids[2],false],[ids[3],true]]);
  assert.ok(!api.calls.some(url=>url.endsWith(sha('e'))),'unchanged verified blobs reuse the deployment baseline');
  assert.ok(!api.calls.some(url=>url.endsWith(sha('b'))),'deleted baseline records are not resurrected');
  const rows = queueRows({videos:ids.slice(0,4).map(id=>video(id))},live.library,live);
  const states = Object.fromEntries(rows.map(r=>[r.youtubeId,r.state]));
  assert.equal(states[ids[0]],'draft');assert.equal(states[ids[2]],'draft');
  assert.equal(states[ids[1]],'available');assert.equal(states[ids[3]],'published');
});

test('an incomplete tree or unreadable latest record blocks contribution availability',async () => {
  for (const tree of [{truncated:true,tree:[]},{truncated:false}]) {
    await assert.rejects(loadContributionState(repo,[],mockGitHub({tree}).get),/inventory is incomplete/);
  }
  const tree = {tree:[{type:'blob',path:path('new'),sha:sha('a')}],truncated:false};
  for (const bad of [
    {encoding:'utf-8',content:'{}',size:2},
    {encoding:'base64',content:'e30=',size:1000001},
    {encoding:'base64',content:Buffer.from('{broken').toString('base64'),size:7},
    blob({youtubeId:'invalid',published:true}),blob({youtubeId:ids[0],published:'false'}),
    new Error('GitHub unavailable')
  ]) await assert.rejects(loadContributionState(repo,[],mockGitHub({tree,blobs:{[sha('a')]:bad}}).get));
});

test('open PRs reserve additions from forks and only exact video IDs, with canonical review links',async () => {
  const pr = {number:21,changed_files:3,head:{repo:{full_name:'contributor/library'}},user:{login:'<img src=x>'},html_url:'javascript:alert(1)'};
  const api = mockGitHub({pulls:[pr],files:{21:[
    {filename:path('candidate'),status:'added',sha:sha('a')},
    {filename:path('removed'),status:'removed',sha:sha('b')},
    {filename:'README.md',status:'modified',sha:sha('c')}
  ]},blobs:{[sha('a')]:blob(entry(ids[0],false))}});
  const live = await loadContributionState(repo,[],api.get);
  assert.match(api.calls.find(url=>url.endsWith('/git/blobs/'+sha('a'))),/^\/repos\/contributor\/library\//);
  assert.equal(live.reviews.get(ids[0])[0].url,`https://github.com/${repo}/pull/21`);
  assert.equal(escapeHtml(live.reviews.get(ids[0])[0].owner),'&lt;img src=x&gt;');
  assert.equal(live.reviews.has(ids[1]),false);
  const rows = queueRows({videos:[video(ids[0]),video(ids[1])]},live.library,live);
  assert.equal(rows.find(r=>r.youtubeId===ids[0]).state,'in-review');
  assert.equal(rows.find(r=>r.youtubeId===ids[0]).canClaim,false);
  assert.equal(rows.find(r=>r.youtubeId===ids[1]).state,'available');
});

test('PR file pagination verifies the detail count when list metadata omits it',async () => {
  const pr = {number:12,head:{repo:{full_name:'reader/library'}},user:{login:'reader'}};
  const changed = Array.from({length:101},(_,i)=>({filename:`notes/${i}.md`,status:'added',sha:sha('a')}));
  changed[100] = {filename:path('last-page'),status:'added',sha:sha('b')};
  const api = mockGitHub({pulls:[pr],files:{12:changed},details:{12:{changed_files:101}},blobs:{[sha('b')]:blob(entry(ids[0],false))}});
  const live = await loadContributionState(repo,[],api.get);
  assert.equal(live.reviews.get(ids[0])[0].number,12);
  assert.ok(api.calls.some(url=>url.includes('/pulls/12/files?per_page=100&page=2')));
  assert.ok(api.calls.includes(prefix+'/pulls/12'));
});

test('unverifiable PRs and the GitHub 3000-file limit fail closed',async () => {
  const base = {number:12,head:{repo:{full_name:'reader/library'}},user:{login:'reader'}};
  const cases = [
    {pulls:[{...base,changed_files:1}],files:{12:[]}},
    {pulls:[base],files:{12:[]},details:{12:{}}},
    {pulls:[{...base,head:{repo:null},changed_files:0}]},
    {pulls:[{...base,changed_files:1}],files:{12:[{filename:path('new'),status:'added',sha:'not-a-sha'}]}},
    {pulls:[{...base,changed_files:3000}],files:{12:Array.from({length:3000},(_,i)=>({filename:`notes/${i}.md`,status:'added'}))}}
  ];
  for (const scenario of cases) await assert.rejects(loadContributionState(repo,[],mockGitHub(scenario).get));
});

test('queue priority prevents reserving known drafts, published talks, PRs, excluded talks, or claims',() => {
  const catalog = {videos:ids.map((id,i)=>video(id,{date:`2026-09-${String(i+1).padStart(2,'0')}`}))};
  const library = [entry(ids[0]),entry(ids[1],false)];
  const live = {claims:new Map([[ids[0],[{number:1,owner:'reader'}]],[ids[2],[{number:2,owner:'reader'}]],[ids[4],[{number:3,owner:'reader'}]]]),reviews:new Map([[ids[0],[{number:10}]],[ids[2],[{number:11}]]])};
  const decisions = [{youtubeId:ids[3],decision:'excluded',reason:'Pali class'}];
  const rows = queueRows(catalog,library,live,decisions);
  const byId = new Map(rows.map(row=>[row.youtubeId,row]));
  assert.deepEqual(ids.map(id=>byId.get(id).state),['published','draft','in-review','excluded','claimed','available']);
  assert.deepEqual(rows.map(row=>row.youtubeId),[...ids].reverse(),'newest recordings appear first');
  assert.ok(rows.filter(row=>row.youtubeId!==ids[5]).every(row=>!row.canClaim));
  assert.equal(byId.get(ids[5]).canClaim,true);
  assert.equal(queueRows({videos:[video(ids[5])]},[])[0].canClaim,false,'deployment data alone never enables claims');
});

test('manual decisions can resolve uncertain classification while search and filters remain independent',() => {
  const live = {claims:new Map(),reviews:new Map()};
  const rows = queueRows({videos:[
    video(ids[0],{classification:'uncertain',title:'Ānāpānasati & mindfulness',type:'Q&A'}),
    video(ids[1],{classification:'uncertain',title:'Mindfulness of the body'}),
    video(ids[2],{classification:'excluded',title:'Pali class'})
  ]},[],live,[{youtubeId:ids[2],decision:'eligible',type:'Q&A',reason:'Confirmed by editor'}]);
  assert.equal(rows.find(row=>row.youtubeId===ids[0]).state,'needs-review');
  assert.equal(rows.find(row=>row.youtubeId===ids[2]).state,'available');
  assert.equal(selectQueue(rows,{q:'ANAPANASATI mindfulness',status:'all',type:'Q&A'}).total,1);
  assert.equal(selectQueue(rows,{q:'anapanasati nonexistent',status:'all'}).total,0,'every search word must match');
  assert.equal(selectQueue(rows,{q:'confirmed',status:'available',type:'Q&A'}).items[0].youtubeId,ids[2]);
  assert.equal(selectQueue(rows,{status:'available',type:'Dhamma talk'}).total,0);
});

test('queue pagination returns twelve items and clamps empty, invalid, and excessive page requests',() => {
  const rows = Array.from({length:26},(_,i)=>({youtubeId:`v${String(i).padStart(10,'0')}`,title:'A teaching',state:'available',type:'Dhamma talk'}));
  const second = selectQueue(rows,{page:2});
  assert.equal(second.items.length,12);assert.equal(second.items[0].youtubeId,rows[12].youtubeId);
  assert.equal(second.total,26);assert.equal(second.pages,3);assert.equal(second.page,2);
  assert.equal(selectQueue(rows,{page:99}).items.length,2);
  assert.equal(selectQueue(rows,{page:-3}).page,1);
  assert.equal(selectQueue(rows,{page:'oops'}).page,1);
  assert.deepEqual(selectQueue(rows,{q:'no match',page:99}),{items:[],total:0,page:1,pages:1});
});
