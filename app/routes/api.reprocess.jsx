import db from "../db.server";
import { unauthenticated } from "../shopify.server";

// ── Shared helpers ────────────────────────────────────────────────────────────

function toOrderGid(orderId) {
  if (typeof orderId === "string" && orderId.startsWith("gid://")) return orderId;
  return `gid://shopify/Order/${orderId}`;
}

function toGmt7IsoString(dateInput = new Date()) {
  const date = new Date(dateInput);
  const offsetMs = 7 * 60 * 60 * 1000;
  const gmt7 = new Date(date.getTime() + offsetMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${gmt7.getUTCFullYear()}-${pad(gmt7.getUTCMonth() + 1)}-${pad(gmt7.getUTCDate())}T${pad(gmt7.getUTCHours())}:${pad(gmt7.getUTCMinutes())}:${pad(gmt7.getUTCSeconds())}+07:00`;
}

function buildLatestSubmissionNote(existingNote, latestTimestamp) {
  const marker = "Latest link submitted at (GMT+7):";
  const newLine = `${marker} ${latestTimestamp}`;
  if (!existingNote?.trim()) return newLine;
  const lines = existingNote.split("\n");
  return [...lines.filter((l) => !l.trim().startsWith(marker)), newLine].join("\n").trim();
}

async function getAdminClient(shop) {
  const auth = await unauthenticated.admin(shop);
  if (!auth?.admin) throw new Error(`Could not create admin client for shop: ${shop}`);
  return auth.admin;
}

async function getOrderData(admin, orderId) {
  const query = `
    query GetOrderData($id: ID!) {
      order(id: $id) {
        id
        name
        note
        metafield(namespace: "custom", key: "link_submission") {
          id type value compareDigest
        }
        lastSubmissionTimestamp: metafield(namespace: "custom", key: "last_submission_timestamp") {
          id type value compareDigest
        }
      }
    }
  `;
  const resp = await admin.graphql(query, { variables: { id: toOrderGid(orderId) } });
  const json = await resp.json();
  if (json.errors?.length) throw new Error(`Order query failed: ${JSON.stringify(json.errors)}`);
  const order = json?.data?.order;
  if (!order) throw new Error(`Order not found for ${orderId}`);
  return order;
}

async function updateOrderMetafields(order, admin, submission) {
  let currentSubmissions = [];
  if (order.metafield?.value) {
    try {
      const parsed = JSON.parse(order.metafield.value);
      currentSubmissions = Array.isArray(parsed) ? parsed : [];
    } catch { currentSubmissions = []; }
  }
  currentSubmissions.push(submission);
  if (currentSubmissions.length > 10) currentSubmissions = currentSubmissions.slice(-10);

  const metafields = [
    {
      ownerId: order.id,
      namespace: "custom",
      key: "link_submission",
      type: "json",
      value: JSON.stringify(currentSubmissions),
      ...(order.metafield?.compareDigest ? { compareDigest: order.metafield.compareDigest } : {}),
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

  const resp = await admin.graphql(`
    mutation SetOrderMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }
  `, { variables: { metafields } });

  const json = await resp.json();
  if (json.errors?.length) throw new Error(`metafieldsSet failed: ${JSON.stringify(json.errors)}`);
  const userErrors = json?.data?.metafieldsSet?.userErrors || [];
  if (userErrors.length) throw new Error(`metafieldsSet userErrors: ${JSON.stringify(userErrors)}`);
}

async function updateOrderNote(order, admin, latestTimestamp) {
  const noteText = buildLatestSubmissionNote(order.note, latestTimestamp);
  const resp = await admin.graphql(`
    mutation UpdateOrderNote($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id }
        userErrors { field message }
      }
    }
  `, { variables: { input: { id: order.id, note: noteText } } });

  const json = await resp.json();
  if (json.errors?.length) throw new Error(`orderUpdate failed: ${JSON.stringify(json.errors)}`);
  const userErrors = json?.data?.orderUpdate?.userErrors || [];
  if (userErrors.length) throw new Error(`orderUpdate userErrors: ${JSON.stringify(userErrors)}`);
}

// ── Action: processes one batch of entries ────────────────────────────────────

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

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const where = {
    createdAt: { gte: sevenDaysAgo },
    OR: [{ metafieldUpdated: false }, { noteUpdated: false }],
  };

  // Get total count + current batch in parallel
  const [total, batch] = await Promise.all([
    db.tikTokUrl.count({ where }),
    db.tikTokUrl.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: offset,
      take: BATCH_SIZE,
    }),
  ]);

  let successCount = 0;
  let failCount = 0;

  for (const entry of batch) {
    let metafieldUpdated = entry.metafieldUpdated;
    let metafieldError = entry.metafieldError;
    let noteUpdated = entry.noteUpdated;
    let noteError = entry.noteError;

    try {
      const admin = await getAdminClient(entry.shop);
      // Single order fetch — reuse for both metafield and note updates
      const order = await getOrderData(admin, entry.orderId);
      const savedAtGmt7 = toGmt7IsoString(entry.createdAt);

      // Backfill order name if it was missing (e.g. submitted from orders list page)
      const orderName = entry.orderName || order.name || null;

      if (!metafieldUpdated) {
        try {
          await updateOrderMetafields(order, admin, {
            url: entry.url,
            savedAt: savedAtGmt7,
            customerEmail: entry.customerEmail,
            orderId: entry.orderId,
            orderName,
            creatorHandle: entry.creatorHandle,
            postDate: entry.postDate ? toGmt7IsoString(entry.postDate) : null,
          });
          metafieldUpdated = true;
          metafieldError = null;
        } catch (e) {
          metafieldError = String(e);
        }
      }

      if (!noteUpdated) {
        try {
          await updateOrderNote(order, admin, savedAtGmt7);
          noteUpdated = true;
          noteError = null;
        } catch (e) {
          noteError = String(e);
        }
      }

      await db.tikTokUrl.update({
        where: { id: entry.id },
        data: { metafieldUpdated, metafieldError, noteUpdated, noteError, orderName },
      });

      if (metafieldUpdated && noteUpdated) successCount++;
      else failCount++;
    } catch (e) {
      failCount++;
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
