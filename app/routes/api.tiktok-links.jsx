import db from "../db.server";
import { sessionStorage } from "../shopify.server";

async function getOfflineAccessTokenForShop(shop) {
  const sessions = await sessionStorage.findSessionsByShop(shop);
  const offlineSession = sessions.find((session) => session.isOnline === false);

  if (!offlineSession?.accessToken) {
    throw new Error(`No offline access token found for shop: ${shop}`);
  }

  return offlineSession.accessToken;
}

function toOrderGid(orderId) {
  if (typeof orderId === "string" && orderId.startsWith("gid://")) {
    return orderId;
  }

  return `gid://shopify/Order/${orderId}`;
}

function toGmt7IsoString(dateInput = new Date()) {
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

async function appendOrderLinkSubmissionMetafield({
  shop,
  accessToken,
  orderId,
  submission,
}) {
  const endpoint = `https://${shop}/admin/api/2026-04/graphql.json`;
  const orderGid = toOrderGid(orderId);

  const getOrderQuery = `
    query GetOrderLinkSubmission($id: ID!) {
      order(id: $id) {
        id
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

  const getResp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: getOrderQuery,
      variables: { id: orderGid },
    }),
  });

  const getJson = await getResp.json();

  if (getJson.errors?.length) {
    throw new Error(`Order query failed: ${JSON.stringify(getJson.errors)}`);
  }

  const order = getJson?.data?.order;

  if (!order) {
    throw new Error(`Order not found for ${orderGid}`);
  }

  let currentSubmissions = [];
  const existingLinkMetafield = order.metafield;
  const existingTimestampMetafield = order.lastSubmissionTimestamp;

  if (existingLinkMetafield?.value) {
    try {
      const parsed = JSON.parse(existingLinkMetafield.value);
      currentSubmissions = Array.isArray(parsed) ? parsed : [];
    } catch {
      currentSubmissions = [];
    }
  }

  currentSubmissions.push(submission);

  // Keep only the latest 5 entries
  if (currentSubmissions.length > 5) {
    currentSubmissions = currentSubmissions.slice(-5);
  }

  const latestTimestamp = submission.savedAt;

  const setMetafieldMutation = `
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

  const metafields = [
    {
      ownerId: order.id,
      namespace: "custom",
      key: "link_submission",
      type: "json",
      value: JSON.stringify(currentSubmissions),
      ...(existingLinkMetafield?.compareDigest
        ? { compareDigest: existingLinkMetafield.compareDigest }
        : {}),
    },
    {
      ownerId: order.id,
      namespace: "custom",
      key: "last_submission_timestamp",
      type: "date_time",
      value: latestTimestamp,
      ...(existingTimestampMetafield?.compareDigest
        ? { compareDigest: existingTimestampMetafield.compareDigest }
        : {}),
    },
  ];

  const setResp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: setMetafieldMutation,
      variables: { metafields },
    }),
  });

  const setJson = await setResp.json();

  if (setJson.errors?.length) {
    throw new Error(`metafieldsSet failed: ${JSON.stringify(setJson.errors)}`);
  }

  const userErrors = setJson?.data?.metafieldsSet?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error(
      `metafieldsSet userErrors: ${JSON.stringify(userErrors)}`,
    );
  }

  return setJson?.data?.metafieldsSet?.metafields ?? [];
}

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization",
  );

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

function isValidTikTokOrShopeeUrl(value) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();

    return (
      host === "tiktok.com" ||
      host.endsWith(".tiktok.com") ||
      host === "vt.tiktok.com" ||
      host === "shp.ee" ||
      host.endsWith(".shp.ee") ||
      host === "shopee.co.th" ||
      host.endsWith(".shopee.co.th")
    );
  } catch {
    return false;
  }
}

async function emitTikTokUrlSaved(payload) {
  console.log("Tiktokurlsaved", payload);
}

async function handleRequest(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Accept, Authorization",
      },
    });
  }

  if (request.method === "GET") {
    try {
      const url = new URL(request.url);
      const shop = url.searchParams.get("shop");
      const orderId = url.searchParams.get("orderId");

      if (!shop || !orderId) {
        return jsonResponse(
          { ok: false, error: "Missing shop or orderId" },
          { status: 400 },
        );
      }

      const links = await db.tikTokUrl.findMany({
        where: { shop, orderId },
        orderBy: { createdAt: "desc" },
      });

      return jsonResponse({ ok: true, links });
    } catch (error) {
      console.error("GET /api/tiktok-links failed:", error);
      return jsonResponse(
        { ok: false, error: "โหลดข้อมูลไม่สำเร็จ" },
        { status: 500 },
      );
    }
  }

  if (request.method === "POST") {
    try {
      const body = await request.json();
      console.log("POST /api/tiktok-links body =", body);

      const shop = typeof body?.shop === "string" ? body.shop : "";
      const orderId = typeof body?.orderId === "string" ? body.orderId : "";
      const orderName =
        typeof body?.orderName === "string" ? body.orderName : null;
      const customerEmail =
        typeof body?.customerEmail === "string" && body.customerEmail.trim()
          ? body.customerEmail.trim()
          : null;
      const rawUrl = typeof body?.url === "string" ? body.url : "";
      const cleanUrl = rawUrl.trim();

      if (!shop || !orderId || !cleanUrl) {
        return jsonResponse(
          { ok: false, error: "ข้อมูลไม่ครบ กรุณาลองใหม่อีกครั้ง" },
          { status: 400 },
        );
      }

      if (!isValidTikTokOrShopeeUrl(cleanUrl)) {
        return jsonResponse(
          {
            ok: false,
            error:
              "ลิงก์ไม่ถูกต้องหรือรูปแบบไม่ถูกต้อง กรุณาวางลิงก์ใหม่ ตรวจสอบอีกครั้ง แล้วคลิกบันทึกลิงก์",
          },
          { status: 400 },
        );
      }

      const saved = await db.tikTokUrl.create({
        data: {
          shop,
          orderId,
          orderName,
          customerEmail,
          url: cleanUrl,
        },
      });

      const savedAtGmt7 = toGmt7IsoString(saved.createdAt);

      let metafieldUpdated = false;
      let metafieldErrorMessage = null;

      try {
        const accessToken = await getOfflineAccessTokenForShop(shop);

        await appendOrderLinkSubmissionMetafield({
          shop,
          accessToken,
          orderId,
          submission: {
            url: saved.url,
            savedAt: savedAtGmt7,
            customerEmail,
            orderId,
            orderName,
          },
        });

        metafieldUpdated = true;
      } catch (metafieldError) {
        console.error("Metafield update failed:", metafieldError);
        metafieldErrorMessage = String(metafieldError);
      }

      await emitTikTokUrlSaved({
        id: saved.id,
        shop,
        orderId,
        orderName,
        customerEmail,
        url: saved.url,
        createdAt: savedAtGmt7,
      });

      const links = await db.tikTokUrl.findMany({
        where: { shop, orderId },
        orderBy: { createdAt: "desc" },
      });

      return jsonResponse({
        ok: true,
        saved,
        links,
        metafieldUpdated,
        metafieldErrorMessage,
      });
    } catch (error) {
      console.error("POST /api/tiktok-links failed:", error);
      return jsonResponse(
        {
          ok: false,
          error: "บันทึกลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
          details: String(error),
        },
        { status: 500 },
      );
    }
  }

  return jsonResponse(
    { ok: false, error: "Method not allowed" },
    { status: 405 },
  );
}

export async function loader({ request }) {
  return handleRequest(request);
}

export async function action({ request }) {
  return handleRequest(request);
}