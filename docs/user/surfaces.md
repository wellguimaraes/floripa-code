# Surfaces

The panel beside a chat holds its surfaces: browser tabs, terminals, pull
requests, the diff, files, and devices. They belong to the checkout the thread
works in, not to the thread. Every agent working in the same worktree, or in
the project's own folder when it has no worktree, sees the same browser tabs
and terminals, and so does every client connected to that server.

## Switch between surfaces

The rail on the panel's right edge lists the surface types with how many tabs
each has open. Choose a type to see its tabs; choose it again to hide the
panel. The rail stays visible while the panel is hidden. `mod+alt+1` through
`mod+alt+6` pick a type from top to bottom, and `mod+t` opens a new tab of the
type on screen. Closing a type's last tab keeps that type open, empty, with a
button to open another.

## Agents in the worktree

The rail on the chat's left edge lists the agents working in the same
worktree. Choose one to switch chats; the panel stays as it is. The worktree
name in the chat's header shows its branch when that differs, and its menu
jumps to the project's other worktrees.

## Collapse the chat

The button at the top of the agent rail, or `mod+\`, collapses the chat so the
surfaces take its place. While it is collapsed no agent is selected; choose
one to bring the chat back.

## What changes when an agent leaves

Archiving or deleting a thread closes the worktree's terminals and browser tabs
only when no other agent in that worktree is left, settled ones included.
Settling a thread closes the worktree's idle shells once every agent in it has
settled, except in the project's own folder. A terminal running a command,
such as a dev server, stays until you close it.
