import db from "../db.server";
import shopify from "../shopify.server";

async function getOfflineAccessTokenForShop(shop) {
  const offlineSessionId = shopify.api.session.getOfflineId(shop);
  const session = await shopify.config.sessionStorage.loadSession(
    offlineSessionId,
  );

  if (!session?.accessToken) {
    throw new Error(`No offline access token found for shop: ${shop}`);
  }

  return session.accessToken;
}

function toOrderGid(orderId) {
  if (typeof orderId === "string" && orderId.startsWith("gid://")) {
    return orderId;
  }

  return `gid://shopify/Order/${orderId}`;
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
  const existingMetafield = order.metafield;

  if (existingMetafield?.value) {
    try {
      const parsed = JSON.parse(existingMetafield.value);
      currentSubmissions = Array.isArray(parsed) ? parsed : [];
    } catch {
      currentSubmissions = [];
    }
  }

  currentSubmissions.push(submission);

  const setMetafieldMutation = `
    mutation SetOrderLinkSubmission($metafields: [MetafieldsSetInput!]!) {
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

  const metafieldInput = {
    ownerId: order.id,
    namespace: "custom",
    key: "link_submission",
    type: "json",
    value: JSON.stringify(currentSubmissions),
  };

  if (existingMetafield?.compareDigest) {
    metafieldInput.compareDigest = existingMetafield.compareDigest;
  }

  const setResp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: setMetafieldMutation,
      variables: {
        metafields: [metafieldInput],
      },
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

  return setJson?.data?.metafieldsSet?.metafields?.[0] ?? null;
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
  // Add your LINE / webhook logic here later
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
            savedAt: saved.createdAt.toISOString(),
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
        createdAt: saved.createdAt,
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