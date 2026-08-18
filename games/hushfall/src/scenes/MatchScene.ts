import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Text } from 'pixi.js';
import {
  Camera,
  Entity,
  Scene,
  Timer,
  Tween,
  VirtualJoystick,
  Wobble,
  blobCharacter,
  buildTileMapView,
  darken,
  easings,
  moveWithCollision,
  solidAt,
  tileMapFromRows,
  verium,
} from '@interverse/engine';
import type { TileMapData } from '@interverse/engine';
import type { Session } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { classById, statsFor } from '../classes.js';
import { NIGHT, setDroneMood, setTerror, sting, updateHeartbeat } from '../theme.js';
import { accessoryView } from '../accessories.js';
import { LEVELS, TILE_SIZE, legend, levelRows, painters } from '../map.js';
import { makeText } from '../text.js';
import { addClassXp, saveLastRoom, clearLastRoom, recordPref, voicePref } from '../store.js';
import { ScreenRecorder, recordingSupported } from '../recorder.js';
import { ProximityVoice, isVcSignal, voiceSupported, type VcSignal } from '../voice.js';
import { MenuScene } from './MenuScene.js';
import type { RosterState } from './LobbyScene.js';

const SEND = 0.1;
const LANTERN_RADIUS = 96;
const LANTERN_SECONDS = 8; // one hider lights a lantern in ~8s (faster in a group)
const ATTACK_RANGE = 170; // the Seeker strikes from a fair reach (longer than melee)
// Fog of war: a small lit disc around you, darkness beyond. Vision is tight by
// default and only grows with an ability (Flashlight / Third Eye).
const FOG_CLEAR = 210; // fully lit within this radius (design units)
const FOG_DARK = 360; // fully dark beyond this radius
const FOG_SPRITE_R = 2000; // fog texture reach (must cover the screen)
const SEEKER_SIGHT_FULL = 190;
const SEEKER_SIGHT_FADE = 320;
const HIDER_SIGHT_FULL = 240;
const HIDER_SIGHT_FADE = 380;
const VISION_BOOST = 2.3; // how much Flashlight / Third Eye widens your vision
const VISION_BOOST_SECS = 6;
// Hiding: a hider inside a hiding spot is invisible to the Seeker (and can't be
// struck) until the Seeker searches — steps within SEARCH_RADIUS of them.
const HIDE_RADIUS = 68;
const SEARCH_RADIUS = 104;
const REVIVE_RADIUS = 86;
const REVIVE_SECONDS = 4;
const BLEED_SECONDS = 30;
// Hiders take TWO hits: a first strike injures (they can still run), a second
// downs them. An injured hider slowly patches up while tucked in a hiding spot.
const HEAL_SECONDS = 6;
// Each hider has this many lives: going down a third time is the end — no
// bleed-out, no rescue. (Bleeding out fully also still eliminates.)
const LIVES = 3;
// Caught hiding? The Seeker's first strike smashes the hiding spot itself
// (flushing everyone out of it) — it takes an extra hit to hurt you.
const BUST_SECONDS = 25;
// Frost's Ice Snap: the Seeker is frozen solid for a moment.
const FREEZE_SECONDS = 1.6;
// Anti-camping: the map holds one MORE lantern than the gate needs, so a
// Seeker guarding a single lantern guards nothing. And if the hunt drags on
// past dawn, the gate creaks open on its own.
const DAWN_BASE_SECONDS = 300; // 5 min on a 5-lantern map, +30s per extra
const GATE_RADIUS = 90;
// The hunt opens with a HIDE PHASE: the Seeker stands blindfolded and
// counting while the hiders scatter into the manor.
const HIDE_PHASE_SECONDS = 12;
// Lit lanterns cast real light: anyone inside the pool is visible to
// everyone (the reward has a risk), and the pools punch through the fog.
const LIGHT_FULL = 150;
const LIGHT_FADE = 260;
const SNARE_RADIUS = 60;
const SNARE_SECONDS = 2.6;
// Weaver's Web Bolt: a ranged shot that SLOWS the nearest visible hider.
// The webbing is THICK — webbed prey moves at about a third of its speed.
const WEB_RANGE = 460;
const WEB_SECONDS = 3.2;
const WEB_SLOW = 0.35;
// A hider downed on their LAST life isn't a camp-able corpse: the dark
// drags their body to a random far corner, where allies can still save
// them before they bleed out.
const DRAG_MIN_DIST = 900;
// Teleporter pads (hiders only): step on one, ride it to its twin at the
// far end of the manor. ONE cooldown is shared by the whole pair — after
// any ride the pads go dark for EVERYONE until they hum again.
const TELEPORT_RADIUS = 70;
const TELEPORT_CD = 30;
const VANISH_SECONDS = 4.5;
const DECOY_SECONDS = 8;
// Siren's Dazzle: white-out the Seeker's screen — but only from close enough
// that using it is a gamble.
const BLIND_RANGE = 640;
const BLIND_SECONDS = 2.6;
// Nester's Pop-up Dens: conjured hiding spots. She can keep NEST_MAX alive;
// the next one folds her oldest den away. A Seeker strike smashes a den for
// good (unlike furniture, which recovers).
const NEST_MAX = 3;
// Wraith: cloaks from every hider's sight, and at the hunt's opening drags
// one random BOT hider over to the dark side (humans stay human).
const CLOAK_SECONDS = 4;
// Seekers only spot a Nester den when they're REALLY close — standing in
// the petals, basically. A patch a room away is just darkness to them.
const NEST_SEE_FULL = 70;
const NEST_SEE_FADE = 120;
// Every hider can SPRINT: a short burst on its own cooldown. Escape tool,
// not a stat — natural speeds still never beat a seeker's.
const SPRINT_SECS = 1.1;
const SPRINT_MUL = 1.45;
const SPRINT_CD = 7;
// Sprinter's Split: clone bots that scatter, pop on a hit, or expire.
const CLONE_SECONDS = 8;
// Twin's dummy: whispers to its owner when hiders wander near.
const DUMMY_ALERT = 300;
const DUMMY_PING_EVERY = 3;
// Builder's Barricade: a wall only SEEKERS collide with.
const WALL_SECONDS = 6;
const WALL_RADIUS = 55;
// Kaiju's Atomic Blast: seekers in range are hurled away.
const BLAST_RADIUS = 380;
const BLAST_PUSH = 340;
// Trickster's Decoy now also fades the caster for a blink.
const DECOY_FADE_SECS = 1.6;
// Frostbite Armor (Frost passive): striking the Frost chills the attacker.
const FROSTBITE_SLOW_SECS = 2.5;
// Second Wind (Medic passive): a downed Medic rises alone — once in a while.
const SELF_REZ_DELAY = 3.5;
const SELF_REZ_CD = 120;
// Howler rework: Screech makes every hider leave a glowing trail on the
// ground that only seekers can see — footprints in the dark.
const TRAIL_SECONDS = 7;
const TRAIL_DOT_LIFE = 3.2;
// Medic's Mend now reaches across the room.
const MEND_RANGE = 520;
// Pocket Portal (Engineer passive): Overcharge also builds a temporary pad
// linked to the manor teleporter FARTHEST from it. Rides run on their OWN
// cooldown — the manor pads' shared cooldown is never touched.
const TEMP_TP_LIFE = 45;
const TEMP_TP_CD = 8;
// Building a pad is its own SECOND BUTTON for Engineers who own the passive.
// The cooldown matches the pad's lifetime — about one live pad at a time.
const TPAD_BTN_CD = 45;
// Lv4 specials for the rest of the survivor roster.
const GHOST_FADE_SECS = 2.2; // Death Fade: vanish after surviving a strike
const LULLABY_RANGE = 520; // Lullaby: song reach
const LULLABY_SLOW_SECS = 3;
const KICKBACK_PUSH = 220; // Kickback: how far the striker is hurled
const AFTERIMAGE_LIFE = 7; // Afterimage: frozen clone lifetime
const RUBBLE_LIFE = 10; // Rubble Snare: how long crumbled walls stay dangerous
const RUBBLE_RADIUS = 70;
const RUBBLE_ROOT_SECS = 2;
// Seeker Lv4 specials.
const SCENT_CD = 40; // Stalker: sniff out the nearest survivor
const SCENT_SECS = 4;
const ECHO_CD = 6; // Howler: one ability-ping per this many seconds
const IRON_GAZE_SLOW = 2; // Warden: dread-slow on revealed hiders
const TANGLE_RANGE = 300; // Weaver: splash reach from the first target
const TRAP_REARM_SECS = 4; // Trapper: a rebuilt snare arms after this
const SHROUD_MUL = 1.15; // Wraith: cloaked glide speed
/** ACTIVE specials — Lv4 passives that unlock a SECOND button. Everything
 *  else in the Lv4 tier triggers on its own. */
const SPECIALS: Record<string, { upId: string; abilityId: string; emoji: string; cd: number }> = {
  engineer: { upId: 'engineer3', abilityId: 'tpad', emoji: '🌀', cd: TPAD_BTN_CD },
  trickster: { upId: 'trickster3', abilityId: 'swap', emoji: '🎭', cd: 25 },
  siren: { upId: 'siren3', abilityId: 'lullaby', emoji: '🎶', cd: 35 },
  stalker: { upId: 'stalker3', abilityId: 'scent', emoji: '🐾', cd: SCENT_CD },
};
// Sixth Sense (Scout passive): the arrow flares alone when a Seeker is near.
const SCOUT_WARN_DIST = 340;
const SCOUT_WARN_CD = 20;
const SCOUT_WARN_SECS = 2.5;
// Town Crier (Lookout passive): Sense hands the arrow to every survivor.
const TOWN_CRIER_SECS = 4;
// Lookout's Sense: besides the reveal, an arrow TRACKS the Seeker live.
const SENSE_ARROW_SECS = 8;
const BOT_FLEE_DIST = 250;
const BOT_ATTACK_EVERY = 1.2;

interface PosMsg {
  type: 'pos';
  x: number;
  y: number;
}
interface AbilityMsg {
  type: 'ability';
  id: string;
  x: number;
  y: number;
}
interface AttackMsg {
  type: 'attack';
}
interface RevealFx {
  type: 'reveal';
  points: { x: number; y: number }[];
  color: number;
  secs: number;
}
interface Fx {
  type: 'fx';
  kind:
    | 'down'
    | 'hurt'
    | 'heal'
    | 'rescue'
    | 'lantern'
    | 'gate'
    | 'escape'
    | 'snare'
    | 'decoy'
    | 'attack'
    | 'screech'
    | 'poof'
    | 'bust'
    | 'freeze'
    | 'dead'
    | 'release'
    | 'teleport'
    | 'web'
    | 'dragged'
    | 'hatch'
    | 'blind'
    | 'nest'
    | 'convert'
    | 'wall'
    | 'blast'
    | 'dummy'
    | 'dummyping'
    | 'tpad'
    | 'warn'
    | 'lull';
  x: number;
  y: number;
  id?: string;
  /** teleport destination — the ridden player warps themselves here. */
  tx?: number;
  ty?: number;
}
interface Snap {
  type: 'snap';
  players: Record<string, { x: number; y: number }>;
  lant: number[];
  gate: boolean;
  down: Record<string, number>;
  esc: string[];
  out: string[];
  hidden: string[];
  vanished: string[];
  rooted: string[];
  hurt: string[];
  downs: Record<string, number>;
  busted: number[];
  dawn: number;
  decoys: { x: number; y: number }[];
  phase: string;
  hideL: number;
  /** shared teleporter cooldown remaining (0 = pads ready). */
  tp: number;
  slowed: string[];
  traps: { x: number; y: number }[];
  hatch: boolean;
  /** Nester's conjured hiding spots (oldest first). */
  nests: { x: number; y: number }[];
  /** Hiders the Wraith turned to the dark side (now seekers). */
  conv: string[];
  /** Howler trail seconds remaining (seekers see hider footprints). */
  trail: number;
  /** Sprinter clone bots on the loose (n = the owner's name — the disguise). */
  cl: { x: number; y: number; n?: string }[];
  /** Twin dummies standing in the dark. */
  dm: { x: number; y: number }[];
  /** Builder walls (block SEEKERS only). */
  wl: { x: number; y: number }[];
  /** Engineer Pocket Portal pads (temporary, own cooldown). */
  tpads: { x: number; y: number }[];
  /** Builder Rubble Snare piles (crumbled walls, seeker-rooting). */
  rb: { x: number; y: number }[];
}
/** What each player DID this hunt — shown on the end screen and paid out. */
interface Deeds {
  lit: number;
  res: number;
  down: number;
}
interface EndMsg {
  type: 'end';
  result: string;
  stats?: Record<string, Deeds>;
}
interface ToLobbyMsg {
  type: 'toLobby';
}
interface HelloMsg {
  type: 'hello';
}

type Msg = PosMsg | AbilityMsg | AttackMsg | RevealFx | Fx | Snap | EndMsg | ToLobbyMsg | HelloMsg;

interface Remote {
  entity: Entity;
  body: Container;
  targetX: number;
  targetY: number;
  mark: Graphics;
}

/** Radial darkness texture: transparent core, opaque beyond, cached once. */
let fogTexture: Texture | null = null;
function getFogTexture(): Texture | null {
  if (fogTexture) return fogTexture;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const clear = FOG_CLEAR / FOG_SPRITE_R;
  const dark = FOG_DARK / FOG_SPRITE_R;
  g.addColorStop(0, 'rgba(4,3,10,0)');
  g.addColorStop(clear, 'rgba(4,3,10,0)');
  g.addColorStop((clear + dark) / 2, 'rgba(4,3,10,0.82)');
  g.addColorStop(dark, 'rgba(4,3,10,0.995)');
  g.addColorStop(1, 'rgba(4,3,10,0.995)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  fogTexture = Texture.from(canvas);
  return fogTexture;
}

/** 1 within `full`, 0 beyond `fade`, linear between. */
function sightAlpha(dist: number, full: number, fade: number): number {
  if (dist <= full) return 1;
  if (dist >= fade) return 0;
  return (fade - dist) / (fade - full);
}

export class MatchScene extends Scene {
  private map!: TileMapData;
  private mapLayer!: Container;
  private tileView!: Container;
  private uiLayer!: Container;
  private camera!: Camera;
  private me!: Entity;
  private meBody!: Container;
  private joystick!: VirtualJoystick;
  private remotes = new Map<string, Remote>();
  private hostPositions: Record<string, { x: number; y: number }> = {};
  private sendIn = 0;
  private t = 0;
  private walk = 0;
  private live = true;
  private unsub: (() => void)[] = [];

  // shared/derived
  private amSeeker = false;
  private level = 0;
  private seekerId = '';
  private spawn = { x: 0, y: 0 };
  private seekerSpawn = { x: 0, y: 0 };
  private lanternPts: { x: number; y: number }[] = [];
  private hidePts: { x: number; y: number }[] = [];
  private gatePt = { x: 0, y: 0 };
  private teleportPts: { x: number; y: number }[] = [];
  private hatchPt = { x: 0, y: 0 };

  // host sim state
  private lant: number[] = [];
  private needed = 1; // lanterns required (one less than the map holds)
  private dawnAt = DAWN_BASE_SECONDS; // game-time when dawn opens the gate
  private gateOpen = false;
  private down: Record<string, number> = {};
  private reviveProg: Record<string, number> = {};
  private hurt = new Set<string>(); // injured hiders (one hit taken, not yet down)
  private healProg: Record<string, number> = {};
  private downsTaken: Record<string, number> = {}; // lives spent per hider
  private bustedUntil: number[] = []; // per hide spot: busted (no cover) until t
  private escaped = new Set<string>();
  private out = new Set<string>();
  private vanishUntil: Record<string, number> = {};
  private rootUntil: Record<string, number> = {};
  private slowUntil: Record<string, number> = {};
  private hatchOpen = false;
  private traps: {
    x: number;
    y: number;
    s?: number;
    owner?: string;
    armAt?: number; // rebuilt snares arm after a beat
    re?: boolean; // each snare rebuilds at most once
  }[] = [];
  private nests: { x: number; y: number; owner?: string }[] = [];
  private converted: string[] = []; // hiders the Wraith turned (host truth)
  private trailUntil = 0; // Howler trail active until this game-time
  private hits: Record<string, number> = {}; // damage taken toward next DOWN
  private clones: {
    x: number;
    y: number;
    ang: number;
    until: number;
    owner: string;
    spd?: number; // afterimages stand perfectly still
  }[] = [];
  private dummies: Record<string, { x: number; y: number }> = {}; // twin doubles
  private dummyPingAt: Record<string, number> = {};
  private walls: { x: number; y: number; until: number; owner?: string }[] = [];
  private rubble: { x: number; y: number; until: number }[] = [];
  private selfRezAt: Record<string, number> = {}; // Second Wind pending rise
  private selfRezCd: Record<string, number> = {}; // Second Wind per-player cd
  private decoys: { x: number; y: number; until: number; owner?: string }[] = [];
  private phase = 'hiding';
  private hideLeft = HIDE_PHASE_SECONDS;
  private deeds: Record<string, Deeds> = {};
  private tpReadyAt = 0; // game-time when the SHARED teleporter cooldown ends
  // Pocket Portal pads arm only after everyone steps OFF — otherwise the
  // Engineer would be yeeted across the manor the instant they build one.
  private tempPads: { x: number; y: number; until: number; armed: boolean }[] = [];
  private tempTpReadyAt = 0; // temp-pad rides cool down SEPARATELY from manor pads
  private warnAt: Record<string, number> = {}; // Sixth Sense per-scout next warn

  // client mirror
  private snapLant: number[] = [];
  private snapGate = false;
  private snapDown: Record<string, number> = {};
  private snapHidden = new Set<string>();
  private snapVanished = new Set<string>();
  private snapRooted = new Set<string>();
  private snapHurt = new Set<string>();
  private snapDowns: Record<string, number> = {};
  private snapBusted = new Set<number>();
  private snapDawn = DAWN_BASE_SECONDS;
  private snapHideLeft = HIDE_PHASE_SECONDS;
  private snapTpCd = 0;
  private snapSlowed = new Set<string>();
  private snapHatch = false;
  private snapNests: { x: number; y: number }[] = [];
  private snapConv: string[] = [];
  private snapTrail = 0;
  private snapClones: { x: number; y: number }[] = [];
  private snapDums: { x: number; y: number }[] = [];
  private snapWalls: { x: number; y: number }[] = [];
  private snapTpads: { x: number; y: number }[] = [];
  private snapRubble: { x: number; y: number }[] = [];
  private cloneViews: Container[] = [];
  private dumViews: Container[] = [];
  private wallViews: Graphics[] = [];
  private tpadViews: Graphics[] = [];
  private rubbleViews: Graphics[] = [];
  private trailDotAt = 0; // client throttle for trail dot spawning
  private trailDots: { x: number; y: number; born: number }[] = [];
  private trailGlow: Graphics | null = null;

  // bots (host-simulated)
  private botAtkCd = 0;
  private botPaths = new Map<string, { goal: string; path: [number, number][]; idx: number }>();
  private botSearch: Record<string, number> = {}; // next time a bot may search furniture
  private botCd: Record<string, number> = {}; // per-bot ability cooldown
  private botBoost: Record<string, number> = {}; // dash/lunge speed-up until t

  // hiding (client)
  private hideTarget: { x: number; y: number } | null = null;
  private hiddenAmt = 0; // 0..1 eased "tucked in" amount for my own blob
  private healEst = 0; // local estimate of my heal-while-hidden progress (secs)

  // Siren blind (only ever fires on the Seeker's client)
  private blindG: Graphics | null = null;
  private blindLeft = 0;
  private blindsTaken = 0;

  // Opt-in extras (settings): proximity voice + screen recording
  private voice: ProximityVoice | null = null;
  private recorder = new ScreenRecorder();
  private recordBtn: UIButton | null = null;
  private recDot: Graphics | null = null; // pulsing "REC" light while recording

  // Lookout's Sense tracking arrow (client-local)
  private senseUntil = 0;
  private senseArrowG: Graphics | null = null;

  // Universal hider sprint (client-local burst)
  private sprintBtn: UIButton | null = null;
  private sprintUntil = 0;
  private sprintCdLeft = 0;

  // PC controls: WASD/arrows move, E = ability, Q = special, Space/Shift =
  // sprint, and (seekers) left-click = attack. Purely additive — touch
  // controls are untouched.
  private heldKeys = new Set<string>();
  private clickCatcher: Graphics | null = null;
  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      this.heldKeys.add(k);
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (k === 'e') this.tryAbility();
    else if (k === 'q' && this.specialBtn) this.trySpecial();
    else if ((k === ' ' || k === 'shift') && !this.amSeeker) {
      this.trySprint();
      e.preventDefault();
    }
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.key.toLowerCase());
  };
  /** WASD/arrow direction, normalized — zero when nothing is held. */
  private keyVector(): { x: number; y: number } {
    const k = this.heldKeys;
    const x =
      (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const y = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (!x && !y) return { x: 0, y: 0 };
    const m = Math.hypot(x, y);
    return { x: x / m, y: y / m };
  }
  /** Seekers only: a full-screen catcher UNDER the UI buttons so a mouse
   *  click anywhere in the world swings the attack. Hiders keep their
   *  tap-to-hide, which this would otherwise swallow. */
  private addClickAttack(): void {
    if (this.clickCatcher) return;
    this.clickCatcher = new Graphics();
    this.clickCatcher.eventMode = 'static';
    this.clickCatcher.on('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && ev.button === 0) this.tryAttack();
    });
    this.uiLayer.addChildAt(this.clickCatcher, 0);
    this.layoutClickCatcher();
  }
  private layoutClickCatcher(): void {
    this.clickCatcher
      ?.clear()
      .rect(0, 0, this.game.viewWidth, this.game.viewHeight)
      .fill({ color: 0xffffff, alpha: 0.0001 });
  }

  // Active special passives get their own SECOND button (Pocket Portal).
  private specialBtn: UIButton | null = null;
  private specialCdLeft = 0;
  private specialLbl = '';
  private specialDef: { upId: string; abilityId: string; emoji: string; cd: number } | null = null;
  // Host truth: per-player active-special cooldown (clients can't skip it).
  private specialCdAt: Record<string, number> = {};
  private echoCdAt: Record<string, number> = {}; // Howler Echolocation pings

  // local ability
  private cooldownLeft = 0;
  private boostUntil = 0;
  private boostFactor = 1;
  private visionBoostUntil = 0;
  private fogBaseScale = 1;
  private abilityUses = 0;
  private revealSeen = 0;
  private attackCd = 0;

  // HUD
  private hud!: Text;
  private roleHud!: Text;
  private roleHudBase = '';
  private terrorVignette!: Graphics;
  private fog: Sprite | null = null;
  private abilityBtn!: UIButton;
  private attackBtn: UIButton | null = null;
  private homeBtn!: UIButton;
  private codeHud!: Text;
  private myBar!: Graphics;
  private partyPanel!: Container;
  private downSignals!: Container;
  private downArrows = new Map<string, { root: Container; arrow: Graphics; label: Text }>();
  private decoyViews: Entity[] = [];
  private endShown = false;

  constructor(
    private readonly session: Session,
    private readonly roster: RosterState,
  ) {
    super();
  }

  protected override onResize(w: number, h: number): void {
    this.layoutUi(w, h);
  }

  private layoutUi(W: number, H: number): void {
    this.joystick?.position.set(160, H - 180);
    this.abilityBtn?.position.set(W - 118, H - 130);
    this.sprintBtn?.position.set(W - 252, H - 112);
    this.specialBtn?.position.set(W - 118, this.amSeeker ? H - 460 : H - 290);
    this.layoutClickCatcher();
    this.attackBtn?.position.set(W - 118, H - 300);
    this.homeBtn?.position.set(W - 46, 44);
    this.recordBtn?.position.set(W - 46, 118);
    this.recDot?.position.set(W - 22, 94);
    this.codeHud?.position.set(W / 2, 40);
    this.blindfold?.position.set(W / 2, H / 2);
    this.blindG?.position.set(W / 2, H / 2);
    this.hud?.position.set(16, 74);
    this.roleHud?.position.set(16, 110);
    this.partyPanel?.position.set(16, 150);
    this.terrorVignette?.clear();
    this.terrorVignette?.rect(0, 0, W, H).fill({ color: NIGHT.blood, alpha: 0.5 });
    this.camera?.setViewSize(W, H);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const session = this.session;
    this.seekerId = this.roster.seekerId ?? this.roster.order[0] ?? session.id;
    this.amSeeker = this.seekerId === session.id;
    if (!session.isHost) saveLastRoom(session.code);

    this.level = this.roster.level ?? 0;
    setDroneMood(this.level); // every manor hums its own chord
    this.map = tileMapFromRows(levelRows(this.level, this.roster.salt ?? 0), TILE_SIZE, legend);
    this.mapLayer = new Container();
    this.uiLayer = new Container();
    this.stage.addChild(this.mapLayer, this.uiLayer);
    this.tileView = buildTileMapView(this.map, painters);
    this.mapLayer.addChildAt(this.tileView, 0);

    const spawnObj = this.map.objects.find((o) => o.name === 'spawn') ?? { x: 800, y: 1600 };
    const seekObj = this.map.objects.find((o) => o.name === 'seekerspawn') ?? { x: 800, y: 800 };
    const gateObj = this.map.objects.find((o) => o.name === 'gate') ?? { x: 800, y: 120 };
    this.spawn = { x: spawnObj.x, y: spawnObj.y };
    this.seekerSpawn = { x: seekObj.x, y: seekObj.y };
    this.gatePt = { x: gateObj.x, y: gateObj.y };
    this.lanternPts = this.map.objects
      .filter((o) => o.name === 'lantern')
      .map((o) => ({ x: o.x, y: o.y }));
    this.hidePts = this.map.objects
      .filter((o) => o.name === 'hide')
      .map((o) => ({ x: o.x, y: o.y }));
    this.teleportPts = this.map.objects
      .filter((o) => o.name === 'teleport')
      .map((o) => ({ x: o.x, y: o.y }));
    const hatchObj = this.map.objects.find((o) => o.name === 'hatch');
    this.hatchPt = hatchObj ? { x: hatchObj.x, y: hatchObj.y } : { ...this.gatePt };
    this.lant = this.lanternPts.map(() => 0);
    this.snapLant = this.lanternPts.map(() => 0);
    this.bustedUntil = this.hidePts.map(() => 0);
    this.needed = Math.max(1, this.lanternPts.length - 1);
    this.dawnAt =
      HIDE_PHASE_SECONDS + DAWN_BASE_SECONDS + Math.max(0, this.lanternPts.length - 5) * 30;

    this.drawObjectives();

    // My blob.
    const myIndex = Math.max(0, this.roster.order.indexOf(session.id));
    const mine = this.makeBlob(session.id, true);
    this.me = mine.entity;
    this.meBody = mine.body;
    const start = this.amSeeker ? this.seekerSpawn : this.spawn;
    this.me.position.set(start.x + (myIndex - 3) * 40, start.y + (myIndex % 2) * 40);
    this.add(this.me, this.mapLayer);
    this.hostPositions[session.id] = { x: this.me.x, y: this.me.y };
    if (!session.isHost) session.send({ type: 'pos', x: this.me.x, y: this.me.y });

    for (const id of this.roster.order) {
      if (id === session.id) continue;
      this.spawnRemote(id);
    }

    this.camera = new Camera(this.mapLayer, W, H, { deadzoneWidth: 100, deadzoneHeight: 140 });
    this.camera.setBounds(0, 0, this.map.width * TILE_SIZE, this.map.height * TILE_SIZE);
    this.camera.follow(this.me);

    this.buildHud();
    this.layoutUi(W, H);
    this.installDebug();

    this.unsub.push(
      session.onMessage((from, data) => {
        if (!this.live) return;
        // Voice signaling rides the same session. The host relays
        // joiner↔joiner packets (the room is a star, not a mesh).
        if (isVcSignal(data)) {
          if (session.isHost && data.vto !== session.id && data.vto !== '*') {
            session.sendTo(data.vto, data);
            return;
          }
          if (session.isHost && data.vto === '*' && from !== session.id) {
            this.session.broadcast(data); // fan the hello out to everyone else
          }
          this.voice?.handleSignal(data);
          return;
        }
        this.onNet(from, data as Msg);
      }),
      session.onPlayerLeave((id) => {
        if (!this.live) return;
        console.warn('[hushfall] player left mid-match:', id, this.roster.names[id] ?? '');
        const r = this.remotes.get(id);
        if (r) {
          this.remove(r.entity);
          this.remotes.delete(id);
        }
        delete this.hostPositions[id];
      }),
      session.onClose((reason) => {
        if (!this.live) return;
        console.error(
          '[hushfall] session closed mid-match:',
          reason,
          '(room',
          this.session.code,
          ')',
        );
        this.roleHud.text = `disconnected: ${reason}`;
        const back = new Entity();
        back.addBehavior(
          new Timer(2.4, () => {
            window.history.replaceState(null, '', window.location.pathname);
            this.game.scenes.replace(new MenuScene());
          }),
        );
        this.add(back);
      }),
    );
    if (session.isHost) {
      this.unsub.push(
        session.onPlayerJoin((p) => {
          if (this.live) session.sendTo(p.id, { type: 'inprogress' });
        }),
      );
    }

    // Proximity voice: only if THIS device opted in (Settings; default off).
    if (voicePref() && voiceSupported()) {
      const sendVc = (pkt: VcSignal): void => {
        if (session.isHost) {
          if (pkt.vto === '*') session.broadcast(pkt);
          else session.sendTo(pkt.vto, pkt);
        } else {
          session.send(pkt); // the host relays it on
        }
      };
      this.voice = new ProximityVoice(session.id, sendVc);
      void this.voice.start().then((ok) => {
        if (!ok && this.live) {
          this.roleHud.text = '🎙️ voice chat off — mic unavailable or denied';
        }
      });
    }
  }

  protected override onExit(): void {
    this.live = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    for (const u of this.unsub) u();
    this.unsub = [];
    delete window.__hushfall;
    setTerror(0);
    setDroneMood(0); // back to the menu's ambience
    this.voice?.stop();
    this.voice = null;
    this.recorder.stop(); // an in-flight clip still saves
  }

  // ------------------------------------------------------------- visuals

  private objectiveLayer!: Container;
  private lanternViews: { g: Graphics; ring: Graphics }[] = [];
  private gateView!: Graphics;
  private hideGlow!: Graphics;
  private hideViews: Graphics[] = [];
  private tpViews: Graphics[] = [];
  private hatchView!: Graphics;
  private trapLayer!: Container;
  private trapViews: Graphics[] = [];
  private nestViews: Graphics[] = [];

  private drawObjectives(): void {
    this.objectiveLayer = new Container();
    this.mapLayer.addChildAt(this.objectiveLayer, 1);
    this.lanternViews = this.lanternPts.map((p) => {
      const g = new Graphics();
      g.position.set(p.x, p.y);
      const ring = new Graphics();
      ring.position.set(p.x, p.y);
      this.objectiveLayer.addChild(ring, g);
      return { g, ring };
    });
    this.gateView = new Graphics();
    this.gateView.position.set(this.gatePt.x, this.gatePt.y);
    this.objectiveLayer.addChild(this.gateView);
    // Teleporter pads: arcane rune circles at the manor's far ends.
    this.tpViews = this.teleportPts.map((p) => {
      const g = new Graphics();
      g.position.set(p.x, p.y);
      this.objectiveLayer.addChild(g);
      return g;
    });
    // The dawn hatch: a bolted cellar grate until dawn breaks it open.
    this.hatchView = new Graphics();
    this.hatchView.position.set(this.hatchPt.x, this.hatchPt.y);
    this.objectiveLayer.addChild(this.hatchView);
    // Trapper snares render from snap data (seeker sees them plainly;
    // hiders get only the faintest glint to spot with sharp eyes).
    this.trapLayer = new Container();
    this.objectiveLayer.addChild(this.trapLayer);
    // Hiding spots: a mix of furniture you can duck into — wardrobes, desks
    // (crawl under) and big potted plants — so they blend into the rooms
    // instead of reading as identical doors. Tap one to auto-walk in and hide.
    this.hideGlow = new Graphics();
    this.objectiveLayer.addChildAt(this.hideGlow, 0);
    this.hidePts.forEach((p, i) => {
      const g = new Graphics();
      g.position.set(p.x, p.y);
      const kind = i % 3;
      if (kind === 0) {
        // Wardrobe with curtain folds.
        const w = 76;
        const h = 96;
        g.roundRect(-w / 2, -h / 2, w, h, 8).fill(0x2a2036);
        g.roundRect(-w / 2, -h / 2, w, h, 8).stroke({ color: NIGHT.violet, width: 2, alpha: 0.45 });
        for (let f = -1; f <= 1; f++) {
          g.roundRect(f * 20 - 8, -h / 2 + 6, 16, h - 12, 6).fill({ color: 0x3a2c4e, alpha: 0.9 });
        }
        g.circle(w / 2 - 14, 0, 4).fill(NIGHT.lantern); // little handle
      } else if (kind === 1) {
        // Writing desk — a shadowed crawl space beneath the top.
        const w = 96;
        const h = 66;
        g.roundRect(-w / 2 + 8, -6, 14, h / 2 + 6, 3).fill(NIGHT.woodDark);
        g.roundRect(w / 2 - 22, -6, 14, h / 2 + 6, 3).fill(NIGHT.woodDark);
        g.roundRect(-w / 2 + 12, -2, w - 24, h / 2 - 4, 3).fill({ color: 0x000000, alpha: 0.45 });
        g.roundRect(-w / 2, -h / 2, w, 22, 6).fill(NIGHT.wood);
        g.roundRect(-w / 2, -h / 2, w, 22, 6).stroke({ color: NIGHT.woodDark, width: 3 });
        g.roundRect(-w / 2 + 10, -h / 2 + 5, 26, 12, 3).fill(NIGHT.woodDark); // drawer
        g.circle(-w / 2 + 23, -h / 2 + 11, 2.5).fill(NIGHT.lantern);
      } else {
        // Big potted plant — leafy enough to vanish behind.
        g.roundRect(-24, 18, 48, 30, 6).fill(NIGHT.pot);
        g.roundRect(-24, 18, 48, 10, 4).fill(darken(NIGHT.pot, 0.25));
        for (let l = 0; l < 7; l++) {
          const a = (l / 7) * Math.PI * 2;
          g.ellipse(Math.cos(a) * 22, -6 + Math.sin(a) * 20, 20, 14).fill(
            l % 2 ? NIGHT.leaf : NIGHT.leafDark,
          );
        }
        g.ellipse(0, -10, 18, 14).fill(NIGHT.leaf);
      }
      if (!this.amSeeker) {
        g.eventMode = 'static';
        g.cursor = 'pointer';
        // Generous tap target around the prop.
        g.hitArea = new Rectangle(-96, -96, 192, 192);
        const at = { x: p.x, y: p.y };
        g.on('pointertap', () => this.tapHide(at));
      }
      this.hideViews.push(g);
      this.objectiveLayer.addChildAt(g, 1); // behind lanterns/gate, above the glow
    });
    this.redrawObjectives();
  }

  private redrawObjectives(): void {
    this.lanternViews.forEach((lv, i) => {
      const p = this.snapLant[i] ?? 0;
      lv.g.clear();
      const lit = p >= 1;
      // post
      lv.g.roundRect(-6, -10, 12, 46, 4).fill(0x2a2740);
      // lamp
      lv.g.circle(0, -26, 18).fill(lit ? NIGHT.lanternLit : 0x4a4460);
      lv.g.circle(0, -26, 18).stroke({ color: lit ? NIGHT.lantern : NIGHT.inkSoft, width: 3 });
      // Lit lanterns blaze; unlit ones give a faint glimmer so they can still
      // be found in the dark.
      lv.g.circle(0, -26, lit ? 36 : 26).fill({ color: NIGHT.lantern, alpha: lit ? 0.2 : 0.07 });
      // progress ring
      lv.ring.clear();
      lv.ring.circle(0, -26, 30).stroke({ color: 0x000000, alpha: 0.4, width: 6 });
      if (p > 0 && !lit) {
        lv.ring
          .arc(0, -26, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p))
          .stroke({ color: NIGHT.lantern, width: 6 });
      }
    });
    // Busted hiding spots slump over, faded — visibly no cover until they
    // recover.
    this.hideViews.forEach((g, i) => {
      const busted = this.snapBusted.has(i);
      g.alpha = busted ? 0.3 : 1;
      g.rotation = busted ? 0.18 : 0;
    });
    this.gateView.clear();
    const open = this.snapGate;
    this.gateView
      .roundRect(-60, -18, 120, 36, 8)
      .fill(open ? { color: NIGHT.gate, alpha: 0.28 } : { color: 0x14121e, alpha: 0.6 });
    for (let i = -1; i <= 1; i++) {
      this.gateView.roundRect(i * 40 - 6, -40, 12, 80, 4).fill(open ? NIGHT.gate : 0x3a3550);
    }
    if (open)
      this.gateView.circle(0, 0, GATE_RADIUS).stroke({ color: NIGHT.gate, alpha: 0.3, width: 3 });
    // Teleporter pads: humming violet runes when ready; dark with a filling
    // recharge arc while the SHARED cooldown ticks down.
    const tpReady = this.snapTpCd <= 0;
    for (const g of this.tpViews) {
      g.clear();
      const col = tpReady ? NIGHT.violet : 0x4a4460;
      if (tpReady) g.circle(0, 0, 46).fill({ color: NIGHT.violet, alpha: 0.14 });
      g.circle(0, 0, 30).stroke({ color: col, width: 4, alpha: tpReady ? 0.95 : 0.5 });
      g.circle(0, 0, 18).stroke({ color: col, width: 2, alpha: tpReady ? 0.6 : 0.35 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        g.circle(Math.cos(a) * 24, Math.sin(a) * 24, 3.5).fill({
          color: col,
          alpha: tpReady ? 0.9 : 0.5,
        });
      }
      if (!tpReady) {
        const frac = 1 - Math.min(1, this.snapTpCd / TELEPORT_CD);
        if (frac > 0.02) {
          g.arc(0, 0, 36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac).stroke({
            color: NIGHT.violet,
            width: 4,
            alpha: 0.7,
          });
        }
      }
    }
    // The dawn hatch — bolted shut until dawn, then a glowing way out.
    if (this.hatchView) {
      const hg = this.hatchView;
      hg.clear();
      const open2 = this.snapHatch;
      hg.roundRect(-44, -32, 88, 64, 10).fill(
        open2 ? { color: 0x0a1410, alpha: 0.9 } : { color: 0x1c1826, alpha: 0.9 },
      );
      hg.roundRect(-44, -32, 88, 64, 10).stroke({ color: open2 ? NIGHT.gate : 0x3a3550, width: 4 });
      if (open2) {
        hg.ellipse(0, 0, 26, 16).fill({ color: 0x000000, alpha: 0.85 });
        hg.ellipse(0, 0, 30, 20).stroke({ color: NIGHT.gate, width: 3, alpha: 0.8 });
        hg.circle(0, 0, GATE_RADIUS).stroke({ color: NIGHT.gate, alpha: 0.3, width: 3 });
      } else {
        for (let i = -1; i <= 1; i++) hg.rect(i * 22 - 4, -26, 8, 52).fill(0x3a3550);
        hg.circle(-32, -22, 3.5).fill(0x555070);
        hg.circle(32, 22, 3.5).fill(0x555070);
      }
    }
  }

  /** Trapper snares: obvious to the Seeker, a faint glint to hiders. */
  private syncTraps(list: { x: number; y: number }[]): void {
    while (this.trapViews.length > list.length) this.trapViews.pop()?.destroy();
    while (this.trapViews.length < list.length) {
      const g = new Graphics();
      const teeth = 8;
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        g.poly([
          Math.cos(a) * 26,
          Math.sin(a) * 26,
          Math.cos(a + 0.18) * 26,
          Math.sin(a + 0.18) * 26,
          Math.cos(a + 0.09) * 12,
          Math.sin(a + 0.09) * 12,
        ]).fill(0xbfc6d0);
      }
      g.circle(0, 0, 26).stroke({ color: 0x8a6a3b, width: 3 });
      g.alpha = this.amSeeker ? 0.9 : 0.14;
      this.trapLayer.addChild(g);
      this.trapViews.push(g);
    }
    list.forEach((tr, i) => this.trapViews[i]?.position.set(tr.x, tr.y));
  }

  /** Nester's pop-up dens — drawn as innocent flower patches. Hiders see
   *  them plainly (real cover, tappable like furniture); SEEKERS don't see
   *  them at all unless they're practically standing in the petals (the
   *  per-frame alpha lives in onUpdate). */
  private syncNests(list: { x: number; y: number }[]): void {
    const changed =
      list.length !== this.snapNests.length ||
      list.some((n, i) => n.x !== this.snapNests[i]?.x || n.y !== this.snapNests[i]?.y);
    this.snapNests = list.map((n) => ({ x: n.x, y: n.y }));
    if (!changed) return;
    while (this.nestViews.length > list.length) this.nestViews.pop()?.destroy();
    while (this.nestViews.length < list.length) {
      const g = new Graphics();
      // A patch of moon-flowers: grassy tuft, lavender blossoms, one pink.
      g.ellipse(0, 14, 42, 20).fill({ color: NIGHT.leafDark, alpha: 0.9 });
      g.ellipse(0, 10, 34, 15).fill({ color: NIGHT.leaf, alpha: 0.85 });
      const blooms: [number, number, number, number][] = [
        [-22, 2, 8, 0xd9b8ff],
        [14, -6, 9, 0xd9b8ff],
        [-2, 12, 7, 0xffb6d5],
        [26, 10, 7, 0xd9b8ff],
        [-12, -10, 6, 0xcfa8ff],
      ];
      for (const [bx, by, br, col] of blooms) {
        for (let pt = 0; pt < 5; pt++) {
          const a = (pt / 5) * Math.PI * 2;
          g.circle(bx + Math.cos(a) * br * 0.8, by + Math.sin(a) * br * 0.8, br * 0.55).fill(col);
        }
        g.circle(bx, by, br * 0.4).fill(NIGHT.lantern);
      }
      if (!this.amSeeker) {
        g.eventMode = 'static';
        g.cursor = 'pointer';
        g.hitArea = new Rectangle(-96, -96, 192, 192);
        g.on('pointertap', () => {
          const i = this.nestViews.indexOf(g);
          const n = this.snapNests[i];
          if (n) this.tapHide({ x: n.x, y: n.y });
        });
      } else {
        g.alpha = 0; // invisible to seekers until they're on top of it
      }
      this.trapLayer.addChild(g);
      this.nestViews.push(g);
    }
    list.forEach((n, i) => this.nestViews[i]?.position.set(n.x, n.y));
  }

  /** The Wraith turned these hiders — flip their role locally, rebuild their
   *  blob as a seeker, and refresh the party panel. Idempotent per id. */
  private applyConversions(conv: string[]): void {
    let changed = false;
    for (const id of conv) {
      if (this.snapConv.includes(id)) continue; // processed ids, NOT role —
      // on the host the role flipped in the sim already, but the blob
      // rebuild and party refresh still have to happen exactly once.
      this.snapConv.push(id);
      this.roster.roles[id] = 'seeker';
      changed = true;
      const r = this.remotes.get(id);
      if (r) {
        // Read the position BEFORE destroying — a removed entity's transform
        // is gone.
        const keepX = r.entity.x;
        const keepY = r.entity.y;
        this.remove(r.entity);
        this.remotes.delete(id);
        this.spawnRemote(id); // rebuilt with the seeker look
        const back = this.remotes.get(id);
        if (back) {
          back.entity.position.set(keepX, keepY);
          back.targetX = r.targetX;
          back.targetY = r.targetY;
        }
      }
    }
    if (changed) this.buildParty();
  }

  /** Howler trail: while it lasts, SEEKERS see fading footprints where every
   *  hider has been — dropped from each snap, throttled so long trails don't
   *  flood the scene. They render ABOVE the fog (drawTrailGlow), so a trail
   *  points the way even when the hider is far across the manor. */
  private dropTrailDots(players: Record<string, { x: number; y: number }>): void {
    if (this.snapTrail <= 0 || !this.amSeeker) return;
    if (this.t - this.trailDotAt < 0.18) return;
    this.trailDotAt = this.t;
    for (const [id, p] of Object.entries(players)) {
      if (this.isSeekerRole(id)) continue;
      if (this.snapDown[id] !== undefined || this.out.has(id) || this.escaped.has(id)) continue;
      this.trailDots.push({ x: p.x, y: p.y, born: this.t });
    }
    if (this.trailDots.length > 500) this.trailDots.splice(0, this.trailDots.length - 500);
  }

  /** Redraw the trail every frame in screen space, over the fog. */
  private drawTrailGlow(): void {
    if (!this.trailGlow) return;
    const g = this.trailGlow;
    g.clear();
    if (!this.trailDots.length) return;
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    let alive = 0;
    for (const d of this.trailDots) {
      const age = this.t - d.born;
      if (age >= TRAIL_DOT_LIFE) continue;
      this.trailDots[alive++] = d;
      const sx = d.x + this.mapLayer.x;
      const sy = d.y + this.mapLayer.y;
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      const fade = 1 - age / TRAIL_DOT_LIFE;
      g.circle(sx, sy, 8).fill({ color: NIGHT.lantern, alpha: 0.35 * fade });
      g.circle(sx, sy, 3.5).fill({ color: 0xfff2c8, alpha: 0.8 * fade });
    }
    this.trailDots.length = alive;
  }

  /** Sprinter clones: navy lookalikes wearing the OWNER'S NAME — a perfect
   *  disguise, indistinguishable from the real Sprinter. */
  private cloneLabels: Text[] = [];
  private syncClones(list: { x: number; y: number; n?: string }[]): void {
    this.snapClones = list;
    while (this.cloneViews.length > list.length) {
      this.cloneViews.pop()?.destroy({ children: true });
      this.cloneLabels.pop();
    }
    while (this.cloneViews.length < list.length) {
      const cls = classById('sprinter');
      const c = new Container();
      const char = blobCharacter({
        radius: 30,
        color: cls.color,
        seed: 40 + this.cloneViews.length,
        shadow: false,
      });
      char.body.addChild(cls.accessory(30));
      c.addChild(char.view);
      const label = makeText('?', 17, { color: NIGHT.ink, weight: 'bold' });
      label.position.set(0, 46);
      c.addChild(label);
      this.cloneLabels.push(label);
      this.mapLayer.addChild(c);
      this.cloneViews.push(c);
    }
    list.forEach((cl, i) => {
      this.cloneViews[i]?.position.set(cl.x, cl.y);
      const label = this.cloneLabels[i];
      if (label && cl.n && label.text !== cl.n) label.text = cl.n;
    });
  }

  /** Twin dummies: a full-size double of the Twin, standing too still. */
  private syncDums(list: { x: number; y: number }[]): void {
    this.snapDums = list;
    while (this.dumViews.length > list.length) this.dumViews.pop()?.destroy({ children: true });
    while (this.dumViews.length < list.length) {
      const cls = classById('twin');
      const c = new Container();
      const char = blobCharacter({
        radius: 40,
        color: cls.color,
        seed: 60 + this.dumViews.length,
        shadow: false,
      });
      char.body.addChild(cls.accessory(40));
      c.addChild(char.view);
      this.mapLayer.addChild(c);
      this.dumViews.push(c);
    }
    list.forEach((d, i) => this.dumViews[i]?.position.set(d.x, d.y));
  }

  /** Builder walls: a mound of conjured stone — everyone sees it, only
   *  SEEKERS bounce off (their movement code owns the collision). */
  private syncWalls(list: { x: number; y: number }[]): void {
    this.snapWalls = list;
    while (this.wallViews.length > list.length) this.wallViews.pop()?.destroy();
    while (this.wallViews.length < list.length) {
      const g = new Graphics();
      // A conjured stone CUBE (2.5D): front face, lit top, shaded side.
      const half = WALL_RADIUS * 0.82;
      const depth = half * 0.55;
      g.ellipse(0, half * 0.72, half * 1.25, 16).fill({ color: 0x000000, alpha: 0.35 });
      // front face
      g.roundRect(-half, -half * 0.5, half * 2, half * 1.2, 6).fill(0x6b6455);
      // top face (parallelogram, catches the moonlight)
      g.poly([
        -half,
        -half * 0.5,
        -half + depth,
        -half * 0.5 - depth,
        half + depth,
        -half * 0.5 - depth,
        half,
        -half * 0.5,
      ]).fill(0x8a8272);
      // right side (shadowed)
      g.poly([
        half,
        -half * 0.5,
        half + depth,
        -half * 0.5 - depth,
        half + depth,
        half * 0.7 - depth,
        half,
        half * 0.7,
      ]).fill(0x4a453a);
      // mortar lines on the front
      g.moveTo(-half, 0).lineTo(half, 0).stroke({ color: 0x4a453a, width: 3, alpha: 0.7 });
      g.moveTo(-half * 0.3, -half * 0.5)
        .lineTo(-half * 0.3, 0)
        .stroke({ color: 0x4a453a, width: 3, alpha: 0.7 });
      g.moveTo(half * 0.35, 0)
        .lineTo(half * 0.35, half * 0.7)
        .stroke({ color: 0x4a453a, width: 3, alpha: 0.7 });
      g.roundRect(-half, -half * 0.5, half * 2, half * 1.2, 6).stroke({
        color: 0x2e2a22,
        width: 3,
      });
      this.trapLayer.addChild(g);
      this.wallViews.push(g);
    }
    list.forEach((w, i) => this.wallViews[i]?.position.set(w.x, w.y));
  }

  /** Engineer Pocket Portal pads: brass-and-copper rune rings — clearly the
   *  Engineer's make, so nobody mistakes them for the manor's violet pads. */
  private syncTpads(list: { x: number; y: number }[]): void {
    this.snapTpads = list;
    while (this.tpadViews.length > list.length) this.tpadViews.pop()?.destroy();
    while (this.tpadViews.length < list.length) {
      const g = new Graphics();
      g.circle(0, 0, 52).fill({ color: 0xffc75f, alpha: 0.12 });
      g.circle(0, 0, 44).stroke({ color: 0xffc75f, width: 4, alpha: 0.85 });
      g.circle(0, 0, 30).stroke({ color: 0xffe6a8, width: 2, alpha: 0.6 });
      // Gear teeth around the rim — a built thing, not an arcane one.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.rect(Math.cos(a) * 44 - 4, Math.sin(a) * 44 - 4, 8, 8).fill(0xffc75f);
      }
      g.circle(0, 0, 8).fill({ color: 0xffe6a8, alpha: 0.9 });
      this.trapLayer.addChild(g);
      this.tpadViews.push(g);
    }
    list.forEach((p, i) => this.tpadViews[i]?.position.set(p.x, p.y));
  }

  /** Rubble Snare piles: a crumbled wall's stones — step in and get stuck. */
  private syncRubble(list: { x: number; y: number }[]): void {
    this.snapRubble = list;
    while (this.rubbleViews.length > list.length) this.rubbleViews.pop()?.destroy();
    while (this.rubbleViews.length < list.length) {
      const g = new Graphics();
      g.ellipse(0, 10, 46, 16).fill({ color: 0x000000, alpha: 0.3 });
      for (const [ox, oy, r] of [
        [-20, 4, 14],
        [8, -2, 17],
        [24, 8, 11],
        [-2, 12, 12],
      ] as const) {
        g.circle(ox, oy, r).fill(0x5a544a);
        g.circle(ox - 3, oy - 3, r * 0.55).fill(0x6b6455);
      }
      this.trapLayer.addChild(g);
      this.rubbleViews.push(g);
    }
    list.forEach((r, i) => this.rubbleViews[i]?.position.set(r.x, r.y));
  }

  private makeBlob(id: string, isMe: boolean): { entity: Entity; body: Container } {
    const cls = classById(this.roster.classes[id]);
    const isSeeker = this.roster.roles[id] === 'seeker';
    const e = new Entity();
    const char = blobCharacter({
      radius: isSeeker ? 40 : 30,
      color: cls.color,
      seed: 5 + this.roster.order.indexOf(id),
      strokeWidth: isMe ? 5 : 3,
    });
    char.body.addChild(cls.accessory(isSeeker ? 40 : 30));
    char.body.addChild(accessoryView(this.roster.accs?.[id], isSeeker ? 40 : 30));
    e.addChild(char.view);
    if (!isMe) e.addBehavior(new Wobble({ target: char.body, amount: 0.03, speed: 2.2 }));
    const label = makeText(this.roster.names[id] ?? '?', 17, {
      color: isSeeker ? NIGHT.blood : isMe ? NIGHT.gate : NIGHT.ink,
      weight: 'bold',
    });
    label.position.set(0, isSeeker ? 56 : 46);
    e.addChild(label);
    return { entity: e, body: char.body };
  }

  private spawnRemote(id: string): void {
    if (this.remotes.has(id) || id === this.session.id) return;
    const made = this.makeBlob(id, false);
    const isSeeker = this.roster.roles[id] === 'seeker';
    const base = isSeeker ? this.seekerSpawn : this.spawn;
    made.entity.position.set(base.x, base.y);
    const mark = new Graphics();
    made.entity.addChild(mark);
    this.add(made.entity, this.mapLayer);
    this.remotes.set(id, {
      entity: made.entity,
      body: made.body,
      targetX: base.x,
      targetY: base.y,
      mark,
    });
    // hostPositions is host-sim state. Joiners must NOT seed it — a stale
    // entry would shadow the live remote entity for terror/seeker tracking.
    if (this.session.isHost) this.hostPositions[id] = { x: base.x, y: base.y };
  }

  // --------------------------------------------------------------- HUD

  private buildHud(): void {
    // Fog of war sits at the very bottom of the UI layer: it darkens the map
    // (and everything in it) beyond a lit disc around you, but never the HUD.
    const tex = getFogTexture();
    if (tex) {
      this.fog = new Sprite(tex);
      this.fog.anchor.set(0.5);
      this.fogBaseScale = FOG_SPRITE_R / 256;
      this.fog.scale.set(this.fogBaseScale);
      this.uiLayer.addChild(this.fog);
    }
    // Light pools render ABOVE the fog so lit lanterns glow through it.
    this.lightGlow = new Graphics();
    this.uiLayer.addChild(this.lightGlow);
    // Howler trail: drawn ABOVE the fog in screen space, so the footprints
    // glow across the whole screen no matter how far the hider ran.
    this.trailGlow = new Graphics();
    this.uiLayer.addChild(this.trailGlow);
    this.terrorVignette = new Graphics();
    this.uiLayer.addChild(this.terrorVignette);
    this.compass = new Graphics();
    this.uiLayer.addChild(this.compass);

    this.joystick = new VirtualJoystick({ radius: 96 });
    this.add(this.joystick, this.uiLayer);

    const myCls = classById(this.roster.classes[this.session.id]);
    this.abilityBtn = new UIButton(myCls.ability.emoji, {
      width: 140,
      height: 140,
      fontSize: 56,
      fill: this.amSeeker ? NIGHT.violet : NIGHT.ghost,
      textColor: 0x140f1e,
      onTap: () => this.tryAbility(),
    });
    this.add(this.abilityBtn, this.uiLayer);

    if (!this.amSeeker) {
      // EVERY hider can sprint — a short burst on its own cooldown.
      this.sprintBtn = new UIButton('🏃', {
        width: 104,
        height: 104,
        fontSize: 44,
        fill: 0x2a3a4a,
        textColor: NIGHT.ink,
        onTap: () => this.trySprint(),
      });
      this.add(this.sprintBtn, this.uiLayer);
    }

    // ACTIVE specials (Pocket Portal, Switcheroo, Lullaby) get their own
    // button so the survivor chooses the moment — auto specials don't.
    const specialDef = SPECIALS[myCls.id];
    if (specialDef && this.ownsUp(this.session.id, specialDef.upId)) {
      this.specialDef = specialDef;
      this.specialLbl = specialDef.emoji;
      this.specialBtn = new UIButton(specialDef.emoji, {
        width: 120,
        height: 120,
        fontSize: 48,
        fill: 0x8a6a2f,
        textColor: NIGHT.ink,
        onTap: () => this.trySpecial(),
      });
      this.add(this.specialBtn, this.uiLayer);
    }

    if (this.amSeeker) {
      this.attackBtn = new UIButton('🩸', {
        width: 120,
        height: 120,
        fontSize: 52,
        fill: NIGHT.blood,
        textColor: 0xffffff,
        onTap: () => this.tryAttack(),
      });
      this.add(this.attackBtn, this.uiLayer);
      this.addClickAttack();
    }

    // Desktop players get real keys alongside the touch buttons.
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.homeBtn = new UIButton('🏠', {
      width: 64,
      height: 64,
      fontSize: 28,
      fill: 0x1a1826,
      textColor: NIGHT.ink,
      onTap: () => this.goHome(),
    });
    this.add(this.homeBtn, this.uiLayer);

    // Screen-record button — only when enabled in Settings AND the browser
    // can actually do it (feature-detected; older iPhones just never see it).
    if (recordPref() && recordingSupported()) {
      this.recordBtn = new UIButton('⏺', {
        width: 64,
        height: 64,
        fontSize: 26,
        fill: 0x1a1826,
        textColor: NIGHT.blood,
        onTap: () => {
          if (this.recorder.recording) {
            this.recorder.stop();
            this.recordBtn?.setLabel('⏺');
            this.roleHud.text = '🎬 clip saved to your downloads';
          } else if (this.recorder.start(this.game.app.canvas)) {
            this.recordBtn?.setLabel('⏹');
            this.roleHud.text = '⏺ recording…';
          }
        },
      });
      this.add(this.recordBtn, this.uiLayer);
      // The classic REC light: a red dot on the button's shoulder that
      // pulses while a clip is rolling — no guessing whether it's live.
      this.recDot = new Graphics();
      this.recDot.circle(0, 0, 8).fill(0xff2d40);
      this.recDot.circle(0, 0, 8).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
      this.recDot.visible = false;
      this.uiLayer.addChild(this.recDot);
    }

    const lvName = LEVELS[this.level]?.name ?? '';
    this.codeHud = makeText(`${this.session.code} · ${lvName}`, 24, {
      color: NIGHT.inkSoft,
      weight: 'bold',
    });
    this.uiLayer.addChild(this.codeHud);
    this.hud = makeText('', 24, { color: NIGHT.lantern, weight: '800' });
    this.hud.anchor.set(0, 0.5);
    this.uiLayer.addChild(this.hud);
    this.roleHudBase = this.amSeeker
      ? '🩸 You are the SEEKER — hunt them down'
      : `${myCls.emoji} ${myCls.name} — light the lanterns`;
    this.roleHud = makeText(this.roleHudBase, 20, {
      color: this.amSeeker ? NIGHT.blood : NIGHT.gate,
      weight: '800',
    });
    this.roleHud.anchor.set(0, 0.5);
    this.uiLayer.addChild(this.roleHud);

    this.myBar = new Graphics();
    this.myBar.position.set(0, 62);
    this.me.addChild(this.myBar);

    this.partyPanel = new Container();
    this.uiLayer.addChild(this.partyPanel);
    this.buildParty();

    // Directional signals pointing at downed teammates (hiders only).
    this.downSignals = new Container();
    this.uiLayer.addChild(this.downSignals);

    // The Seeker's hide-phase blindfold.
    if (this.amSeeker) {
      this.blindfold = new Container();
      const curtain = new Graphics();
      curtain.rect(-4000, -4000, 8000, 8000).fill({ color: 0x05040a, alpha: 0.96 });
      this.blindfold.addChild(curtain);
      const line1 = makeText('🙈 Eyes shut — count with me', 34, {
        color: NIGHT.blood,
        weight: '800',
      });
      line1.position.set(0, -90);
      this.blindfold.addChild(line1);
      this.blindfoldNum = makeText(`${HIDE_PHASE_SECONDS}`, 120, { color: NIGHT.ink });
      this.blindfold.addChild(this.blindfoldNum);
      const line2 = makeText('they are scattering into the dark…', 22, {
        color: NIGHT.inkSoft,
        weight: 'bold',
      });
      line2.position.set(0, 96);
      this.blindfold.addChild(line2);
      this.blindfold.visible = false;
      this.uiLayer.addChild(this.blindfold);
      // Siren's Dazzle white-out — sits above everything, fades with time.
      this.blindG = new Graphics();
      this.blindG.rect(-4000, -4000, 8000, 8000).fill(0xffffff);
      this.blindG.alpha = 0;
      this.blindG.visible = false;
      this.uiLayer.addChild(this.blindG);
    }
  }

  private partyRows = new Map<string, { dot: Graphics; label: Text }>();
  private buildParty(): void {
    for (const c of this.partyPanel.removeChildren()) c.destroy({ children: true });
    this.partyRows.clear();
    const hiders = this.roster.order.filter((id) => this.roster.roles[id] !== 'seeker');
    hiders.forEach((id, i) => {
      const row = new Container();
      row.position.set(0, i * 30);
      const dot = new Graphics();
      dot.position.set(8, 8);
      row.addChild(dot);
      const label = makeText(this.roster.names[id] ?? '?', 16, {
        color: NIGHT.ink,
        weight: 'bold',
      });
      label.anchor.set(0, 0.5);
      label.position.set(26, 8);
      row.addChild(label);
      this.partyPanel.addChild(row);
      this.partyRows.set(id, { dot, label });
    });
  }

  // --------------------------------------------------------------- net

  private onNet(from: string, msg: Msg): void {
    if (!msg) return;
    if (msg.type === 'hello' && this.session.isHost) {
      this.session.sendTo(from, { type: 'inprogress' });
      return;
    }
    if (msg.type === 'pos' && this.session.isHost) {
      this.hostPositions[from] = { x: msg.x, y: msg.y };
      return;
    }
    if (msg.type === 'attack' && this.session.isHost) {
      this.hostAttack(from);
      return;
    }
    if (msg.type === 'ability' && this.session.isHost) {
      this.hostAbility(from, msg.id, msg.x, msg.y);
      return;
    }
    if (msg.type === 'snap' && !this.session.isHost) {
      this.applySnap(msg);
      return;
    }
    if (msg.type === 'reveal') {
      this.playReveal(msg.points, msg.color, msg.secs);
      return;
    }
    if (msg.type === 'fx') {
      this.playFx(msg);
      return;
    }
    if (msg.type === 'end') {
      this.showEnd(msg.result, msg.stats);
      return;
    }
    if (msg.type === 'toLobby' && !this.session.isHost) {
      this.returnToLobby();
      return;
    }
  }

  private applySnap(s: Snap): void {
    for (const [id, p] of Object.entries(s.players)) {
      if (id === this.session.id) continue;
      const r = this.remotes.get(id);
      if (r) {
        r.targetX = p.x;
        r.targetY = p.y;
      }
    }
    this.snapLant = s.lant;
    this.snapGate = s.gate;
    this.snapDown = s.down;
    this.snapHidden = new Set(s.hidden);
    this.snapVanished = new Set(s.vanished);
    this.snapRooted = new Set(s.rooted);
    this.snapHurt = new Set(s.hurt ?? []);
    this.snapDowns = s.downs ?? {};
    this.snapBusted = new Set(s.busted ?? []);
    this.snapDawn = s.dawn ?? this.snapDawn;
    this.snapHideLeft = s.hideL ?? 0;
    this.snapTpCd = s.tp ?? 0;
    this.snapSlowed = new Set(s.slowed ?? []);
    this.snapHatch = s.hatch ?? false;
    this.snapTrail = s.trail ?? 0;
    this.applyConversions(s.conv ?? []);
    this.dropTrailDots(s.players);
    this.syncClones(s.cl ?? []);
    this.syncDums(s.dm ?? []);
    this.syncWalls(s.wl ?? []);
    this.syncTpads(s.tpads ?? []);
    this.syncRubble(s.rb ?? []);
    this.syncTraps(s.traps ?? []);
    this.syncNests(s.nests ?? []);
    this.escaped = new Set(s.esc);
    this.out = new Set(s.out);
    this.phase = s.phase;
    this.syncDecoys(s.decoys);
    this.redrawObjectives();
    if (s.phase !== 'playing' && s.phase !== 'hiding' && !this.endShown) this.showEnd(s.phase);
  }

  // ---------------------------------------------------------- host sim

  private hostAttack(seekerId: string): void {
    if (!this.isSeekerRole(seekerId) || this.phase !== 'playing') return;
    const sp = this.hostPositions[seekerId];
    if (!sp) return;
    let target: string | null = null;
    let best = ATTACK_RANGE;
    for (const id of this.activeHiders()) {
      if (this.down[id] !== undefined) continue;
      const p = this.hostPositions[id];
      if (!p) continue;
      const d = Math.hypot(p.x - sp.x, p.y - sp.y);
      // Vanished hiders can't be struck; hidden ones only once searched.
      if ((this.vanishUntil[id] ?? 0) > this.t) continue;
      if (this.isConcealed(id) && d > SEARCH_RADIUS) continue;
      if (d < best) {
        best = d;
        target = id;
      }
    }
    // A Sprinter clone soaks the swing if it's the closest thing in reach.
    let cloneHit = -1;
    let cloneBest = best;
    this.clones.forEach((c, i) => {
      const d = Math.hypot(c.x - sp.x, c.y - sp.y);
      if (d < cloneBest) {
        cloneBest = d;
        cloneHit = i;
      }
    });
    if (cloneHit >= 0) {
      const c = this.clones.splice(cloneHit, 1)[0]!;
      this.broadcastFx({ type: 'fx', kind: 'attack', x: sp.x, y: sp.y, tx: c.x, ty: c.y });
      this.broadcastFx({ type: 'fx', kind: 'poof', x: c.x, y: c.y });
      return;
    }
    // The swing FX auto-aims: it sweeps TOWARD the victim (tx/ty). With
    // nobody in range it plays as an all-around whiff instead.
    const tp0 = target ? this.hostPositions[target] : undefined;
    this.broadcastFx(
      tp0
        ? { type: 'fx', kind: 'attack', x: sp.x, y: sp.y, tx: tp0.x, ty: tp0.y }
        : { type: 'fx', kind: 'attack', x: sp.x, y: sp.y },
    );
    if (target) {
      const p = this.hostPositions[target]!;
      // Caught hiding: the first strike smashes the hiding spot itself — the
      // cover collapses (flushing everyone in it) and the hider is unharmed.
      const spot = this.hideSpotAt(p.x, p.y);
      if (spot >= 0) {
        this.bustedUntil[spot] = this.t + BUST_SECONDS;
        const b = this.hidePts[spot]!;
        this.broadcastFx({ type: 'fx', kind: 'bust', x: b.x, y: b.y });
        return;
      }
      // A conjured den doesn't recover — one strike tears it down for good.
      const nest = this.nestAt(p.x, p.y);
      if (nest >= 0) {
        const n = this.nests.splice(nest, 1)[0]!;
        this.broadcastFx({ type: 'fx', kind: 'bust', x: n.x, y: n.y });
        return;
      }
      this.deed(seekerId).down++;
      // Durability: each class takes a different number of hits to go DOWN
      // (Medic and the tanks shrug off more). The final hit downs them; on
      // the LAST life the dark DRAGS the body to a random far corner
      // instead of leaving a camp-able corpse.
      this.hits[target] = (this.hits[target] ?? 0) + 1;
      if (this.hits[target]! >= this.statsOf(target).hp) {
        this.hits[target] = 0;
        this.hurt.delete(target);
        delete this.healProg[target];
        this.downsTaken[target] = (this.downsTaken[target] ?? 0) + 1;
        this.down[target] = BLEED_SECONDS;
        this.reviveProg[target] = 0;
        if (this.downsTaken[target]! >= LIVES) {
          const spot = this.randomFarSpot(p.x, p.y);
          this.hostPositions[target] = { ...spot };
          this.botPaths.delete(target);
          this.broadcastFx({
            type: 'fx',
            kind: 'dragged',
            x: p.x,
            y: p.y,
            id: target,
            tx: spot.x,
            ty: spot.y,
          });
        } else {
          this.broadcastFx({ type: 'fx', kind: 'down', x: p.x, y: p.y, id: target });
        }
      } else {
        // First strike — injured but still on their feet.
        this.hurt.add(target);
        this.healProg[target] = 0;
        this.broadcastFx({ type: 'fx', kind: 'hurt', x: p.x, y: p.y, id: target });
      }
      // Frostbite Armor: striking the Frost chills the attacker.
      if (this.ownsUp(target, 'frost3')) {
        this.slowUntil[seekerId] = Math.max(
          this.slowUntil[seekerId] ?? 0,
          this.t + FROSTBITE_SLOW_SECS,
        );
        const ap = this.hostPositions[seekerId];
        if (ap) this.broadcastFx({ type: 'fx', kind: 'freeze', x: ap.x, y: ap.y, id: seekerId });
      }
      // Death Fade: a Ghost who SURVIVES the strike vanishes on the spot.
      if (this.down[target] === undefined && this.ownsUp(target, 'ghost3')) {
        this.vanishUntil[target] = Math.max(
          this.vanishUntil[target] ?? 0,
          this.t + GHOST_FADE_SECS,
        );
        this.broadcastFx({ type: 'fx', kind: 'poof', x: p.x, y: p.y, id: target });
      }
      // Kickback: striking the Kaiju hurls YOU away (walls stop it honestly).
      if (this.ownsUp(target, 'kaiju3')) {
        const ap = this.hostPositions[seekerId];
        if (ap) {
          const ang = Math.atan2(ap.y - p.y, ap.x - p.x);
          let px = ap.x;
          let py = ap.y;
          for (let s = 0; s < 8; s++) {
            const m = moveWithCollision(
              this.map,
              px,
              py,
              18,
              14,
              Math.cos(ang) * (KICKBACK_PUSH / 8),
              Math.sin(ang) * (KICKBACK_PUSH / 8),
            );
            px = m.x;
            py = m.y;
          }
          this.hostPositions[seekerId] = { x: px, y: py };
          this.botPaths.delete(seekerId);
          this.broadcastFx({
            type: 'fx',
            kind: 'blast',
            x: ap.x,
            y: ap.y,
            id: seekerId,
            tx: px,
            ty: py,
          });
        }
      }
    }
  }

  private hostAbility(from: string, id: string, x: number, y: number): void {
    // Echolocation: every survivor ability RINGS for Howlers with the
    // passive — a mark blooms where it was cast (rate-limited per Howler).
    if (!this.isSeekerRole(from)) {
      for (const sid of this.seekerIds()) {
        if (!this.ownsUp(sid, 'howler3')) continue;
        if (this.t < (this.echoCdAt[sid] ?? 0)) continue;
        this.echoCdAt[sid] = this.t + ECHO_CD;
        this.reveal([{ x, y }], NIGHT.blood, 3);
      }
    }
    switch (id) {
      case 'scent': {
        // Stalker (second button): catch the scent — a tracking arrow
        // points at the nearest survivor for a few seconds.
        if (!this.isSeekerRole(from)) return;
        if (!this.ownsUp(from, 'stalker3')) return;
        if (this.t < (this.specialCdAt[from] ?? 0)) return;
        this.specialCdAt[from] = this.t + SCENT_CD * this.statsOf(from).cdMul * 0.9;
        this.broadcastFx({ type: 'fx', kind: 'warn', x, y, id: from });
        break;
      }
      case 'thirdeye': {
        // Warden: the unblinking eye sees EVERYTHING for a moment — every
        // living hider, even tucked in furniture or vanished. Rings mark
        // them for a few seconds (and warn them they've been seen).
        if (!this.isSeekerRole(from)) return;
        const pts: { x: number; y: number }[] = [];
        for (const hid of this.activeHiders()) {
          if (this.down[hid] !== undefined) continue;
          const hp = this.hostPositions[hid];
          if (hp) pts.push({ x: hp.x, y: hp.y });
        }
        this.reveal(pts, NIGHT.violet, 5 * this.statsOf(from).powMul);
        // Iron Gaze: dread grips everyone the eye touched.
        if (this.ownsUp(from, 'warden3')) {
          for (const hid of this.activeHiders()) {
            if (this.down[hid] !== undefined) continue;
            this.slowUntil[hid] = Math.max(this.slowUntil[hid] ?? 0, this.t + IRON_GAZE_SLOW);
          }
        }
        break;
      }
      case 'screech': {
        if (!this.isSeekerRole(from)) return;
        // The scream leaves footprints: every hider trails glowing residue
        // on the ground for a while — visible only to seekers.
        this.trailUntil = this.t + TRAIL_SECONDS * this.statsOf(from).powMul;
        const pts = this.visibleHiderPoints();
        this.reveal(pts, NIGHT.blood, 4);
        this.broadcastFx({ type: 'fx', kind: 'screech', x, y });
        break;
      }
      case 'web': {
        // Weaver: a ranged bolt that SLOWS the nearest visible hider.
        if (!this.isSeekerRole(from)) return;
        let tid: string | null = null;
        let bd = WEB_RANGE * this.statsOf(from).powMul;
        for (const hid of this.activeHiders()) {
          if (this.down[hid] !== undefined) continue;
          if ((this.vanishUntil[hid] ?? 0) > this.t) continue;
          const hp = this.hostPositions[hid];
          if (!hp) continue;
          const d = Math.hypot(hp.x - x, hp.y - y);
          if (this.isConcealed(hid) && d > SEARCH_RADIUS) continue;
          if (d < bd) {
            bd = d;
            tid = hid;
          }
        }
        if (tid) {
          this.slowUntil[tid] = this.t + WEB_SECONDS;
          const p = this.hostPositions[tid]!;
          this.broadcastFx({ type: 'fx', kind: 'web', x: p.x, y: p.y, id: tid, tx: x, ty: y });
          // Tangle: the web LEAPS to another survivor standing close.
          if (this.ownsUp(from, 'weaver3')) {
            let tid2: string | null = null;
            let bd2 = TANGLE_RANGE;
            for (const hid of this.activeHiders()) {
              if (hid === tid || this.down[hid] !== undefined) continue;
              if ((this.vanishUntil[hid] ?? 0) > this.t) continue;
              const hp = this.hostPositions[hid];
              if (!hp) continue;
              const d = Math.hypot(hp.x - p.x, hp.y - p.y);
              if (d < bd2) {
                bd2 = d;
                tid2 = hid;
              }
            }
            if (tid2) {
              this.slowUntil[tid2] = this.t + WEB_SECONDS;
              const p2 = this.hostPositions[tid2]!;
              this.broadcastFx({
                type: 'fx',
                kind: 'web',
                x: p2.x,
                y: p2.y,
                id: tid2,
                tx: p.x,
                ty: p.y,
              });
            }
          }
        } else {
          // A whiff still shows the bolt fizzling at the Weaver.
          this.broadcastFx({ type: 'fx', kind: 'web', x, y });
        }
        break;
      }
      case 'ping': {
        const sp = this.hostPositions[this.seekerId];
        if (sp) this.reveal([{ x: sp.x, y: sp.y }], NIGHT.ghost, 4);
        break;
      }
      case 'sense': {
        const pts = this.lanternPts.filter((_, i) => (this.lant[i] ?? 0) < 1);
        for (const sid of this.seekerIds()) {
          const sp = this.hostPositions[sid];
          if (sp) pts.push({ x: sp.x, y: sp.y });
        }
        this.reveal(pts, NIGHT.lantern, 6);
        // Town Crier: the Lookout's arrow goes out to EVERY survivor.
        if (this.ownsUp(from, 'lookout3')) this.broadcastFx({ type: 'fx', kind: 'warn', x, y });
        break;
      }
      case 'snare':
        this.traps.push({ x, y, s: SNARE_SECONDS * this.statsOf(from).powMul, owner: from });
        this.broadcastFx({ type: 'fx', kind: 'snare', x, y });
        break;
      case 'blind': {
        // Siren's Dazzle: white-out the NEAREST Seeker's screen — if she's
        // close enough. The fx carries that Seeker's id; only they blank.
        if (this.isSeekerRole(from)) return;
        const near = this.nearestSeeker(x, y);
        if (near && near.d < BLIND_RANGE * this.statsOf(from).powMul) {
          // A blinded bot Seeker forgets what it was doing.
          if (near.id.startsWith('bot')) {
            this.botPaths.delete(near.id);
            this.botCd[near.id] = Math.max(this.botCd[near.id] ?? 0, this.t + BLIND_SECONDS);
          }
          this.broadcastFx({ type: 'fx', kind: 'blind', x: near.p.x, y: near.p.y, id: near.id });
        } else {
          // Out of range — the flash fizzles at the Siren.
          this.broadcastFx({ type: 'fx', kind: 'blind', x, y });
        }
        break;
      }
      case 'nest': {
        // Nester's Pop-up Den: a conjured hiding spot right where she stands.
        // Over the cap, her OLDEST den folds away (anyone inside loses cover).
        if (this.isSeekerRole(from)) return;
        this.nests.push({ x, y, owner: from });
        const cap = NEST_MAX + (this.statsOf(from).powMul >= 1.3 ? 1 : 0);
        while (this.nests.length > cap) this.nests.shift();
        this.broadcastFx({ type: 'fx', kind: 'nest', x, y });
        break;
      }
      case 'freeze': {
        // Ice Snap: the NEAREST Seeker is frozen for a beat — buy an escape.
        const near = this.nearestSeeker(x, y);
        if (near) {
          this.rootUntil[near.id] = this.t + FREEZE_SECONDS * this.statsOf(from).powMul;
          this.broadcastFx({ type: 'fx', kind: 'freeze', x: near.p.x, y: near.p.y, id: near.id });
        }
        break;
      }
      case 'vanish':
        this.vanishUntil[from] = this.t + VANISH_SECONDS * this.statsOf(from).powMul;
        this.broadcastFx({ type: 'fx', kind: 'poof', x, y, id: from });
        break;
      case 'decoy':
        // Drop the doll AND fade for a blink — the misdirection is the point.
        this.decoys.push({
          x,
          y,
          until: this.t + DECOY_SECONDS * this.statsOf(from).powMul,
          owner: from,
        });
        this.vanishUntil[from] = Math.max(this.vanishUntil[from] ?? 0, this.t + DECOY_FADE_SECS);
        this.broadcastFx({ type: 'fx', kind: 'decoy', x, y });
        this.broadcastFx({ type: 'fx', kind: 'poof', x, y, id: from });
        break;
      case 'overcharge': {
        let li = -1;
        let bd = Infinity;
        this.lanternPts.forEach((p, i) => {
          if ((this.lant[i] ?? 1) >= 1) return;
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bd) {
            bd = d;
            li = i;
          }
        });
        if (li >= 0) {
          // One surge finishes the lantern outright — the Engineer's whole
          // job is objectives, so the button should feel like it.
          const before = this.lant[li] ?? 0;
          this.lant[li] = 1;
          if (before < 1) this.deed(from).lit++;
          const p = this.lanternPts[li]!;
          this.broadcastFx({ type: 'fx', kind: 'lantern', x: p.x, y: p.y });
        }
        break;
      }
      case 'tpad': {
        // Pocket Portal (second button): assemble a temporary pad right
        // here. Newest two pads stand; rides use their OWN cooldown (never
        // the manor pads' shared one).
        if (this.isSeekerRole(from)) return;
        if (!this.ownsUp(from, 'engineer3')) return;
        // Host-enforced build cooldown (slight slack so an honest client's
        // own timer, which runs on its clock, is never rejected).
        if (this.t < (this.specialCdAt[from] ?? 0)) return;
        this.specialCdAt[from] = this.t + TPAD_BTN_CD * this.statsOf(from).cdMul * 0.9;
        this.tempPads.push({ x, y, until: this.t + TEMP_TP_LIFE, armed: false });
        while (this.tempPads.length > 2) this.tempPads.shift();
        this.broadcastFx({ type: 'fx', kind: 'tpad', x, y });
        break;
      }
      case 'swap': {
        // Switcheroo: trade places with your latest doll — the doll keeps
        // your old spot, and the Seeker keeps guessing.
        if (this.isSeekerRole(from)) return;
        if (!this.ownsUp(from, 'trickster3')) return;
        if (this.t < (this.specialCdAt[from] ?? 0)) return;
        let doll: { x: number; y: number; until: number; owner?: string } | null = null;
        for (let i = this.decoys.length - 1; i >= 0; i--) {
          if (this.decoys[i]!.owner === from) {
            doll = this.decoys[i]!;
            break;
          }
        }
        if (!doll) return; // no doll standing — no swap, no cooldown burned
        this.specialCdAt[from] = this.t + 25 * this.statsOf(from).cdMul * 0.9;
        const dx = doll.x;
        const dy = doll.y;
        doll.x = x;
        doll.y = y;
        this.hostPositions[from] = { x: dx, y: dy };
        this.broadcastFx({ type: 'fx', kind: 'teleport', x, y, id: from, tx: dx, ty: dy });
        break;
      }
      case 'lullaby': {
        // Lullaby: a slowing song — every Seeker in earshot crawls.
        if (this.isSeekerRole(from)) return;
        if (!this.ownsUp(from, 'siren3')) return;
        if (this.t < (this.specialCdAt[from] ?? 0)) return;
        this.specialCdAt[from] = this.t + 35 * this.statsOf(from).cdMul * 0.9;
        for (const sid of this.seekerIds()) {
          const sp2 = this.hostPositions[sid];
          if (!sp2) continue;
          if (Math.hypot(sp2.x - x, sp2.y - y) >= LULLABY_RANGE * this.statsOf(from).powMul)
            continue;
          this.slowUntil[sid] = Math.max(this.slowUntil[sid] ?? 0, this.t + LULLABY_SLOW_SECS);
        }
        this.broadcastFx({ type: 'fx', kind: 'lull', x, y });
        break;
      }
      case 'afterimage': {
        // Afterimage: sprinting leaves a frozen you-shaped clone behind.
        if (this.isSeekerRole(from)) return;
        if (!this.ownsUp(from, 'sprinter3')) return;
        if (this.t < (this.specialCdAt[from] ?? 0)) return;
        this.specialCdAt[from] = this.t + 8; // matches the sprint's own pace
        this.clones.push({ x, y, ang: 0, until: this.t + AFTERIMAGE_LIFE, owner: from, spd: 0 });
        this.broadcastFx({ type: 'fx', kind: 'poof', x, y });
        break;
      }
      case 'dummy': {
        // Twin: first press PLANTS a perfect double where you stand; the
        // next press TRADES PLACES with it (the dummy keeps your old spot).
        if (!this.isSeekerRole(from)) return;
        const d = this.dummies[from];
        if (!d) {
          this.dummies[from] = { x, y };
          this.broadcastFx({ type: 'fx', kind: 'dummy', x, y });
        } else {
          const mine = this.hostPositions[from];
          if (!mine) return;
          const mx = mine.x;
          const my = mine.y;
          this.hostPositions[from] = { x: d.x, y: d.y };
          this.broadcastFx({
            type: 'fx',
            kind: 'teleport',
            x: mx,
            y: my,
            id: from,
            tx: d.x,
            ty: d.y,
          });
          d.x = mx;
          d.y = my;
          this.broadcastFx({ type: 'fx', kind: 'dummy', x: mx, y: my });
        }
        break;
      }
      case 'cloak': {
        // Wraith: fade from every hider's sight for a few seconds.
        if (!this.isSeekerRole(from)) return;
        this.vanishUntil[from] = this.t + CLOAK_SECONDS * this.statsOf(from).powMul;
        this.broadcastFx({ type: 'fx', kind: 'poof', x, y, id: from });
        break;
      }
      case 'clones': {
        // Sprinter: split into clone bots that scatter — they pop when hit.
        if (this.isSeekerRole(from)) return;
        const count = this.statsOf(from).powMul >= 1.5 ? 3 : 2;
        for (let i = 0; i < count; i++) {
          const ang = Math.random() * Math.PI * 2;
          this.clones.push({ x, y, ang, until: this.t + CLONE_SECONDS, owner: from });
        }
        this.broadcastFx({ type: 'fx', kind: 'poof', x, y });
        break;
      }
      case 'wall': {
        // Builder: a barricade only the SEEKER collides with.
        if (this.isSeekerRole(from)) return;
        this.walls.push({
          x,
          y,
          until: this.t + WALL_SECONDS * this.statsOf(from).powMul,
          owner: from,
        });
        this.broadcastFx({ type: 'fx', kind: 'wall', x, y });
        break;
      }
      case 'blast': {
        // Kaiju: a shockwave that HURLS every seeker in range away.
        if (this.isSeekerRole(from)) return;
        const radius = BLAST_RADIUS * this.statsOf(from).powMul;
        for (const sid of this.seekerIds()) {
          const sp2 = this.hostPositions[sid];
          if (!sp2) continue;
          const d = Math.hypot(sp2.x - x, sp2.y - y);
          if (d >= radius) continue;
          const ang = Math.atan2(sp2.y - y, sp2.x - x);
          // Walk the push in steps so walls stop it honestly.
          let px = sp2.x;
          let py = sp2.y;
          for (let s = 0; s < 16; s++) {
            const m = moveWithCollision(
              this.map,
              px,
              py,
              18,
              14,
              Math.cos(ang) * (BLAST_PUSH / 16),
              Math.sin(ang) * (BLAST_PUSH / 16),
            );
            px = m.x;
            py = m.y;
          }
          this.hostPositions[sid] = { x: px, y: py };
          this.rootUntil[sid] = Math.max(this.rootUntil[sid] ?? 0, this.t + 0.5);
          this.botPaths.delete(sid);
          this.broadcastFx({
            type: 'fx',
            kind: 'blast',
            x: sp2.x,
            y: sp2.y,
            id: sid,
            tx: px,
            ty: py,
          });
        }
        this.broadcastFx({ type: 'fx', kind: 'blast', x, y });
        break;
      }
      case 'mend': {
        // Medic: a healing beam. Priority one is LIFTING a downed ally;
        // with nobody down, it fully HEALS the most-wounded ally in range.
        const range = MEND_RANGE * this.statsOf(from).powMul;
        let tid: string | null = null;
        let bd = range;
        for (const did of Object.keys(this.down)) {
          const p = this.hostPositions[did];
          if (!p) continue;
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bd) {
            bd = d;
            tid = did;
          }
        }
        if (tid) {
          delete this.down[tid];
          this.reviveProg[tid] = 0;
          this.hits[tid] = 0;
          this.deed(from).res++;
          const p = this.hostPositions[tid]!;
          this.broadcastFx({ type: 'fx', kind: 'rescue', x: p.x, y: p.y, id: tid, tx: x, ty: y });
          break;
        }
        let hid2: string | null = null;
        let worst = 0;
        for (const hid of this.activeHiders()) {
          if (hid === from || this.down[hid] !== undefined) continue;
          const hp2 = this.hostPositions[hid];
          if (!hp2 || Math.hypot(hp2.x - x, hp2.y - y) >= range) continue;
          const dmg = this.hits[hid] ?? 0;
          if (dmg > worst) {
            worst = dmg;
            hid2 = hid;
          }
        }
        if (hid2) {
          this.hits[hid2] = 0;
          this.hurt.delete(hid2);
          delete this.healProg[hid2];
          this.deed(from).res++;
          const p = this.hostPositions[hid2]!;
          this.broadcastFx({ type: 'fx', kind: 'heal', x: p.x, y: p.y, id: hid2, tx: x, ty: y });
        }
        break;
      }
    }
  }

  private activeHiders(): string[] {
    return this.roster.order.filter(
      (id) => this.roster.roles[id] !== 'seeker' && !this.escaped.has(id) && !this.out.has(id),
    );
  }

  /** More than one blob can hunt now (Wraith conversions). */
  private isSeekerRole(id: string): boolean {
    return this.roster.roles[id] === 'seeker';
  }

  /** A player's live numbers: class base + their owned Verium passives. */
  private statsOf(id: string): { speed: number; hp: number; cdMul: number; powMul: number } {
    return statsFor(classById(this.roster.classes[id]), this.roster.ups?.[id] ?? []);
  }

  /** Does this player own a specific passive (special, non-stat ones)? */
  private ownsUp(id: string, upId: string): boolean {
    return (this.roster.ups?.[id] ?? []).includes(upId);
  }

  private seekerIds(): string[] {
    return this.roster.order.filter((id) => this.isSeekerRole(id));
  }

  /** Host: the seeker closest to (x, y) — for abilities that target "the
   *  Seeker" now that there can be several. */
  private nearestSeeker(
    x: number,
    y: number,
  ): { id: string; p: { x: number; y: number }; d: number } | null {
    let best: { id: string; p: { x: number; y: number }; d: number } | null = null;
    for (const sid of this.seekerIds()) {
      const p = this.hostPositions[sid];
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (!best || d < best.d) best = { id: sid, p, d };
    }
    return best;
  }

  /** Host: a random walkable tile far from (fx,fy) — where the dark drops a
   *  last-life body. Falls back to the hider spawn if the dice run cold. */
  private randomFarSpot(fx: number, fy: number): { x: number; y: number } {
    for (let tries = 0; tries < 60; tries++) {
      const c = 1 + Math.floor(Math.random() * (this.map.width - 2));
      const r = 1 + Math.floor(Math.random() * (this.map.height - 2));
      if (solidAt(this.map, c, r)) continue;
      const x = c * TILE_SIZE + TILE_SIZE / 2;
      const y = r * TILE_SIZE + TILE_SIZE / 2;
      if (Math.hypot(x - fx, y - fy) < DRAG_MIN_DIST) continue;
      return { x, y };
    }
    return { ...this.spawn };
  }

  private visibleHiderPoints(): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (const id of this.activeHiders()) {
      if ((this.vanishUntil[id] ?? 0) > this.t) continue;
      if (this.isConcealed(id)) continue;
      const p = this.hostPositions[id];
      if (p) pts.push({ x: p.x, y: p.y });
    }
    return pts;
  }

  /** Host: which hide spot (if any) covers this position? Busted spots give
   *  no cover until they recover. */
  private hideSpotAt(x: number, y: number): number {
    for (let i = 0; i < this.hidePts.length; i++) {
      const b = this.hidePts[i]!;
      if (Math.hypot(b.x - x, b.y - y) < HIDE_RADIUS && (this.bustedUntil[i] ?? 0) <= this.t)
        return i;
    }
    return -1;
  }

  /** Host: which of the Nester's pop-up dens (if any) covers this position? */
  private nestAt(x: number, y: number): number {
    for (let i = 0; i < this.nests.length; i++) {
      const n = this.nests[i]!;
      if (Math.hypot(n.x - x, n.y - y) < HIDE_RADIUS) return i;
    }
    return -1;
  }

  private isConcealed(id: string): boolean {
    const p = this.hostPositions[id];
    if (!p) return false;
    return this.hideSpotAt(p.x, p.y) >= 0 || this.nestAt(p.x, p.y) >= 0;
  }

  /** Am I (locally) tucked inside a hiding spot? Computed from my own position
   *  so the "hidden" feedback is instant, not a network round-trip away. */
  private amConcealedLocal(): boolean {
    return (
      this.hidePts.some(
        (b, i) =>
          !this.snapBusted.has(i) && Math.hypot(b.x - this.me.x, b.y - this.me.y) < HIDE_RADIUS,
      ) || this.snapNests.some((n) => Math.hypot(n.x - this.me.x, n.y - this.me.y) < HIDE_RADIUS)
    );
  }

  private deed(id: string): Deeds {
    return (this.deeds[id] ??= { lit: 0, res: 0, down: 0 });
  }

  private hostSim(dt: number): void {
    // Hide phase: the Seeker counts with eyes shut while everyone scatters.
    // No lanterns, no attacks, no dawn — the hunt proper starts at zero.
    if (this.phase === 'hiding') {
      this.hideLeft = Math.max(0, this.hideLeft - dt);
      if (this.hideLeft <= 0) {
        this.phase = 'playing';
        const sp = this.hostPositions[this.seekerId];
        this.broadcastFx({ type: 'fx', kind: 'release', x: sp?.x ?? 0, y: sp?.y ?? 0 });
        // Wraith's opening curse: one random BOT hider is dragged to the
        // dark side (humans stay human) — suddenly the hunt has two hunters.
        const wraith = this.seekerIds().some(
          (sid) => classById(this.roster.classes[sid]).id === 'wraith',
        );
        if (wraith) {
          // Humans make far better thralls — bots are the LAST resort.
          const alive = this.activeHiders().filter((id) => this.down[id] === undefined);
          const humans = alive.filter((id) => !id.startsWith('bot'));
          const pool = humans.length ? humans : alive.filter((id) => id.startsWith('bot'));
          const pick = pool[Math.floor(Math.random() * pool.length)];
          if (pick) {
            this.converted.push(pick);
            this.roster.roles[pick] = 'seeker';
            this.hurt.delete(pick);
            delete this.healProg[pick];
            this.botPaths.delete(pick);
            const pp = this.hostPositions[pick];
            if (pp) this.broadcastFx({ type: 'fx', kind: 'convert', x: pp.x, y: pp.y, id: pick });
          }
        }
      }
      return;
    }
    const active = this.activeHiders();
    // Sprinter clones scatter like panicked prey; expired ones pop quietly.
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const c = this.clones[i]!;
      if (c.until <= this.t) {
        this.clones.splice(i, 1);
        this.broadcastFx({ type: 'fx', kind: 'poof', x: c.x, y: c.y });
        continue;
      }
      const near = this.nearestSeeker(c.x, c.y);
      if (near && near.d < 420) {
        c.ang = Math.atan2(c.y - near.p.y, c.x - near.p.x) + (Math.random() - 0.5) * 0.4;
      }
      const step = (c.spd ?? 260) * dt;
      const m = moveWithCollision(
        this.map,
        c.x,
        c.y,
        16,
        14,
        Math.cos(c.ang) * step,
        Math.sin(c.ang) * step,
      );
      if (Math.hypot(m.x - c.x, m.y - c.y) < step * 0.3) c.ang += 1.2 + Math.random(); // wall — bounce off
      c.x = m.x;
      c.y = m.y;
    }
    // Twin dummies whisper to their owner when hiders wander near.
    for (const [owner, d] of Object.entries(this.dummies)) {
      const alert = DUMMY_ALERT * this.statsOf(owner).powMul;
      let prowler: string | null = null;
      for (const id of active) {
        if (this.down[id] !== undefined) continue;
        const p = this.hostPositions[id];
        if (p && Math.hypot(p.x - d.x, p.y - d.y) < alert) {
          prowler = id;
          break;
        }
      }
      if (prowler && this.t >= (this.dummyPingAt[owner] ?? 0)) {
        this.dummyPingAt[owner] = this.t + DUMMY_PING_EVERY;
        this.broadcastFx({ type: 'fx', kind: 'dummyping', x: d.x, y: d.y, id: owner });
        // Watchful Double: the double SEES — its warning marks the prowler.
        if (this.ownsUp(owner, 'twin3')) {
          const pp = this.hostPositions[prowler];
          if (pp) this.reveal([{ x: pp.x, y: pp.y }], NIGHT.violet, 3);
        }
      }
    }
    // Builder walls crumble on their own clock — and with Rubble Snare,
    // the wreckage stays dangerous for a while.
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i]!;
      if (w.until <= this.t) {
        if (this.ownsUp(w.owner ?? '', 'builder3'))
          this.rubble.push({ x: w.x, y: w.y, until: this.t + RUBBLE_LIFE });
        this.walls.splice(i, 1);
      }
    }
    // Rubble snares the first Seeker who blunders in, then is spent.
    for (let i = this.rubble.length - 1; i >= 0; i--) {
      const r = this.rubble[i]!;
      if (r.until <= this.t) {
        this.rubble.splice(i, 1);
        continue;
      }
      for (const sid of this.seekerIds()) {
        const sp2 = this.hostPositions[sid];
        if (!sp2 || Math.hypot(sp2.x - r.x, sp2.y - r.y) >= RUBBLE_RADIUS) continue;
        this.rootUntil[sid] = Math.max(this.rootUntil[sid] ?? 0, this.t + RUBBLE_ROOT_SECS);
        this.broadcastFx({ type: 'fx', kind: 'snare', x: r.x, y: r.y, id: sid });
        this.rubble.splice(i, 1);
        break;
      }
    }
    // Pocket Portal pads dissolve on their own clock too, and ARM once every
    // hider has stepped clear (so building one never rides you instantly).
    for (let i = this.tempPads.length - 1; i >= 0; i--) {
      const pad = this.tempPads[i]!;
      if (pad.until <= this.t) {
        this.tempPads.splice(i, 1);
        continue;
      }
      if (!pad.armed) {
        const occupied = active.some((id) => {
          const p = this.hostPositions[id];
          return !!p && Math.hypot(pad.x - p.x, pad.y - p.y) < TELEPORT_RADIUS + 12;
        });
        if (!occupied) pad.armed = true;
      }
    }
    // Pocket Portal rides: a hider on a temp pad warps to the manor
    // teleporter FARTHEST from it — on the temp pads' OWN cooldown, so the
    // manor pair's shared cooldown (tpReadyAt) is never spent here.
    if (this.tempPads.length >= 1 && this.teleportPts.length >= 1 && this.t >= this.tempTpReadyAt) {
      rideTemp: for (const id of active) {
        if (this.down[id] !== undefined) continue;
        const p = this.hostPositions[id];
        if (!p) continue;
        if (id.startsWith('bot')) continue; // bots never burn the Engineer's gift
        for (const pad of this.tempPads) {
          if (!pad.armed) continue;
          if (Math.hypot(pad.x - p.x, pad.y - p.y) >= TELEPORT_RADIUS) continue;
          let dest = this.teleportPts[0]!;
          let far = -1;
          for (const tp of this.teleportPts) {
            const d = Math.hypot(tp.x - pad.x, tp.y - pad.y);
            if (d > far) {
              far = d;
              dest = tp;
            }
          }
          // Land just OFF the manor pad so the ride can't chain into the
          // manor pair (that would spend THEIR shared cooldown).
          let lx = dest.x + 90;
          let ly = dest.y;
          for (const [dx, dy] of [
            [90, 0],
            [-90, 0],
            [0, 90],
            [0, -90],
          ] as const) {
            if (
              !solidAt(
                this.map,
                Math.floor((dest.x + dx) / TILE_SIZE),
                Math.floor((dest.y + dy) / TILE_SIZE),
              )
            ) {
              lx = dest.x + dx;
              ly = dest.y + dy;
              break;
            }
          }
          this.hostPositions[id] = { x: lx, y: ly };
          this.tempTpReadyAt = this.t + TEMP_TP_CD;
          this.broadcastFx({
            type: 'fx',
            kind: 'teleport',
            x: pad.x,
            y: pad.y,
            id,
            tx: lx,
            ty: ly,
          });
          break rideTemp;
        }
      }
    }
    // Sixth Sense: a Scout with the passive feels a Seeker creeping close —
    // their arrow flares on its own (per-scout cooldown so it stays a chill,
    // not a radar).
    for (const id of active) {
      if (this.down[id] !== undefined) continue;
      if (classById(this.roster.classes[id]).id !== 'scout') continue;
      if (!this.ownsUp(id, 'scout3')) continue;
      if (this.t < (this.warnAt[id] ?? 0)) continue;
      const p = this.hostPositions[id];
      if (!p) continue;
      const near = this.nearestSeeker(p.x, p.y);
      if (near && near.d < SCOUT_WARN_DIST) {
        this.warnAt[id] = this.t + SCOUT_WARN_CD;
        this.broadcastFx({ type: 'fx', kind: 'warn', x: p.x, y: p.y, id });
      }
    }
    // Teleporters: a standing hider on a ready pad rides to the twin pad.
    // ONE shared cooldown — the first ride locks the pair for everyone.
    if (this.teleportPts.length >= 2 && this.t >= this.tpReadyAt) {
      outer: for (const id of active) {
        if (this.down[id] !== undefined) continue;
        const p = this.hostPositions[id];
        if (!p) continue;
        // Bots wander through room centres constantly — they only ride to
        // ESCAPE (seeker close), never burn the shared cooldown idly.
        if (id.startsWith('bot')) {
          const near = this.nearestSeeker(p.x, p.y);
          if (!near || near.d > BOT_FLEE_DIST) continue;
        }
        for (let i = 0; i < this.teleportPts.length; i++) {
          const pad = this.teleportPts[i]!;
          if (Math.hypot(pad.x - p.x, pad.y - p.y) >= TELEPORT_RADIUS) continue;
          const dest = this.teleportPts[(i + 1) % this.teleportPts.length]!;
          // Land just OFF the twin pad (first open side) so nobody re-rides
          // the instant the cooldown ends.
          let lx = dest.x + 90;
          let ly = dest.y;
          for (const [dx, dy] of [
            [90, 0],
            [-90, 0],
            [0, 90],
            [0, -90],
          ] as const) {
            if (
              !solidAt(
                this.map,
                Math.floor((dest.x + dx) / TILE_SIZE),
                Math.floor((dest.y + dy) / TILE_SIZE),
              )
            ) {
              lx = dest.x + dx;
              ly = dest.y + dy;
              break;
            }
          }
          this.hostPositions[id] = { x: lx, y: ly };
          this.botPaths.delete(id); // a teleported bot re-plans from the far side
          this.tpReadyAt = this.t + TELEPORT_CD;
          this.broadcastFx({
            type: 'fx',
            kind: 'teleport',
            x: pad.x,
            y: pad.y,
            id,
            tx: lx,
            ty: ly,
          });
          break outer;
        }
      }
    }
    // Lanterns.
    for (const id of active) {
      if (this.down[id] !== undefined) continue;
      const p = this.hostPositions[id];
      if (!p) continue;
      const cls = classById(this.roster.classes[id]);
      const rate = (cls.id === 'engineer' ? 2 : 1) / LANTERN_SECONDS;
      this.lanternPts.forEach((lp, i) => {
        if ((this.lant[i] ?? 1) >= 1) return;
        if (Math.hypot(lp.x - p.x, lp.y - p.y) < LANTERN_RADIUS) {
          const before = this.lant[i] ?? 0;
          this.lant[i] = Math.min(1, before + rate * dt);
          if (before < 1 && this.lant[i]! >= 1) {
            const q = this.lanternPts[i]!;
            this.broadcastFx({ type: 'fx', kind: 'lantern', x: q.x, y: q.y });
            // Every hider at the lantern shares the credit.
            for (const hid of active) {
              if (this.down[hid] !== undefined) continue;
              const hp = this.hostPositions[hid];
              if (hp && Math.hypot(lp.x - hp.x, lp.y - hp.y) < LANTERN_RADIUS) this.deed(hid).lit++;
            }
          }
        }
      });
    }
    // Gate: opens at all-but-one lanterns (a camped lantern guards nothing).
    // Dawn opens the HATCH instead — a second exit across the manor, so the
    // endgame never funnels through one campable door.
    const litEnough = this.lant.filter((v) => v >= 1).length >= this.needed;
    if (litEnough && !this.gateOpen) {
      this.gateOpen = true;
      this.broadcastFx({ type: 'fx', kind: 'gate', x: this.gatePt.x, y: this.gatePt.y });
    }
    if (this.t >= this.dawnAt && !this.hatchOpen) {
      this.hatchOpen = true;
      this.broadcastFx({ type: 'fx', kind: 'hatch', x: this.hatchPt.x, y: this.hatchPt.y });
    }
    // Snares.
    for (const id of active) {
      if (this.down[id] !== undefined) continue;
      const p = this.hostPositions[id];
      if (!p) continue;
      for (let i = this.traps.length - 1; i >= 0; i--) {
        const tr = this.traps[i]!;
        if (this.t < (tr.armAt ?? 0)) continue; // still rebuilding
        if (Math.hypot(tr.x - p.x, tr.y - p.y) < SNARE_RADIUS) {
          this.rootUntil[id] = this.t + (tr.s ?? SNARE_SECONDS);
          this.traps.splice(i, 1);
          this.broadcastFx({ type: 'fx', kind: 'snare', x: p.x, y: p.y, id });
          // Double Springs: the snare rebuilds itself — once.
          if (!tr.re && this.ownsUp(tr.owner ?? '', 'trapper3')) {
            this.traps.push({
              x: tr.x,
              y: tr.y,
              ...(tr.s !== undefined ? { s: tr.s } : {}),
              ...(tr.owner !== undefined ? { owner: tr.owner } : {}),
              re: true,
              armAt: this.t + TRAP_REARM_SECS,
            });
          }
        }
      }
    }
    // Second Wind: any downed Medic with the passive (and an off-cooldown
    // wind) schedules their own rise — whatever put them down.
    for (const id of Object.keys(this.down)) {
      if (this.selfRezAt[id] !== undefined) continue;
      if (!this.ownsUp(id, 'medic3')) continue;
      if (this.t < (this.selfRezCd[id] ?? 0)) continue;
      this.selfRezAt[id] = this.t + SELF_REZ_DELAY;
    }
    // Second Wind: pending self-revives rise on their own.
    for (const id of Object.keys(this.selfRezAt)) {
      if (this.down[id] === undefined) {
        delete this.selfRezAt[id]; // someone got there first
        continue;
      }
      if (this.t < this.selfRezAt[id]!) continue;
      delete this.selfRezAt[id];
      delete this.down[id];
      this.reviveProg[id] = 0;
      this.selfRezCd[id] = this.t + SELF_REZ_CD;
      const p = this.hostPositions[id];
      if (p) this.broadcastFx({ type: 'fx', kind: 'rescue', x: p.x, y: p.y, id });
    }
    // Revives + bleed.
    for (const did of Object.keys(this.down)) {
      const dp = this.hostPositions[did];
      if (!dp) continue;
      let helper = false;
      for (const hid of active) {
        if (hid === did || this.down[hid] !== undefined) continue;
        const hp = this.hostPositions[hid];
        if (!hp) continue;
        if (Math.hypot(hp.x - dp.x, hp.y - dp.y) < REVIVE_RADIUS) {
          const cls = classById(this.roster.classes[hid]);
          this.reviveProg[did] =
            (this.reviveProg[did] ?? 0) + (dt * (cls.id === 'medic' ? 2 : 1)) / REVIVE_SECONDS;
          helper = true;
        }
      }
      if (helper && (this.reviveProg[did] ?? 0) >= 1) {
        delete this.down[did];
        this.reviveProg[did] = 0;
        for (const hid of active) {
          if (hid === did || this.down[hid] !== undefined) continue;
          const hp = this.hostPositions[hid];
          if (hp && Math.hypot(hp.x - dp.x, hp.y - dp.y) < REVIVE_RADIUS) this.deed(hid).res++;
        }
        this.broadcastFx({ type: 'fx', kind: 'rescue', x: dp.x, y: dp.y, id: did });
      } else {
        this.down[did] = Math.max(0, (this.down[did] ?? 0) - dt);
        if (this.down[did]! <= 0) {
          delete this.down[did];
          this.out.add(did);
        }
      }
    }
    // Injured hiders patch up while tucked inside a hiding spot; step out and
    // the progress bleeds back off.
    for (const id of active) {
      if (!this.hurt.has(id) || this.down[id] !== undefined) continue;
      if (this.isConcealed(id)) {
        // Brood Comfort: patching up inside a caring Nester's den is 2x.
        const hp2 = this.hostPositions[id];
        const ni = hp2 ? this.nestAt(hp2.x, hp2.y) : -1;
        const brood = ni >= 0 && this.ownsUp(this.nests[ni]?.owner ?? '', 'nester3') ? 2 : 1;
        this.healProg[id] = (this.healProg[id] ?? 0) + (dt * brood) / HEAL_SECONDS;
        if (this.healProg[id]! >= 1) {
          this.hurt.delete(id);
          this.hits[id] = 0; // fully patched — all durability back
          delete this.healProg[id];
          const p = this.hostPositions[id];
          if (p) this.broadcastFx({ type: 'fx', kind: 'heal', x: p.x, y: p.y, id });
        }
      } else {
        this.healProg[id] = Math.max(0, (this.healProg[id] ?? 0) - dt / HEAL_SECONDS);
      }
    }
    // Escape — through the lantern gate, or the dawn hatch once it creaks.
    const exits: { x: number; y: number }[] = [];
    if (this.gateOpen) exits.push(this.gatePt);
    if (this.hatchOpen) exits.push(this.hatchPt);
    if (exits.length) {
      for (const id of active) {
        if (this.down[id] !== undefined) continue;
        const p = this.hostPositions[id];
        if (p && exits.some((e) => Math.hypot(p.x - e.x, p.y - e.y) < GATE_RADIUS)) {
          this.escaped.add(id);
          this.hurt.delete(id);
          delete this.healProg[id];
          this.broadcastFx({ type: 'fx', kind: 'escape', x: p.x, y: p.y, id });
        }
      }
    }
    // Expire decoys.
    this.decoys = this.decoys.filter((d) => d.until > this.t);
    // End check. The hunt is over when nobody's left in play (all escaped or
    // lost), OR when everyone still in is downed at once (no one standing to
    // rescue). Either way: if ANYONE made it out the gate, the hiders won —
    // downed stragglers (often bots) left behind never flip it to the Seeker.
    if (this.phase === 'playing') {
      const inPlay = this.activeHiders();
      // A downed Medic with Second Wind pending is NOT done — the hunt
      // holds its breath until they rise (or truly stay down).
      const allDown =
        inPlay.length > 0 &&
        inPlay.every((id) => this.down[id] !== undefined && this.selfRezAt[id] === undefined);
      if (inPlay.length === 0 || allDown) {
        this.endMatch(this.escaped.size > 0 ? 'hiders-win' : 'seeker-wins');
      }
    }
  }

  private endMatch(result: string): void {
    this.phase = result;
    const stats: Record<string, Deeds> = {};
    for (const id of this.roster.order) stats[id] = this.deed(id);
    this.session.broadcast({ type: 'end', result, stats });
    this.showEnd(result, stats);
  }

  /** Host: drive the AI bots (fill-in players). Everything else — lantern
   *  progress, revives, escapes, bleed — already resolves by position, so a
   *  bot only needs to steer; standing on a lantern lights it like anyone. */
  private hostSimBots(dt: number): void {
    this.botAtkCd = Math.max(0, this.botAtkCd - dt);
    for (const id of this.roster.order) {
      if (!id.startsWith('bot')) continue;
      if (this.escaped.has(id) || this.out.has(id)) continue;
      const p = this.hostPositions[id];
      if (!p) continue;
      if ((this.rootUntil[id] ?? 0) > this.t) continue; // snared
      const cls = classById(this.roster.classes[id]);
      const isSeeker = this.roster.roles[id] === 'seeker';
      const bi0 = parseInt(id.slice(3), 10) || 0;
      let gx = p.x;
      let gy = p.y;
      let speed = cls.speed * 0.9;
      if ((this.slowUntil[id] ?? 0) > this.t) speed *= WEB_SLOW; // webbed
      let stop = 40;

      if (isSeeker) {
        if (this.phase === 'hiding') continue; // eyes shut, counting
        speed = cls.speed * 0.82; // a touch slower so humans can juke
        if ((this.botBoost[id] ?? 0) > this.t) speed *= 1.5; // mid-lunge
        stop = ATTACK_RANGE * 0.55;
        // Fair play: the bot sees what a human Seeker sees. Concealed hiders
        // don't exist until searched, and a Trickster decoy looks exactly
        // like prey — it chases those too.
        let tgt: { x: number; y: number } | null = null;
        let best = 1e9;
        for (const hid of this.activeHiders()) {
          if ((this.vanishUntil[hid] ?? 0) > this.t) continue;
          const hp = this.hostPositions[hid];
          if (!hp) continue;
          const d = Math.hypot(hp.x - p.x, hp.y - p.y);
          // While the Howler's trail glows, the footprints lead bot seekers
          // even to tucked-away prey.
          if (this.isConcealed(hid) && d > SEARCH_RADIUS && this.t >= this.trailUntil) continue;
          if (d < best) {
            best = d;
            tgt = hp;
          }
        }
        for (const dcy of this.decoys) {
          const d = Math.hypot(dcy.x - p.x, dcy.y - p.y);
          if (d < best) {
            best = d;
            tgt = dcy;
          }
        }
        if (tgt) {
          gx = tgt.x;
          gy = tgt.y;
          // Lunge (Stalker): burst forward when prey is just out of reach.
          if (
            cls.ability.id === 'lunge' &&
            best > 200 &&
            best < 450 &&
            this.t >= (this.botCd[id] ?? 0)
          ) {
            this.botCd[id] = this.t + cls.ability.cooldown;
            this.botBoost[id] = this.t + 0.5;
          }
          if (best < ATTACK_RANGE * 0.9 && this.botAtkCd <= 0) {
            this.botAtkCd = BOT_ATTACK_EVERY;
            this.hostAttack(id);
          }
        } else {
          // Nobody in sight: search the nearest furniture now and then, or
          // patrol the unlit lanterns (rotating so it doesn't camp one).
          let spot = -1;
          let sd = 340;
          this.hidePts.forEach((q, i) => {
            if ((this.bustedUntil[i] ?? 0) > this.t) return;
            const d0 = Math.hypot(q.x - p.x, q.y - p.y);
            if (d0 < sd) {
              sd = d0;
              spot = i;
            }
          });
          if (spot >= 0 && this.t >= (this.botSearch[id] ?? 0)) {
            const q = this.hidePts[spot]!;
            gx = q.x;
            gy = q.y;
            stop = SEARCH_RADIUS * 0.6;
            if (sd < SEARCH_RADIUS * 0.7) this.botSearch[id] = this.t + 14;
          } else {
            const unlit: number[] = [];
            this.lanternPts.forEach((_, i) => {
              if ((this.lant[i] ?? 1) < 1) unlit.push(i);
            });
            const pool = unlit.length ? unlit : this.lanternPts.map((_, i) => i);
            const li = pool[(Math.floor(this.t / 9) + bi0) % pool.length]!;
            const lp2 = this.lanternPts[li] ?? this.gatePt;
            gx = lp2.x;
            gy = lp2.y;
            // Howler: screech while prowling — flush anyone in the open.
            if (cls.ability.id === 'screech' && this.t >= (this.botCd[id] ?? 0)) {
              this.botCd[id] = this.t + cls.ability.cooldown + 4;
              this.hostAbility(id, 'screech', p.x, p.y);
            }
          }
        }
      } else {
        if (this.down[id] !== undefined) continue; // downed — wait for a rescue
        // With Twin echoes and Wraith converts about, danger is whichever
        // seeker is CLOSEST — not just the primary.
        const seekerPos = this.nearestSeeker(p.x, p.y)?.p;
        // A stable per-bot index so each bot prefers different spots and they
        // fan out instead of all chasing the single nearest objective.
        const bi = bi0;
        if (this.phase === 'hiding') {
          // The count is on — scurry to your own hiding spot.
          const hs = this.hidePts[bi % Math.max(1, this.hidePts.length)];
          if (hs) {
            gx = hs.x;
            gy = hs.y;
            stop = 16;
          }
          speed = cls.speed;
        } else {
          this.botHiderAbility(id, cls.ability.id, cls.ability.cooldown, p, seekerPos);
          if ((this.botBoost[id] ?? 0) > this.t) speed *= 1.7; // mid-dash
        }
        const fleeing =
          this.phase !== 'hiding' &&
          !!seekerPos &&
          Math.hypot(seekerPos.x - p.x, seekerPos.y - p.y) < BOT_FLEE_DIST;
        if (this.phase === 'hiding') {
          /* goal already set above */
        } else if (fleeing && seekerPos) {
          // Scatter: each bot bolts for a *different* nearby hiding spot rather
          // than every bot piling onto the single closest one.
          const cand = this.hidePts
            .map((q) => ({ q, d: Math.hypot(q.x - p.x, q.y - p.y) }))
            .filter((o) => o.d < 440)
            .sort((a, b) => a.d - b.d);
          if (cand.length) {
            const hs = cand[bi % Math.min(cand.length, 3)]!.q;
            gx = hs.x;
            gy = hs.y;
            stop = 16;
          } else {
            // No cover — flee at a bot-specific angle away from the Seeker so
            // they don't all run the same line.
            const ax = p.x - seekerPos.x;
            const ay = p.y - seekerPos.y;
            const a0 = Math.atan2(ay, ax) + (((bi % 3) - 1) * Math.PI) / 5;
            gx = p.x + Math.cos(a0) * 220;
            gy = p.y + Math.sin(a0) * 220;
          }
          speed = cls.speed;
        } else if (this.gateOpen || this.hatchOpen) {
          // Run for the NEAREST open exit — gate or dawn hatch.
          const exits2: { x: number; y: number }[] = [];
          if (this.gateOpen) exits2.push(this.gatePt);
          if (this.hatchOpen) exits2.push(this.hatchPt);
          const ex = exits2.sort(
            (a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
          )[0]!;
          gx = ex.x;
          gy = ex.y;
        } else {
          // Divide up the objectives: each bot walks its *own* rotation of the
          // lantern list (starting at its index), taking the first still-unlit
          // one. So bot0 favours lantern0, bot1 lantern1, … and they spread
          // across the manor instead of swarming the nearest lantern together.
          const n = this.lanternPts.length;
          const unlit: number[] = [];
          for (let i = 0; i < n; i++) if ((this.lant[i] ?? 1) < 1) unlit.push(i);
          if (unlit.length) {
            const rank = (i: number): number => (i - bi + n) % n;
            const li = unlit.slice().sort((a, b) => rank(a) - rank(b))[0]!;
            gx = this.lanternPts[li]!.x;
            gy = this.lanternPts[li]!.y;
          } else {
            gx = this.gatePt.x;
            gy = this.gatePt.y;
          }
          // Help up a nearby downed ally if the coast is reasonably clear.
          for (const did of Object.keys(this.down)) {
            const dp = this.hostPositions[did];
            if (dp && Math.hypot(dp.x - p.x, dp.y - p.y) < 260) {
              gx = dp.x;
              gy = dp.y;
            }
          }
        }
      }

      // Steer along a BFS path so bots route through doorways instead of
      // pressing into walls. Fall back to a straight line if no path exists.
      let wx = gx;
      let wy = gy;
      let wstop = stop;
      const gc = Math.floor(gx / TILE_SIZE);
      const gr = Math.floor(gy / TILE_SIZE);
      const gk = `${gc},${gr}`;
      let info = this.botPaths.get(id);
      if (!info || info.goal !== gk) {
        info = { goal: gk, path: this.bfsPath(p.x, p.y, gx, gy), idx: 1 };
        this.botPaths.set(id, info);
      }
      if (info.path.length > info.idx) {
        const [c, r] = info.path[info.idx]!;
        wx = c * TILE_SIZE + TILE_SIZE / 2;
        wy = r * TILE_SIZE + TILE_SIZE / 2;
        if (Math.hypot(wx - p.x, wy - p.y) < TILE_SIZE * 0.6) info.idx++;
        if (info.idx < info.path.length - 1) wstop = 6; // keep moving between nodes
      }
      const d = Math.hypot(wx - p.x, wy - p.y) || 1;
      if (d > wstop) {
        const moved = moveWithCollision(
          this.map,
          p.x,
          p.y,
          16,
          14,
          ((wx - p.x) / d) * speed * dt,
          ((wy - p.y) / d) * speed * dt,
        );
        p.x = moved.x;
        p.y = moved.y;
      }
      // Builder walls stop SEEKER bots the same as human seekers.
      if (isSeeker) {
        for (const w of this.walls) {
          const dx = p.x - w.x;
          const dy = p.y - w.y;
          const d = Math.hypot(dx, dy);
          if (d < WALL_RADIUS + 16 && d > 0.01) {
            const push = (WALL_RADIUS + 16 - d) / d;
            p.x += dx * push;
            p.y += dy * push;
          }
        }
      }
    }
  }

  /** Hider bots fight back with their class kit, on honest cooldowns:
   *  Frost snaps the closing Seeker, Medic mends a nearby downed ally,
   *  Ghost vanishes at the last moment, Trickster drops a decoy while
   *  fleeing, Sprinter dashes. */
  private botHiderAbility(
    id: string,
    ability: string,
    cooldown: number,
    p: { x: number; y: number },
    seekerPos: { x: number; y: number } | undefined,
  ): void {
    if (this.t < (this.botCd[id] ?? 0)) return;
    const seekerDist = seekerPos ? Math.hypot(seekerPos.x - p.x, seekerPos.y - p.y) : 1e9;
    const fire = (): void => {
      this.botCd[id] = this.t + cooldown;
    };
    if (ability === 'freeze' && seekerDist < 200) {
      fire();
      this.hostAbility(id, 'freeze', p.x, p.y);
    } else if (ability === 'vanish' && seekerDist < 170) {
      fire();
      this.hostAbility(id, 'vanish', p.x, p.y);
    } else if (ability === 'decoy' && seekerDist < BOT_FLEE_DIST) {
      fire();
      this.hostAbility(id, 'decoy', p.x, p.y);
    } else if (ability === 'clones' && seekerDist < BOT_FLEE_DIST) {
      fire();
      this.hostAbility(id, 'clones', p.x, p.y);
    } else if (ability === 'wall' && seekerDist < 220) {
      fire();
      this.hostAbility(id, 'wall', p.x, p.y);
    } else if (ability === 'blast' && seekerDist < 200) {
      fire();
      this.hostAbility(id, 'blast', p.x, p.y);
    } else if (ability === 'blind' && seekerDist < 300) {
      // Siren bot: dazzle the closing Seeker and slip away in the white-out.
      fire();
      this.hostAbility(id, 'blind', p.x, p.y);
    } else if (ability === 'nest' && seekerDist < 220) {
      // Nester bot: conjure cover right underfoot when cornered.
      fire();
      this.hostAbility(id, 'nest', p.x, p.y);
    } else if (ability === 'mend') {
      for (const did of Object.keys(this.down)) {
        const dp = this.hostPositions[did];
        if (dp && Math.hypot(dp.x - p.x, dp.y - p.y) < 200) {
          fire();
          this.hostAbility(id, 'mend', p.x, p.y);
          break;
        }
      }
    }
  }

  /** BFS over walkable tiles → a tile path from (fx,fy) to (tx,ty). Returns
   *  just the start tile if the target is unreachable/solid. */
  private bfsPath(fx: number, fy: number, tx: number, ty: number): [number, number][] {
    const tw = this.map.width;
    const th = this.map.height;
    const fc = Math.max(0, Math.min(tw - 1, Math.floor(fx / TILE_SIZE)));
    const fr = Math.max(0, Math.min(th - 1, Math.floor(fy / TILE_SIZE)));
    const tc = Math.max(0, Math.min(tw - 1, Math.floor(tx / TILE_SIZE)));
    const tr = Math.max(0, Math.min(th - 1, Math.floor(ty / TILE_SIZE)));
    const start: [number, number] = [fc, fr];
    if ((fc === tc && fr === tr) || solidAt(this.map, tc, tr)) return [start];
    const prev = new Map<number, number>();
    const seen = new Set<number>([fr * tw + fc]);
    const queue: [number, number][] = [start];
    let head = 0;
    let found = false;
    while (head < queue.length) {
      const [c, r] = queue[head++]!;
      if (c === tc && r === tr) {
        found = true;
        break;
      }
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= tw || nr >= th) continue;
        if (solidAt(this.map, nc, nr)) continue;
        const k = nr * tw + nc;
        if (seen.has(k)) continue;
        seen.add(k);
        prev.set(k, r * tw + c);
        queue.push([nc, nr]);
      }
    }
    if (!found) return [start];
    const path: [number, number][] = [];
    let cur: number | undefined = tr * tw + tc;
    while (cur !== undefined) {
      path.push([cur % tw, Math.floor(cur / tw)]);
      cur = prev.get(cur);
    }
    path.reverse();
    return path;
  }

  private reveal(points: { x: number; y: number }[], color: number, secs: number): void {
    this.session.broadcast({ type: 'reveal', points, color, secs });
    this.playReveal(points, color, secs);
  }

  private broadcastFx(fx: Fx): void {
    this.session.broadcast(fx);
    this.playFx(fx);
  }

  // -------------------------------------------------------------- update

  protected override onUpdate(dt: number): void {
    this.t += dt;
    this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.sprintCdLeft = Math.max(0, this.sprintCdLeft - dt);
    if (this.sprintBtn) this.sprintBtn.alpha = this.sprintCdLeft > 0 ? 0.4 : 1;
    this.specialCdLeft = Math.max(0, this.specialCdLeft - dt);
    if (this.specialBtn) {
      // Cooling: the button counts down the seconds so the wait is visible.
      this.specialBtn.alpha = this.specialCdLeft > 0 ? 0.4 : 1;
      const lbl =
        this.specialCdLeft > 0
          ? `${Math.ceil(this.specialCdLeft)}`
          : (this.specialDef?.emoji ?? '');
      if (lbl !== this.specialLbl) {
        this.specialLbl = lbl;
        this.specialBtn.setLabel(lbl);
      }
    }
    // Dazzled: the white-out holds, then thins as sight returns.
    if (this.blindG) {
      this.blindLeft = Math.max(0, this.blindLeft - dt);
      const frac = this.blindLeft / BLIND_SECONDS;
      this.blindG.visible = frac > 0;
      this.blindG.alpha = Math.min(1, frac * 1.6);
    }
    // Proximity voice: each peer's volume tracks in-game distance.
    this.voice?.updateDistances((id) => {
      const r = this.remotes.get(id);
      return r ? Math.hypot(r.entity.x - this.me.x, r.entity.y - this.me.y) : null;
    });
    // REC light: pulse while a clip is rolling.
    if (this.recDot) {
      this.recDot.visible = this.recorder.recording;
      if (this.recDot.visible) this.recDot.alpha = 0.55 + 0.45 * Math.sin(this.t * 6);
    }
    // Seekers only see a Nester den when right on top of it — the flower
    // patch fades in as they close, so cover reads as scenery from afar.
    if (this.amSeeker) {
      this.nestViews.forEach((g, i) => {
        const n = this.snapNests[i];
        if (!n) return;
        const d = Math.hypot(n.x - this.me.x, n.y - this.me.y);
        g.alpha = sightAlpha(d, NEST_SEE_FULL, NEST_SEE_FADE);
      });
    }
    // Lookout's Sense arrow: circles my blob, pointing at the nearest Seeker.
    if (this.t < this.senseUntil) {
      if (!this.senseArrowG) {
        this.senseArrowG = new Graphics();
        this.me.addChild(this.senseArrowG);
      }
      // Survivors track the nearest SEEKER; a scenting Stalker tracks the
      // nearest SURVIVOR.
      let sp: { x: number; y: number } | null = null;
      let bd = Infinity;
      for (const [id, r] of this.remotes) {
        if (this.isSeekerRole(id) === this.amSeeker) continue;
        if (this.amSeeker && (this.escaped.has(id) || this.out.has(id))) continue;
        const d = Math.hypot(r.entity.x - this.me.x, r.entity.y - this.me.y);
        if (d < bd) {
          bd = d;
          sp = { x: r.entity.x, y: r.entity.y };
        }
      }
      this.senseArrowG.clear();
      if (sp) {
        const a = Math.atan2(sp.y - this.me.y, sp.x - this.me.x);
        const tipX = Math.cos(a) * 82;
        const tipY = Math.sin(a) * 82;
        this.senseArrowG
          .poly([
            tipX,
            tipY,
            Math.cos(a + 2.6) * 26 + Math.cos(a) * 56,
            Math.sin(a + 2.6) * 26 + Math.sin(a) * 56,
            Math.cos(a - 2.6) * 26 + Math.cos(a) * 56,
            Math.sin(a - 2.6) * 26 + Math.sin(a) * 56,
          ])
          .fill({ color: NIGHT.blood, alpha: 0.5 + 0.4 * Math.abs(Math.sin(this.t * 5)) });
      }
    } else if (this.senseArrowG) {
      this.senseArrowG.clear();
    }
    if (this.session.isHost) {
      this.hostSim(dt);
      this.hostSimBots(dt);
    }

    const iAmDown =
      this.snapDown[this.session.id] !== undefined || this.down[this.session.id] !== undefined;
    const iAmRooted =
      this.snapRooted.has(this.session.id) || (this.rootUntil[this.session.id] ?? 0) > this.t;
    const iAmOut = this.out.has(this.session.id);
    const iAmEscaped = this.escaped.has(this.session.id);
    // During the hide phase the SEEKER stands counting (eyes shut) while the
    // hiders are free to scatter; terminal phases freeze everyone.
    const phaseFrozen = this.phase === 'hiding' ? this.amSeeker : this.phase !== 'playing';
    const frozen = iAmDown || iAmRooted || iAmOut || iAmEscaped || phaseFrozen;

    // Movement.
    if (this.t < this.boostUntil) {
      /* boost active */
    } else this.boostFactor = 1;
    let jx = frozen ? 0 : this.joystick.value.x;
    let jy = frozen ? 0 : this.joystick.value.y;
    if (!frozen && Math.hypot(jx, jy) <= 0.12) {
      const kv = this.keyVector();
      jx = kv.x;
      jy = kv.y;
    }
    // Webbed? You crawl until the strands snap.
    const slowMul = this.snapSlowed.has(this.session.id) ? WEB_SLOW : 1;
    // Natural speed comes from class stats (+ passives); SPRINT is a burst.
    const sprintMul = !this.amSeeker && this.t < this.sprintUntil ? SPRINT_MUL : 1;
    // Deep Shroud: a cloaked Wraith with the passive glides faster.
    const shroudMul =
      this.amSeeker &&
      this.snapVanished.has(this.session.id) &&
      this.ownsUp(this.session.id, 'wraith3')
        ? SHROUD_MUL
        : 1;
    const speed =
      this.statsOf(this.session.id).speed * this.boostFactor * slowMul * sprintMul * shroudMul;
    let sx = 1;
    let sy = 1;
    if (Math.hypot(jx, jy) > 0.12) {
      // Any manual input cancels an auto-walk into a hiding spot.
      this.hideTarget = null;
      const moved = moveWithCollision(
        this.map,
        this.me.x,
        this.me.y,
        18,
        14,
        jx * speed * dt,
        jy * speed * dt,
      );
      this.me.position.set(moved.x, moved.y);
      this.walk += dt * 11;
      const s = Math.sin(this.walk) * 0.07;
      sx = 1 + s;
      sy = 1 - s;
    } else if (this.hideTarget && !frozen) {
      // Tapped a hiding spot — auto-walk into it, then settle.
      const dx = this.hideTarget.x - this.me.x;
      const dy = this.hideTarget.y - this.me.y;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        const step = Math.min(d, speed * dt);
        const moved = moveWithCollision(
          this.map,
          this.me.x,
          this.me.y,
          18,
          14,
          (dx / d) * step,
          (dy / d) * step,
        );
        // Wall in the way and no progress → abandon the auto-walk.
        if (Math.hypot(moved.x - this.me.x, moved.y - this.me.y) < 0.4) this.hideTarget = null;
        this.me.position.set(moved.x, moved.y);
        this.walk += dt * 11;
        const s = Math.sin(this.walk) * 0.07;
        sx = 1 + s;
        sy = 1 - s;
      } else {
        this.hideTarget = null;
      }
    }
    // Builder walls: only SEEKERS collide — hiders slip right through.
    if (this.amSeeker) {
      for (const w of this.snapWalls) {
        const dx = this.me.x - w.x;
        const dy = this.me.y - w.y;
        const d = Math.hypot(dx, dy);
        if (d < WALL_RADIUS + 18 && d > 0.01) {
          const push = (WALL_RADIUS + 18 - d) / d;
          this.me.position.set(this.me.x + dx * push, this.me.y + dy * push);
        }
      }
    }
    // Hidden self: tuck in noticeably (shrink + fade) while inside a spot.
    const concealed = !this.amSeeker && !frozen && this.amConcealedLocal();
    this.hiddenAmt += ((concealed ? 1 : 0) - this.hiddenAmt) * Math.min(1, dt * 8);
    // Local estimate of patching up while injured + hidden (host is authority).
    const iAmHurt = this.snapHurt.has(this.session.id);
    if (iAmHurt && concealed) this.healEst = Math.min(HEAL_SECONDS, this.healEst + dt);
    else if (!iAmHurt) this.healEst = 0;
    else this.healEst = Math.max(0, this.healEst - dt);
    const tuck = 1 - this.hiddenAmt * 0.42;
    this.meBody.scale.set(sx * tuck, sy * tuck);
    this.meBody.alpha = 1 - this.hiddenAmt * 0.5;
    // Highlight the spot I'm tucked into (or heading toward) so hiding reads.
    this.hideGlow.clear();
    const glowAt = concealed
      ? this.hidePts.find((b) => Math.hypot(b.x - this.me.x, b.y - this.me.y) < HIDE_RADIUS)
      : this.hideTarget;
    if (glowAt) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
      const col = concealed ? NIGHT.gate : NIGHT.violet;
      this.hideGlow
        .roundRect(glowAt.x - 46, glowAt.y - 56, 92, 112, 12)
        .stroke({ color: col, width: 4, alpha: 0.35 + pulse * 0.4 });
    }

    // Ship position every tick (not just on movement): stationary hiders must
    // still be visible to the host for hiding, rescue, escape and attacks.
    this.sendIn -= dt;
    if (this.sendIn <= 0) {
      this.sendIn = SEND;
      if (this.session.isHost) {
        this.hostPositions[this.session.id] = { x: this.me.x, y: this.me.y };
        this.broadcastSnap();
      } else {
        this.session.send({ type: 'pos', x: this.me.x, y: this.me.y });
      }
    }

    // Remote smoothing + seeker fog.
    for (const [id, r] of this.remotes) {
      if (this.session.isHost) {
        const p = this.hostPositions[id];
        if (p) {
          r.targetX = p.x;
          r.targetY = p.y;
        }
      }
      const k = Math.min(1, dt * 12);
      r.entity.x += (r.targetX - r.entity.x) * k;
      r.entity.y += (r.targetY - r.entity.y) * k;
      this.styleRemote(id, r, dt);
    }

    this.updateSpectate(iAmOut, iAmEscaped);
    this.updateHud();
    this.updateDownSignals();
    this.updateCompass();
    this.updateTerror(dt);
    this.camera.update(dt);
    // Keep the lit disc centred on the camera's star (me, or whoever I'm
    // spectating) and grow it while a vision ability runs.
    const eye = this.spectating ?? this.me;
    if (this.fog) {
      this.fog.position.set(eye.x + this.mapLayer.x, eye.y + this.mapLayer.y);
      const target = this.t < this.visionBoostUntil || this.spectating ? VISION_BOOST : 1;
      const cur = this.fog.scale.x / this.fogBaseScale;
      const next = cur + (target - cur) * Math.min(1, dt * 6);
      this.fog.scale.set(this.fogBaseScale * next);
    }
    this.drawLightPools();
    this.drawTrailGlow();
    this.updateBlindfold();
  }

  /** Tile-grid line of sight: walls (and tall furniture) block your view of
   *  other blobs — corners finally mean something. */
  private losBlocked(x0: number, y0: number, x1: number, y1: number): boolean {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(dist / (TILE_SIZE * 0.45));
    for (let i = 1; i < steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      if (solidAt(this.map, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))) return true;
    }
    return false;
  }

  /** How strongly the lit lanterns illuminate a world position (0..1). */
  private lanternLightAt(x: number, y: number): number {
    let best = 0;
    this.lanternPts.forEach((p, i) => {
      if ((this.snapLant[i] ?? 0) < 1) return;
      best = Math.max(best, sightAlpha(Math.hypot(p.x - x, p.y - y), LIGHT_FULL, LIGHT_FADE));
    });
    return best;
  }

  // Spectator cam: once you've escaped (or the dark claimed you), ride along
  // with a teammate still in the hunt instead of staring at frozen fog.
  private spectating: Entity | null = null;
  private spectateName = '';
  private updateSpectate(iAmOut: boolean, iAmEscaped: boolean): void {
    const want = (iAmOut || iAmEscaped) && this.phase === 'playing';
    if (!want) {
      if (this.spectating) {
        this.spectating = null;
        this.spectateName = '';
        this.camera.follow(this.me);
      }
      return;
    }
    // Follow the first teammate still standing (falling back to the Seeker).
    const targetId =
      this.activeHiders().find((id) => id !== this.session.id && this.remotes.has(id)) ??
      (this.remotes.has(this.seekerId) ? this.seekerId : null);
    const r = targetId ? this.remotes.get(targetId) : null;
    if (r && this.spectating !== r.entity) {
      this.spectating = r.entity;
      this.spectateName = this.roster.names[targetId!] ?? '?';
      this.camera.follow(r.entity);
    }
  }

  // Lit lanterns (and the open gate) punch warm pools through the fog.
  private lightGlow: Graphics | null = null;
  private drawLightPools(): void {
    if (!this.lightGlow) return;
    const g = this.lightGlow;
    g.clear();
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const pool = (wx: number, wy: number, color: number, k: number): void => {
      const sx = wx + this.mapLayer.x;
      const sy = wy + this.mapLayer.y;
      if (sx < -LIGHT_FADE || sy < -LIGHT_FADE || sx > W + LIGHT_FADE || sy > H + LIGHT_FADE)
        return;
      g.circle(sx, sy, LIGHT_FADE * k).fill({ color, alpha: 0.09 });
      g.circle(sx, sy, LIGHT_FULL * k).fill({ color, alpha: 0.11 });
      g.circle(sx, sy, LIGHT_FULL * 0.55 * k).fill({ color, alpha: 0.13 });
    };
    this.lanternPts.forEach((p, i) => {
      if ((this.snapLant[i] ?? 0) >= 1) pool(p.x, p.y - 26, NIGHT.lantern, 1);
    });
    if (this.snapGate) pool(this.gatePt.x, this.gatePt.y, NIGHT.gate, 0.8);
  }

  // The Seeker's blindfold: a near-black curtain with the countdown while
  // the hiders scatter.
  private blindfold: Container | null = null;
  private blindfoldNum: Text | null = null;
  private updateBlindfold(): void {
    if (!this.blindfold) return;
    const on = this.amSeeker && this.phase === 'hiding';
    this.blindfold.visible = on;
    if (on && this.blindfoldNum) {
      const secs = `${Math.max(0, Math.ceil(this.snapHideLeft))}`;
      if (this.blindfoldNum.text !== secs) this.blindfoldNum.text = secs;
    }
  }

  // A soft edge-arrow nudging hiders toward the nearest unlit lantern (or
  // the open gate) — the big manors need a sense of direction.
  private compass: Graphics | null = null;
  private updateCompass(): void {
    if (!this.compass) return;
    const g = this.compass;
    g.clear();
    if (this.amSeeker || this.phase !== 'playing' || this.spectating) return;
    if (
      this.snapDown[this.session.id] !== undefined ||
      this.out.has(this.session.id) ||
      this.escaped.has(this.session.id)
    )
      return;
    let target: { x: number; y: number } | null = null;
    let color: number = NIGHT.lantern;
    if (this.snapGate || this.snapHatch) {
      const exits: { x: number; y: number }[] = [];
      if (this.snapGate) exits.push(this.gatePt);
      if (this.snapHatch) exits.push(this.hatchPt);
      target = exits.sort(
        (a, b) =>
          Math.hypot(a.x - this.me.x, a.y - this.me.y) -
          Math.hypot(b.x - this.me.x, b.y - this.me.y),
      )[0]!;
      color = NIGHT.gate;
    } else {
      let bd = 1e9;
      this.lanternPts.forEach((p, i) => {
        if ((this.snapLant[i] ?? 0) >= 1) return;
        const d = Math.hypot(p.x - this.me.x, p.y - this.me.y);
        if (d < bd) {
          bd = d;
          target = p;
        }
      });
    }
    if (!target) return;
    const t2: { x: number; y: number } = target;
    const d = Math.hypot(t2.x - this.me.x, t2.y - this.me.y);
    if (d < 420) return; // close enough to spot it yourself
    const ang = Math.atan2(t2.y - this.me.y, t2.x - this.me.x);
    const px = this.me.x + this.mapLayer.x + Math.cos(ang) * 120;
    const py = this.me.y + this.mapLayer.y + Math.sin(ang) * 120;
    g.poly([14, 0, -9, -9, -9, 9]).fill({ color, alpha: 0.55 });
    g.position.set(px, py);
    g.rotation = ang;
  }

  private styleRemote(id: string, r: Remote, dt: number): void {
    const isSeeker = this.roster.roles[id] === 'seeker';
    const downed = this.snapDown[id] !== undefined || this.down[id] !== undefined;
    const gone = this.escaped.has(id) || this.out.has(id);
    r.entity.visible = !gone;
    // Fog of war: anyone beyond your sight radius is hidden; they fade in as
    // they cross into view. Sight widens while your vision ability is active.
    const eye = this.spectating ?? this.me;
    const boost = this.t < this.visionBoostUntil || this.spectating ? VISION_BOOST : 1;
    const full = (this.amSeeker ? SEEKER_SIGHT_FULL : HIDER_SIGHT_FULL) * boost;
    const fade = (this.amSeeker ? SEEKER_SIGHT_FADE : HIDER_SIGHT_FADE) * boost;
    const dist = Math.hypot(r.entity.x - eye.x, r.entity.y - eye.y);
    let distAlpha = sightAlpha(dist, full, fade);
    // Standing in a lit lantern's pool makes you visible from anywhere —
    // the light you fought for cuts both ways.
    distAlpha = Math.max(distAlpha, this.lanternLightAt(r.entity.x, r.entity.y));
    // …but a wall between you blocks the view entirely. Corners matter.
    if (distAlpha > 0 && this.losBlocked(eye.x, eye.y, r.entity.x, r.entity.y)) distAlpha = 0;
    // A hider in a hiding spot is invisible to the Seeker until searched — the
    // Seeker must step within SEARCH_RADIUS of them to reveal them.
    if (this.amSeeker && !isSeeker && this.snapHidden.has(id) && dist > SEARCH_RADIUS)
      distAlpha = 0;
    // Ease toward the target so corner reveals don't strobe.
    r.entity.alpha += (distAlpha - r.entity.alpha) * Math.min(1, dt * 10);
    // Vanish (Ghost) hides fully from the Seeker — and a cloaked Wraith
    // (Seeker) hides fully from every hider.
    let alpha = 1;
    if (this.amSeeker && !isSeeker && this.snapVanished.has(id)) alpha = 0;
    if (!this.amSeeker && isSeeker && this.snapVanished.has(id)) alpha = 0;
    r.body.alpha = downed ? 0.4 : alpha;
    r.mark.clear();
    if (downed) {
      // downed marker + revive ring so allies can find them
      r.mark.circle(0, 0, 26).stroke({ color: NIGHT.blood, width: 4, alpha: 0.9 });
      r.mark
        .moveTo(-10, -10)
        .lineTo(10, 10)
        .moveTo(10, -10)
        .lineTo(-10, 10)
        .stroke({ color: NIGHT.blood, width: 4 });
    } else if (!isSeeker && this.snapHurt.has(id)) {
      // injured marker — a red gash so both allies and the Seeker can tell
      // this one is one hit from going down.
      r.mark
        .arc(0, -34, 12, Math.PI * 0.15, Math.PI * 0.85)
        .stroke({ color: NIGHT.blood, width: 4, alpha: 0.9 });
      r.mark
        .moveTo(-5, -30)
        .lineTo(5, -38)
        .moveTo(-5, -38)
        .lineTo(5, -30)
        .stroke({ color: NIGHT.blood, width: 3, alpha: 0.85 });
    }
    if (!isSeeker && this.snapSlowed.has(id)) {
      // webbed — sticky strands wrap the blob
      for (let i = 0; i < 3; i++) {
        r.mark
          .moveTo(-26, -14 + i * 12)
          .lineTo(26, -18 + i * 12)
          .stroke({ color: 0xd8d4e8, width: 2.5, alpha: 0.8 });
      }
    }
  }

  private broadcastSnap(): void {
    const players: Record<string, { x: number; y: number }> = {};
    for (const [id, p] of Object.entries(this.hostPositions)) players[id] = { x: p.x, y: p.y };
    const hidden = this.activeHiders().filter((id) => this.isConcealed(id));
    const vanished = Object.keys(this.vanishUntil).filter(
      (id) => (this.vanishUntil[id] ?? 0) > this.t,
    );
    const rooted = Object.keys(this.rootUntil).filter((id) => (this.rootUntil[id] ?? 0) > this.t);
    const hurt = [...this.hurt];
    const busted: number[] = [];
    this.bustedUntil.forEach((until, i) => {
      if (until > this.t) busted.push(i);
    });
    const snap: Snap = {
      type: 'snap',
      players,
      lant: this.lant,
      gate: this.gateOpen,
      down: this.down,
      esc: [...this.escaped],
      out: [...this.out],
      hidden,
      vanished,
      rooted,
      hurt,
      downs: this.downsTaken,
      busted,
      dawn: Math.max(0, this.dawnAt - this.t),
      decoys: this.decoys.map((d) => ({ x: d.x, y: d.y })),
      phase: this.phase,
      hideL: this.hideLeft,
      tp: Math.max(0, this.tpReadyAt - this.t),
      slowed: Object.keys(this.slowUntil).filter((id) => (this.slowUntil[id] ?? 0) > this.t),
      traps: this.traps.map((tr) => ({ x: tr.x, y: tr.y })),
      hatch: this.hatchOpen,
      nests: this.nests.map((n) => ({ x: n.x, y: n.y })),
      conv: [...this.converted],
      trail: Math.max(0, this.trailUntil - this.t),
      cl: this.clones.map((c) => ({ x: c.x, y: c.y, n: this.roster.names[c.owner] ?? '?' })),
      dm: Object.values(this.dummies).map((d) => ({ x: d.x, y: d.y })),
      wl: this.walls.map((w) => ({ x: w.x, y: w.y })),
      tpads: this.tempPads.map((p) => ({ x: p.x, y: p.y })),
      rb: this.rubble.map((r) => ({ x: r.x, y: r.y })),
    };
    this.session.broadcast(snap);
    // Host mirrors its own snap-derived view.
    this.snapLant = this.lant;
    this.snapGate = this.gateOpen;
    this.snapDown = this.down;
    this.snapHidden = new Set(hidden);
    this.snapVanished = new Set(vanished);
    this.snapRooted = new Set(rooted);
    this.snapHurt = new Set(hurt);
    this.snapDowns = this.downsTaken;
    this.snapBusted = new Set(busted);
    this.snapDawn = Math.max(0, this.dawnAt - this.t);
    this.snapHideLeft = this.hideLeft;
    this.snapTpCd = Math.max(0, this.tpReadyAt - this.t);
    this.snapSlowed = new Set(snap.slowed);
    this.snapHatch = this.hatchOpen;
    this.snapTrail = snap.trail;
    this.applyConversions(snap.conv);
    this.dropTrailDots(snap.players);
    this.syncClones(snap.cl);
    this.syncDums(snap.dm);
    this.syncWalls(snap.wl);
    this.syncTpads(snap.tpads);
    this.syncRubble(snap.rb);
    this.syncTraps(snap.traps);
    this.syncNests(snap.nests);
    this.syncDecoys(snap.decoys);
    this.redrawObjectives();
  }

  private updateHud(): void {
    const lit = this.snapLant.filter((v) => v >= 1).length;
    const needTo = Math.max(1, this.snapLant.length - 1);
    const dawnSecs = Math.max(0, Math.ceil(this.snapDawn));
    const mm = Math.floor(dawnSecs / 60);
    const ss = `${dawnSecs % 60}`.padStart(2, '0');
    let hudLine =
      this.phase === 'hiding'
        ? `🙈 The Seeker counts… ${Math.max(0, Math.ceil(this.snapHideLeft))}`
        : this.snapGate && this.snapHatch
          ? '🚪 GATE + HATCH OPEN — escape!'
          : this.snapGate
            ? '🚪 GATE OPEN — escape!'
            : this.snapHatch
              ? '🌅 DAWN — the hatch is open, run!'
              : `🕯️ ${lit}/${needTo} · 🌅 ${mm}:${ss}`;
    if (!this.amSeeker && !this.escaped.has(this.session.id)) {
      const left = Math.max(0, LIVES - (this.snapDowns[this.session.id] ?? 0));
      hudLine += `  ${'❤️'.repeat(left)}${'🖤'.repeat(LIVES - left)}`;
    }
    this.hud.text = hudLine;
    const iAmDown = this.snapDown[this.session.id] !== undefined;
    const iAmHurt = this.snapHurt.has(this.session.id);
    const iAmHidden = this.hiddenAmt > 0.5;
    const lastLife = (this.snapDowns[this.session.id] ?? 0) >= LIVES - 1;
    if (!this.amSeeker) {
      if (this.phase === 'hiding') {
        this.roleHud.text = '🏃 Scatter — find a spot before the count ends!';
        this.roleHud.style.fill = NIGHT.violet;
      } else if (this.spectating) {
        this.roleHud.text = `👻 Spectating ${this.spectateName}`;
        this.roleHud.style.fill = NIGHT.inkSoft;
      } else if (this.out.has(this.session.id)) {
        this.roleHud.text = '💀 The dark claimed you — watch the hunt play out';
        this.roleHud.style.fill = NIGHT.inkSoft;
      } else if (iAmDown) {
        this.roleHud.text = lastLife
          ? '💀 DOWNED — this is your LAST life, hold on!'
          : '💀 DOWNED — hold on, someone can save you';
        this.roleHud.style.fill = NIGHT.blood;
      } else if (iAmHurt) {
        this.roleHud.text = iAmHidden
          ? '🩹 Patching up — stay hidden…'
          : '🩸 Injured — one more hit downs you. Hide to heal';
        this.roleHud.style.fill = NIGHT.blood;
      } else if (iAmHidden) {
        this.roleHud.text = '🫥 Hidden — stay still, the Seeker must search you out';
        this.roleHud.style.fill = NIGHT.gate;
      } else if (
        this.snapTpCd <= 0 &&
        this.teleportPts.some((p) => Math.hypot(p.x - this.me.x, p.y - this.me.y) < 260)
      ) {
        // Teach the teleporter right where it matters.
        this.roleHud.text = '🌀 Step on the rune ring to ride to its twin pad';
        this.roleHud.style.fill = NIGHT.violet;
      } else {
        this.roleHud.text = this.roleHudBase;
        this.roleHud.style.fill = NIGHT.gate;
      }
    }
    this.myBar.clear();
    if (iAmDown) {
      const bleed = this.snapDown[this.session.id] ?? 0;
      this.myBar.rect(-26, 0, 52, 6).fill({ color: 0x000000, alpha: 0.4 });
      this.myBar.rect(-26, 0, 52 * Math.max(0, bleed / BLEED_SECONDS), 6).fill(NIGHT.blood);
    } else if (iAmHurt) {
      // Injured: a red pip; if patching up while hidden, a green bar fills over it.
      this.myBar.rect(-26, 0, 52, 6).fill({ color: 0x000000, alpha: 0.4 });
      this.myBar.rect(-26, 0, 26, 6).fill(NIGHT.blood);
      if (this.healEst > 0)
        this.myBar.rect(-26, 0, 52 * (this.healEst / HEAL_SECONDS), 6).fill(NIGHT.gate);
    }
    this.abilityBtn.alpha = this.cooldownLeft > 0 ? 0.4 : 1;
    if (this.attackBtn) this.attackBtn.alpha = this.attackCd > 0 ? 0.4 : 1;
    // Party statuses.
    for (const [id, row] of this.partyRows) {
      const downed = this.snapDown[id] !== undefined;
      const esc = this.escaped.has(id);
      const gone = this.out.has(id);
      const injured = this.snapHurt.has(id);
      const color = esc
        ? NIGHT.gate
        : gone
          ? 0x556070
          : downed
            ? NIGHT.blood
            : injured
              ? 0xd98a8a
              : NIGHT.ghost;
      row.dot.clear();
      row.dot.circle(0, 0, 8).fill(color);
      const suffix = esc ? ' ✓escaped' : gone ? ' ✗out' : downed ? ' 💀' : injured ? ' 🩸' : '';
      const base = this.roster.names[id] ?? '?';
      if (row.label.text !== base + suffix) row.label.text = base + suffix;
    }
  }

  /** Point an arrow + bleed-out countdown at each downed teammate so allies
   *  know which way to run to save them. Hiders only. */
  private updateDownSignals(): void {
    if (this.amSeeker) {
      if (this.downArrows.size) {
        for (const [, sig] of this.downArrows) sig.root.destroy({ children: true });
        this.downArrows.clear();
      }
      return;
    }
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const myScreenX = this.me.x + this.mapLayer.x;
    const myScreenY = this.me.y + this.mapLayer.y;
    const live = new Set<string>();
    for (const id of Object.keys(this.snapDown)) {
      if (id === this.session.id || this.escaped.has(id) || this.out.has(id)) continue;
      const r = this.remotes.get(id);
      const wp = r ? { x: r.entity.x, y: r.entity.y } : this.hostPositions[id];
      if (!wp) continue;
      live.add(id);
      let sig = this.downArrows.get(id);
      if (!sig) {
        const root = new Container();
        const arrow = new Graphics().poly([18, 0, -11, -12, -11, 12]).fill(NIGHT.blood);
        arrow.stroke({ color: 0x1a0810, width: 2 });
        root.addChild(arrow);
        const label = makeText('', 18, { color: 0xffffff, weight: '800' });
        label.anchor.set(0.5);
        label.position.set(0, 24);
        root.addChild(label);
        this.downSignals.addChild(root);
        sig = { root, arrow, label };
        this.downArrows.set(id, sig);
      }
      const ang = Math.atan2(wp.y - this.me.y, wp.x - this.me.x);
      const R = 150;
      const m = 64;
      const px = Math.max(m, Math.min(W - m, myScreenX + Math.cos(ang) * R));
      const py = Math.max(m, Math.min(H - m, myScreenY + Math.sin(ang) * R));
      sig.root.position.set(px, py);
      sig.arrow.rotation = ang;
      const secs = Math.ceil(this.snapDown[id] ?? 0);
      if (sig.label.text !== `${secs}`) sig.label.text = `${secs}`;
    }
    for (const [id, sig] of this.downArrows) {
      if (!live.has(id)) {
        sig.root.destroy({ children: true });
        this.downArrows.delete(id);
      }
    }
  }

  private updateTerror(dt: number): void {
    if (this.amSeeker || this.phase !== 'playing') {
      setTerror(0);
      this.terrorVignette.alpha = 0;
      updateHeartbeat(dt);
      return;
    }
    // Terror tracks the CLOSEST hunter — echoes and converts count too.
    let level = 0;
    for (const sid of this.seekerIds()) {
      const sp = this.hostPositions[sid] ?? this.remotes.get(sid)?.entity;
      if (!sp) continue;
      const d = Math.hypot((sp.x ?? 0) - this.me.x, (sp.y ?? 0) - this.me.y);
      level = Math.max(level, Math.min(1, (620 - d) / 500));
    }
    setTerror(level);
    this.terrorVignette.alpha = level * 0.5;
    updateHeartbeat(dt);
  }

  // ------------------------------------------------------------ decoys/fx

  private syncDecoys(list: { x: number; y: number }[]): void {
    while (this.decoyViews.length > list.length) {
      const v = this.decoyViews.pop();
      if (v) this.remove(v);
    }
    while (this.decoyViews.length < list.length) {
      const e = new Entity();
      const ch = blobCharacter({ radius: 28, color: NIGHT.violet, seed: 99, shadow: false });
      e.addChild(ch.view);
      e.alpha = 0.7;
      this.add(e, this.mapLayer);
      this.decoyViews.push(e);
    }
    list.forEach((d, i) => this.decoyViews[i]?.position.set(d.x, d.y));
  }

  private playReveal(points: { x: number; y: number }[], color: number, secs: number): void {
    this.revealSeen += 1;
    for (const p of points) {
      const e = new Entity();
      e.position.set(p.x, p.y);
      const g = new Graphics()
        .circle(0, 0, 40)
        .stroke({ color, width: 6, alpha: 0.9 })
        .circle(0, 0, 8)
        .fill(color);
      e.addChild(g);
      e.addBehavior(new Wobble({ target: e, amount: 0.14, speed: 4 }));
      e.addBehavior(new Timer(secs, () => this.remove(e)));
      this.add(e, this.mapLayer);
    }
  }

  private playFx(fx: Fx): void {
    const e = new Entity();
    e.position.set(fx.x, fx.y);
    const g = new Graphics();
    e.addChild(g);
    let life = 0.5;
    switch (fx.kind) {
      case 'attack':
        if (fx.tx !== undefined && fx.ty !== undefined) {
          // A landed swing sweeps toward its victim.
          g.arc(0, 0, ATTACK_RANGE * 0.8, -1.1, 1.1).stroke({
            color: NIGHT.blood,
            width: 14,
            alpha: 0.85,
          });
          g.arc(0, 0, ATTACK_RANGE * 0.55, -0.9, 0.9).stroke({
            color: 0xff8fa8,
            width: 8,
            alpha: 0.7,
          });
          e.rotation = Math.atan2(fx.ty - fx.y, fx.tx - fx.x);
        } else {
          // A whiff spins all the way around — swung at shadows.
          g.circle(0, 0, ATTACK_RANGE * 0.7).stroke({ color: NIGHT.blood, width: 10, alpha: 0.5 });
          g.circle(0, 0, ATTACK_RANGE * 0.45).stroke({ color: 0xff8fa8, width: 6, alpha: 0.4 });
        }
        sting('blip');
        life = 0.24;
        break;
      case 'down':
        g.circle(0, 0, 40).fill({ color: NIGHT.blood, alpha: 0.4 });
        sting('down');
        this.camera?.shake(12, 0.3);
        life = 0.5;
        break;
      case 'hurt':
        // A glancing strike — splash, but they stay up.
        g.circle(0, 0, 30).stroke({ color: NIGHT.blood, width: 6, alpha: 0.8 });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.circle(Math.cos(a) * 22, Math.sin(a) * 22, 4).fill({ color: NIGHT.blood, alpha: 0.7 });
        }
        sting('blip');
        this.camera?.shake(6, 0.2);
        life = 0.35;
        break;
      case 'heal':
        // Medic beam: a green thread from the healer (tx/ty) to the healed.
        if (fx.tx !== undefined && fx.ty !== undefined) {
          g.moveTo(fx.tx - fx.x, fx.ty - fx.y)
            .lineTo(0, 0)
            .stroke({ color: NIGHT.gate, width: 4, alpha: 0.85 });
        }
        g.circle(0, 0, 34).stroke({ color: NIGHT.gate, width: 6, alpha: 0.85 });
        g.roundRect(-4, -14, 8, 28, 3)
          .fill(NIGHT.gate)
          .roundRect(-14, -4, 28, 8, 3)
          .fill(NIGHT.gate);
        sting('rescue');
        life = 0.7;
        break;
      case 'rescue':
        if (fx.tx !== undefined && fx.ty !== undefined) {
          g.moveTo(fx.tx - fx.x, fx.ty - fx.y)
            .lineTo(0, 0)
            .stroke({ color: NIGHT.gate, width: 4, alpha: 0.85 });
        }
        g.circle(0, 0, 44).stroke({ color: NIGHT.gate, width: 8, alpha: 0.9 });
        sting('rescue');
        life = 0.7;
        break;
      case 'lantern':
        g.circle(0, -26, 46).fill({ color: NIGHT.lantern, alpha: 0.35 });
        sting('lantern');
        life = 0.4;
        break;
      case 'gate':
        g.circle(0, 0, 80).stroke({ color: NIGHT.gate, width: 10, alpha: 0.9 });
        sting('gate');
        this.camera?.shake(10, 0.4);
        life = 0.6;
        break;
      case 'escape':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.circle(Math.cos(a) * 30, Math.sin(a) * 30, 6).fill(NIGHT.gate);
        }
        sting('escape');
        life = 0.5;
        break;
      case 'snare':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.moveTo(0, 0)
            .lineTo(Math.cos(a) * SNARE_RADIUS, Math.sin(a) * SNARE_RADIUS)
            .stroke({ color: NIGHT.violet, width: 3, alpha: 0.7 });
        }
        life = fx.id ? 0.4 : DECOY_SECONDS; // a laid trap lingers faintly
        break;
      case 'decoy':
        g.circle(0, 0, 30).fill({ color: NIGHT.violet, alpha: 0.3 });
        sting('blip');
        life = 0.4;
        break;
      case 'screech':
        g.circle(0, 0, 60).stroke({ color: NIGHT.blood, width: 8, alpha: 0.8 });
        sting('screech');
        this.camera?.shake(8, 0.3);
        life = 0.5;
        break;
      case 'poof':
        g.circle(0, 0, 30).fill({ color: NIGHT.ghost, alpha: 0.4 });
        life = 0.4;
        break;
      case 'blind':
        // Dazzle burst — pink starburst; the TARGETED Seeker's screen whites
        // out (their client owns the overlay).
        if (fx.id === this.session.id) {
          this.blindLeft = BLIND_SECONDS;
          this.blindsTaken += 1;
          this.camera?.shake(10, 0.3);
        }
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          g.moveTo(Math.cos(a) * 12, Math.sin(a) * 12)
            .lineTo(Math.cos(a) * (i % 2 ? 40 : 64), Math.sin(a) * (i % 2 ? 40 : 64))
            .stroke({ color: 0xffb6d5, width: 5, alpha: 0.9 });
        }
        g.circle(0, 0, 16).fill(0xfff2f8);
        sting('screech');
        life = 0.6;
        break;
      case 'nest':
        // A den pops up — soft violet shimmer ring.
        g.circle(0, 0, 48).stroke({ color: 0xd9b8ff, width: 6, alpha: 0.9 });
        g.circle(0, 0, 26).stroke({ color: 0xd9b8ff, width: 3, alpha: 0.5 });
        sting('lantern');
        life = 0.5;
        break;
      case 'wall':
        // Stone bursts from the floor.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.circle(Math.cos(a) * WALL_RADIUS * 0.8, Math.sin(a) * WALL_RADIUS * 0.8, 7).fill(
            0x8a8272,
          );
        }
        g.circle(0, 0, WALL_RADIUS).stroke({ color: 0x8a8272, width: 6, alpha: 0.8 });
        sting('down');
        this.camera?.shake(6, 0.2);
        life = 0.5;
        break;
      case 'blast': {
        // Atomic shockwave — and the HURLED seeker warps via tx/ty.
        if (fx.id === this.session.id && fx.tx !== undefined && fx.ty !== undefined) {
          this.me.position.set(fx.tx, fx.ty);
          this.hideTarget = null;
        }
        g.circle(0, 0, 120).stroke({ color: 0x8fe07a, width: 14, alpha: 0.9 });
        g.circle(0, 0, 70).stroke({ color: 0xd6ffc8, width: 8, alpha: 0.7 });
        g.circle(0, 0, 30).fill({ color: 0x8fe07a, alpha: 0.5 });
        sting('gate');
        this.camera?.shake(16, 0.45);
        life = 0.7;
        break;
      }
      case 'dummy':
        // A double shimmers into place.
        g.circle(0, 0, 46).stroke({ color: 0x9a86c8, width: 6, alpha: 0.9 });
        g.circle(0, 0, 24).stroke({ color: 0x9a86c8, width: 3, alpha: 0.5 });
        sting('blip');
        life = 0.5;
        break;
      case 'dummyping':
        // Only the Twin hears the whisper.
        if (fx.id === this.session.id) {
          this.roleHud.text = '🪞 something stirs near your dummy…';
          this.roleHud.style.fill = NIGHT.violet;
          sting('blip');
          g.circle(0, 0, 40).stroke({ color: 0x9a86c8, width: 4, alpha: 0.8 });
          life = 0.8;
        } else {
          life = 0.01; // nothing to see for anyone else
        }
        break;
      case 'convert':
        // The Wraith's curse takes someone — dark tendrils close around them.
        if (fx.id === this.session.id && !this.amSeeker) {
          // The dark claimed ME: flip to the seeker side mid-hunt.
          this.amSeeker = true;
          this.roleHudBase = '🌫️ The dark claimed you — HUNT the survivors';
          this.roleHud.text = this.roleHudBase;
          this.roleHud.style.fill = NIGHT.blood;
          this.hideTarget = null;
          if (this.sprintBtn) this.sprintBtn.visible = false;
          if (this.specialBtn) this.specialBtn.visible = false;
          if (this.abilityBtn) this.abilityBtn.visible = false;
          if (!this.attackBtn) {
            this.attackBtn = new UIButton('🩸', {
              width: 120,
              height: 120,
              fontSize: 52,
              fill: NIGHT.blood,
              textColor: 0xffffff,
              onTap: () => this.tryAttack(),
            });
            this.add(this.attackBtn, this.uiLayer);
            this.layoutUi(this.game.viewWidth, this.game.viewHeight);
          }
          this.addClickAttack(); // converted seekers click-attack on PC too
        }
        g.circle(0, 0, 46).fill({ color: 0x1a1030, alpha: 0.7 });
        g.circle(0, 0, 46).stroke({ color: 0xb7ff5e, width: 5, alpha: 0.9 });
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          g.moveTo(Math.cos(a) * 18, Math.sin(a) * 18)
            .lineTo(Math.cos(a + 0.5) * 58, Math.sin(a + 0.5) * 58)
            .stroke({ color: 0x2a1a44, width: 4, alpha: 0.9 });
        }
        sting('lose');
        this.camera?.shake(10, 0.35);
        life = 0.9;
        break;
      case 'web': {
        // Web Bolt: strand from the Weaver to the webbed hider.
        if (fx.tx !== undefined && fx.ty !== undefined) {
          g.moveTo(fx.tx - fx.x, fx.ty - fx.y)
            .lineTo(0, 0)
            .stroke({ color: 0xd8d4e8, width: 4, alpha: 0.8 });
        }
        for (const rr of [12, 22, 32])
          g.circle(0, 0, rr).stroke({ color: 0xd8d4e8, width: 2.5, alpha: 0.8 });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.moveTo(0, 0)
            .lineTo(Math.cos(a) * 32, Math.sin(a) * 32)
            .stroke({ color: 0xd8d4e8, width: 2, alpha: 0.7 });
        }
        sting('blip');
        life = 0.7;
        break;
      }
      case 'dragged': {
        // The dark claims a last-life body… and drops it somewhere far away.
        if (fx.id === this.session.id && fx.tx !== undefined && fx.ty !== undefined) {
          this.me.position.set(fx.tx, fx.ty);
          this.hideTarget = null;
        }
        g.circle(0, 0, 44).fill({ color: 0x000000, alpha: 0.6 });
        g.circle(0, 0, 44).stroke({ color: NIGHT.violet, width: 6, alpha: 0.9 });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.moveTo(Math.cos(a) * 20, Math.sin(a) * 20)
            .lineTo(Math.cos(a + 0.4) * 52, Math.sin(a + 0.4) * 52)
            .stroke({ color: 0x1a1030, width: 4, alpha: 0.8 });
        }
        sting('lose');
        this.camera?.shake(12, 0.35);
        life = 0.8;
        break;
      }
      case 'hatch':
        g.circle(0, 0, 80).stroke({ color: NIGHT.gate, width: 10, alpha: 0.9 });
        g.circle(0, 0, 46).stroke({ color: NIGHT.gate, width: 5, alpha: 0.6 });
        sting('gate');
        this.camera?.shake(8, 0.35);
        life = 0.7;
        break;
      case 'teleport': {
        // Violet rings at BOTH ends of the ride; the ridden player warps
        // themselves (positions are client-authoritative for humans).
        if (fx.id === this.session.id && fx.tx !== undefined && fx.ty !== undefined) {
          this.me.position.set(fx.tx, fx.ty);
          this.hideTarget = null;
        }
        g.circle(0, 0, 40).stroke({ color: NIGHT.violet, width: 6, alpha: 0.9 });
        g.circle(0, 0, 20).stroke({ color: NIGHT.violet, width: 3, alpha: 0.6 });
        if (fx.tx !== undefined && fx.ty !== undefined) {
          const dxr = fx.tx - fx.x;
          const dyr = fx.ty - fx.y;
          g.circle(dxr, dyr, 40).stroke({ color: NIGHT.violet, width: 6, alpha: 0.9 });
          g.circle(dxr, dyr, 20).stroke({ color: NIGHT.violet, width: 3, alpha: 0.6 });
        }
        sting('lantern');
        life = 0.6;
        break;
      }
      case 'tpad':
        // Pocket Portal assembles: brass sparks and a spinning rune flash.
        g.circle(0, 0, 48).stroke({ color: 0xffc75f, width: 6, alpha: 0.9 });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.moveTo(Math.cos(a) * 20, Math.sin(a) * 20)
            .lineTo(Math.cos(a) * 58, Math.sin(a) * 58)
            .stroke({ color: 0xffe6a8, width: 4, alpha: 0.8 });
        }
        sting('gate');
        life = 0.7;
        break;
      case 'lull': {
        // The Siren's slowing song — soft rings ripple out to earshot.
        for (let i = 0; i < 3; i++) {
          g.circle(0, 0, 60 + i * 90).stroke({
            color: 0xffb3c6,
            width: 5 - i,
            alpha: 0.7 - i * 0.18,
          });
        }
        g.circle(0, 0, 26).fill({ color: 0xffb3c6, alpha: 0.35 });
        sting('rescue');
        life = 0.9;
        break;
      }
      case 'warn': {
        // Targeted: hand THAT player the tracking arrow (Sixth Sense for
        // scouts, Scent for stalkers). Broadcast: every survivor gets it
        // (Town Crier) — seekers ignore those.
        if (fx.id) {
          if (fx.id !== this.session.id) break;
        } else if (this.amSeeker) break;
        const secs = fx.id ? (this.amSeeker ? SCENT_SECS : SCOUT_WARN_SECS) : TOWN_CRIER_SECS;
        this.senseUntil = Math.max(this.senseUntil, this.t + secs);
        sting('blip');
        life = 0.1;
        break;
      }
      case 'bust':
        // The hiding spot shatters — splinters fly.
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 + 0.3;
          const r1 = 16 + (i % 3) * 14;
          g.moveTo(Math.cos(a) * 10, Math.sin(a) * 10)
            .lineTo(Math.cos(a) * (r1 + 30), Math.sin(a) * (r1 + 30))
            .stroke({ color: NIGHT.wood, width: 5, alpha: 0.9 });
        }
        g.circle(0, 0, 34).fill({ color: NIGHT.woodDark, alpha: 0.5 });
        sting('down');
        this.camera?.shake(10, 0.25);
        life = 0.5;
        break;
      case 'freeze':
        // Ice snap — crystalline ring around the frozen Seeker.
        g.circle(0, 0, 52).stroke({ color: NIGHT.ghost, width: 8, alpha: 0.9 });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.poly([
            Math.cos(a) * 40,
            Math.sin(a) * 40,
            Math.cos(a + 0.18) * 62,
            Math.sin(a + 0.18) * 62,
            Math.cos(a - 0.18) * 62,
            Math.sin(a - 0.18) * 62,
          ]).fill({ color: NIGHT.ghost, alpha: 0.7 });
        }
        sting('lantern');
        life = FREEZE_SECONDS;
        break;
      case 'release':
        // "…ready or not, HERE I COME." The hunt begins.
        g.circle(0, 0, 90).stroke({ color: NIGHT.blood, width: 10, alpha: 0.9 });
        g.circle(0, 0, 50).stroke({ color: NIGHT.blood, width: 6, alpha: 0.6 });
        sting('screech');
        this.camera?.shake(10, 0.4);
        life = 0.8;
        break;
      case 'dead':
        // Final down — a skull-dark burst; they're out of the hunt for good.
        g.circle(0, 0, 44).fill({ color: 0x000000, alpha: 0.6 });
        g.circle(0, 0, 44).stroke({ color: NIGHT.blood, width: 6, alpha: 0.9 });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.circle(Math.cos(a) * 34, Math.sin(a) * 34, 5).fill({ color: NIGHT.blood, alpha: 0.8 });
        }
        sting('lose');
        this.camera?.shake(14, 0.35);
        life = 0.7;
        break;
    }
    e.addBehavior(new Tween(e, { alpha: 0 }, life, { ease: easings.outQuad }));
    e.addBehavior(new Timer(life, () => this.remove(e)));
    this.add(e, this.mapLayer);
  }

  // ---------------------------------------------------------- abilities

  private tryAttack(): void {
    if (!this.amSeeker || this.attackCd > 0 || this.phase !== 'playing') return;
    this.attackCd = 0.9;
    sting('blip');
    if (this.session.isHost) this.hostAttack(this.session.id);
    else this.session.send({ type: 'attack' });
  }

  /** Tap a hiding spot to duck inside. Auto-walks there if it's within reach;
   *  moving the joystick cancels it. */
  private tapHide(at: { x: number; y: number }): void {
    if (this.amSeeker || this.phase !== 'playing') return;
    if (this.snapDown[this.session.id] !== undefined || this.out.has(this.session.id)) return;
    if (Math.hypot(at.x - this.me.x, at.y - this.me.y) > 560) return; // too far to bother
    this.hideTarget = { x: at.x, y: at.y };
    sting('blip');
  }

  /** Universal hider sprint: a short burst, own cooldown, no class needed. */
  private trySprint(): void {
    if (this.amSeeker || this.sprintCdLeft > 0) return;
    if (this.snapDown[this.session.id] !== undefined || this.out.has(this.session.id)) return;
    if (this.phase !== 'playing' && this.phase !== 'hiding') return;
    this.sprintUntil = this.t + SPRINT_SECS;
    this.sprintCdLeft = SPRINT_CD;
    sting('blip');
    // Afterimage: the burst leaves a frozen clone where you started.
    if (this.ownsUp(this.session.id, 'sprinter3')) {
      if (this.session.isHost)
        this.hostAbility(this.session.id, 'afterimage', this.me.x, this.me.y);
      else this.session.send({ type: 'ability', id: 'afterimage', x: this.me.x, y: this.me.y });
    }
  }

  private trySpecial(): void {
    // Same guards as the main ability, on an independent cooldown.
    const sp = this.specialDef;
    if (!sp) return;
    const okPhase = this.phase === 'playing' || (this.phase === 'hiding' && !this.amSeeker);
    if (this.specialCdLeft > 0 || !okPhase) return;
    if (this.snapDown[this.session.id] !== undefined || this.out.has(this.session.id)) return;
    // Switcheroo needs a doll out — don't burn the cooldown on empty air.
    if (sp.abilityId === 'swap' && this.decoyViews.length === 0) {
      sting('lose');
      return;
    }
    this.specialCdLeft = sp.cd * this.statsOf(this.session.id).cdMul;
    sting('blip');
    if (this.session.isHost) this.hostAbility(this.session.id, sp.abilityId, this.me.x, this.me.y);
    else this.session.send({ type: 'ability', id: sp.abilityId, x: this.me.x, y: this.me.y });
  }

  private tryAbility(): void {
    // Hiders may burn abilities while scattering; the counting Seeker may not.
    const okPhase = this.phase === 'playing' || (this.phase === 'hiding' && !this.amSeeker);
    if (this.cooldownLeft > 0 || !okPhase) return;
    const cls = classById(this.roster.classes[this.session.id]);
    const iAmDown = this.snapDown[this.session.id] !== undefined;
    if (iAmDown) return;
    this.cooldownLeft = cls.ability.cooldown * this.statsOf(this.session.id).cdMul;
    this.abilityUses += 1;
    sting('blip');
    const id = cls.ability.id;
    if (id === 'lunge') {
      this.boostUntil = this.t + 0.5;
      this.boostFactor = 2.6;
      return;
    }
    if (id === 'flashlight' || id === 'thirdeye') {
      // Client-local: widen your own vision for a while.
      this.visionBoostUntil = this.t + VISION_BOOST_SECS * this.statsOf(this.session.id).powMul;
      sting('lantern');
      // The Warden's eye does more than squint: it PIERCES — the host also
      // reveals every hider's position (fall through to the host dispatch).
      if (id === 'flashlight') return;
    }
    // Lookout: the reveal pulses come from the host, but the tracking arrow
    // is client-local — it follows the Seeker live for a while.
    if (id === 'sense')
      this.senseUntil = this.t + SENSE_ARROW_SECS * this.statsOf(this.session.id).powMul;
    if (this.session.isHost) this.hostAbility(this.session.id, id, this.me.x, this.me.y);
    else this.session.send({ type: 'ability', id, x: this.me.x, y: this.me.y });
  }

  // ---------------------------------------------------------------- end

  private endRoot: Container | null = null;
  private showEnd(result: string, stats?: Record<string, Deeds>): void {
    if (this.endShown) return;
    this.endShown = true;
    this.phase = result;
    clearLastRoom();
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const hidersWin = result === 'hiders-win';
    const iWon = this.amSeeker ? !hidersWin : hidersWin && this.escaped.has(this.session.id);
    // Verium payout: a base for the result plus a cut for every DEED —
    // lanterns lit, rescues made, strikes landed. Doing things pays.
    const my = stats?.[this.session.id];
    let reward: number;
    if (this.amSeeker) {
      reward = (hidersWin ? 25 : 70) + (my ? Math.min(60, my.down * 12) : hidersWin ? 5 : 10);
    } else if (this.escaped.has(this.session.id)) {
      reward = 40 + (my ? my.lit * 8 + my.res * 10 : 20);
    } else {
      reward = (this.out.has(this.session.id) ? 8 : 15) + (my ? my.lit * 8 + my.res * 10 : 0);
    }
    verium.add(reward);
    // Class XP: playing levels the class (levels gate its passives).
    const xpGain = 50 + (iWon ? 50 : 0);
    addClassXp(classById(this.roster.classes[this.session.id]).id, xpGain);
    sting(iWon ? 'escape' : 'lose');

    this.endRoot = new Container();
    const bg = new Graphics().rect(0, 0, W, H).fill({ color: 0x0a0812, alpha: 0.92 });
    bg.eventMode = 'static';
    this.endRoot.addChild(bg);
    const title = makeText(
      this.amSeeker
        ? hidersWin
          ? 'THEY ESCAPED'
          : 'HUNT SUCCESSFUL'
        : hidersWin
          ? 'YOU SURVIVED'
          : 'THE DARK WINS',
      56,
      { color: iWon ? NIGHT.gate : NIGHT.blood },
    );
    title.position.set(W / 2, H * 0.16);
    this.endRoot.addChild(title);

    // Announce the winners by name.
    const escNames = [...this.escaped]
      .filter((id) => this.roster.roles[id] !== 'seeker')
      .map((id) => this.roster.names[id] ?? '?');
    const seekerName = this.roster.names[this.seekerId] ?? 'The Seeker';
    const winnersLine = hidersWin
      ? escNames.length
        ? `🏆 Escaped: ${escNames.join(', ')}`
        : '🏆 The hiders got away'
      : `🏆 ${seekerName} wins — nobody escaped`;
    const winners = makeText(winnersLine, 28, {
      color: hidersWin ? NIGHT.gate : NIGHT.blood,
      weight: '800',
      wrapWidth: 680,
    });
    winners.position.set(W / 2, H * 0.26);
    this.endRoot.addChild(winners);

    // Deed scoreboard: what everyone actually DID this hunt.
    let rowY = H * 0.34;
    if (stats) {
      for (const id of this.roster.order.slice(0, 8)) {
        const d = stats[id] ?? { lit: 0, res: 0, down: 0 };
        const isSeeker = this.roster.roles[id] === 'seeker';
        const fate = isSeeker
          ? ''
          : this.escaped.has(id)
            ? ' · ✓ escaped'
            : this.out.has(id)
              ? ' · ✗ lost'
              : '';
        const line = isSeeker
          ? `🩸 ${this.roster.names[id] ?? '?'} — ${d.down} strikes`
          : `${this.roster.names[id] ?? '?'} — 🕯️${d.lit} 💚${d.res}${fate}`;
        const row = makeText(line, 21, {
          color: id === this.session.id ? NIGHT.lantern : NIGHT.ink,
          weight: 'bold',
        });
        row.position.set(W / 2, rowY);
        this.endRoot.addChild(row);
        rowY += 30;
      }
    }

    const lv = LEVELS[this.level] ?? LEVELS[0]!;
    const sub = makeText(
      `${lv.name} — ${this.escaped.size} escaped · ${this.out.size} lost   +${reward} ⬡ · +${xpGain} XP`,
      24,
      { color: NIGHT.ink, weight: 'bold', wrapWidth: 660 },
    );
    sub.position.set(W / 2, rowY + 26);
    this.endRoot.addChild(sub);

    if (this.session.isHost) {
      const btn = new UIButton('BACK TO LOBBY', {
        width: 380,
        height: 76,
        fontSize: 28,
        fill: NIGHT.gate,
        textColor: 0x0c1a12,
        onTap: () => {
          this.session.broadcast({ type: 'toLobby' });
          this.returnToLobby();
        },
      });
      btn.position.set(W / 2, Math.min(H - 60, rowY + 96));
      this.add(btn, this.uiLayer);
      this.endRoot.addChild(btn);
    } else {
      const wait = makeText('waiting for the host…', 24, { color: NIGHT.inkSoft, weight: 'bold' });
      wait.position.set(W / 2, Math.min(H - 60, rowY + 96));
      this.endRoot.addChild(wait);
    }
    this.uiLayer.addChild(this.endRoot);
  }

  private returnToLobby(): void {
    if (!this.live) return;
    this.live = false;
    // A fresh lobby on the same session — roles/ready reset, cosmetics kept.
    void import('./LobbyScene.js').then(({ LobbyScene }) => {
      this.game.scenes.replace(new LobbyScene(this.session));
    });
  }

  private goHome(): void {
    if (this.game.scenes.isTransitioning) return;
    this.live = false;
    clearLastRoom();
    sting('blip');
    this.session.leave();
    window.history.replaceState(null, '', window.location.pathname);
    this.game.scenes.replace(new MenuScene());
  }

  /** Flood-fill from the hider spawn: are the gate, Seeker spawn and every
   *  lantern actually reachable? Guards against a bad building generation. */
  private reachabilityOk(): boolean {
    const tw = this.map.width;
    const th = this.map.height;
    const tile = (x: number, y: number): [number, number] => [
      Math.floor(x / TILE_SIZE),
      Math.floor(y / TILE_SIZE),
    ];
    const [sc, sr] = tile(this.spawn.x, this.spawn.y);
    const seen = new Set<number>([sr * tw + sc]);
    const stack: [number, number][] = [[sc, sr]];
    while (stack.length) {
      const [c, r] = stack.pop()!;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= tw || nr >= th) continue;
        if (solidAt(this.map, nc, nr)) continue;
        const k = nr * tw + nc;
        if (seen.has(k)) continue;
        seen.add(k);
        stack.push([nc, nr]);
      }
    }
    const reach = (x: number, y: number): boolean => {
      const [c, r] = tile(x, y);
      return seen.has(r * tw + c);
    };
    return (
      reach(this.gatePt.x, this.gatePt.y) &&
      reach(this.seekerSpawn.x, this.seekerSpawn.y) &&
      this.lanternPts.every((p) => reach(p.x, p.y)) &&
      this.teleportPts.every((p) => reach(p.x, p.y))
    );
  }

  // --------------------------------------------------------------- debug

  private installDebug(): void {
    window.__hushfall = {
      scene: () => 'match',
      code: () => this.session.code,
      playerCount: () => this.roster.order.length,
      phase: () => this.phase,
      myRole: () => (this.amSeeker ? 'seeker' : 'hider'),
      seekerId: () => this.seekerId,
      myPos: () => ({ x: this.me.x, y: this.me.y }),
      warp: (x: number, y: number) => {
        this.me.position.set(x, y);
        this.hideTarget = null; // a teleport cancels any pending auto-walk
      },
      litCount: () => this.snapLant.filter((v) => v >= 1).length,
      lanternCount: () => this.snapLant.length,
      gateOpen: () => this.snapGate,
      attack: () => this.tryAttack(),
      ability: () => this.tryAbility(),
      downedCount: () => Object.keys(this.snapDown).length,
      escapedCount: () => this.escaped.size,
      aliveCount: () => this.activeHiders().length,
      amDowned: () => this.snapDown[this.session.id] !== undefined,
      amHurt: () => this.snapHurt.has(this.session.id),
      hurtCount: () => this.snapHurt.size,
      tapHide: (i: number) => {
        const p = this.hidePts[i];
        if (p) this.tapHide(p);
      },
      hideTargetSet: () => this.hideTarget !== null,
      downSignalCount: () => this.downArrows.size,
      amConcealed: () => this.amConcealedLocal(),
      seekerPos: () => {
        const p = this.hostPositions[this.seekerId] ?? this.remotes.get(this.seekerId)?.entity;
        return p ? { x: p.x, y: p.y } : null;
      },
      lanternPos: (i: number) => this.lanternPts[i] ?? null,
      gatePos: () => ({ ...this.gatePt }),
      spawnPos: () => (this.amSeeker ? { ...this.seekerSpawn } : { ...this.spawn }),
      forceLightAll: () => {
        if (!this.session.isHost) return;
        this.lant = this.lanternPts.map(() => 1);
        this.gateOpen = true;
      },
      forceDownAll: () => {
        if (!this.session.isHost) return;
        for (const id of this.activeHiders()) {
          this.hurt.delete(id);
          this.down[id] = BLEED_SECONDS;
          this.reviveProg[id] = 0;
        }
      },
      levelIndex: () => this.level,
      levelName: () => LEVELS[this.level]?.name ?? '',
      levelCount: () => LEVELS.length,
      amRooted: () =>
        this.snapRooted.has(this.session.id) || (this.rootUntil[this.session.id] ?? 0) > this.t,
      lanternsNeeded: () => this.needed,
      dawnLeft: () => this.snapDawn,
      forceDawn: () => {
        if (this.session.isHost) this.dawnAt = this.t + 0.5;
      },
      myLives: () => Math.max(0, LIVES - (this.snapDowns[this.session.id] ?? 0)),
      livesOf: (id: string) => Math.max(0, LIVES - (this.snapDowns[id] ?? 0)),
      bustedCount: () => this.snapBusted.size,
      outCount: () => this.out.size,
      backToLobby: () => {
        if (!this.session.isHost) return;
        this.session.broadcast({ type: 'toLobby' });
        this.returnToLobby();
      },
      revealSeen: () => this.revealSeen,
      abilityUses: () => this.abilityUses,
      hideLeft: () => this.snapHideLeft,
      skipHide: () => {
        if (this.session.isHost) this.hideLeft = 0.01;
      },
      stats: () => ({ ...this.deeds }),
      losSelfTest: () => {
        // Find a solid tile flanked by open tiles: sight across it must be
        // blocked, sight between two open neighbours must be clear.
        for (let r = 1; r < this.map.height - 1; r++) {
          for (let c = 2; c < this.map.width - 2; c++) {
            if (
              !solidAt(this.map, c, r) ||
              solidAt(this.map, c - 1, r) ||
              solidAt(this.map, c + 1, r)
            )
              continue;
            const y = r * TILE_SIZE + TILE_SIZE / 2;
            const ax = (c - 1) * TILE_SIZE + TILE_SIZE / 2;
            const bx = (c + 1) * TILE_SIZE + TILE_SIZE / 2;
            return this.losBlocked(ax, y, bx, y) && !this.losBlocked(ax, y, ax + 4, y);
          }
        }
        return false;
      },
      botCount: () => this.roster.order.filter((id) => id.startsWith('bot')).length,
      botPos: () => {
        const id = this.roster.order.find((x) => x.startsWith('bot'));
        const p = id ? this.hostPositions[id] : null;
        return p ? { x: p.x, y: p.y } : null;
      },
      botPositions: () =>
        this.roster.order
          .filter((x) => x.startsWith('bot'))
          .map((id) => {
            const p = this.hostPositions[id];
            return p ? { x: p.x, y: p.y } : null;
          })
          .filter((p): p is { x: number; y: number } => !!p),
      botGoals: () =>
        this.roster.order
          .filter((x) => x.startsWith('bot'))
          .map((id) => this.botPaths.get(id)?.goal ?? ''),
      hidePos: (i: number) => this.hidePts[i] ?? null,
      hideCount: () => this.hidePts.length,
      hiddenIds: () => this.activeHiders().filter((id) => this.isConcealed(id)),
      tpCount: () => this.teleportPts.length,
      tpPos: (i: number) => this.teleportPts[i] ?? null,
      tpCd: () => (this.session.isHost ? Math.max(0, this.tpReadyAt - this.t) : this.snapTpCd),
      hatchOpen: () => this.snapHatch,
      hatchPos: () => ({ ...this.hatchPt }),
      slowedCount: () => this.snapSlowed.size,
      amSlowed: () => this.snapSlowed.has(this.session.id),
      rootedCount: () => this.snapRooted.size,
      trapCount: () => this.traps.length,
      nestCount: () => this.snapNests.length,
      nestPos: (i: number) => this.snapNests[i] ?? null,
      tpadCount: () => this.snapTpads.length,
      tpadPos: (i: number) => this.snapTpads[i] ?? null,
      rubbleCount: () => this.snapRubble.length,
      decoyCount: () => this.decoyViews.length,
      arrowOn: () => this.t < this.senseUntil,
      special: () => this.trySpecial(),
      hasSpecialBtn: () => !!this.specialBtn,
      blindsTaken: () => this.blindsTaken,
      amBlinded: () => this.blindLeft > 0,
      seekerCount: () => this.seekerIds().length,
      convertedCount: () => this.snapConv.length,
      amCloaked: () => this.snapVanished.has(this.session.id),
      trailLeft: () => this.snapTrail,
      cloneCount: () => this.snapClones.length,
      dummyCount: () => this.snapDums.length,
      wallCount: () => this.snapWalls.length,
      sprint: () => this.trySprint(),
      sprinting: () => this.t < this.sprintUntil,
      amSeeker: () => this.amSeeker,
      forceDownsTaken: (n: number) => {
        if (!this.session.isHost) return;
        for (const id of this.activeHiders()) this.downsTaken[id] = n;
      },
      visionActive: () => this.t < this.visionBoostUntil,
      reachOk: () => this.reachabilityOk(),
    };
  }
}
