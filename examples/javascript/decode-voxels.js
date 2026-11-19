// Decode a packed source part into occupied cells, bottom layer first.
// Each cell carries its palette symbol and original color (hex string or channel array).
export function* decodeVoxels({ size, voxels }, palette) {
  if (!Array.isArray(size) || size.length !== 3 ||
      !size.every(n => Number.isSafeInteger(n) && n > 0) || typeof voxels !== 'string') {
    throw new Error('Expected a packed part with size [width, height, depth] and a voxels string');
  }
  const [width, height, depth] = size;
  const volume = width * height * depth;
  if (!Number.isSafeInteger(volume)) throw new Error('Part dimensions are too large');
  const runs = /(\d*)(\D)/uy;
  let offset = 0;
  while (runs.lastIndex < voxels.length) {
    const run = runs.exec(voxels);
    if (!run) throw new Error('Missing palette symbol after run length');
    const symbol = run[2];
    const end = offset + Number(run[1] || 1);
    if (!Number.isSafeInteger(end) || end > volume) throw new Error('Run exceeds part dimensions');
    if (symbol === '.') {
      offset = end;
      continue;
    }
    if (!Object.hasOwn(palette, symbol)) throw new Error(`Unknown palette symbol: ${symbol}`);
    for (; offset < end; offset++) {
      yield { x: offset % width, y: Math.floor(offset / (width * depth)),
        z: Math.floor(offset / width) % depth, symbol, color: palette[symbol] };
    }
  }
  if (offset !== volume) throw new Error('Voxel data does not fill the declared dimensions');
}
