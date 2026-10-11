# World view (experimental)

The world shows your recent threads as characters. Each project gets its own
island, named on a sign in the project's colour and grouped the same way as
projects in the sidebar.
Where a character is and what it does tells you the thread's state at a glance:

- **Swinging a pickaxe at the quarry**: the agent is working. A gold nugget
  lands in its pile each time its work advances.
- **Leaning on the pickaxe, scratching its head**: still working, but nothing
  new has come out for a while. It may be thinking or stuck.
- **Fishing off the pier**: it is waiting on a long command running in the
  background.
- **Standing with a `!` or `?` balloon**: it needs your approval or has a question.
- **On the beach, cheering** (or with an arm up, on a lounger): it finished and
  you have not read the reply yet. Once you have, it rests on a towel or a lounger.
- **On the raft under a grey cloud**: the run failed or hit a usage limit.

Each agent has its own colour, shared with its subagents.

When everyone on an island has been done for an hour, and you have read what
they finished, night falls there: the island goes dark and its agents sleep
around a campfire. The first new work wakes them up.

The water ripples around an island when someone on it needs you or finishes
work you have not read, so you can spot it from far out. It keeps rippling until
you click something on that island.

Subagents appear as smaller copies of the agent that started them and mine the
same rock pile beside it, on its island.

## Open the world

Press `mod+alt+w`, or pick **Enter world** from the command palette. Press it again,
or click **Leave world**, to return to the regular view. The choice is remembered
in this browser.

Hover an island to see each character's thread title above its head; the one
under the pointer shows its full title. Click a character, or its balloon, to
open a reply bubble beside it. Type a
message and press `Enter` to send it; if the agent is busy, the message waits
for the current turn to finish. The expand button opens the full chat over the
world, keeping anything you typed. The archive button archives the thread; undo it
from the notice that appears, or later from **Settings → Archived**. Close the chat with the **×** button beside
the panel or `Escape`. Drag to pan the map and scroll to zoom.

To start an agent on an island, hover it and click the **+** over an empty rock
pile. Type what it should do and press `Enter`: the project's new-thread draft
opens with your text, ready to review and send, and the new agent mines that pile.

The world shows the 30 most recently updated threads. Starting a new thread with
`mod+n` opens its draft in the same panel.
