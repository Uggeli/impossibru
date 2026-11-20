// Browser ES module. The returned draw function uses the caller's animation clock.
export async function loadSprite(metadataUrl) {
  const response = await fetch(metadataUrl);
  if (!response.ok) throw new Error(`Could not load atlas metadata (HTTP ${response.status})`);
  const { image, animations } = await response.json();
  if (!image || !animations) throw new Error('Expected exported atlas metadata with an image and animations');
  const atlas = new Image();
  atlas.src = new URL(image, response.url).href;
  await atlas.decode();
  return {
    animations,
    draw(ctx, { clip, angle = 0, elapsedMs = 0, x, y, scale = 1 }) {
      const animation = animations[clip];
      if (!animation?.directions?.length) throw new Error(`Unknown or empty clip: ${clip}`);
      const distance = direction => Math.abs(((direction.angle - angle) % 360 + 540) % 360 - 180);
      const { frames } = animation.directions.reduce((best, next) =>
        distance(next) < distance(best) ? next : best);
      const step = Math.floor(Math.max(0, elapsedMs) / animation.frame_duration_ms);
      const index = animation.loop ? step % frames.length : Math.min(step, frames.length - 1);
      const { rect, pivot } = frames[index];
      if (rect.w && rect.h) {
        // Pivots are atlas-relative. Subtract the crop origin for trimmed and grid atlases alike.
        ctx.drawImage(atlas, rect.x, rect.y, rect.w, rect.h,
          x - (pivot.x - rect.x) * scale, y - (pivot.y - rect.y) * scale,
          rect.w * scale, rect.h * scale);
      }
      return index;
    }
  };
}

// Sequences clips on a loaded sprite: one-shots that return to idle, loops, held poses, pointing.
// `now` is the caller's millisecond clock; a clip starts on the first draw after it is chosen.
export function createController(sprite, { idle = 'idle', angle = 0, pointYaw = { left: 315, right: 45 } } = {}) {
  const check = name => {
    if (!sprite.animations[name]) throw new Error(`Unknown clip: ${name}`);
    return name;
  };
  let state = { clip: check(idle), mode: 'loop', then: null, start: null };
  const set = (clip, mode, then = null) => { state = { clip: check(clip), mode, then, start: null }; };
  const duration = name => {
    const a = sprite.animations[name];
    return a.directions[0].frames.length * a.frame_duration_ms;
  };
  return {
    get clip() { return state.clip; },
    play(clip, { then = idle } = {}) { check(then); set(clip, 'once', then); },
    loop(clip) { set(clip, 'loop'); },
    hold(clip) { set(clip, 'hold'); },
    setAngle(deg) { angle = deg; },
    pointAt(fromX, fromY, toX, toY) {
      const dx = toX - fromX;
      const side = dx < 0 ? 'left' : 'right';
      const a = Math.atan2(fromY - toY, Math.abs(dx)) * 180 / Math.PI;
      const height = a > 25 ? 'up' : a < -25 ? 'down' : 'level';
      const clip = check(`point_${side}_${height}`);
      angle = pointYaw[side];
      set(clip, 'hold');
    },
    draw(ctx, { x, y, scale = 1, now }) {
      if (state.start === null) state.start = now;
      if (state.mode === 'once' && now - state.start >= duration(state.clip)) {
        state = { clip: state.then, mode: 'loop', then: null, start: now };
      }
      sprite.draw(ctx, { clip: state.clip, angle, elapsedMs: now - state.start, x, y, scale });
      return state.clip;
    },
  };
}
