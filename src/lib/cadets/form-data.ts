const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export function cadetFromForm(fd: FormData) {
  const raw = text(fd, "id").trim();
  return {
    id: raw === "" ? undefined : Number(raw),
    name: text(fd, "name"),
    phone: text(fd, "phone"),
    active: fd.has("active"),
  };
}
