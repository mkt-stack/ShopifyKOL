import db from "../db.server";
import { getAdminClient } from "../lib/tiktok-submission.server";

function toCustomerGid(customerId) {
  if (typeof customerId === "string" && customerId.startsWith("gid://")) {
    return customerId;
  }
  return `gid://shopify/Customer/${customerId}`;
}

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization",
  );

  return new Response(JSON.stringify(data), { ...init, headers });
}

// Always resolves both id and email — our own DB (TikTokUrl) is keyed by
// email, not Shopify customer id, so the caller needs both regardless of
// which identifier the extension happened to send.
async function resolveCustomer(admin, { customerId, customerEmail }) {
  if (customerId) {
    const resp = await admin.graphql(
      `#graphql
      query GetCustomerEmail($id: ID!) {
        customer(id: $id) { id email }
      }`,
      { variables: { id: toCustomerGid(customerId) } },
    );
    const json = await resp.json();
    const customer = json?.data?.customer;
    return customer ? { id: customer.id, email: customer.email } : null;
  }

  const resp = await admin.graphql(
    `#graphql
    query FindCustomerByEmail($query: String!) {
      customers(first: 1, query: $query) { nodes { id email } }
    }`,
    { variables: { query: `email:${customerEmail}` } },
  );
  const json = await resp.json();
  const customer = json?.data?.customers?.nodes?.[0];
  return customer ? { id: customer.id, email: customer.email } : null;
}

// Lifetime store credit "earned" = sum of every `credit`-type transaction,
// not the current balance (confirmed with the user — spent credit still
// counts as earned). Store credit access requires a scope this app doesn't
// have yet as of writing this route; this degrades to null (not a thrown
// error) so the rest of the page still renders once that's approved.
async function getLifetimeStoreCredit(admin, customerGid) {
  const resp = await admin.graphql(
    `#graphql
    query CustomerStoreCredit($id: ID!, $after: String) {
      customer(id: $id) {
        storeCreditAccounts(first: 5) {
          nodes {
            balance { currencyCode }
            transactions(first: 250, after: $after, query: "type:credit") {
              nodes {
                ... on StoreCreditAccountCreditTransaction {
                  amount { amount currencyCode }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    }`,
    { variables: { id: customerGid } },
  );

  const json = await resp.json();
  if (json.errors?.length) {
    console.error("Store credit query failed:", json.errors);
    return null;
  }

  const accounts = json?.data?.customer?.storeCreditAccounts?.nodes || [];
  const totalsByCurrency = {};

  for (const account of accounts) {
    for (const tx of account.transactions?.nodes || []) {
      const amount = Number(tx?.amount?.amount || 0);
      const currency = tx?.amount?.currencyCode || account.balance?.currencyCode;
      if (!currency) continue;
      totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + amount;
    }
    // Note: only the first page (250) of each account's credit transactions
    // is summed. Pagination via pageInfo.hasNextPage can be added if any
    // real account turns out to exceed that — unlikely for a sample/KOL
    // reward program, flagging rather than over-building for it up front.
  }

  return totalsByCurrency;
}

const RECEIVE_TAGS = ["CONFIRM-RECEIVE", "MANUAL-RECEIVE", "AUTO-RECEIVE"];

// Classifies one order into the affiliate-progress pipeline. All 4
// tags/statuses this reads are applied by systems outside this app — see
// the plan doc for exactly which. This is a linear funnel, checked in this
// order, first match wins.
function classifyOrderStage(order) {
  const tags = new Set((order.tags || []).map((t) => t.toUpperCase()));

  if (tags.has("VIDEO-SUBMITTED")) return "submittedVideo";
  if (RECEIVE_TAGS.some((t) => tags.has(t))) return "pendingSubmission";
  if (order.displayFulfillmentStatus === "FULFILLED") return "inTransit";
  if (
    order.displayFinancialStatus === "PAID" &&
    order.displayFulfillmentStatus === "UNFULFILLED"
  ) {
    return "completed";
  }

  return null; // doesn't fit any defined bucket (e.g. cancelled/refunded) — not counted
}

async function getOrdersSummary(admin, customerGid) {
  let after = null;
  let hasNextPage = true;
  let totalValue = 0;
  let totalQuantity = 0;
  const pipeline = {
    completed: 0,
    inTransit: 0,
    pendingSubmission: 0,
    submittedVideo: 0,
  };

  while (hasNextPage) {
    const resp = await admin.graphql(
      `#graphql
      query CustomerOrders($id: ID!, $after: String) {
        customer(id: $id) {
          orders(first: 100, after: $after, sortKey: CREATED_AT) {
            nodes {
              totalPriceSet { shopMoney { amount } }
              lineItems(first: 25) { nodes { quantity } }
              tags
              displayFinancialStatus
              displayFulfillmentStatus
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { variables: { id: customerGid, after } },
    );

    const json = await resp.json();
    if (json.errors?.length) {
      throw new Error(`Customer orders query failed: ${JSON.stringify(json.errors)}`);
    }

    const orders = json?.data?.customer?.orders;
    for (const order of orders?.nodes || []) {
      totalValue += Number(order.totalPriceSet?.shopMoney?.amount || 0);
      for (const item of order.lineItems?.nodes || []) {
        totalQuantity += item.quantity || 0;
      }

      const stage = classifyOrderStage(order);
      if (stage) pipeline[stage] += 1;
    }

    hasNextPage = Boolean(orders?.pageInfo?.hasNextPage);
    after = orders?.pageInfo?.endCursor || null;
  }

  return { totalValue, totalQuantity, pipeline };
}

async function handleGet(request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const customerId = url.searchParams.get("customerId");
  const customerEmail = url.searchParams.get("customerEmail");

  if (!shop || (!customerId && !customerEmail)) {
    return jsonResponse(
      { ok: false, error: "Missing shop or customer identifier" },
      { status: 400 },
    );
  }

  try {
    const admin = await getAdminClient(shop);
    const customer = await resolveCustomer(admin, { customerId, customerEmail });

    if (!customer) {
      return jsonResponse({ ok: false, error: "ไม่พบข้อมูลลูกค้า" }, { status: 404 });
    }

    const [storeCredit, ordersSummary, videosSubmitted] = await Promise.all([
      getLifetimeStoreCredit(admin, customer.id).catch((error) => {
        console.error("Store credit lookup failed:", error);
        return null;
      }),
      getOrdersSummary(admin, customer.id),
      db.tikTokUrl.count({
        where: {
          shop,
          customerEmail: customer.email,
          metafieldUpdated: true,
        },
      }),
    ]);

    return jsonResponse({
      ok: true,
      totalCreditEarned: storeCredit, // { [currencyCode]: amount } or null if unavailable
      totalSampleValue: ordersSummary.totalValue,
      totalSampleQuantity: ordersSummary.totalQuantity,
      videosSubmitted,
      pipeline: ordersSummary.pipeline,
    });
  } catch (error) {
    console.error("GET /api/affiliate-progress failed:", error);
    return jsonResponse(
      { ok: false, error: "โหลดข้อมูลความคืบหน้าไม่สำเร็จ" },
      { status: 500 },
    );
  }
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
      },
    });
  }

  return handleGet(request);
}
