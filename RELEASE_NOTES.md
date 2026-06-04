# v0.8.4 Release Notes

## Summary

v0.8.4 is a focused safety/cleanup release for both Lite and Full. It prevents model thinking/reasoning traces from being injected into the MultiAgent RP Analysis Context.

## Fixed

- Strips `<｜begin▁of▁thinking｜>...<｜end▁of▁thinking｜>` style blocks from auxiliary agent outputs.
- Strips `<think>...</think>`, `<thinking>...</thinking>`, and `<reasoning>...</reasoning>` style blocks.
- Adds cleanup in Lite immediately after provider response extraction and again before context injection.
- Adds cleanup in Full sidecar LLM output handling and again in the Full browser plugin before recording/injecting context.

## Why This Matters

Some reasoning models can return hidden-analysis text as visible message content through OpenAI-compatible endpoints. When that leaked into `[MultiAgent RP Analysis Context]`, downstream worldbuilding or main RP generation could treat the reasoning trace as story content and start an unintended continuation.

## Compatibility

- No configuration migration is required.
- Existing Lite and Full settings remain compatible.
- This release only removes thinking/reasoning wrapper blocks from auxiliary agent notes; normal bullet-point analysis notes are preserved.

## Verification

- `node --check lite/risu-multiagent.js`
- `node --check full/plugin/risu-multiagent-full.js`
- `python -m compileall full/app`
