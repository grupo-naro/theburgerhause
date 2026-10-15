import Image from "next/image";
import Link from "next/link";
import { CartButton } from "@/components/cart/cart-button";
import { getPublicStoreInfo } from "@/lib/menu/queries";
import { SearchButton } from "./search-button";

const shell = "sticky top-0 z-40 h-[var(--header-h)] bg-brand-600 text-white shadow-md";

export async function StoreHeader() {
  const { storeName } = await getPublicStoreInfo();
  return (
    <header className={shell}>
      <div className="mx-auto flex h-full max-w-[1100px] items-center gap-1 px-3 sm:px-4">
        <h1 className="min-w-0 flex-1">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3 rounded-full py-1 pr-2 focus-visible:outline-white"
          >
            <Image
              src="/brand/logo-512.webp"
              alt=""
              width={40}
              height={40}
              priority
              className="size-10 shrink-0 rounded-full bg-white ring-2 ring-white/40"
            />
            <span className="truncate font-display text-xl font-extrabold leading-none tracking-tight sm:text-2xl">
              {storeName}
            </span>
          </Link>
        </h1>
        <SearchButton />
        <CartButton />
      </div>
    </header>
  );
}

/** Same box as the header so nothing shifts while the store name resolves. */
export function StoreHeaderFallback() {
  return (
    <div className={shell} aria-hidden="true">
      <div className="mx-auto flex h-full max-w-[1100px] items-center gap-3 px-4">
        <div className="size-10 rounded-full bg-white/25" />
        <div className="h-5 w-44 rounded-full bg-white/25" />
      </div>
    </div>
  );
}
