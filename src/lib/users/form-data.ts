const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export function userFromForm(fd: FormData) {
  const raw = text(fd, "id").trim();
  return {
    id: raw === "" ? undefined : Number(raw),
    name: text(fd, "name"),
    username: text(fd, "username"),
    role: text(fd, "role"),
    active: fd.has("active"),
    password: text(fd, "password"),
  };
}
