"use client";

import { CloseIcon, SearchIcon } from "./icons";

type Props = { value: string; onChange: (value: string) => void; resultCount: number };

export function SearchBox({ value, onChange, resultCount }: Props) {
  return (
    <div role="search" className="mx-auto max-w-[1100px] px-4 pt-4">
      <label htmlFor="menu-search" className="sr-only">
        Buscar en el menú
      </label>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-muted" />
        <input
          id="menu-search"
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Buscar hamburguesas, papas…"
          autoComplete="off"
          enterKeyHint="search"
          className="h-12 w-full rounded-full border border-line bg-surface pl-12 pr-12 text-base text-ink shadow-sm placeholder:text-ink-muted [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value && (
          <button
            type="button"
            aria-label="Borrar búsqueda"
            onClick={() => onChange("")}
            className="absolute right-0.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-ink-muted hover:text-ink"
          >
            <CloseIcon className="size-5" />
          </button>
        )}
      </div>
      <p className="sr-only" role="status">
        {value.trim() ? `${resultCount} ${resultCount === 1 ? "producto" : "productos"}` : ""}
      </p>
    </div>
  );
}
