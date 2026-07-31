import { describe, expect, it } from 'vitest';
import { danglingDialogueLinks, defaultProject, dialogueFromLines, normalizeDialogue, parseProject } from '../src/model.js';

describe('the old flat lines still work', () => {
  it('becomes a chain that ends', () => {
    const d = dialogueFromLines(['Hi.', 'Bye.']);
    expect(d.start).toBe('n0');
    expect(d.nodes.map((n) => n.id)).toEqual(['n0', 'n1']);
    expect(d.nodes[0]!.next).toBe('n1');
    expect(d.nodes[1]!.next).toBeUndefined(); // last line ends the talk
  });

  it('never produces an empty conversation', () => {
    expect(dialogueFromLines([]).nodes).toHaveLength(1);
  });

  it('is a valid tree with nothing dangling', () => {
    expect(danglingDialogueLinks(dialogueFromLines(['a', 'b', 'c']))).toEqual([]);
  });
});

describe('repairing a tree', () => {
  const tree = {
    start: 'greet',
    nodes: [
      {
        id: 'greet',
        text: 'Well met.',
        choices: [
          { text: 'Who are you?', to: 'who' },
          { text: 'Got work?', to: 'work', ifSwitch: 'introduced', actions: [{ cmd: 'coins', n: 2 }] },
        ],
      },
      { id: 'who', text: 'The warden.', next: 'greet' },
      { id: 'work', text: 'Clear the crypt.' },
    ],
  };

  it('keeps choices, conditions and actions', () => {
    const d = normalizeDialogue(tree)!;
    expect(d.nodes).toHaveLength(3);
    const c = d.nodes[0]!.choices!;
    expect(c[0]!.to).toBe('who');
    expect(c[1]!.ifSwitch).toBe('introduced');
    expect(c[1]!.actions).toEqual([{ cmd: 'coins', n: 2 }]);
  });

  it('drops nodes with no id and choices that are not objects', () => {
    const d = normalizeDialogue({
      nodes: [{ id: 'a', text: 'x', choices: ['junk', null, { text: 'ok', to: 'a' }] }, { text: 'no id' }],
    })!;
    expect(d.nodes).toHaveLength(1);
    expect(d.nodes[0]!.choices).toHaveLength(1);
  });

  /** 'remove this' means "delete the speaker" — mid-conversation that would
   *  destroy the actor whose lines are still on screen. */
  it("refuses 'remove this' as a reply action", () => {
    const d = normalizeDialogue({
      nodes: [{ id: 'a', text: 'x', choices: [{ text: 'go', to: '', actions: [{ cmd: 'remove' }, { cmd: 'coins' }] }] }],
    })!;
    expect(d.nodes[0]!.choices![0]!.actions).toEqual([{ cmd: 'coins' }]);
  });

  it('falls back to the first node when start points nowhere', () => {
    expect(normalizeDialogue({ start: 'ghost', nodes: [{ id: 'a', text: 'x' }] })!.start).toBe('a');
  });

  it('returns null for something that is not a tree', () => {
    expect(normalizeDialogue(null)).toBeNull();
    expect(normalizeDialogue({ nodes: [] })).toBeNull();
    expect(normalizeDialogue('words')).toBeNull();
  });

  /** A link to a node that does not exist is the classic way a tree breaks,
   *  and it is invisible when you read the tree top to bottom. */
  it('reports dead ends the author cannot see', () => {
    const d = normalizeDialogue({
      nodes: [
        { id: 'a', text: 'x', next: 'ghost' },
        { id: 'b', text: 'y', choices: [{ text: 'go', to: 'nowhere' }] },
      ],
    })!;
    expect(danglingDialogueLinks(d)).toEqual(['a → ghost', 'b → nowhere']);
  });

  it('does not call an intentional ending a dead end', () => {
    const d = normalizeDialogue({ nodes: [{ id: 'a', text: 'bye', choices: [{ text: 'ok', to: '' }] }] })!;
    expect(danglingDialogueLinks(d)).toEqual([]);
  });
});

describe('saving', () => {
  it('round-trips on an actor', () => {
    const p = defaultProject();
    p.scenes[0]!.entities[0]!.dialogue = normalizeDialogue({
      start: 'a',
      nodes: [{ id: 'a', text: 'Hello', choices: [{ text: 'Hi', to: '', ifVar: 'trust', ifVarAtLeast: 2 }] }],
    })!;
    const out = parseProject(JSON.stringify(p));
    const back = out.scenes[0]!.entities[0]!.dialogue!;
    expect(back.nodes[0]!.choices![0]!.ifVar).toBe('trust');
    expect(back.nodes[0]!.choices![0]!.ifVarAtLeast).toBe(2);
  });

  it('leaves an actor with no conversation free of the key', () => {
    const out = parseProject(JSON.stringify(defaultProject()));
    expect('dialogue' in out.scenes[0]!.entities[0]!).toBe(false);
  });

  it('drops a junk conversation rather than keeping a broken one', () => {
    const p = defaultProject();
    (p.scenes[0]!.entities[0]! as { dialogue?: unknown }).dialogue = { nodes: 'nope' };
    expect(parseProject(JSON.stringify(p)).scenes[0]!.entities[0]!.dialogue).toBeUndefined();
  });
});
