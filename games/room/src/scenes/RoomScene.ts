import { Container, Text } from 'pixi.js';
import {
  Camera,
  DialogueRunner,
  Entity,
  Scene,
  VirtualJoystick,
  Wobble,
  audio,
  blobCharacter,
  buildTileMapView,
  cozyAutumn,
  makeTappable,
  moveWithCollision,
  tileMapFromRows,
} from '@interverse/engine';
import type { DialogueData, TileMapData } from '@interverse/engine';
import { DialogueBox } from '@interverse/ui';
import { TILE_SIZE, roomLegend, roomPainters, roomRows } from '../map.js';
import fernDialogue from '../dialogue/fern.json';

const PLAYER_SPEED = 260;
const TALK_DISTANCE = 150;

interface RoomDebug {
  player: () => { x: number; y: number };
  npc: () => { x: number; y: number };
  npcScreen: () => { x: number; y: number };
  joystickScreen: () => { x: number; y: number };
  boxScreen: () => { x: number; y: number };
  choiceScreen: (i: number) => { x: number; y: number } | null;
  dialogueOpen: () => boolean;
  nodeId: () => string | null;
  teleport: (x: number, y: number) => void;
}

declare global {
  interface Window {
    __room?: RoomDebug;
  }
}

export class RoomScene extends Scene {
  private map!: TileMapData;
  private mapLayer!: Container;
  private camera!: Camera;
  private player!: Entity;
  private playerBody!: Container;
  private npc!: Entity;
  private bang!: Text;
  private joystick!: VirtualJoystick;
  private box!: DialogueBox;
  private runner: DialogueRunner | null = null;
  private met = false;
  private shook = false;
  private walkPhase = 0;

  protected override onEnter(): void {
    const W = this.game.designWidth;
    const H = this.game.designHeight;

    this.map = tileMapFromRows(roomRows, TILE_SIZE, roomLegend);

    // World (camera-transformed) under a fixed UI layer.
    this.mapLayer = new Container();
    const uiLayer = new Container();
    this.stage.addChild(this.mapLayer, uiLayer);

    this.mapLayer.addChild(buildTileMapView(this.map, roomPainters));

    const spawn = this.map.objects.find((o) => o.name === 'player');
    const fernSpawn = this.map.objects.find((o) => o.name === 'fern');

    // NPC — Fern.
    this.npc = new Entity();
    const fernChar = blobCharacter({ radius: 36, color: 0x81b29a, seed: 21 });
    this.npc.addChild(fernChar.view);
    this.npc.position.set(fernSpawn?.x ?? 480, fernSpawn?.y ?? 544);
    this.npc.addBehavior(new Wobble({ target: fernChar.body, amount: 0.04, speed: 2 }));
    this.bang = new Text({
      text: '!',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 44,
        fontWeight: '900',
        fill: cozyAutumn.accent,
      },
    });
    this.bang.anchor.set(0.5);
    this.bang.position.set(0, -70);
    this.bang.visible = false;
    this.npc.addChild(this.bang);
    makeTappable(this.npc, () => this.tryTalk(), { hitRadius: 80 });
    this.add(this.npc, this.mapLayer);

    // Player.
    this.player = new Entity();
    const playerChar = blobCharacter({
      radius: 30,
      color: cozyAutumn.colors[0] ?? 0xe07a5f,
      seed: 5,
    });
    this.playerBody = playerChar.body;
    this.player.addChild(playerChar.view);
    this.player.position.set(spawn?.x ?? 544, spawn?.y ?? 992);
    this.add(this.player, this.mapLayer);

    // Camera follows the player inside the room bounds.
    this.camera = new Camera(this.mapLayer, W, H, { deadzoneWidth: 140, deadzoneHeight: 180 });
    this.camera.setBounds(0, 0, this.map.width * TILE_SIZE, this.map.height * TILE_SIZE);
    this.camera.follow(this.player);

    // UI: joystick bottom-left, dialogue box at the bottom.
    this.joystick = new VirtualJoystick({ radius: 100 });
    this.joystick.position.set(170, H - 190);
    this.add(this.joystick, uiLayer);

    this.box = new DialogueBox({ palette: cozyAutumn });
    this.box.position.set((W - 656) / 2, H - 300 - 36);
    this.box.onClosed = () => {
      this.runner = null;
      this.joystick.visible = true;
    };
    this.add(this.box, uiLayer);

    const hint = new Text({
      text: 'walk up to Fern and tap her to chat',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 26,
        fontWeight: 'bold',
        fill: cozyAutumn.inkSoft,
        align: 'center',
      },
    });
    hint.anchor.set(0.5);
    hint.position.set(W / 2, 60);
    uiLayer.addChild(hint);

    window.__room = {
      player: () => ({ x: this.player.x, y: this.player.y }),
      npc: () => ({ x: this.npc.x, y: this.npc.y }),
      npcScreen: () => {
        const p = this.npc.getGlobalPosition();
        return { x: p.x, y: p.y };
      },
      joystickScreen: () => {
        const p = this.joystick.getGlobalPosition();
        return { x: p.x, y: p.y };
      },
      boxScreen: () => {
        const p = this.box.getGlobalPosition();
        return { x: p.x + 656 / 2, y: p.y + 80 };
      },
      choiceScreen: (i) => this.box.choiceScreenPos(i),
      dialogueOpen: () => this.box.isOpen,
      nodeId: () => this.runner?.currentId ?? null,
      teleport: (x, y) => this.player.position.set(x, y),
    };
  }

  protected override onExit(): void {
    delete window.__room;
  }

  protected override onUpdate(dt: number): void {
    // Movement (frozen during dialogue).
    if (!this.box.isOpen) {
      const jx = this.joystick.value.x;
      const jy = this.joystick.value.y;
      const moving = Math.hypot(jx, jy) > 0.12;
      if (moving) {
        const moved = moveWithCollision(
          this.map,
          this.player.x,
          this.player.y,
          22,
          16,
          jx * PLAYER_SPEED * dt,
          jy * PLAYER_SPEED * dt,
        );
        this.player.position.set(moved.x, moved.y);
        // Walk bob — cozy games live and die on juice.
        this.walkPhase += dt * 11;
        const s = Math.sin(this.walkPhase) * 0.07;
        this.playerBody.scale.set(1 + s, 1 - s);
      } else {
        this.playerBody.scale.set(1, 1);
      }
    }

    // "!" prompt when close enough to talk.
    const near = this.distToNpc() < TALK_DISTANCE;
    this.bang.visible = near && !this.box.isOpen;
    if (this.bang.visible) this.bang.y = -70 + Math.sin(this.walkPhase * 0.5) * 4;

    // Fern gets flustered if you call the place dusty.
    if (this.runner?.currentId === 'dusty' && !this.shook) {
      this.shook = true;
      this.camera.shake(10, 0.35);
    }

    this.camera.update(dt);
  }

  private distToNpc(): number {
    return Math.hypot(this.player.x - this.npc.x, this.player.y - this.npc.y);
  }

  private tryTalk(): void {
    if (this.box.isOpen || this.distToNpc() > TALK_DISTANCE) return;
    audio.blip();
    this.joystick.visible = false;
    this.runner = new DialogueRunner(fernDialogue as DialogueData);
    this.runner.start(this.met ? 'again' : 'intro');
    this.met = true;
    this.shook = false;
    this.box.open(this.runner);
  }
}
