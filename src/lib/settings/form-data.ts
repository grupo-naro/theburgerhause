const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

const num = (fd: FormData, key: string): number => {
  const v = text(fd, key).trim();
  return v === "" ? Number.NaN : Number(v);
};

export function settingsFromForm(fd: FormData) {
  const fee = text(fd, "deliveryFeePesos").trim();
  return {
    storeName: text(fd, "storeName"),
    storeAddress: text(fd, "storeAddress"),
    storePhone: text(fd, "storePhone"),
    whatsapp: text(fd, "whatsapp"),
    bankAlias: text(fd, "bankAlias"),
    bankCbu: text(fd, "bankCbu"),
    deliveryFeePesos: fee === "" ? Number.NaN : Number(fee),
    acceptingOrders: fd.has("acceptingOrders"),
    openingHoursText: text(fd, "openingHoursText"),
    businessDayCutoff: text(fd, "businessDayCutoff"),
    basePrepMinutes: num(fd, "basePrepMinutes"),
    deliveryTravelMinutes: num(fd, "deliveryTravelMinutes"),
  };
}
