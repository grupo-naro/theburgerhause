import { NotFoundView } from "@/components/menu/not-found-view";

/** Unmatched URLs render inside the root layout only (no storefront shell). */
export default function RootNotFound() {
  return (
    <main className="flex flex-1 items-center justify-center">
      <NotFoundView heading="h1" />
    </main>
  );
}
