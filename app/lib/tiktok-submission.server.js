import { unauthenticated } from "../shopify.server";

const FLOW_TRIGGER_HANDLE = "video-link-submitted";

export function toOrderGid(orderId) {
  if (typeof orderId === "string" && orderId.startsWith("gid://")) {
    return orderId;
  }

  return `gid://shopify/Order/${orderId}`;
}

export function toGmt7IsoString(dateInput = new Date()) {
  const date = new Date(dateInput);
  const offsetMs = 7 * 60 * 60 * 1000;
  const gmt7 = new Date(date.getTime() + offsetMs);

  const year = gmt7.getUTCFullYear();
  const month = String(gmt7.getUTCMonth() + 1).padStart(2, "0");
  const day = String(gmt7.getUTCDate()).padStart(2, "0");
  const hours = String(gmt7.getUTCHours()).padStart(2, "0");
  const minutes = String(gmt7.getUTCMinutes()).padStart(2, "0");
  const seconds = String(gmt7.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+07:00`;
}

export function buildLatestSubmissionNote(existingNote, latestTimestamp) {
  const marker = "Latest link submitted at (GMT+7):";
  const newLine = `${marker} ${latestTimestamp}`;

  if (!existingNote || !existingNote.trim()) {
    return newLine;
  }

  const lines = existingNote.split("\n");
  const filtered = lines.filter((line) => !line.trim().startsWith(marker));

  return [...filtered, newLine].join("\n").trim();
}

// Server-side copy of the tiktok/shopee host-check used to label the
// platform in the Flow trigger payload. Intentionally not shared with
// app._index.jsx's client-side `getPlatform` (that one runs in the browser
// bundle; this module is `.server.js`-only and stripped from client code).
export function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "tiktok.com" || host.endsWith(".tiktok.com") || host === "vt.tiktok.com") {
      return "tiktok";
    }
    if (host === "shp.ee" || host.endsWith(".shp.ee") || host === "shopee.co.th" || host.endsWith(".shopee.co.th")) {
      return "shopee";
    }
  } catch {
    // ignore
  }
  return "other";
}

export async function getAdminClient(shop) {
  const auth = await unauthenticated.admin(shop);

  if (!auth?.admin) {
    throw new Error(`Could not create admin client for shop: ${shop}`);
  }

  return auth.admin;
}

export async function getOrderData(admin, orderId) {
  const orderGid = toOrderGid(orderId);

  const query = `
    query GetOrderData($id: ID!) {
      order(id: $id) {
        id
        legacyResourceId
        name
        note
        customer {
          id
          legacyResourceId
          email
          displayName
          firstName
          lastName
        }
        lineItems(first: 25) {
          nodes {
            title
            quantity
            product {
              id
              legacyResourceId
            }
          }
        }
        metafield(namespace: "custom", key: "link_submission") {
          id
          type
          value
          compareDigest
        }
        lastSubmissionTimestamp: metafield(namespace: "custom", key: "last_submission_timestamp") {
          id
          type
          value
          compareDigest
        }
      }
    }
  `;

  const resp = await admin.graphql(query, {
    variables: { id: orderGid },
  });

  const json = await resp.json();

  if (json.errors?.length) {
    throw new Error(`Order query failed: ${JSON.stringify(json.errors)}`);
  }

  const order = json?.data?.order;

  if (!order) {
    throw new Error(`Order not found for ${orderGid}`);
  }

  return order;
}

export async function updateOrderMetafields(order, admin, submission) {
  let currentSubmissions = [];

  if (order.metafield?.value) {
    try {
      const parsed = JSON.parse(order.metafield.value);
      currentSubmissions = Array.isArray(parsed) ? parsed : [];
    } catch {
      currentSubmissions = [];
    }
  }

  currentSubmissions.push(submission);

  // keep latest 10
  if (currentSubmissions.length > 10) {
    currentSubmissions = currentSubmissions.slice(-10);
  }

  const metafields = [
    {
      ownerId: order.id,
      namespace: "custom",
      key: "link_submission",
      type: "json",
      value: JSON.stringify(currentSubmissions),
      ...(order.metafield?.compareDigest
        ? { compareDigest: order.metafield.compareDigest }
        : {}),
    },
    {
      ownerId: order.id,
      namespace: "custom",
      key: "last_submission_timestamp",
      type: "date_time",
      value: submission.savedAt,
      ...(order.lastSubmissionTimestamp?.compareDigest
        ? { compareDigest: order.lastSubmissionTimestamp.compareDigest }
        : {}),
    },
  ];

  const mutation = `
    mutation SetOrderMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          type
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const resp = await admin.graphql(mutation, {
    variables: { metafields },
  });

  const json = await resp.json();

  if (json.errors?.length) {
    throw new Error(`metafieldsSet failed: ${JSON.stringify(json.errors)}`);
  }

  const userErrors = json?.data?.metafieldsSet?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error(
      `metafieldsSet userErrors: ${JSON.stringify(userErrors)}`,
    );
  }

  return json?.data?.metafieldsSet?.metafields ?? [];
}

export async function updateOrderNote(order, admin, latestTimestamp) {
  const noteText = buildLatestSubmissionNote(order.note, latestTimestamp);

  const mutation = `
    mutation UpdateOrderNote($input: OrderInput!) {
      orderUpdate(input: $input) {
        order {
          id
          note
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const resp = await admin.graphql(mutation, {
    variables: {
      input: {
        id: order.id,
        note: noteText,
      },
    },
  });

  const json = await resp.json();

  if (json.errors?.length) {
    throw new Error(`orderUpdate failed: ${JSON.stringify(json.errors)}`);
  }

  const userErrors = json?.data?.orderUpdate?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error(`orderUpdate userErrors: ${JSON.stringify(userErrors)}`);
  }

  return json?.data?.orderUpdate?.order?.note ?? null;
}

// Builds the flat payload for the "video-link-submitted" Flow trigger.
// Every key defined in extensions/video-link-flow-trigger/shopify.extension.toml
// must be present here (Flow's docs are ambiguous about omitted keys, so we
// always send all of them: `null` for missing reference ids, "" for missing text).
export function buildFlowTriggerPayload({
  order,
  submission,
  resolvedOrderName,
  resolvedCustomerName,
  resolvedCustomerEmail,
  savedAtGmt7,
}) {
  const lineItems = order?.lineItems?.nodes || [];
  const firstProduct = lineItems[0]?.product || null;
  const productTitles = lineItems
    .map((item) => `${item.quantity}x ${item.title}`)
    .join(", ");

  return {
    customer_id: order?.customer?.legacyResourceId
      ? Number(order.customer.legacyResourceId)
      : null,
    order_id: order?.legacyResourceId ? Number(order.legacyResourceId) : null,
    product_id: firstProduct?.legacyResourceId
      ? Number(firstProduct.legacyResourceId)
      : null,
    order_name: resolvedOrderName || "",
    customer_name: resolvedCustomerName || "",
    customer_email: resolvedCustomerEmail || "",
    video_url: submission.url || "",
    platform: detectPlatform(submission.url),
    creator_handle: submission.creatorHandle || "",
    post_date: submission.postDate ? toGmt7IsoString(submission.postDate) : "",
    submission_id: submission.id || "",
    submitted_at: savedAtGmt7 || "",
    product_titles: productTitles,
    line_item_count: lineItems.length,
  };
}

export async function triggerLinkSubmissionFlow(admin, payload) {
  const mutation = `
    mutation TriggerLinkSubmissionFlow($handle: String, $payload: JSON) {
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
