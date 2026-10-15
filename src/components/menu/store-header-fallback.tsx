export const headerShell = "sticky top-0 z-40 h-[var(--header-h)] bg-brand-600 text-white shadow-md";

/** Same box as the header so nothing shifts while the store name resolves. */
export function StoreHeaderFallback() {
  return (
    <div className={headerShell} aria-hidden="true">
      <div className="mx-auto flex h-full max-w-[1100px] items-center gap-3 px-4">
        <div className="size-10 rounded-full bg-white/25" />
        <div className="h-5 w-44 rounded-full bg-white/25" />
      </div>
    </div>
  );
}
