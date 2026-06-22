import db from "../db.server";
import { unauthenticated } from "../shopify.server";

function toOrderGid(orderId) {
  if (typeof orderId === "string" && orderId.startsWith("gid://")) return orderId;
  return `gid://shopify/Order/${orderId}`;
}

async function getAdminClient(shop) {
  const auth = await unauthenticated.admin(shop);
  if (!auth?.admin) throw new Error(`Could not create admin client for shop: ${shop}`);
  return auth.admin;
}

async function getOrderWithMetafield(admin, orderId) {
  const resp = await admin.graphql(`
    query GetOrderWithMetafield($id: ID!) {
      order(id: $id) {
        id
        name
        metafield(namespace: "custom", key: "link_submission") {
          id type value compareDigest
        }
      }
    }
  `, { variables: { id: toOrderGid(orderId) } });
  const json = await resp.json();
  if (json.errors?.length) throw new Error(`Order query failed: ${JSON.stringify(json.errors)}`);
  const order = json?.data?.order;
  if (!order) throw new Error(`Order not found for ${orderId}`);
  return order;
}

async function patchMetafieldOrderName(order, admin, resolvedOrderName) {
  if (!order.metafield?.value) return false;
  let submissions;
  try {
    submissions = JSON.parse(order.metafield.value);
    if (!Array.isArray(submissions)) return false;
  } catch { return false; }

  if (!submissions.some((s) => !s.orderName)) return false; // nothing to patch

  const patched = submissions.map((s) => ({
    ...s,
    orderName: s.orderName || resolvedOrderName,
  }));

  const resp = await admin.graphql(`
    mutation SetOrderMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      metafields: [{
        ownerId: order.id,
        namespace: "custom",
        key: "link_submission",
        type: "json",
        value: JSON.stringify(patched),
        ...(order.metafield?.compareDigest ? { compareDigest: order.metafield.compareDigest } : {}),
      }],
    },
  });

  const json = await resp.json();
  const userErrors = json?.data?.metafieldsSet?.userErrors || [];
  if (userErrors.length) throw new Error(`metafieldsSet userErrors: ${JSON.stringify(userErrors)}`);
  return true;
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BATCH_SIZE = 10;

export async function action({ request }) {
  if (request.method !== "POST") return jsonResp({ ok: false }, 405);

  const reqUrl = new URL(request.url);
  const offset = parseInt(reqUrl.searchParams.get("offset") || "0", 10);

  const where = { orderName: null };

  const [total, batch] = await Promise.all([
    db.tikTokUrl.count({ where }),
    db.tikTokUrl.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: offset,
      take: BATCH_SIZE,
    }),
  ]);

  // Group by shop + orderId to avoid duplicate Shopify API calls per order
  const groups = new Map();
  for (const entry of batch) {
    const key = `${entry.shop}|${entry.orderId}`;
    if (!groups.has(key)) {
      groups.set(key, { shop: entry.shop, orderId: entry.orderId, entries: [] });
    }
    groups.get(key).entries.push(entry);
  }

  let successCount = 0;
  let failCount = 0;

  for (const group of groups.values()) {
    try {
      const admin = await getAdminClient(group.shop);
      const order = await getOrderWithMetafield(admin, group.orderId);
      const resolvedName = order.name || null;

      // Patch the metafield JSON in-place (no duplicate entries)
      await patchMetafieldOrderName(order, admin, resolvedName);

      // Update all DB entries for this order
      for (const entry of group.entries) {
        await db.tikTokUrl.update({
          where: { id: entry.id },
          data: { orderName: resolvedName },
        });
        if (resolvedName) successCount++;
        else failCount++;
      }
    } catch (e) {
      failCount += group.entries.length;
    }
  }

  const nextOffset = offset + batch.length;
  return jsonResp({
    ok: true,
    total,
    batchSize: batch.length,
    offset,
    nextOffset,
    hasMore: nextOffset < total,
    success: successCount,
    failed: failCount,
  });
}
