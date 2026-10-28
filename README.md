# betterprompt

A Claude Code mod: `/betterprompt` opens a pane beside your session that rewrites a prompt with Felix Rieseberg's
ambition framework ([How to be more ambitious](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/)).
You use it when you want it; nothing enters your session's conversation until you send the result.

## Use

- `/betterprompt` opens the pane (`/betterprompt <prompt>` opens it and rewrites at once).
- Type or paste a prompt and press Enter (or **Improve**). **From prompt box** pulls in what you have typed in the
  main prompt box.
- **Focus** (optional, the line under the prompt): name the aspect or idea the rewrite should be built around, such as
  "security", "cold start of the CLI" or "keep it short". It shapes which checks get added and which are left out, and
  never makes the result longer. Enter in it reruns the current prompt; it stays for later prompts until you clear it.
  If it contradicts a decision your prompt states, the prompt wins and the rewrite asks you about it.
- The rewrite first names the prompt's **kind** (bug, feature, refactor, ui, research, review, ops, other, or reply for
  a go-ahead it leaves alone) and deepens it the way that kind needs: a bug is reproduced and gets a failing test, a
  UI gets every state, a research question gets primary sources and stated criteria. Press **Kind** to correct it.
- The pane shows the angles it used (only those that change the result; often one or none), each with what it adds,
  and the better version, sized to the prompt (at most 60 words for a short one, 120 otherwise).
- **Questions**: where your answer would change the work (root cause or quick fix, report or apply, which "system"),
  it asks, with answer chips and a field for your own. Answering is optional; **Rewrite with answers** reruns with
  them as facts, and **Again** keeps them. **Let the agent ask** moves a question into the result instead.
- **The agent asks you**: questions that need the code read first go at the end of the result ("Once you have read the
  relevant code, and before changing anything, ask me: ..."), on by default; press one to drop it.
- Anything else the rewrite made up rather than took from your prompt, session or project notes (a number, a tool, a
  file, a step that changes something) is listed under it, unchecked: press one to add it to the result.
- **Project snapshot**: from the session's root it sends the project's `CLAUDE.md` (a full fork already has it), the
  opening of `README.md`, the Now and Next sections of `ROADMAP.md`, the tracked files (up to 300), the branch, the last
  10 commits and the uncommitted changes. The rewrite names real files and commands instead of guessing and sets its
  sights by your roadmap, but never turns roadmap items into tasks you didn't ask for. It is cached between rewrites.
- **Loom memory**: when the `loom` project-memory CLI is on your PATH, `loom recall` on your prompt
  adds up to 5 earlier decisions and lessons, so it asks before reversing a decision and does not suggest an approach
  you dropped. Without `loom`, a repo or git, those parts are simply left out. The line under the result lists which
  parts were sent.
- **Use** puts it in your prompt box to edit or send, **Copy** copies it, **Again** rewrites again, **Hide** (or Esc)
  closes the pane. `/betterprompt` brings it back with your last prompt and result, so you can use it on every later
  prompt in the session.
- **Context** (cycles recent → full → off) sets what of your session the rewrite sees, so follow-ups like "now the
  same for the API" get resolved:
  - **recent** (default): the text of your latest messages, about 2.5k tokens, no tool calls or outputs. Cheap.
  - **full**: a fork of your session (`$.model.fork`): everything, tool outputs included, on your session's model.
    Cheap while the session's prompt cache is warm, a full-price read of the whole session once it has lapsed.
  - **off**: the prompt alone.
  The line under the result shows the tokens it read and how many came from cache. A plain go-ahead comes back
  unchanged.
- A prompt over 20k characters is sent as its head and tail (the line under the result says so).

## How it works

- One call to Opus 5.5 (`$.model.complete`), no tools, with the recent context or none; or, on **full**, one fork of
  the session, every tool denied.
- Instructions: `prompts/rewrite.md`, with the Altitude, Depth and Range wording read at run time from
  `prompts/ambition.md` (plugin option `ambition_prompt` points at another copy), so there is one version of it.
  It uses every technique that changes the result. Speed is left out as Rieseberg leaves it out: doing the same work
  faster is what an agent already does.
- `hooks/register.tsx` is the whole mod; `types/index.d.ts` is its state contract.

## Install

In Claude Code, type:

    /plugin install betterprompt --marketplace CodaVibe/betterprompt

Answer `y` to add the marketplace, then pick a scope. Then `/betterprompt` opens the pane.

From a local clone instead (read from the folder; `/reload-plugins` after an edit):

    claude plugin marketplace add <path to the clone>
    claude plugin install betterprompt@betterprompt

## Checking

    claude plugin validate .                 # manifest + module, as the engine reads them
    claude plugin test .                     # tests/betterprompt.test.tsx
