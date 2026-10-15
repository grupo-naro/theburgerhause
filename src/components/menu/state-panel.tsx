import Image from "next/image";
import type { ReactNode } from "react";

/** Friendly full-width message with the mascot: errors, 404 and "menu being updated". */
export function StatePanel({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <Image
        src="/brand/logo-512.webp"
        alt=""
        width={112}
        height={112}
        className="size-28 rounded-full bg-white shadow-md ring-4 ring-brand-50"
      />
      <h2 className="mt-6 font-display text-2xl font-extrabold text-ink">{title}</h2>
      {children && <p className="mt-2 text-ink-muted">{children}</p>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}
