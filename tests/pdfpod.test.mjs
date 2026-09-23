import {test} from 'node:test';import assert from 'node:assert/strict';
import {hostedInPdfPod,pdfPodRoute,pdfPodReport,pdfPodNote,PDF_POD_FIX} from '../src/pdfpod.js';import {defaults} from '../src/config.js';
const pod={__pdfPodHost:{}};
test('PDF Pod child runtime is detected only through the scoped document marker',()=>{
 assert.equal(hostedInPdfPod(pod),true);assert.equal(hostedInPdfPod({}),false);assert.equal(hostedInPdfPod(undefined),false);
 assert.equal(hostedInPdfPod(new Proxy({},{get(){throw Error('blocked')}})),false);
});
test('routes follow PDF Pod OpenAI to Gemini conversion outcomes',()=>{
 assert.equal(pdfPodRoute({provider:'anthropic',base_url:'https://api.anthropic.com/v1'}),'passthrough');
 assert.equal(pdfPodRoute({provider:'vertex-ai',base_url:'https://aiplatform.googleapis.com/v1/projects/p/locations/global/endpoints/openapi'}),'gemini');
 assert.equal(pdfPodRoute({provider:'openai',base_url:'https://generativelanguage.googleapis.com/v1beta/openai'}),'gemini');
 assert.equal(pdfPodRoute({provider:'custom',base_url:'https://us-central1-aiplatform.googleapis.com/v1/x'}),'gemini');
 for(const base_url of ['https://api.openai.com/v1','https://openrouter.ai/api/v1','http://localhost:11434/v1','not a url'])assert.equal(pdfPodRoute({provider:'openai',base_url}),'converted');
});
test('report and note use per-agent overrides and skip disabled agents',()=>{
 const c=defaults();c.plot_provider='anthropic';c.plot_base_url='https://api.anthropic.com/v1';c.character_enabled=false;c.worldbuilding_pdf_mode='quality';
 const r=pdfPodReport(c);assert.deepEqual(r.agents.map(a=>a.name),['worldbuilding','plot']);assert.deepEqual(r.broken.map(a=>a.name),['worldbuilding']);assert.equal(r.internalPdf,true);
 const note=pdfPodNote(c,pod);assert.match(note,/세계관 요청/);assert.ok(!note.includes('플롯'));assert.ok(note.includes(PDF_POD_FIX));
 assert.equal(pdfPodNote(c,{}),'');
 c.default_base_url='https://generativelanguage.googleapis.com/v1beta/openai';assert.equal(pdfPodNote(c,pod),'');
});
