import db from "../db.server";
import {
  toGmt7IsoString,
  getAdminClient,
  getOrderData,
  updateOrderMetafields,
  updateOrderNote,
  buildFlowTriggerPayload,
  triggerLinkSubmissionFlow,
} from "../lib/tiktok-submission.server";

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
    OR: [
      { metafieldUpdated: false },
      { noteUpdated: false },
      { metafieldUpdated: true, flowTriggered: false },
    ],
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
    let flowTriggered = entry.flowTriggered;
    let flowTriggerError = entry.flowTriggerError;

    try {
      const admin = await getAdminClient(entry.shop);
      // Single order fetch — reuse for the metafield, flow trigger, and note updates
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

      if (metafieldUpdated && !flowTriggered) {
        try {
          const flowPayload = buildFlowTriggerPayload({
            order,
            submission: entry,
            resolvedOrderName: orderName,
            resolvedCustomerName: entry.customerName,
            resolvedCustomerEmail: entry.customerEmail,
            savedAtGmt7,
          });
          await triggerLinkSubmissionFlow(admin, flowPayload);
          flowTriggered = true;
          flowTriggerError = null;
        } catch (e) {
          flowTriggerError = String(e);
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
        data: {
          metafieldUpdated,
          metafieldError,
          noteUpdated,
          noteError,
          flowTriggered,
          flowTriggerError,
          orderName,
        },
      });

      if (metafieldUpdated && noteUpdated && flowTriggered) successCount++;
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
