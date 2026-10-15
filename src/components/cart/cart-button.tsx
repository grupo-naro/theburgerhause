import { BagIcon } from "@/components/menu/icons";

/** Header cart button. Stub (count 0): Task 4.2 replaces it with the real cart. */
export function CartButton({ count = 0 }: { count?: number }) {
  return (
    <button
      type="button"
      aria-label="Ver pedido"
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:outline-white"
    >
      <BagIcon className="size-6" />
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 flex min-w-5 items-center justify-center rounded-full bg-cheddar-400 px-1 text-xs font-bold text-ink">
          {count}
        </span>
      )}
    </button>
  );
}
