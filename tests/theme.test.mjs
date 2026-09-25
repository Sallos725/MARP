import {test} from 'node:test';import assert from 'node:assert/strict';
import {shellCSS} from '../src/ui.js';import {diagnosticsCSS} from '../src/diagnostics-ui.js';
test('theme colors live only in the shell tokens',()=>{
 const tokens=shellCSS.match(/^\.marp-shell\{[^}]*\}/)[0];
 assert.match(tokens,/--m-bg:#0b1120/);assert.match(tokens,/--m-accent:#e2b865/);
 for(const css of [shellCSS.slice(tokens.length),diagnosticsCSS])assert.deepEqual(css.match(/#[0-9a-f]{3,8}\b/gi)||[],[]);
});
