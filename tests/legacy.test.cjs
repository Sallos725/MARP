const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function utilities(file, names) {
  const source = JSON.parse(fs.readFileSync('tests/fixtures/v0.8.4-helpers.json', 'utf8'))[file], context = vm.createContext({});
  for (const name of names) {
    const match = source.match(new RegExp('^    function ' + name + '\\([\\s\\S]*?\\n    }', 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  return context;
}
for (const file of ['lite/risu-multiagent.js', 'full/plugin/risu-multiagent-full.js']) {
  test(file + ': reasoning removal and auxiliary request boundaries', () => {
    const u = utilities(file, ['cleanAgentOutput', 'containsLbProcess', 'getBypassReason']);
    assert.equal(u.cleanAgentOutput('<think>private</think>stable fact'), 'stable fact');
    assert.equal(u.cleanAgentOutput('<think>unfinished'), '');
    const settings = { mainModelOnly: true, bypassHypaMemory: true, bypassTranslate: true, bypassLbProcess: true };
    for (const mode of ['memory', 'translate', 'submodel', 'emotion']) assert.ok(u.getBypassReason([], mode, settings));
    assert.equal(u.getBypassReason([], 'model', settings), '');
  });
}
