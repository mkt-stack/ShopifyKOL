import db from "../db.server";
import { unauthenticated } from "../shopify.server";

const MAX_LINKS_PER_ORDER = 10;

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

function buildLatestSubmissionNote(existingNote, latestTimestamp) {
  const marker = "Latest link submitted at (GMT+7):";
  const newLine = `${marker} ${latestTimestamp}`;

  if (!existingNote || !existingNote.trim()) {
    return newLine;
  }

  const lines = existingNote.split("\n");
  const filtered = lines.filter((line) => !line.trim().startsWith(marker));

  return [...filtered, newLine].join("\n").trim();
}

async function getAdminClient(shop) {
  const auth = await unauthenticated.admin(shop);

  if (!auth?.admin) {
    throw new Error(`Could not create admin client for shop: ${shop}`);
  }

  return auth.admin;
}

async function getOrderData(admin, orderId) {
  const orderGid = toOrderGid(orderId);

  const query = `
    query GetOrderData($id: ID!) {
      order(id: $id) {
        id
        name
        note
        customer {
          email
          displayName
          firstName
          lastName
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

async function updateOrderMetafields(order, admin, submission) {
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

async function updateOrderNote(order, admin, latestTimestamp) {
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

async function emitTikTokUrlSaved(payload) {
  console.log("Tiktokurlsaved", payload);
}

function isTikTokUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

function parseTikTokVideoInfo(url) {
  if (!url) return null;
  try {
    const match = new URL(url).pathname.match(/\/@([^/?#]+)\/video\/(\d+)/);
    if (!match) return null;
    return { creatorHandle: match[1], videoId: match[2] };
  } catch {
    return null;
  }
}

function estimatePostDateFromVideoId(videoId) {
  try {
    const timestamp = Number(BigInt(videoId) >> 32n);
    if (timestamp < 1_000_000_000 || timestamp > 9_999_999_999) return null;
    return new Date(timestamp * 1000);
  } catch {
    return null;
  }
}

async function resolveTikTokVideoInfo(inputUrl) {
  // Full video URL — no resolution needed
  const direct = parseTikTokVideoInfo(inputUrl);
  if (direct) return direct;

  // Short URL (vt.tiktok.com) — follow redirects to get canonical URL
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(inputUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeoutId);
    try { response.body?.cancel(); } catch {}
    return parseTikTokVideoInfo(response.url);
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
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

      // customer-facing pages show only successful historical submissions
      const links = await db.tikTokUrl.findMany({
        where: {
          shop,
          orderId,
          metafieldUpdated: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
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
        typeof body?.orderName === "string" && body.orderName.trim()
          ? body.orderName.trim()
          : null;
      const customerName =
        typeof body?.customerName === "string" && body.customerName.trim()
          ? body.customerName.trim()
          : null;
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
              "ลิงก์ไม่ถูกต้องหรือรูปแบบไม่ถูกต้อง กรุณาวางลิงก์ใหม่ ตรวจสอบอีกครั้ง แล้วคลิกส่งลิงก์",
          },
          { status: 400 },
        );
      }

      // Resolve TikTok video info (short links resolve to a canonical video ID)
      // and validate post is within 30 days
      let creatorHandle = null;
      let postDate = null;
      let videoId = null;

      if (isTikTokUrl(cleanUrl)) {
        const videoInfo = await resolveTikTokVideoInfo(cleanUrl);
        if (videoInfo) {
          creatorHandle = videoInfo.creatorHandle;
          videoId = videoInfo.videoId;
          const estimated = estimatePostDateFromVideoId(videoInfo.videoId);
          if (estimated) {
            postDate = estimated;
            const ageInDays = (Date.now() - estimated.getTime()) / 86_400_000;
            if (ageInDays > 30) {
              return jsonResponse(
                {
                  ok: false,
                  error:
                    "กรุณาแปะลิ้งของ post ใหม่ที่พึ่ง post ไม่เกิน 30 วันเท่านั้น หากมีข้อสงสัยกรุณาอ่าน FAQ หรือติดต่อ admin",
                },
                { status: 422 },
              );
            }
          }
        }
      }

      // Only block if a SUCCESSFUL submission already exists for this video
      // (TikTok short links generate a different URL every time you copy them,
      // so dedupe by the resolved video ID; fall back to exact URL match for
      // non-TikTok links or TikTok links whose video ID couldn't be resolved)
      const duplicate = videoId
        ? await db.tikTokUrl.findFirst({
            where: { videoId, metafieldUpdated: true },
          })
        : await db.tikTokUrl.findFirst({
            where: { url: cleanUrl, metafieldUpdated: true },
          });

      if (duplicate) {
        return jsonResponse(
          {
            ok: false,
            error: "ลิงก์นี้เคยถูกส่งไปแล้ว ไม่สามารถส่งลิงก์ซ้ำได้",
          },
          { status: 409 },
        );
      }

      // Cap the number of successfully accepted links per order
      const successfulCount = await db.tikTokUrl.count({
        where: { shop, orderId, metafieldUpdated: true },
      });

      if (successfulCount >= MAX_LINKS_PER_ORDER) {
        return jsonResponse(
          {
            ok: false,
            error: `คุณส่งลิงก์ครบ ${MAX_LINKS_PER_ORDER} ลิงก์สำหรับออเดอร์นี้แล้ว ไม่สามารถส่งเพิ่มได้`,
          },
          { status: 409 },
        );
      }

      const saved = await db.tikTokUrl.create({
        data: {
          shop,
          orderId,
          orderName,
          customerName,
          customerEmail,
          url: cleanUrl,
          videoId,
          creatorHandle,
          postDate,
        },
      });

      const savedAtGmt7 = toGmt7IsoString(saved.createdAt);

      let metafieldUpdated = false;
      let metafieldError = null;
      let noteUpdated = false;
      let noteError = null;
      let resolvedOrderName = orderName;
      let resolvedCustomerName = customerName;
      let resolvedCustomerEmail = customerEmail;

      try {
        const admin = await getAdminClient(shop);
        const order = await getOrderData(admin, orderId);

        // Backfill orderName from Shopify if not provided by the client
        if (!resolvedOrderName && order.name) {
          resolvedOrderName = order.name;
          await db.tikTokUrl.update({
            where: { id: saved.id },
            data: { orderName: resolvedOrderName },
          });
        }

        // Backfill customer name/email from the order's customer if the
        // client couldn't provide them (e.g. guest/unauthenticated checkout)
        const orderCustomerName =
          order.customer?.displayName ||
          [order.customer?.firstName, order.customer?.lastName]
            .filter(Boolean)
            .join(" ") ||
          null;
        const orderCustomerEmail = order.customer?.email || null;

        if (!resolvedCustomerName || !resolvedCustomerEmail) {
          resolvedCustomerName = resolvedCustomerName || orderCustomerName;
          resolvedCustomerEmail = resolvedCustomerEmail || orderCustomerEmail;

          if (resolvedCustomerName || resolvedCustomerEmail) {
            await db.tikTokUrl.update({
              where: { id: saved.id },
              data: {
                customerName: resolvedCustomerName,
                customerEmail: resolvedCustomerEmail,
              },
            });
          }
        }

        try {
          await updateOrderMetafields(order, admin, {
            url: saved.url,
            savedAt: savedAtGmt7,
            customerEmail: resolvedCustomerEmail,
            orderId,
            orderName: resolvedOrderName,
            creatorHandle,
            postDate: postDate ? toGmt7IsoString(postDate) : null,
          });
          metafieldUpdated = true;
        } catch (error) {
          console.error("Metafield update failed:", error);
          metafieldError = String(error);
        }

        try {
          await updateOrderNote(order, admin, savedAtGmt7);
          noteUpdated = true;
        } catch (error) {
          console.error("Note update failed:", error);
          noteError = String(error);
        }
      } catch (error) {
        console.error("Order/admin lookup failed:", error);
        const sharedError = String(error);
        metafieldError = sharedError;
        noteError = sharedError;
      }

      await db.tikTokUrl.update({
        where: { id: saved.id },
        data: {
          metafieldUpdated,
          metafieldError,
          noteUpdated,
          noteError,
        },
      });

      await emitTikTokUrlSaved({
        id: saved.id,
        shop,
        orderId,
        orderName: resolvedOrderName,
        customerName: resolvedCustomerName,
        customerEmail: resolvedCustomerEmail,
        url: saved.url,
        createdAt: savedAtGmt7,
        metafieldUpdated,
        metafieldError,
        noteUpdated,
        noteError,
      });

      const links = await db.tikTokUrl.findMany({
        where: {
          shop,
          orderId,
          metafieldUpdated: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      return jsonResponse({
        ok: true,
        saved: {
          ...saved,
          customerName: resolvedCustomerName,
          customerEmail: resolvedCustomerEmail,
          orderName: resolvedOrderName,
          savedAt: savedAtGmt7,
          metafieldUpdated,
          metafieldError,
          noteUpdated,
          noteError,
        },
        links,
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