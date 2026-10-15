"use client";

import { useMemo, useState } from "react";
import type { PublicMenu } from "@/lib/menu/public";
import { filterMenu } from "@/lib/menu/search";
import { CategoryBar } from "./category-bar";
import { CategorySection } from "./category-section";
import { FeaturedCarousel } from "./featured-carousel";
import { SearchBox } from "./search-box";

/** Featured row + search + sticky category bar + sections, filtered instantly on the client. */
export function MenuBrowser({ menu }: { menu: PublicMenu }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterMenu(menu, query), [menu, query]);
  const count = filtered.categories.reduce((n, c) => n + c.products.length, 0);
  const searching = query.trim() !== "";

  return (
    <div>
      {/* Hidden while searching: the results are what the visitor is looking at. */}
      {!searching && <FeaturedCarousel products={menu.featured} />}
      <SearchBox value={query} onChange={setQuery} resultCount={count} />
      {filtered.categories.length > 0 ? (
        <>
          <div className="h-3" />
          <CategoryBar categories={filtered.categories} />
          <div className="mx-auto max-w-[1100px] px-4">
            {filtered.categories.map((c) => (
              <CategorySection key={c.id} category={c} />
            ))}
          </div>
        </>
      ) : (
        <div role="status" className="mx-auto max-w-[1100px] px-4 py-16 text-center">
          <p className="font-display text-xl font-bold text-ink">
            No encontramos productos para «{query.trim()}»
          </p>
          <p className="mt-1 text-ink-muted">Revisá la ortografía o probá con otra palabra.</p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-5 inline-flex h-11 items-center rounded-full bg-brand-600 px-6 font-display font-bold text-white hover:bg-brand-700"
          >
            Borrar búsqueda
          </button>
        </div>
      )}
    </div>
  );
}
