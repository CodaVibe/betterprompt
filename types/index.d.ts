export type Angle = { name: string; why: string }

/** An addition the rewrite made up rather than read from the prompt; it joins the result only when kept. */
export type Assumed = { text: string; kept: boolean }

/** A question for the developer in the pane; `picked` is the chosen or typed answer, '' until answered. */
export type Question = { ask: string; options: string[]; picked: string }

/** A settled question, sent with the next rewrite as a fact. */
export type Answer = { ask: string; answer: string }

/** What the rewrite sees of the session: nothing, the recent messages' text, or all of it through a fork. */
export type Context = 'off' | 'recent' | 'full'

/** The ladder's steps, each a field of the done job: better is Sharper. */
export type Rung = 'better' | 'outcome' | 'audacious'

/** The reasoning shown before the rewrite; all empty for a reply or a small, precise change. */
export type Thinking = {
  verbs: string
  crew: { field: string; does: string }[]
  /** The four questions a top professional answers: `label` is how the pane names each. */
  depth: { label: string; text: string }[]
}

export type Job =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'error'; error: string }
  | {
      phase: 'done'
      kind: string
      angles: Angle[]
      thinking: Thinking
      better: string
      /** The higher steps of the ladder; '' when the rewrite left one out. */
      outcome: string
      audacious: string
      /** Goals and methods the rewrite proposes; they join the result unless dropped. */
      proposed: Assumed[]
      /** What the developer must give the agent first; shown, never sent. */
      needs: string[]
      questions: Question[]
      /** Questions the agent asks after reading the code; `kept` ones join the result. */
      askAgent: Assumed[]
      assumed: Assumed[]
      note?: string
    }

declare module 'claude-code' {
  interface PluginState {
    betterprompt: {
      draft: Shaped<string>
      job: Shaped<Job>
      context: Shaped<Context>
      /** The kind the developer set for the current prompt; '' lets the rewrite name it. */
      kind: Shaped<string>
      /** Answers given for the current prompt; a new prompt starts with none. */
      answers: Shaped<Answer[]>
      /** Whether the kind picker row is open. */
      picking: Shaped<boolean>
      /** The developer's free-text steer for the rewrite; kept across prompts until they clear it. */
      focus: Shaped<string>
      /** The ladder step Use and Copy send; a new prompt starts at Sharper, a rerun keeps it. */
      rung: Shaped<Rung>
      /** Whether the reasoning is shown; kept across prompts. */
      reasoning: Shaped<boolean>
    }
  }
}
