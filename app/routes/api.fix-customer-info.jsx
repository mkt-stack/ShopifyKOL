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

async function getOrderCustomer(admin, orderId) {
  const resp = await admin.graphql(`
    query GetOrderCustomer($id: ID!) {
      order(id: $id) {
        customer {
          email
          displayName
          firstName
          lastName
        }
      }
    }
  `, { variables: { id: toOrderGid(orderId) } });
  const json = await resp.json();
  if (json.errors?.length) throw new Error(`Order query failed: ${JSON.stringify(json.errors)}`);

  const customer = json?.data?.order?.customer;
  const customerName =
    customer?.displayName ||
    [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") ||
    null;
  const customerEmail = customer?.email || null;

  return { customerName, customerEmail };
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

  const where = { customerName: null, customerEmail: null };

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
      const { customerName, customerEmail } = await getOrderCustomer(admin, group.orderId);

      for (const entry of group.entries) {
        await db.tikTokUrl.update({
          where: { id: entry.id },
          data: { customerName, customerEmail },
        });
        if (customerName || customerEmail) successCount++;
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
