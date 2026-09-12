import {test} from 'node:test';import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
import {encodePDF,makePDF,unsupportedPDF,hasPDF,pdfSource} from '../src/pdf.js';import {callAgent,pdfRequest,nativeURL,textRequest} from '../src/providers.js';
test('Unicode PDF mapping, size limits and worker-blocked fallback',async()=>{const text='[1 user]\n한글 日本語 😀\nsecond line';const r=await encodePDF(text);const pdf=Buffer.from(r.data,'base64');assert.ok(pdf.includes(Buffer.from('D83DDE00')));if(process.env.MARP_PDF_FIXTURE)await writeFile(process.env.MARP_PDF_FIXTURE,pdf);assert.equal((await makePDF(text,null,{worker:false})).worker,false);await assert.rejects(encodePDF('a'.repeat((1<<20)+1)),/source-limit/)});
test('PDF unsupported only retries once with original materials',async()=>{const seen=[],host={nativeFetch:async(u,r)=>{seen.push(JSON.parse(r.body));return seen.length===1?{status:400,data:{error:{message:'PDF files are not supported'}}}:{status:200,data:{choices:[{message:{content:'fact'}}]}}}};
 const a={provider:'custom',base_url:'https://proxy.test/v1',api_key:'fake',model:'mock',pdf_mode:'quality'};const m=[{role:'user',content:'자료 '.repeat(500)}];const result=await callAgent(host,a,m);assert.equal(result.text,'fact');assert.equal(seen.length,2);assert.equal(seen[0].messages.at(-1).content[0].type,'file');assert.deepEqual(seen[1].messages,m);assert.ok(result.pdf.text_retry);
});
test('provider envelopes and existing PDF detection',async()=>{const messages=[{role:'system',content:'rules'},{role:'user',content:'자료 '.repeat(500)}];
 for(const provider of ['openai','anthropic','google','vertex-ai']){
  const a={provider,api_key:'fake',base_url:provider==='vertex-ai'?'https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/endpoints/openapi':provider==='google'?'https://generativelanguage.googleapis.com/v1beta/openai':'https://proxy.test/v1',model:'gemini-test',pdf_mode:'standard'};
  const r=await pdfRequest(a,messages,{},null);
  if(['google','vertex-ai'].includes(provider)){assert.ok(r.body.contents[0].parts[0].inlineData);assert.match(r.url,/:generateContent/)}else assert.equal(r.body.messages.at(-1).content[0].type,provider==='anthropic'?'document':'file');
 }
 assert.ok(hasPDF([{content:[{type:'file',file:{filename:'x.pdf'}}]}]));
 assert.equal(unsupportedPDF({status:429,message:'PDF not supported'}),false);
});

test('Anthropic accepts advanced JSON while preserving instructions',()=>{
 const m=[{role:'system',content:'rules'},{role:'user',content:'source'}];
 const r=textRequest({provider:'anthropic',base_url:'https://api.anthropic.com/v1',model:'mock',extra_body_json:'{"top_p":0.4,"system":"replace"}'},m);
 assert.equal(r.body.top_p,0.4);assert.equal(r.body.system,'rules');assert.equal(r.body.stream,false);
});
