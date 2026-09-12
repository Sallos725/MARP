import {start} from './runtime.js';
start(Risuai,{full:true}).catch(e=>console.error('MARP 초기화 실패:',e.message));
