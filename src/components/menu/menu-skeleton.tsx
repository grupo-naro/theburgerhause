const bone = "animate-pulse rounded-xl bg-brand-50";

/** Loading state shaped like the real menu (carousel, search, chips, cards). */
export function MenuSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto max-w-[1100px] px-4 pt-6">
      <div className={`${bone} h-8 w-40`} />
      <div className="mt-3 flex gap-3 overflow-hidden">
        {[0, 1].map((i) => (
          <div key={i} className={`${bone} aspect-[4/3] w-[72%] shrink-0 sm:w-72`} />
        ))}
      </div>
      <div className={`${bone} mt-6 h-12 rounded-full`} />
      <div className="mt-4 flex gap-2 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${bone} h-11 w-32 shrink-0 rounded-full`} />
        ))}
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${bone} h-80`} />
        ))}
      </div>
    </div>
  );
}
