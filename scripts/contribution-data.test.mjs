import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog, validateDecisions } from './contribution-data.mjs';
import { queueRows } from '../public/assets/contribution-state.js';
const id='AbCdEfGhI_1';
const video={youtubeId:id,title:'A teaching',reason:'Confirmed title',classification:'eligible',type:'Dhamma talk',date:'2026-09-20',url:`https://www.youtube.com/watch?v=${id}`};
const catalog={version:1,complete:true,warnings:[],scope:{since:'2026-04-01',until:'2026-10-01',months:6},checkedAt:'2026-10-01T12:00:00Z',videos:[video]};
test('catalog rejects duplicate IDs, bad dates, unexpected types, and noncanonical links',()=>{
  assert.equal(validateCatalog(catalog),catalog);
  for(const changes of [{date:'2026-02-30'},{youtubeId:'invalid'},{type:'Pali class'},{url:'javascript:alert(1)'},{classification:'available'}]) assert.throws(()=>validateCatalog({...catalog,videos:[{...video,...changes}]}));
  assert.throws(()=>validateCatalog({...catalog,videos:[video,video]}));
  assert.throws(()=>validateCatalog({...catalog,scope:{...catalog.scope,since:'2026-11-01'}}));
});
test('manual decisions require a reason and correct type; reuploads cannot point to themselves',()=>{
  const decision={youtubeId:id,decision:'eligible',type:'Q&A',reason:'Recording checked'};
  assert.deepEqual(validateDecisions([decision]),[decision]);
  for(const changes of [{type:null},{reason:''},{decision:'unknown'},{duplicateOf:id},{duplicateOf:'abcdefghij2'}]) assert.throws(()=>validateDecisions([{...decision,...changes}])) ;
  assert.throws(()=>validateDecisions([decision,decision]));
  assert.doesNotThrow(()=>validateDecisions([{...decision,decision:'excluded',duplicateOf:'abcdefghij2'}]));
});
test('a successful GitHub check cannot enable reservations after an incomplete channel scan',()=>{
  const live={claims:new Map(),reviews:new Map()};
  assert.equal(queueRows({...catalog,complete:false},[],live)[0].canClaim,false);
  assert.equal(queueRows(catalog,[],live)[0].canClaim,true);
});
