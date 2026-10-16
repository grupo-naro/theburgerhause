"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { CloseIcon, SearchIcon } from "@/components/menu/icons";
import { useMenu } from "@/components/menu/menu-provider";
import { nextTileIndex, type ArrowKey } from "@/lib/pos/grid-nav";
import { filterMenu } from "@/lib/menu/search";
import type { PublicProduct } from "@/lib/menu/public";
import { ProductTile } from "./product-tile";

type Props = {
  searchRef: RefObject<HTMLInputElement | null>;
  /** productId -> bump counter of the last plain add (drives the +1 pulse). */
  pulses: Record<number, number>;
  onAdd: (product: PublicProduct) => void;
  onCustomize: (product: PublicProduct, opener: HTMLElement) => void;
};

const ALL = "all";
const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/** Left panel: search, category chips and the grid of tiles. */
export function CatalogPanel({ searchRef, pulses, onAdd, onCustomize }: Props) {
  const menu = useMenu();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL);
  const gridRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterMenu(menu, query), [menu, query]);
  const sections = useMemo(
    () => filtered.categories.filter((c) => category === ALL || String(c.id) === category),
    [filtered, category],
  );
  const flat = sections.flatMap((c) => c.products);

  const tiles = () => [...(gridRef.current?.querySelectorAll<HTMLElement>("[data-tile-main]") ?? [])];

  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!ARROWS.has(e.key)) return;
    const all = tiles();
    const from = all.findIndex((el) => el === document.activeElement);
    if (from < 0) return;
    e.preventDefault();
    const to = nextTileIndex(
      all.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
      from,
      e.key as ArrowKey,
    );
    all[to]?.focus();
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (flat.length === 1) {
        onAdd(flat[0]);
        setQuery("");
      } else tiles()[0]?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      tiles()[0]?.focus();
    } else if (e.key === "Escape" && query) {
      setQuery("");
    }
  }

  const chip = (active: boolean) =>
    `inline-flex min-h-12 shrink-0 items-center rounded-full px-5 text-base font-bold whitespace-nowrap transition-colors ${
      active ? "bg-brand-600 text-white shadow-sm" : "border border-line bg-surface text-ink hover:bg-brand-50"
    }`;

  return (
    <section aria-label="Productos" className="flex min-h-0 flex-col lg:h-full">
      <div className="z-10 -mx-1 flex flex-col gap-3 bg-bg px-1 pb-3 lg:shrink-0">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-muted" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Buscar producto…"
            aria-label="Buscar producto"
            aria-keyshortcuts="/"
            autoComplete="off"
            data-testid="pos-search"
            className="min-h-12 w-full rounded-full border border-line bg-surface pr-24 pl-12 text-lg text-ink placeholder:text-ink-muted/80 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Borrar búsqueda"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              className="absolute top-1/2 right-1.5 grid size-10 -translate-y-1/2 place-items-center rounded-full text-ink-muted hover:bg-brand-50"
            >
              <CloseIcon className="size-5" />
            </button>
          ) : (
            <kbd
              aria-hidden="true"
              className="absolute top-1/2 right-4 -translate-y-1/2 rounded-md border border-line bg-bg px-2 py-0.5 font-mono text-sm text-ink-muted"
            >
              /
            </kbd>
          )}
        </div>
        <div role="group" aria-label="Categorías" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <button type="button" aria-pressed={category === ALL} onClick={() => setCategory(ALL)} className={chip(category === ALL)}>
            Todas
          </button>
          {menu.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={category === String(c.id)}
              onClick={() => setCategory(String(c.id))}
              className={chip(category === String(c.id))}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div ref={gridRef} onKeyDown={onGridKey} data-testid="pos-grid" className="min-h-0 flex-1 pb-6 lg:overflow-y-auto lg:pr-1 [scrollbar-width:thin]">
        {sections.length === 0 ? (
          <div data-testid="pos-no-results" className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
            <p className="font-display text-xl font-bold text-ink">No encontramos productos</p>
            <p className="mt-1 text-ink-muted">Probá con otra palabra o elegí otra categoría.</p>
            {(query || category !== ALL) && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCategory(ALL);
                }}
                className="mt-4 inline-flex min-h-12 items-center rounded-full bg-brand-600 px-6 font-display font-bold text-white hover:bg-brand-700"
              >
                Ver todo
              </button>
            )}
          </div>
        ) : (
          sections.map((c) => (
            <div key={c.id} className="mb-5 last:mb-0" data-testid="pos-section">
              {(category === ALL || query) && (
                <h2 className="mb-2 font-display text-lg font-extrabold text-ink-muted">{c.name}</h2>
              )}
              <ul className="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2.5">
                {c.products.map((p) => (
                  <ProductTile key={p.id} product={p} pulse={pulses[p.id] ?? 0} onAdd={onAdd} onCustomize={onCustomize} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
