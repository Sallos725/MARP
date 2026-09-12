import {build} from 'esbuild';import {readFile,writeFile,mkdir} from 'node:fs/promises';
for(const [edition,path] of [['lite','lite/risu-multiagent.js'],['full','full/plugin/risu-multiagent-full.js']]){
 const header=await readFile('src/'+edition+'.header.txt','utf8');
 await build({entryPoints:['src/'+edition+'.js'],bundle:true,minify:true,format:'iife',target:['es2020'],outfile:path,banner:{js:header},legalComments:'none'});
}
