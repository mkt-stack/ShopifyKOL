import { authenticate } from "../shopify.server";
import {
  parseTags,
  diffAddedTags,
  saveOrderTagState,
  getPreviousOrderTags,
  buildOrderTagAddedPayload,
  triggerOrderTagAddedFlow,
} from "../lib/order-tag-flow.server";

export const action = async ({ request }) => {
  const { payload, session, admin, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!session || !admin) {
    return new Response();
  }

  const orderId = String(payload.id);
  const currentTags = parseTags(payload.tags);
  const previousTags = await getPreviousOrderTags(shop, orderId);

  // No baseline yet (order existed before this app started tracking it) —
  // record its current tags without firing, so the *next* change has
  // something real to diff against instead of treating every existing tag
  // as newly added.
  if (previousTags !== null) {
    const addedTags = diffAddedTags(previousTags, currentTags);

    for (const tag of addedTags) {
      try {
        const flowPayload = buildOrderTagAddedPayload({
          order: payload,
          tag,
          currentTags,
        });
        await triggerOrderTagAddedFlow(admin, flowPayload);
      } catch (error) {
        console.error(
          `Failed to trigger order-tag-added flow for order ${orderId}, tag "${tag}":`,
          error,
        );
      }
    }
  }

  await saveOrderTagState(shop, orderId, currentTags);

  return new Response();
};
