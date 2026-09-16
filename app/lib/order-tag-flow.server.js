import db from "../db.server";

const FLOW_TRIGGER_HANDLE = "order-tag-added";

export function parseTags(tagsInput) {
  if (Array.isArray(tagsInput)) {
    return tagsInput.map((tag) => tag.trim()).filter(Boolean);
  }

  if (typeof tagsInput !== "string" || !tagsInput.trim()) {
    return [];
  }

  return tagsInput
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function diffAddedTags(previousTags, currentTags) {
  const previousSet = new Set(previousTags);
  return currentTags.filter((tag) => !previousSet.has(tag));
}

// Records the order's current tag set so the next orders/updated webhook can
// diff against it. Called on every orders/create and orders/updated webhook,
// independent of whether a Flow trigger fires for this delivery.
export async function saveOrderTagState(shop, orderId, tags) {
  await db.orderTagState.upsert({
    where: { shop_orderId: { shop, orderId } },
    create: { shop, orderId, tags: tags.join(",") },
    update: { tags: tags.join(",") },
  });
}

export async function getPreviousOrderTags(shop, orderId) {
  const state = await db.orderTagState.findUnique({
    where: { shop_orderId: { shop, orderId } },
  });

  return state ? parseTags(state.tags) : null;
}

// Builds the flat payload for the "order-tag-added" Flow trigger. Custom
// field keys here must match extensions/order-tag-added-flow-trigger/
// shopify.extension.toml VERBATIM (Shopify requires each `key` there to be
// alphabetic-plus-spaces only, and the payload key you send must be the
// exact same string — no camelCase/snake_case). Reference fields
// (customer_id/order_id) are the fixed Shopify-assigned payload keys for
// customer_reference/order_reference and are exempt from that naming rule.
export function buildOrderTagAddedPayload({ order, tag, currentTags }) {
  const customer = order.customer || null;
  const customerName = customer
    ? [customer.first_name, customer.last_name].filter(Boolean).join(" ")
    : "";

  return {
    order_id: order.id != null ? Number(order.id) : null,
    customer_id: customer?.id != null ? Number(customer.id) : null,
    "Tag added": tag,
    "Order name": order.name || "",
    "Customer name": customerName,
    "Customer email": customer?.email || order.email || "",
    "All tags": currentTags.join(", "),
    "Financial status": order.financial_status || "",
    "Fulfillment status": order.fulfillment_status || "",
    "Total price": order.total_price != null ? Number(order.total_price) : null,
    Currency: order.currency || "",
  };
}

export async function triggerOrderTagAddedFlow(admin, payload) {
  const mutation = `
    mutation TriggerOrderTagAddedFlow($handle: String, $payload: JSON) {
      flowTriggerReceive(handle: $handle, payload: $payload) {
        userErrors {
          field
          message
        }
      }
    }
  `;

  const resp = await admin.graphql(mutation, {
    variables: { handle: FLOW_TRIGGER_HANDLE, payload },
  });

  const json = await resp.json();

  if (json.errors?.length) {
    throw new Error(`flowTriggerReceive failed: ${JSON.stringify(json.errors)}`);
  }

  const userErrors = json?.data?.flowTriggerReceive?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error(
      `flowTriggerReceive userErrors: ${JSON.stringify(userErrors)}`,
    );
  }
}
