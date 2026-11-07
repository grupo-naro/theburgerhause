"use client";

/** Category filter for the top products: a GET form that submits on change. */
export function CategoryFilter({
  categories,
  value,
  keep,
}: {
  categories: { id: number; name: string }[];
  value?: string;
  keep: Record<string, string | undefined>;
}) {
  return (
    <form method="get" action="/admin/analiticas">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="sr-only" htmlFor="cat">
        Categoría
      </label>
      <select
        id="cat"
        name="cat"
        defaultValue={value ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm"
      >
        <option value="">Todas las categorías</option>
        {categories.map((c) => (
          <option key={c.id} value={String(c.id)}>
            {c.name}
          </option>
        ))}
      </select>
    </form>
  );
}
