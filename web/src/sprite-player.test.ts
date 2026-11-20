import { describe, expect, it } from 'vitest';
// @ts-ignore -- plain browser ES module shipped next to exported atlases
import { createController } from '../../examples/javascript/sprite-player.js';

type Call = { clip: string; angle: number; elapsedMs: number };

function clip(frames: number, loop: boolean, ms = 100) {
  return {
    fps: 1000 / ms, frame_duration_ms: ms, loop,
    directions: [0, 45, 315].map(angle => ({ angle, frames: Array.from({ length: frames }, (_, index) => ({ index })) })),
  };
}

function fakeSprite(withPoints = true) {
  const animations: Record<string, unknown> = { idle: clip(4, true), wave: clip(3, false), think: clip(4, true) };
  if (withPoints) {
    for (const side of ['left', 'right']) for (const h of ['up', 'level', 'down']) animations[`point_${side}_${h}`] = clip(2, false);
  }
  const calls: Call[] = [];
  return {
    calls,
    sprite: { animations, draw: (_ctx: unknown, o: Call) => { calls.push({ clip: o.clip, angle: o.angle, elapsedMs: o.elapsedMs }); return 0; } },
  };
}

function at(q: any, calls: Call[], now: number): Call {
  q.draw({}, { x: 0, y: 0, now });
  return calls[calls.length - 1];
}

describe('createController', () => {
  it('starts on idle and loops it', () => {
    const { sprite, calls } = fakeSprite();
    const q = createController(sprite);
    expect(at(q, calls, 1000)).toEqual({ clip: 'idle', angle: 0, elapsedMs: 0 });
    expect(at(q, calls, 1900).elapsedMs).toBe(900);
  });

  it('play() runs a one-shot then returns to idle', () => {
    const { sprite, calls } = fakeSprite();
    const q = createController(sprite);
    q.play('wave');
    expect(at(q, calls, 0).clip).toBe('wave');
    expect(at(q, calls, 250)).toMatchObject({ clip: 'wave', elapsedMs: 250 });
    expect(at(q, calls, 300)).toMatchObject({ clip: 'idle', elapsedMs: 0 });
    expect(q.clip).toBe('idle');
  });

  it('play() with then switches to that clip', () => {
    const { sprite, calls } = fakeSprite();
    const q = createController(sprite);
    q.play('wave', { then: 'think' });
    at(q, calls, 0);
    expect(at(q, calls, 300).clip).toBe('think');
  });

  it('play() during the same one-shot restarts it', () => {
    const { sprite, calls } = fakeSprite();
    const q = createController(sprite);
    q.play('wave');
    at(q, calls, 0);
    at(q, calls, 100);
    q.play('wave');
    expect(at(q, calls, 160)).toMatchObject({ clip: 'wave', elapsedMs: 0 });
  });

  it('hold() stays on the clip until the next call', () => {
    const { sprite, calls } = fakeSprite();
    const q = createController(sprite);
    q.hold('point_left_up');
    at(q, calls, 0);
    expect(at(q, calls, 10000).clip).toBe('point_left_up');
    q.loop('think');
    expect(at(q, calls, 10010)).toMatchObject({ clip: 'think', elapsedMs: 0 });
  });

  it('pointAt() picks side, height and the 3/4 angle', () => {
    const { sprite, calls } = fakeSprite();
    const q = createController(sprite);
    q.pointAt(100, 100, 20, 100);
    expect(at(q, calls, 0)).toMatchObject({ clip: 'point_left_level', angle: 315 });
    q.pointAt(100, 100, 200, 0);
    expect(at(q, calls, 10)).toMatchObject({ clip: 'point_right_up', angle: 45 });
    q.pointAt(100, 100, 120, 300);
    expect(at(q, calls, 20)).toMatchObject({ clip: 'point_right_down', angle: 45 });
  });

  it('setAngle() changes the drawn direction', () => {
    const { sprite, calls } = fakeSprite();
    const q = createController(sprite);
    q.setAngle(45);
    expect(at(q, calls, 0).angle).toBe(45);
  });

  it('rejects unknown clips by name', () => {
    const { sprite } = fakeSprite(false);
    const q = createController(sprite);
    expect(() => q.play('nope')).toThrow('Unknown clip: nope');
    expect(() => q.pointAt(100, 100, 20, 100)).toThrow('Unknown clip: point_left_level');
  });
});
