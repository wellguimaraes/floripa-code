# World view (experimental)

The world shows your recent threads as characters. Each project gets its own
island, named on a sign in the project's colour and grouped the same way as
projects in the sidebar. An island with no recent threads on it stays, drawn
in dark shades of the sea, until new work lands there.
Where a character is and what it does tells you the thread's state at a glance:

- **Swinging a pickaxe at the quarry**: the agent is working, or its turn
  ended while a command it started still runs in the background. A gold nugget
  lands in its pile each time its work advances.
- **Swinging the pickaxe slowly**: still working, but nothing new has come out
  for a while. It may be thinking or stuck.
- **Standing with a `!` or `?` balloon**: it needs your approval or has a question.
- **On the beach, cheering** (or with an arm up, on a lounger): it finished and
  you have not read the reply yet. Once you have, it rests on a towel or a lounger.
- **On the raft under a grey cloud**: the run failed or hit a usage limit.

Each agent has its own colour, shared with its subagents. To change it, click
the agent, then the colour dot at the top left of its bubble. Subagents change
with it. If another agent on the island wears that colour, that agent moves to a
free one. Your pick is remembered in this browser.

A hat shows where an agent works. Agents in the same worktree wear the same
hat: hard hat, straw hat, top hat, beanie, party hat or crown. Agents in the
project's own checkout wear none. Hats only repeat on an island with more than
six worktrees.

The water ripples around an island while an agent on it waits for your answer
or approval, so you can spot it from far out. It stops as soon as you reply.

Subagents appear as smaller copies of the agent that started them and mine the
same rock pile beside it, on its island.

## Open the world

Press `mod+alt+w`, click the map button at the right of the sidebar's title row,
or pick **Enter world** from the command palette. The sidebar folds away while
the world is open. To return to the regular view, open the sidebar again with
the sidebar button at the top left, or press `mod+alt+w` again. The choice is
remembered in this browser.

Hover an island to see each character's thread title above its head; the one
under the pointer shows its full title. A resting agent's tag also shows how
long ago it last replied, such as `10s`, `30m` or `2h`. Click a character, or its balloon, to
open a reply bubble beside it. It shows the first two lines of the last message you sent. Type a
message and press `Enter` to send it; if the agent is busy, the message waits
for the current turn to finish. Paste, drop, or use the paperclip to attach
images and files to the message. The expand button, or `Cmd`+`Enter`
(`Ctrl`+`Enter`), opens the full chat over the world, keeping anything you typed or attached. The archive button archives the thread; undo it
from the notice that appears, or later from **Settings → Archived**. `Option`-click
(`Alt`-click) a character to skip the bubble and open its chat; the map frames the character's
island beside the panel. While a chat is open, clicking another character switches the
chat to it instead of opening a bubble. Close the chat with the **×** button beside the panel,
`Escape` on the map, or `Escape` twice quickly inside the chat, and the map goes back to where it was.

Right-click a character for **Open chat**, **Send voice command**,
**Regenerate title**, **Stop** and **Archive**. Stop ends the agent's current run, like the stop button in the
chat; the reply bubble has the same button while the agent is busy. A voice command opens the reply bubble already listening and sends
what you say once you stop talking; the bubble's microphone fills the message
box without sending. Press `Escape` while it listens to drop what you said and keep the bubble open. Voice needs speech recognition in the browser, so it may
not be available everywhere. `mod`-click characters to select several; the
character whose bubble or chat is open joins the selection too. Then
right-click one of them to stop or archive them all at once.

Drag to pan the map and scroll to zoom. Double-click an island to zoom
to it, or the sea to see every island. Right-click an island to show only that
island, hide it, grow or shrink it, zoom to it, or archive every agent resting
on its beach. An island comes in three
sizes: 8 rock piles and 9 beach spots, 12 and 14, or 16 and 18. The eye button
at the top right lists every project; click one to show or hide its island. The
button beside it lines the islands up vertically, in a grid, or horizontally.
What you hide, how big each island is, and how you arrange the islands are
remembered in this browser. In the desktop app, the
**+** button at the top right opens a folder picker; the folder you choose
becomes a new project with its own island.

To start an agent on an island, hover it and click the **+** over an empty rock
pile. Type what it should do, pick its colour (it starts on one nobody on that
island wears), and press `Enter`. Paste, drop, or use the paperclip to attach
images or files too. In a git project, the select above the text picks where it
works: the current checkout, a new worktree, or a worktree that already exists.
It starts on the project's worktree setting. A new thread starts in that project
with your text and files as its first message, using the project's default model
and permissions, and the new agent mines that pile. The chat stays closed. The colour is
remembered in this browser.

`mod+n` does the same from the keyboard. It asks which island, with one big
button per island in its sign's colour; use the arrow keys and `Enter`, or click.
The map then glides to that island if needed and opens the new-agent bubble over
its first free pile. With only one island, it skips the question.

The world shows the 30 most recently updated threads.
