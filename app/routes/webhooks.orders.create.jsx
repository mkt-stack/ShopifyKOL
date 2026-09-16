import { authenticate } from "../shopify.server";
import { parseTags, saveOrderTagState } from "../lib/order-tag-flow.server";

// Seeds the tag baseline at order creation so the orders/updated handler can
// tell which tags were *added* later, rather than treating a pre-tagged
// order's existing tags as newly added the first time it's ever updated.
export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!session) {
    return new Response();
  }

  const orderId = String(payload.id);
  const tags = parseTags(payload.tags);

  await saveOrderTagState(shop, orderId, tags);

  return new Response();
};
