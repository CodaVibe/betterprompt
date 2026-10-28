export type Angle = { name: string; why: string }

/** An addition the rewrite made up rather than read from the prompt; it joins the result only when kept. */
export type Assumed = { text: string; kept: boolean }

/** A question for the developer in the pane; `picked` is the chosen or typed answer, '' until answered. */
export type Question = { ask: string; options: string[]; picked: string }

/** A settled question, sent with the next rewrite as a fact. */
export type Answer = { ask: string; answer: string }

/** What the rewrite sees of the session: nothing, the recent messages' text, or all of it through a fork. */
export type Context = 'off' | 'recent' | 'full'

export type Job =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'error'; error: string }
  | {
      phase: 'done'
      kind: string
      angles: Angle[]
      better: string
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
    }
  }
}
