import { isGridPart } from './voxelgrid';
import type { PartSpec } from './types';

/** Banner "Sync Silhouette" applies only to front/back silhouette errors on view-based (non-grid) parts. */
export function offersSilhouetteSync(message: string, selected: PartSpec | undefined): boolean {
  if (!message.includes('front/back silhouettes differ')) return false;
  return !(selected && isGridPart(selected));
}

/** Reason a new palette character is invalid, or null. `old` is the char being renamed (allowed to stay). */
export function paletteCharError(
  v: string,
  palette: Record<string, unknown>,
  old?: string,
  parts: Record<string, PartSpec> = {}
): string | null {
  if (v.length === 1 && /[\d\s]/.test(v) && Object.values(parts).some(p => isGridPart(p))) {
    return "Digits and spaces can't be colour keys in projects with 3D grid parts";
  }
  if (v.length !== 1 || v === '.' || (v !== old && palette[v] !== undefined)) {
    return 'Choose one unused character other than .';
  }
  return null;
}

/** Part dropdown value for the key inspector: an authored key wins (null -> none), else the unmuted sample. */
export function partKeyDisplay(key: { value?: unknown } | null, sampled: string | null | undefined): string {
  if (key) return typeof key.value === 'string' ? key.value : '';
  return sampled ?? '';
}
