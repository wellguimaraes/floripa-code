# Terminal history

Each terminal keeps up to 5,000 lines and 8 MiB of scrollback on its environment
server. Floripa Code removes the oldest output when either limit is reached. A long
line can be shortened at the start. New terminal output is not truncated.

These limits apply when you reconnect and when Floripa Code restores saved terminal
history. A client can show less scrollback than the server keeps.

On web and desktop, use Shift+PageUp and Shift+PageDown to read scrollback
without leaving terminal input. Ctrl+Shift+Home and Ctrl+Shift+End jump to the
start and latest output; use Cmd instead of Ctrl on macOS. Full-screen terminal
programs keep these navigation keys.

To copy all retained output, choose Select all in the terminal's context menu,
then copy. Cmd+A on macOS and Ctrl+Shift+A elsewhere select the same output.
Ctrl+A still moves to the beginning of shell input on Windows and Linux.
Jump to latest in the context menu returns to the current output.

## Commands that restart

A terminal that runs a command, such as a project script, can run it again when
its environment server restarts: after an app update, a quit, or a crash. Open
the terminal tab's context menu and turn on Restart on reopen. When the server
starts again, Floripa Code opens a fresh shell in the same directory, below the
saved output, and runs the command once. It does not restart a command that
exits on its own. Closing the tab turns it off.

Use it for dev servers, watchers, and tunnels. A command that changes something
each time it runs, such as a migration or a deploy, should not restart.

## Agent terminals

An agent with full access can start a command, such as a dev server, in a
terminal of its own. It opens as a tab in the thread's checkout and keeps
running after the agent's turn ends. The agent can read its output and stop it,
and it can ask for Restart on reopen when the command is safe to start twice.
You can turn that off or close the tab like any other terminal. Agents in
other permission modes use their own shell instead.
