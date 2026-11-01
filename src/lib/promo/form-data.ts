const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export function promoFromForm(fd: FormData) {
  return {
    imagePath: text(fd, "imagePath") || null,
    title: text(fd, "title"),
    active: fd.has("active"),
    startsAt: text(fd, "startsAt"),
    endsAt: text(fd, "endsAt"),
  };
}
