const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export function stationFromForm(fd: FormData) {
  return { name: text(fd, "name"), kind: text(fd, "kind") };
}

export function renameFromForm(fd: FormData) {
  return { id: Number(text(fd, "id") || Number.NaN), name: text(fd, "name") };
}
