# Codex Enhancement Pack Design

## Goal

Land a low-risk Codex enhancement pack inside `/root/htops` that improves development ergonomics without directly mutating the global Codex installation during implementation.

## Recommended Architecture

The enhancement stack is split into three layers:

1. `Exa MCP`
   - External search and research layer.
   - Highest immediate ROI.
2. `Repo-local enhancement pack`
   - Doctor script
   - Bootstrap script
   - Long-lived operator documentation
3. `Optional workflow overlays`
   - `oh-my-codex` as the staged workflow layer
   - `everything-claude-code` as a selective pattern source

## Why This Shape

The current environment allows safe changes inside `/root/htops`, but not guaranteed direct mutation of the operator's global `~/.codex` setup. Therefore the best direct landing is a project-local control surface that:

- tells us what is installed
- tells us what should be installed next
- gives an operator a one-command path to apply the Exa upgrade on the host

## Scope

In scope:

- recommendation model for the top Codex enhancement points
- project-local doctor output
- project-local bootstrap entrypoint
- permanent documentation
- README integration

Out of scope for this slice:

- importing all of `oh-my-codex`
- importing all of `everything-claude-code`
- changing global prompts, hooks, or Codex home layout during implementation

## Success Criteria

- The repository exposes a stable `codex:doctor` command.
- The repository exposes a stable `codex:bootstrap` command.
- The enhancement pack documents a clear priority order: `Exa -> repo controls -> OMX -> ECC patterns`.
- The new behavior is covered by tests.
