import db from "../db.server";

export const DEFAULT_SHOP_SETTINGS = {
  dailyLimitEnabled: false,
  dailyLimit: 20,
  tiktokEnabled: true,
  shopeeEnabled: true,
};

// Shops without a row yet behave exactly like the defaults above — the row
// is only created the first time an admin actually changes a setting.
export async function getShopSettings(shop) {
  const row = await db.shopSettings.findUnique({ where: { shop } });
  if (!row) {
    return { shop, ...DEFAULT_SHOP_SETTINGS };
  }
  return row;
}

export async function upsertShopSettings(shop, data) {
  return db.shopSettings.upsert({
    where: { shop },
    create: { shop, ...DEFAULT_SHOP_SETTINGS, ...data },
    update: data,
  });
}
