import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/WeeklyLimitBlock.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
