import {stat} from 'node:fs/promises';
for(const[path,limit]of [['lite/risu-multiagent.js',128*1024],['full/plugin/risu-multiagent-full.js',96*1024]]){const {size}=await stat(path);console.log(path+': '+size+' / '+limit+' bytes');if(size>limit)process.exitCode=1}
