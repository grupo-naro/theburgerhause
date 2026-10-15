import { thumbUrl } from "@/lib/uploads/storage";

/**
 * Plain <img>: uploads are webp thumbnails served by our own /uploads route
 * (not /public), already resized, so next/image's optimizer would add nothing
 * and would need extra config for non-public local sources.
 */
export function Thumb({ path, alt = "", size = 48 }: { path: string | null; alt?: string; size?: number }) {
  const box = { width: size, height: size };
  if (!path) {
    return (
      <span
        aria-hidden="true"
        style={box}
        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xs text-ink-muted"
      >
        Sin foto
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={thumbUrl(path)} alt={alt} style={box} className="shrink-0 rounded-lg object-cover" loading="lazy" />
  );
}
