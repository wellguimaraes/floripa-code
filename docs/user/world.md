# World view (experimental)

The world shows your recent threads as characters. Each project gets its own
island, named on a sign in the project's colour, with the project's icon
before the name, and grouped the same way as projects in the sidebar. An
island with no recent threads on it stays, drawn in dark shades of the sea,
until new work lands there. After the name, the sign
counts the project's local branches (other than the default one) and the open
pull requests from those branches, so branches you no longer need are easy to
spot. The counts update about once a
minute. Click the branch count to list the branches, with the worktree each is
checked out in, its last commit, and whether that worktree has uncommitted
changes. Delete removes a branch along with its worktree and archives the agents
that worked there; it asks for a second click, and once more if the branch isn't
merged. Click the icon to choose a new
one, as in Settings. Right-click it for **Detect automatically**, which drops any
icon you chose and looks through the project's files again, and **Choose image
file…**.
If a project's folder was moved or deleted outside the app, a **Folder not found**
pill shows over its sign. Click it to point the project at the folder's new
place, or to remove the project along with its threads.
Where a character is and what it does tells you the thread's state at a glance:

- **Swinging a pickaxe at the quarry**: the agent is working, or its turn
  ended while a command it started still runs in the background. A gold nugget
  lands in its pile each time its work advances.
- **Swinging the pickaxe slowly**: still working, but nothing new has come out
  for a while. It may be thinking or stuck.
- **Standing with a `!` or `?` balloon**: it needs your approval or has a question.
- **On the beach**: it finished. It cheers for the first 5 minutes after its last
  reply (on a lounger, it raises an arm), sits for the rest of the hour, then lies
  down. After a day it goes fishing, from the pier or the far shore. Agents that
  finished most recently rest furthest right.
- **Sitting on the sand behind the beach, under a grey cloud**: the run failed.
- **Flat out on the sand with × eyes**: the agent hit its usage limit.

Each agent has its own colour, shared with its subagents. To change it, click
the agent, then the colour dot at the top left of its bubble, or click the agent's
figure next to its chat's message box. Subagents change
with it. If another agent on the island wears that colour, that agent moves to a
free one. Your pick is remembered in this browser.

A hat shows where an agent works. Agents in the same worktree wear the same
hat: hard hat, straw hat, top hat, beanie, party hat or crown. Agents in the
project's own checkout wear none. Hats only repeat on an island with more than
six worktrees.

The water ripples around an island while an agent on it waits for your answer
or approval, so you can spot it from far out. It stops as soon as you reply.

Subagents appear as smaller copies of the agent that started them and mine the
same rock pile beside it, on its island. A subagent that has finished still goes
back to the pile with its agent and stands by. Anywhere else, such as on the
beach, an agent and its subagents sit next to each other.

## Open the world

The world is where your threads live: it fills the window, with no sidebar. Use
the search button at the top left, or the command palette, to find a thread,
project or page, and the gear at the top right for Settings. In the desktop app, an
**Update** button shows beside the gear when a new version is out; click it to
download, then again to restart. Settings opens over the
map, and closing it with `Esc` puts you back where you were. On a phone or a narrow
window, threads show in the regular list instead, where the map would not fit.

Hover an island to see each character's thread title above its head; the one
under the pointer shows its full title. A resting agent's tag also shows how
long ago it last replied, such as `10s`, `30m` or `2h`. A tag acts like its character:
clicks and right-clicks on it do the same things. Click a character, or its balloon, to
open a reply bubble beside it; a character with a `!` or `?` balloon opens its chat instead. It shows the first two lines of the last message you sent. Type a
message and press `Enter` to send it; if the agent is busy, the message waits
for the current turn to finish. Paste, drop, or use the paperclip to attach
images and files to the message. The bubble and the thread's full chat share one draft, so
what you type or attach in either shows in both. The expand button, or `Cmd`+`Enter`
(`Ctrl`+`Enter`), opens the full chat over the world. The archive button, or `Option`+`A` (`Alt`+`A`), archives the thread; undo it
from the notice that appears, or later from **Settings → Archived**. `Option`-click
(`Alt`-click) a character to skip the bubble and open its chat; the map frames the character's
island beside the panel. While a chat is open, clicking another character switches the
chat to it instead of opening a bubble. The chat's footer has the same regenerate-title and
archive buttons as the bubble, and `Option`+`A` (`Alt`+`A`) archives from the chat too; the chat stays open as the agent leaves. Close the chat with the **×** button beside the panel, by double-clicking its left edge, or
with `Cmd`+`Escape` (`Ctrl`+`Escape`) or `Cmd`+`W` (`Ctrl`+`W`), and the map goes back to where it was.
`Cmd`+`W` also closes Settings when it opens over the world.

Right-click a character for **Open chat**, **Send voice command**,
**Regenerate title**, **Stop** and **Archive**. Stop ends the agent's current run, like the stop button in the
chat; the reply bubble has the same button while the agent is busy. Archiving a busy agent, or one waiting on a question, stops its run first. A voice command opens the reply bubble already listening and sends
what you say once you stop talking; the bubble's microphone fills the message
box without sending. Click the microphone to listen until you pause, or hold it
down to talk and let go to finish. Holding `⌘⇧` (`Ctrl+Shift` on Windows and
Linux) while the bubble has focus does the same as holding the microphone. Press `Escape` while it listens to drop what you said and keep the bubble open. Voice needs speech recognition in the browser, so it may
not be available everywhere. `mod`-click characters to select several; the
character whose bubble or chat is open joins the selection too. Then
right-click one of them to stop or archive them all at once.

Drag to pan the map and scroll to zoom. Double-click an island to zoom
to it, or the sea to see every island. Right-click an island to show only that
island, hide it, grow or shrink it, zoom to it, or archive every agent resting
on its beach. **Run script…** lists the project's commands and package scripts; the one you
pick runs in the terminal of the island's latest agent in the main checkout (or its latest agent
anywhere, if none works there), and that agent's chat opens to show it. **Restore archived agent…** lists the island's archived agents,
newest first; click **Restore** on one to bring it back. Its search box matches words in titles
and messages, and also matches by meaning, so a paraphrase or another language can find an
agent. The first search downloads a local model (about 150 MB) and reads the island's archived
agents once. Until that finishes, results show word matches only. **Remove project…** removes the
project and deletes its threads after you confirm; hiding only takes the island off the map, and
neither touches the files on disk. An island comes in three
sizes: 8 rock piles and 9 beach spots, 12 and 14, or 16 and 18, plus 4 chairs on
the pier. The island button at the top left counts the islands, or shows "4 of 6" when some are hidden. Click
it to line the islands up vertically, in a grid, or horizontally, to show or hide
a project's island, or to remove a project.
What you hide, how big each island is, and how you arrange the islands are
remembered in this browser. In the desktop app, the
**+** button at the top left opens a folder picker; the folder you choose
becomes a new project with its own island. Right-click open water to add an
island or arrange the islands.

To start an agent on an island, hover it and click the **+** over an empty rock
pile. In a git project, the bubble first asks where it works, with one row each
for the main worktree, a new worktree, and every worktree that already exists,
the one an agent used most recently first. Use the up and down arrow keys and
`Enter`, or click. It starts on the project's worktree setting. Your pick shows
under the bubble's title; click it to change it. A new worktree starts from the
default branch; pick another branch, or origin's copy, next to it. Type what the agent should do
and press `Enter`. It starts on a colour nobody on that island wears; click its
portrait to pick another. Paste, drop, or use the paperclip to attach images or files too.
A new thread starts in that project
with your text and files as its first message, using the project's default model
and permissions, and the new agent mines that pile. A closed chat stays closed; an open one switches to the new agent. The colour is
remembered in this browser, and so is where it worked. Closing the bubble
before the agent starts keeps what you typed as that island's draft. The next
new agent there asks where it works again, then opens with the draft selected:
type to replace it, or click to edit it. Attached files are not kept.

`mod+n` does the same from the keyboard. It asks which island, with one big
button per island in its sign's colour; use the arrow keys and `Enter`, or click.
The map then glides to that island if needed and opens the new-agent bubble over
its first free pile. With only one island, it skips the question.

The world shows the 30 most recently updated threads.

The pill beside the Settings gear shows how much subscription quota is left
for each provider, pooled across your accounts as in **Usage → Limits**, with the
time until the next reset hands quota back. When the window is narrow it drops
the reset times, then the percentages, then shortens labels to initials, and
finally shows only a small stack of bars per provider. Click it for the full
breakdown and to switch the meters between quota left and quota used. Providers
hidden on the Usage page are hidden here too, and so are limits nothing has used
yet. The pill shows only when some quota is in use.
