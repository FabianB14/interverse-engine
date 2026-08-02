import { beforeEach, describe, expect, it } from 'vitest';
import { MUSIC_TRACKS, audio } from '../src/audio/audio.js';

beforeEach(() => {
  window.localStorage.clear();
  audio.music.stop();
});

describe('music tracks', () => {
  it('every track has 16-step bass and lead patterns of valid MIDI notes', () => {
    for (const track of Object.values(MUSIC_TRACKS)) {
      expect(track.bass.length).toBe(16);
      expect(track.lead.length).toBe(16);
      expect(track.bpm).toBeGreaterThan(40);
      for (const n of [...track.bass, ...track.lead]) {
        expect(n === 0 || (n >= 21 && n <= 108)).toBe(true); // rest or piano range
      }
    }
  });

  it('play/stop tracks the current BGM (even before an audio gesture)', () => {
    expect(audio.music.current()).toBeNull();
    audio.music.play('battle');
    expect(audio.music.current()).toBe('battle');
    audio.music.play('cozy'); // switching mid-play
    expect(audio.music.current()).toBe('cozy');
    audio.music.stop();
    expect(audio.music.current()).toBeNull();
  });

  it('ignores unknown track ids', () => {
    audio.music.play('nope' as never);
    expect(audio.music.current()).toBeNull();
  });

  it('fanfare never throws, with or without an AudioContext', () => {
    expect(() => audio.music.fanfare()).not.toThrow();
  });
});

describe('volume buses', () => {
  it('clamps to 0..1 and persists per device', () => {
    audio.setVolume('music', 5);
    expect(audio.getVolume('music')).toBe(1);
    audio.setVolume('music', -2);
    expect(audio.getVolume('music')).toBe(0);
    audio.setVolume('sfx', 0.4);
    expect(audio.getVolume('sfx')).toBeCloseTo(0.4);
    const raw = window.localStorage.getItem('interverse:audio');
    expect(raw).toContain('0.4');
  });
});
