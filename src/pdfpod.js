import {AGENTS,LABELS} from './core.js';
import {resolve} from './config.js';

// PDF Pod v0.17.10 wraps child nativeFetch. With its default "API 형식 변환: 자동" (openAiToGeminiMode auto),
// every OpenAI-format request is re-sent to a native Gemini URL, so non-Google endpoints
// receive nothing and their key is sent to Google. Anthropic /messages is passed through.
// Labels match the PDF Pod 0.17.10 settings screen, where the child is listed by its display name.
export const PDF_POD_FIX='PDF Pod 설정 → 자식 플러그인 MultiAgent RP Pipeline → API 형식 변환 "끄기", PDF 압축 수준 "끄기"';

// Only PDF Pod's scoped child document exposes __pdfPodHost.
export function hostedInPdfPod(doc=typeof document==='undefined'?undefined:document){
 try{return Boolean(doc?.__pdfPodHost)}catch{return false}
}

const googleHost=h=>h==='generativelanguage.googleapis.com'||h==='aiplatform.googleapis.com'||h.endsWith('-aiplatform.googleapis.com');

// 'passthrough': PDF Pod leaves it alone · 'gemini': conversion keeps working · 'converted': breaks
export function pdfPodRoute(a){
 const p=String(a.provider||'').toLowerCase().replaceAll('_','-');
 if(['anthropic','claude'].includes(p))return 'passthrough';
 if(['vertex','vertex-ai','google','gemini','google-ai-studio'].includes(p))return 'gemini';
 let host='';try{host=new URL(a.base_url).hostname.toLowerCase()}catch{}
 return googleHost(host)?'gemini':'converted';
}

export function pdfPodReport(c){
 const agents=AGENTS.filter(n=>c[n+'_enabled']!==false).map(n=>{const a=resolve(c,n);return {name:n,label:LABELS[n],route:pdfPodRoute(a),pdf:(a.pdf_mode||'off')!=='off'}});
 return {agents,broken:agents.filter(a=>a.route==='converted'),internalPdf:agents.some(a=>a.pdf)};
}

// One-line note for diagnostics records; empty when nothing needs changing.
export function pdfPodNote(c,doc){
 if(!hostedInPdfPod(doc))return '';
 const {broken}=pdfPodReport(c);
 return broken.length?`PDF Pod 기본 설정에서는 ${broken.map(a=>a.label).join('·')} 요청이 Gemini 주소로 바뀌어 실패합니다. ${PDF_POD_FIX}로 바꿔 주세요.`:'';
}
