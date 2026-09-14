import {start} from './runtime.js';
import {analyze,defaultPrompts} from './pipeline.js';
import {clearTokens,checkConnection} from './providers.js';
start(Risuai,{analyze,defaultPrompts,clearTokens,checkConnection}).catch(e=>console.error('MARP 초기화 실패:',e.message));
