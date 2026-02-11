# Agent Reference

## Greenfield Policy

This codebase is always treated as a greenfield implementation. Every change is a
clean break. Do not:

- Look for migration paths between old and new code.
- Add shims, adapters, or compatibility layers for previous behavior.
- Preserve legacy code, deprecated patterns, or backward-compatible wrappers.
- Assume prior state that needs to be carried forward.

If something needs to change, replace it outright. There is no installed base to
protect.

## SDK Source of Truth

Use the installed SDK in this workspace as the source of truth:

- `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts`
- `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`
- `node_modules/@opencode-ai/plugin/dist/index.d.ts`

When working on session/runtime behavior in this plugin, read these files first
to confirm the exact client call shapes and available plugin hooks.
