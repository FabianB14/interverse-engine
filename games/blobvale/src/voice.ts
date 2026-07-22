import { audio } from '@interverse/engine';

/**
 * Blob voices (M5): a short signature sound each blob plays when it emotes
 * or quick-chats, built from the engine's procedural SFX. Distinct enough
 * that friends can tell each other apart by ear.
 */
export interface VoiceDef {
  id: string;
  name: string;
  emoji: string;
  play: () => void;
}

export const VOICES: VoiceDef[] = [
  { id: 'blip', name: 'Blip', emoji: '🔵', play: () => audio.blip(1.2) },
  { id: 'squeak', name: 'Squeak', emoji: '🐭', play: () => audio.pop(2.4) },
  { id: 'chirp', name: 'Chirp', emoji: '🐤', play: () => audio.blip(1.9) },
  { id: 'boop', name: 'Boop', emoji: '🤖', play: () => audio.pop(0.7) },
  { id: 'fanfare', name: 'Fanfare', emoji: '🎺', play: () => audio.chime() },
  { id: 'buzz', name: 'Buzz', emoji: '🐝', play: () => audio.buzz() },
];

/** Play voice `i` (falls back to the first voice). */
export function playVoice(i: number | undefined): void {
  (VOICES[i ?? 0] ?? VOICES[0])?.play();
}
