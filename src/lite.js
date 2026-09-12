import {start} from './runtime.js';
import {analyze,defaultPrompts} from './pipeline.js';
import {clearTokens} from './providers.js';
start(Risuai,{analyze,defaultPrompts,clearTokens}).catch(e=>console.error('MARP 초기화 실패:',e.message));
