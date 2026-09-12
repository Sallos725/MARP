const fs = require('node:fs');
const history = Array.from({length:1000}, (_, i) => ({role:i % 2 ? 'assistant' : 'user', content:'대화 '.repeat(1000)}));
const common = {user_input:'다음 장면', system_context:'설정 '.repeat(2000), analysis_language:'auto'};
console.log(JSON.stringify({
  sourceBytes: Object.fromEntries(['lite/risu-multiagent.js','full/plugin/risu-multiagent-full.js'].map(p=>[p,fs.statSync(p).size])),
  fixture: '1000 synthetic history messages; same system and current input',
  originalPayloadBytes: Buffer.byteLength(JSON.stringify({...common,chat_history:history})),
  windowedPayloadBytes: Buffer.byteLength(JSON.stringify({...common,chat_history:history.slice(-10)})),
}, null, 2));
