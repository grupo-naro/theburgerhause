const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const optionalId = (fd: FormData) => {
  const raw = text(fd, "id").trim();
  return raw === "" ? undefined : Number(raw);
};

export function groupFromForm(fd: FormData) {
  return { id: optionalId(fd), name: text(fd, "name") };
}

/** A removal has no price: its (disabled, hence unsent) field counts as 0. */
export function modifierFromForm(fd: FormData) {
  const kind = text(fd, "kind");
  const price = text(fd, "priceArs").trim();
  return {
    id: optionalId(fd),
    groupId: Number(text(fd, "groupId") || Number.NaN),
    name: text(fd, "name"),
    kind,
    priceArs: price === "" ? (kind === "remove" ? 0 : Number.NaN) : Number(price),
    kitchenLabel: text(fd, "kitchenLabel"),
    active: fd.has("active"),
  };
}

/** Ids of the checked groups; null when any value is not a positive integer. */
export function groupIdsFromForm(fd: FormData): number[] | null {
  const ids: number[] = [];
  for (const v of fd.getAll("groupId")) {
    if (typeof v !== "string" || !/^\d+$/.test(v) || Number(v) <= 0) return null;
    ids.push(Number(v));
  }
  return ids;
}
