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
