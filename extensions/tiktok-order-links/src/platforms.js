// Mirrors ShopSettings.tiktokEnabled / shopeeEnabled, returned by
// GET /api/tiktok-links. Both stay on until the server says otherwise,
// matching DEFAULT_SHOP_SETTINGS.
export const DEFAULT_PLATFORMS = {tiktok: true, shopee: true};

// Display names of the enabled platforms, e.g. ['TikTok', 'Shopee'].
export function getPlatformNames(platforms) {
  const names = [];
  if (platforms?.tiktok) names.push('TikTok');
  if (platforms?.shopee) names.push('Shopee');
  // The settings page requires at least one platform enabled; fall back
  // to both rather than rendering empty text if that ever slips.
  return names.length ? names : ['TikTok', 'Shopee'];
}
