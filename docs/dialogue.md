# Dialogue (§4.7)

Dialogue is plain JSON (easy to generate/edit), run by `DialogueRunner`,
presented by `DialogueBox` from `@interverse/ui`.

```json
{
  "start": "intro",
  "nodes": {
    "intro": { "speaker": "Fern", "text": "Hello!", "next": "ask" },
    "ask": {
      "speaker": "Fern",
      "text": "Nice room, right?",
      "choices": [
        { "text": "Beautiful!", "next": "happy", "set": ["complimented"] },
        { "text": "Bit dusty.", "next": "dusty" }
      ]
    },
    "happy": { "speaker": "Fern", "text": "Aw, thanks!" },
    "dusty": { "speaker": "Fern", "text": "...fair." }
  }
}
```

```ts
import { DialogueRunner } from '@interverse/engine';
import { DialogueBox } from '@interverse/ui';

const box = scene.add(new DialogueBox({ palette: cozyAutumn }), uiLayer);
box.position.set((W - 656) / 2, H - 336);
box.onClosed = () => resumeGameplay();

const runner = new DialogueRunner(data as DialogueData);
runner.start(met ? 'again' : 'intro'); // branch entry by game state
box.open(runner);
```

- A node with `choices` requires a pick; otherwise tap advances via `next`,
  and omitting `next` ends the conversation.
- `set` arrays add flags to `runner.flags` (node-level and choice-level).
- `runner.currentId` lets game code react to reaching a node (e.g. screen
  shake on a specific line — see `games/room`).
- The box handles typewriter reveal, tap-to-skip, speaker pill, and choice
  buttons; freeze player movement while `box.isOpen`.

Validate files with the MCP tool `validate_dialogue` (checks node
references, reachability, and structure).
