import {test} from 'node:test';import assert from 'node:assert/strict';import {createRetryCache,retryCacheKey} from '../src/retry-cache.js';

test('retry cache fingerprints object keys deterministically without retaining expired entries',async()=>{
 assert.equal(await retryCacheKey({b:2,a:{d:4,c:3}}),await retryCacheKey({a:{c:3,d:4},b:2}));
 let time=100;const cache=createRetryCache({ttl:10,limit:2,now:()=>time});
 cache.set('a',{value:1},1);time=101;cache.set('b',{value:2},2);assert.equal(cache.get('a').source_run_id,1);
 cache.set('c',{value:3},3);assert.equal(cache.get('b'),null);assert.equal(cache.size,2);
 time=112;assert.equal(cache.get('a'),null);assert.equal(cache.size,0);
});

test('retry cache has a deterministic non-Web-Crypto fingerprint',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 try{
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});
  assert.equal(await retryCacheKey({b:'한글',a:1}),await retryCacheKey({a:1,b:'한글'}));
  assert.notEqual(await retryCacheKey({a:1}),await retryCacheKey({a:2}));
 }finally{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto}
});
