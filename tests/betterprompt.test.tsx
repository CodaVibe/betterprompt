import { expect, mock, test } from 'claude-code/testing'

import { answersText, clip, finalText, memoryText, parseReply, recentText, roadmapFocus, section } from '../hooks/register'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const PANE = {
  plugin: 'betterprompt',
  component: 'Pane',
  requestId: 'betterprompt',
  props: {
    title: 'betterprompt',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const AMBITION = `Intro line.

1. Range: verbs and fields.
More range.

2. Altitude: the goal beyond the goal.

3. Depth: raw data, real instruments.
(4) an outside judge.
`

test('section and parseReply', async () => {
  expect(section(AMBITION, '1')).toBe('1. Range: verbs and fields.\nMore range.')
  expect(section(AMBITION, '3')).toBe('3. Depth: raw data, real instruments.\n(4) an outside judge.')
  expect(section(AMBITION, '4')).toBe(undefined)
  const ok = parseReply('noise {"angles": [{"name": "depth", "why": "w"}, {"name": "speed"}], "better": " B "} tail')
  expect(ok).toEqual({
    kind: 'other',
    angles: [{ name: 'depth', why: 'w' }],
    thinking: { verbs: '', crew: [], depth: [] },
    better: 'B',
    outcome: '',
    audacious: '',
    proposed: [],
    needs: [],
    questions: [],
    askAgent: [],
    assumed: [],
  })
  expect(parseReply('{"angles": []}')).toBe(undefined)
  expect(parseReply('not json')).toBe(undefined)
  const twice = parseReply('{"angles": [{"name": "depth", "why": "a"}, {"name": "depth", "why": "b"}], "better": "B"}')
  expect(twice?.angles).toEqual([{ name: 'depth', why: 'a' }])
  const extra = parseReply('{"angles": [], "better": "B", "assumed": [" Use knip. ", 3, "", "a", "b", "c", "d"]}')
  expect(extra?.assumed).toEqual([{ text: 'Use knip.', kept: false }, { text: 'a', kept: false }, { text: 'b', kept: false }, { text: 'c', kept: false }])
  expect(finalText('B.', [{ text: 'X.', kept: true }, { text: 'Y.', kept: false }])).toBe('B. X.')
  expect(clip('abcdef', 10)).toBe('abcdef')
  expect(clip('a'.repeat(5) + 'MID' + 'z'.repeat(5), 8)).toBe('aaaa\n[... 5 characters cut ...]\nzzzz')
})

test('Enter in the pane rewrites the prompt and shows the better version, on every surface with a field', async ($, on) => {
  const asked: string[] = []
  const reads: string[] = []
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => {
    reads.push(String(e.path))
    return { value: String(e.path).endsWith('rewrite.md') ? 'SYS\n{{techniques}}' : AMBITION }
  })
  on('model.complete', (_, e) => {
    asked.push(JSON.stringify(e))
    return {
      value: {
        isAnswered: true,
        text: '{"angles": [{"name": "altitude", "why": "the decision behind it"}], "better": "Decide X with Y"}',
        usage: USAGE,
      },
    }
  })

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.input({ key: 'prompt', text: 'fix the report' })
    expect((await ui.find({ type: 'Text', text: /Decide X with Y/ }))?.text).toBe('Decide X with Y')
    expect((await ui.find({ type: 'Text', text: /^Altitude$/ }))?.text).toBe('Altitude')
    expect((await ui.find({ type: 'Text', text: /decision behind/ }))?.text).toBe('the decision behind it')
    await ui.unmount()
  }
  expect(asked[0]).toContain('PROMPT:\\nfix the report')
  expect(asked[0]).toContain('3. Depth: raw data')
  expect(asked[0]).toContain('claude-opus-5-5')
  expect(reads.some((r) => r.endsWith('/prompts/ambition.md') && !r.startsWith('/home/t/'))).toBe(true)
})

test('a failed call shows why instead of a result', async ($, on) => {
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('rewrite.md') ? 'SYS\n{{techniques}}' : AMBITION }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'prompt', text: 'fix the report' })
  expect((await ui.find({ type: 'Text', text: /No reply/ }))?.text).toBe('No reply (empty-reply).')
  await ui.unmount()
})

test('a missing ambition prompt is reported, not swallowed', async ($, on) => {
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => {
    if (String(e.path).endsWith('rewrite.md')) return { value: 'SYS\n{{techniques}}' }
    throw new Error('ENOENT')
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'prompt', text: 'fix the report' })
  expect((await ui.find({ type: 'Text', text: /Cannot build/ }))?.text).toContain('Cannot build the rewrite prompt')
  await ui.unmount()
})

test('recentText keeps the newest text within budget, oldest first, without empty messages', async () => {
  const m = [
    { role: 'user', text: 'old question' },
    { role: 'assistant', text: '' },
    { role: 'assistant', text: 'x'.repeat(50) + 'END' },
    { role: 'user', text: 'now the same for the API' },
  ]
  expect(recentText(m)).toBe(`USER: old question\n\nASSISTANT: ${'x'.repeat(50)}END\n\nUSER: now the same for the API`)
  const cut = recentText(m, 30)
  expect(cut.startsWith('ASSISTANT: ...')).toBe(true)
  expect(cut.endsWith('END\n\nUSER: now the same for the API')).toBe(true)
  expect(recentText([])).toBe('')
})

test('Context cycles recent -> full -> off: recent sends the conversation, full forks, off sends neither', async ($, on) => {
  const completes: string[] = []
  const forks: string[] = []
  const reply = '{"angles": [{"name": "depth", "why": "w"}], "better": "B"}'
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('rewrite.md') ? 'SYS\n{{techniques}}' : AMBITION }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'we built the CSV export', toolUses: [] }] }))
  on('model.complete', (_, e) => {
    completes.push(String(e.prompt))
    return { value: { isAnswered: true, text: reply, usage: USAGE } }
  })
  on('model.fork', (_, e) => {
    forks.push(String(e.prompt))
    return { value: { isAnswered: true, text: reply, usage: { ...USAGE, input_tokens: 10, cache_read_input_tokens: 90 } } }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'prompt', text: 'now the same for PDF' })
  expect(completes[0]).toContain('RECENT CONVERSATION')
  expect(completes[0]).toContain('USER: we built the CSV export')
  expect(completes[0]).toContain('PROMPT:\nnow the same for PDF')

  await ui.press({ key: 'context' })
  await ui.press({ key: 'improve' })
  expect(forks.length).toBe(1)
  expect(forks[0]).toContain('SYS')
  expect(forks[0]).toContain('PROMPT:\nnow the same for PDF')
  expect((await ui.find({ type: 'Text', text: /context full/ }))?.text).toContain('90% from cache')

  await ui.press({ key: 'context' })
  await ui.press({ key: 'improve' })
  expect(completes.length).toBe(2)
  expect(completes[1]).not.toContain('RECENT CONVERSATION')
  await ui.unmount()
})

const SYS_FILES = (path: string, ambition = AMBITION) => ({ value: path.endsWith('rewrite.md') ? 'SYS {{techniques}} END' : ambition })

test('an empty prompt says so; an API error names its status and kind', async ($, on) => {
  let calls = 0
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => SYS_FILES(String(e.path)))
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'prompt', text: '   ' })
  expect((await ui.find({ type: 'Text', text: /Type a prompt/ }))?.text).toBe('Type a prompt first.')
  expect(calls).toBe(0)
  await ui.input({ key: 'prompt', text: 'fix the report' })
  expect((await ui.find({ type: 'Text', text: /No reply/ }))?.text).toBe('No reply (API error 529, overloaded).')
  await ui.unmount()
})

test('$& in the ambition text stays literal, and a huge prompt is cut and noted', async ($, on) => {
  const sent: { system: string; prompt: string }[] = []
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => SYS_FILES(String(e.path), "1. Range: costs $& and $'.\n\n2. Altitude: a.\n\n3. Depth: d.\n"))
  on('model.complete', (_, e) => {
    sent.push({ system: JSON.stringify(e.system), prompt: String(e.prompt) })
    return { value: { isAnswered: true, text: '{"angles": [], "better": "B"}', usage: USAGE } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'context' })
  await ui.press({ key: 'context' })   // off: the prompt alone
  await ui.input({ key: 'prompt', text: `ASK ${'x'.repeat(50000)} TAIL` })
  expect(sent[0]?.system).toContain("costs $& and $'.")
  expect(sent[0]?.system).toContain('d. END')
  expect(sent[0]?.prompt.length).toBeLessThan(20100)
  expect(sent[0]?.prompt).toContain('PROMPT:\nASK ')
  expect(sent[0]?.prompt.endsWith(' TAIL')).toBe(true)
  expect((await ui.find({ type: 'Text', text: /context off/ }))?.text).toContain('prompt cut to 20k of 50k chars')
  await ui.unmount()
})

test('a slow fork overtaken by a newer rewrite does not replace it', async ($, on) => {
  const clock = mock.clock(on)
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => SYS_FILES(String(e.path)))
  on('model.fork', async () => {
    await clock.sleep(5000)
    return { value: { isAnswered: true, text: '{"angles": [], "better": "STALE"}', usage: USAGE } }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"angles": [], "better": "FRESH"}', usage: USAGE } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'context' })                       // full
  await ui.input({ key: 'prompt', text: 'first prompt' })   // the fork waits
  await ui.press({ key: 'context' })                       // off
  await ui.input({ key: 'prompt', text: 'second prompt' })
  await clock.advance(5000)
  expect((await ui.find({ type: 'Text', text: /FRESH|STALE|Cancelled/ }))?.text).toBe('FRESH')
  await ui.unmount()
})

test('a short pane drops the rule and keeps the buttons; a tall one draws the rule', async ($) => {
  const short = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'inline', scroll: { offset: 0, bodyRows: 8 } }, surface: 'terminal' })
  expect(await short.find({ type: 'Text', text: /━/ })).toBeUndefined()
  expect((await short.find({ type: 'Text', text: /^ Improve $/ }))?.text).toBe(' Improve ')
  await short.unmount()
  const tall = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await tall.find({ type: 'Text', text: /━/ }))?.text).toContain('━')
  await tall.unmount()
})

test('additions the rewrite assumed stay out of Use until kept', async ($, on) => {
  const filled: string[] = []
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => SYS_FILES(String(e.path)))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: '{"angles": [{"name": "depth", "why": "w"}], "better": "Check the parser.", "assumed": ["Keep parsing under 200 ms.", "Use knip."]}',
      usage: USAGE,
    },
  }))
  on('prompt.fill', (_, e) => {
    filled.push(String(e.text))
    return { isFilled: true }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'prompt', text: 'make the parser accept other date formats' })
  expect((await ui.find({ type: 'Text', text: /not from you/ }))?.text).toContain('not from you')
  await ui.press({ key: 'use' })
  expect(filled[0]).toBe('Check the parser.')
  await ui.press({ key: 'assumed-1' })
  expect((await ui.find({ type: 'Text', text: /\[x\] Use knip/ }))?.text).toBe('[x] Use knip.')
  await ui.press({ key: 'use' })
  expect(filled[1]).toBe('Check the parser. Use knip.')
  await ui.unmount()
})

test('parseReply reads kind, questions and questions for the agent; finalText appends the kept ones', async () => {
  const r = parseReply(JSON.stringify({
    kind: 'bug',
    angles: [],
    better: 'Fix it.',
    questions: [
      { ask: ' Root cause or symptom? ', options: ['Root cause', ' ', 'Symptom', 'a', 'b', 'c'] },
      { ask: 'No options?', options: [] },
      { ask: '', options: ['x'] },
      { ask: 'Q2', options: ['y'] },
      { ask: 'Q3', options: ['y'] },
      { ask: 'Q4', options: ['y'] },
    ],
    ask_agent: ['Which call site stays?', 7, 'Migration needed?', 'third'],
  }))
  expect(r?.kind).toBe('bug')
  expect(r?.questions.map(q => q.ask)).toEqual(['Root cause or symptom?', 'Q2', 'Q3'])
  expect(r?.questions[0]?.options).toEqual(['Root cause', 'Symptom', 'a', 'b'])
  expect(r?.questions[0]?.picked).toBe('')
  expect(r?.askAgent).toEqual([{ text: 'Which call site stays?', kept: true }, { text: 'Migration needed?', kept: true }])
  expect(parseReply('{"kind": "poem", "better": "B"}')?.kind).toBe('other')
  expect(finalText('B.', [], [{ text: 'Q1?', kept: true }, { text: 'Q2?', kept: false }]))
    .toBe('B. Once you have read the relevant code, and before changing anything, ask me: Q1?')
  expect(finalText('B.', [{ text: 'X.', kept: true }], [])).toBe('B. X.')
  expect(answersText([{ ask: 'Scope?', answer: 'API only' }])).toBe('Q: Scope?\nA: API only')
})

test('answers, a picked kind and the project notes reach the next rewrite; a new prompt drops them', async ($, on) => {
  const prompts: string[] = []
  const filled: string[] = []
  on('env.get', () => ({ value: '/home/t' }))
  on('session.root', () => ({ value: '/repo' }))
  on('fs.read', (_, e) => {
    if (String(e.path) === '/repo/CLAUDE.md') return { value: 'Gate: make check' }
    return SYS_FILES(String(e.path))
  })
  on('model.complete', (_, e) => {
    prompts.push(String(e.prompt))
    return {
      value: {
        isAnswered: true,
        text: JSON.stringify({
          kind: 'bug',
          angles: [{ name: 'depth', why: 'w' }],
          better: 'Fix the parser.',
          questions: [{ ask: 'Root cause or symptom?', options: ['Root cause', 'Symptom'] }, { ask: 'Keep the API?', options: ['Yes', 'No'] }],
          ask_agent: ['Which date formats exist?'],
        }),
        usage: USAGE,
      },
    }
  })
  on('prompt.fill', (_, e) => {
    filled.push(String(e.text))
    return { isFilled: true }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'context' })
  await ui.press({ key: 'context' })   // off: the conversation stays out, the notes still go
  await ui.input({ key: 'prompt', text: 'the parser breaks' })
  expect(prompts[0]).toContain('PROJECT SNAPSHOT')
  expect(prompts[0]).toContain('Gate: make check')
  expect((await ui.find({ type: 'Text', text: /project: CLAUDE\.md/ }))?.text).toContain('project: CLAUDE.md')
  expect(await ui.find({ type: 'Text', text: /Rewrite with answers/ })).toBeUndefined()

  await ui.press({ key: 'q-0-0' })
  await ui.press({ key: 'q-1-agent' })   // the second question goes to the agent
  await ui.press({ key: 'use' })
  expect(filled[0]).toBe('Fix the parser. Once you have read the relevant code, and before changing anything, ask me: Which date formats exist? Keep the API?')

  await ui.press({ key: 'answer' })
  expect(prompts[1]).toContain('ANSWERS')
  expect(prompts[1]).toContain('Q: Root cause or symptom?\nA: Root cause')
  expect((await ui.find({ type: 'Text', text: /^Answered: 1/ }))?.text).toContain('Answered: 1')

  await ui.press({ key: 'kind' })
  await ui.press({ key: 'kind-refactor' })
  expect(prompts[2]).toContain('KIND (set by the developer): refactor')
  expect(prompts[2]).toContain('A: Root cause')   // a picked kind keeps the answers

  await ui.input({ key: 'q-1-text', text: 'Break it, v2' })
  expect((await ui.find({ type: 'Text', text: /Rewrite with answers/ }))?.text).toContain('Rewrite with answers')

  await ui.input({ key: 'prompt', text: 'a new prompt' })
  expect(prompts[3]).not.toContain('KIND')
  expect(prompts[3]).not.toContain('ANSWERS')
  await ui.unmount()
})

test('parseReply reads the ladder, the reasoning, proposals and needs', async () => {
  const r = parseReply(JSON.stringify({
    better: 'S',
    outcome: ' O ',
    audacious: 7,
    proposed: [' Load in 200 ms. ', 3, 'a', 'b', 'c', 'd'],
    needs: ['Crash reports', '', 'a', 'b', 'c', 'd'],
    thinking: {
      verbs: ' letting people decide ',
      crew: [{ field: 'Short seller', does: 'hunts the weak claim' }, { field: 'no does' }, 'junk', { field: 'a', does: 'b' }, { field: 'c', does: 'd' }, { field: 'e', does: 'f' }, { field: 'g', does: 'h' }],
      depth: { pro: 'P', raw: '', methods: 'M', judge: 'J', extra: 'X' },
    },
  }))
  expect(r?.outcome).toBe('O')
  expect(r?.audacious).toBe('')
  expect(r?.proposed.length).toBe(4)
  expect(r?.proposed[0]).toEqual({ text: 'Load in 200 ms.', kept: true })
  expect(r?.needs).toEqual(['Crash reports', 'a', 'b', 'c'])
  expect(r?.thinking.verbs).toBe('letting people decide')
  expect(r?.thinking.crew.map(c => c.field)).toEqual(['Short seller', 'a', 'c', 'e'])
  expect(r?.thinking.depth.map(d => d.text)).toEqual(['P', 'M', 'J'])
  expect(parseReply('{"better": "B", "thinking": "nope"}')?.thinking).toEqual({ verbs: '', crew: [], depth: [] })
})

const LADDER = JSON.stringify({
  kind: 'feature',
  angles: [{ name: 'altitude', why: 'w' }],
  thinking: { verbs: 'getting people to decide', crew: [{ field: 'Short seller', does: 'hunts the weak claim' }], depth: { pro: 'reads the raw logs' } },
  better: 'SHARP.',
  outcome: 'OUT.',
  audacious: 'BOLD.',
  proposed: ['Load in 200 ms.', 'Use a statistical model.'],
  assumed: ['Delete old.'],
  needs: ['Access to crash reports'],
})

test('the ladder starts at Sharper; a step and the proposals choose what Use sends; needs are never sent', async ($, on) => {
  const filled: string[] = []
  const copied: string[] = []
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => SYS_FILES(String(e.path)))
  on('model.complete', () => ({ value: { isAnswered: true, text: LADDER, usage: USAGE } }))
  on('prompt.fill', (_, e) => {
    filled.push(String(e.text))
    return { isFilled: true }
  })
  on('ui.copy', (_, e) => {
    copied.push(String(e.text))
    return { value: { isCopied: true } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'prompt', text: 'add a report' })
  expect((await ui.find({ type: 'Text', text: /Access to crash reports/ }))?.text).toBe('- Access to crash reports')
  await ui.press({ key: 'use' })
  expect(filled[0]).toBe('SHARP. Load in 200 ms. Use a statistical model.')
  await ui.press({ key: 'rung-audacious' })
  await ui.press({ key: 'proposed-0' })
  await ui.press({ key: 'use' })
  expect(filled[1]).toBe('BOLD. Use a statistical model.')
  await ui.press({ key: 'assumed-0' })
  await ui.press({ key: 'copy' })
  expect(copied[0]).toBe('BOLD. Use a statistical model. Delete old.')
  await ui.unmount()
})

test('a rerun keeps the step, a new prompt goes back to Sharper, a step left out falls back to it', async ($, on) => {
  const filled: string[] = []
  const replies = [LADDER, LADDER, '{"kind": "feature", "angles": [], "better": "ONLY."}', LADDER]
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => SYS_FILES(String(e.path)))
  on('model.complete', () => ({ value: { isAnswered: true, text: replies.shift() ?? LADDER, usage: USAGE } }))
  on('prompt.fill', (_, e) => {
    filled.push(String(e.text))
    return { isFilled: true }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'prompt', text: 'add a report' })
  await ui.press({ key: 'rung-outcome' })
  await ui.press({ key: 'again' })
  await ui.press({ key: 'use' })
  expect(filled[0]?.startsWith('OUT.')).toBe(true)
  await ui.press({ key: 'again' })   // this reply has no Outcome
  await ui.press({ key: 'use' })
  expect(filled[1]).toBe('ONLY.')
  await ui.input({ key: 'prompt', text: 'a new prompt' })
  await ui.press({ key: 'use' })
  expect(filled[2]?.startsWith('SHARP.')).toBe(true)
  await ui.unmount()
})

test('the reasoning shows by default and hides on press; a reply draws neither it nor the ladder', async ($, on) => {
  const replies = [LADDER, '{"kind": "reply", "angles": [], "better": "ok ship it"}']
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => SYS_FILES(String(e.path)))
  on('model.complete', () => ({ value: { isAnswered: true, text: replies.shift() ?? LADDER, usage: USAGE } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'prompt', text: 'add a report' })
  expect((await ui.find({ type: 'Text', text: /^getting people to decide$/ }))?.text).toBe('getting people to decide')
  expect((await ui.find({ type: 'Text', text: /hunts the weak claim/ }))?.text).toContain('hunts the weak claim')
  expect((await ui.find({ type: 'Text', text: /reads the raw logs/ }))?.text).toContain('reads the raw logs')
  await ui.press({ key: 'reasoning' })
  expect(await ui.find({ type: 'Text', text: /hunts the weak claim/ })).toBeUndefined()
  await ui.input({ key: 'prompt', text: 'ok ship it' })
  expect(await ui.find({ type: 'Text', text: /Reasoning/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /How far/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /fine as written/ }))?.text).toContain('fine as written')
  await ui.unmount()
})

const ROADMAP = `# Roadmap

## Now

- [ ] Ship the kind chip

## Next

- [ ] Bench per kind

## Done

- [x] Old thing
`

test('roadmapFocus keeps Now and Next; memoryText lists the first hits by type and status', async () => {
  expect(roadmapFocus(ROADMAP)).toBe('## Now\n\n- [ ] Ship the kind chip\n\n## Next\n\n- [ ] Bench per kind')
  expect(roadmapFocus('# Plan\n\nnothing here')).toBe('')
  const hits = Array.from({ length: 7 }, (_, i) => ({ type: 'decision', status: 'current', content: ` note ${i} ` }))
  const m = memoryText(JSON.stringify({ ok: true, hits: [{ type: 'fact' }, ...hits] }))
  expect(m.split('\n').length).toBe(5)
  expect(m.startsWith('- (decision, current) note 0')).toBe(true)
  expect(memoryText('{"ok": true, "hits": []}')).toBe('')
})

test('the project snapshot and Loom memory reach the rewrite; a fork gets them without CLAUDE.md', async ($, on) => {
  const completes: { prompt: string; blocks: string }[] = []
  const forks: string[] = []
  const ran: string[] = []
  const reply = '{"kind": "feature", "angles": [], "better": "B"}'
  on('env.get', () => ({ value: '/home/t' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.messages', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const path = String(e.path)
    if (path === '/repo/CLAUDE.md') return { value: 'Gate: make check' }
    if (path === '/repo/README.md') return { value: '# Tool\nDoes things.' }
    if (path === '/repo/ROADMAP.md') return { value: ROADMAP }
    return SYS_FILES(path)
  })
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    ran.push(argv)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv === 'git ls-files') return out('src/a.ts\nsrc/b.ts')
    if (argv === 'git branch --show-current') return out('feat')
    if (argv.startsWith('git log')) return out('abc123 Add a')
    if (argv === 'git status --short') return out(' M src/a.ts')
    if (argv.startsWith('loom recall')) return out(JSON.stringify({ hits: [{ type: 'decision', status: 'current', content: 'Dropped the Haiku gate' }] }))
    return out('', 1)
  })
  on('model.complete', (_, e) => {
    completes.push({ prompt: String(e.prompt), blocks: JSON.stringify(e.promptBlocks) })
    return { value: { isAnswered: true, text: reply, usage: USAGE } }
  })
  on('model.fork', (_, e) => {
    forks.push(String(e.prompt))
    return { value: { isAnswered: true, text: reply, usage: USAGE } }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'prompt', text: 'add the kind chip' })
  const c = completes[0]?.prompt ?? ''
  for (const part of ['Gate: make check', 'Does things.', '- [ ] Ship the kind chip', 'src/b.ts', 'Branch: feat', 'abc123 Add a', ' M src/a.ts',
    'PROJECT MEMORY', '(decision, current) Dropped the Haiku gate'])
    expect(c).toContain(part)
  expect(c).not.toContain('Old thing')   // Done stays out
  expect(c).toContain(' M src/a.ts\n\nPROJECT MEMORY')
  expect(completes[0]?.blocks).toContain('"cache":true')
  expect(ran.some(a => a.startsWith('loom recall add the kind chip --json'))).toBe(true)
  expect((await ui.find({ type: 'Text', text: /project:/ }))?.text).toContain('project: CLAUDE.md, README.md, ROADMAP.md, Tracked, Git, Loom')

  await ui.press({ key: 'context' })   // full
  await ui.press({ key: 'improve' })
  expect(forks[0]).toContain('PROJECT SNAPSHOT')
  expect(forks[0]).toContain('Dropped the Haiku gate')
  expect(forks[0]).not.toContain('Gate: make check')
  await ui.unmount()
})

test('without a repo, git or loom the rewrite still runs, with no snapshot', async ($, on) => {
  const prompts: string[] = []
  on('env.get', () => ({ value: '/home/t' }))
  on('session.root', () => ({ value: '/tmp/new' }))
  on('session.messages', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    if (String(e.path).startsWith('/tmp/new/')) throw new Error('ENOENT')
    return SYS_FILES(String(e.path))
  })
  on('process.run', () => {
    throw new Error('not found')
  })
  on('model.complete', (_, e) => {
    prompts.push(String(e.prompt))
    return { value: { isAnswered: true, text: '{"angles": [], "better": "B"}', usage: USAGE } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'prompt', text: 'start a new app' })
  expect(prompts[0]).not.toContain('PROJECT')
  expect((await ui.find({ type: 'Text', text: /^B$/ }))?.text).toBe('B')
  await ui.unmount()
})

test('a focus reaches the rewrite, Enter in its field reruns, it stays for a new prompt until cleared', async ($, on) => {
  const prompts: string[] = []
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_, e) => SYS_FILES(String(e.path)))
  on('model.complete', (_, e) => {
    prompts.push(String(e.prompt))
    return { value: { isAnswered: true, text: '{"kind": "feature", "angles": [], "better": "Add the cache."}', usage: USAGE } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'focus', text: 'security' })   // no prompt yet: kept, nothing sent
  expect(prompts.length).toBe(0)
  await ui.input({ key: 'prompt', text: 'add a cache' })
  expect(prompts[0]).toContain('FOCUS (set by the developer): security')
  await ui.input({ key: 'focus', text: 'cold start' })
  expect(prompts[1]).toContain('FOCUS (set by the developer): cold start\n\nPROMPT:\nadd a cache')
  await ui.input({ key: 'prompt', text: 'a new prompt' })
  expect(prompts[2]).toContain('FOCUS (set by the developer): cold start')
  await ui.input({ key: 'focus', text: 'x'.repeat(600) })
  expect(prompts[3]).toContain(`FOCUS (set by the developer): ${'x'.repeat(500)}\n`)
  await ui.input({ key: 'focus', text: '  ' })
  expect(prompts[4]).not.toContain('FOCUS')
  await ui.unmount()
})
