import { describe, expect, it } from 'vitest';
import { DialogueRunner } from '../src/dialogue/runner.js';
import type { DialogueData } from '../src/dialogue/runner.js';

const story: DialogueData = {
  start: 'hi',
  nodes: {
    hi: { speaker: 'Elder', text: 'Welcome!', next: 'ask', set: ['met-elder'] },
    ask: {
      speaker: 'Elder',
      text: 'Will you help?',
      choices: [
        { text: 'Yes', next: 'yes', set: ['agreed'] },
        { text: 'No' },
      ],
    },
    yes: { speaker: 'Elder', text: 'Thank you.' },
  },
};

describe('DialogueRunner', () => {
  it('walks linear nodes and sets entry flags', () => {
    const r = new DialogueRunner(story);
    r.start();
    expect(r.currentId).toBe('hi');
    expect(r.flags.has('met-elder')).toBe(true);
    r.advance();
    expect(r.currentId).toBe('ask');
  });

  it('does not advance past a choice node without choosing', () => {
    const r = new DialogueRunner(story);
    r.start('ask');
    r.advance();
    expect(r.currentId).toBe('ask');
  });

  it('choices jump, set flags, and can end the conversation', () => {
    const r = new DialogueRunner(story);
    r.start('ask');
    r.choose(0);
    expect(r.currentId).toBe('yes');
    expect(r.flags.has('agreed')).toBe(true);
    r.advance(); // 'yes' has no next -> done
    expect(r.done).toBe(true);

    const r2 = new DialogueRunner(story);
    r2.start('ask');
    r2.choose(1); // 'No' has no next -> ends immediately
    expect(r2.done).toBe(true);
  });

  it('entering a missing node ends cleanly instead of crashing', () => {
    const r = new DialogueRunner(story);
    r.start('nope');
    expect(r.done).toBe(true);
    expect(r.node).toBeNull();
  });

  it('seeds initial flags from the constructor', () => {
    const r = new DialogueRunner(story, ['from-save']);
    expect(r.flags.has('from-save')).toBe(true);
  });
});
