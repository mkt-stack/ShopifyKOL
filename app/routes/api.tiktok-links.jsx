import db from "../db.server";
import {
  toGmt7IsoString,
  getAdminClient,
  getOrderData,
  updateOrderMetafields,
  updateOrderNote,
  buildFlowTriggerPayload,
  triggerLinkSubmissionFlow,
  getBangkokDayBoundsUtc,
  checkTikTokHandleOwnership,
} from "../lib/tiktok-submission.server";
import { getShopSettings } from "../lib/shop-settings.server";

const MAX_LINKS_PER_ORDER = 10;

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

// Returns "tiktok", "shopee", or null if the URL doesn't match either
// platform's accepted hostnames. This is the single source of truth for
// URL format acceptance on this route (per-platform on/off toggles are
// applied separately via ShopSettings, after format is confirmed valid).
function detectSubmissionPlatform(value) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();

    if (
      host === "tiktok.com" ||
      host.endsWith(".tiktok.com") ||
      host === "vt.tiktok.com" ||
      host === "tt.site" ||
      host.endsWith(".tt.site")
    ) {
      return "tiktok";
    }

    if (
      host === "shp.ee" ||
      host.endsWith(".shp.ee") ||
      host === "shopee.co.th" ||
      host.endsWith(".shopee.co.th")
    ) {
      return "shopee";
    }

    return null;
  } catch {
    return null;
  }
}

async function emitTikTokUrlSaved(payload) {
  console.log("Tiktokurlsaved", payload);
}

// Only video pages count — profile (/@handle), live (/@handle/live), photo
// posts, shop pages etc. return null and are rejected by the caller. The
// handle can be blank: some share links redirect to /@/video/<id>.
const TIKTOK_VIDEO_PATH_PATTERNS = [
  /^\/@([^/?#]*)\/video\/(\d+)\/?$/,
  /^\/(?:v|share\/video|embed\/v2|embed)\/(\d+)(?:\.html)?\/?$/,
];

function parseTikTokVideoInfo(url) {
  if (!url) return null;
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.toLowerCase();
    if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) return null;

    const [withHandle, withoutHandle] = TIKTOK_VIDEO_PATH_PATTERNS;
    let match = pathname.match(withHandle);
    if (match) return { creatorHandle: match[1] || null, videoId: match[2] };
    match = pathname.match(withoutHandle);
    if (match) return { creatorHandle: null, videoId: match[1] };
    return null;
  } catch {
    return null;
  }
}

// Share links (vt.tiktok.com/xxx, vm.tiktok.com/xxx, tiktok.com/t/xxx,
// tt.site/t/xxx) only reveal what they point to after following their
// redirects.
function isTikTokShortLink(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.toLowerCase();
    return (
      host === "vt.tiktok.com" ||
      host === "vm.tiktok.com" ||
      host === "tt.site" ||
      host.endsWith(".tt.site") ||
      /^\/t\/[^/]+\/?$/.test(pathname)
    );
  } catch {
    return false;
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

// Returns { status: "video", videoInfo } for a TikTok video link,
// { status: "not_video" } for any other TikTok page, or
// { status: "unverified" } when a short link couldn't be resolved.
async function resolveTikTokVideoInfo(inputUrl) {
  // Full video URL — no resolution needed
  const direct = parseTikTokVideoInfo(inputUrl);
  if (direct) return { status: "video", videoInfo: direct };

  if (!isTikTokShortLink(inputUrl)) return { status: "not_video" };

  // Short URL — walk the redirect chain hop by hop, since TikTok may bounce
  // a video through further redirects (e.g. a login wall) after the first one
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    let currentUrl = inputUrl;
    for (let hop = 0; hop < 5; hop++) {
      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      try { response.body?.cancel(); } catch {}

      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        return { status: response.ok ? "not_video" : "unverified" };
      }

      currentUrl = new URL(location, currentUrl).toString();
      const videoInfo = parseTikTokVideoInfo(currentUrl);
      if (videoInfo) return { status: "video", videoInfo };
    }
    return { status: "not_video" };
  } catch {
    return { status: "unverified" };
  } finally {
    clearTimeout(timeoutId);
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
      const [links, shopSettings] = await Promise.all([
        db.tikTokUrl.findMany({
          where: {
            shop,
            orderId,
            metafieldUpdated: true,
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        getShopSettings(shop),
      ]);

      // Lets the extensions word their heading/label/placeholder for only
      // the platforms currently accepting links.
      const platforms = {
        tiktok: shopSettings.tiktokEnabled,
        shopee: shopSettings.shopeeEnabled,
      };

      return jsonResponse({ ok: true, links, platforms });
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

      const platform = detectSubmissionPlatform(cleanUrl);

      if (!platform) {
        return jsonResponse(
          {
            ok: false,
            error:
              "ลิงก์ไม่ถูกต้องหรือรูปแบบไม่ถูกต้อง กรุณาวางลิงก์ใหม่ ตรวจสอบอีกครั้ง แล้วคลิกส่งลิงก์",
          },
          { status: 400 },
        );
      }

      const shopSettings = await getShopSettings(shop);

      if (platform === "tiktok" && !shopSettings.tiktokEnabled) {
        return jsonResponse(
          {
            ok: false,
            error: "ขณะนี้ปิดรับลิงก์ TikTok ชั่วคราว กรุณาติดต่อแอดมิน",
          },
          { status: 403 },
        );
      }

      if (platform === "shopee" && !shopSettings.shopeeEnabled) {
        return jsonResponse(
          {
            ok: false,
            error: "ขณะนี้ปิดรับลิงก์ Shopee ชั่วคราว กรุณาติดต่อแอดมิน",
          },
          { status: 403 },
        );
      }

      // Resolve TikTok video info (short links resolve to a canonical video ID)
      // and validate post is within 30 days
      let creatorHandle = null;
      let postDate = null;
      let videoId = null;

      if (platform === "tiktok") {
        const resolved = await resolveTikTokVideoInfo(cleanUrl);

        if (resolved.status === "not_video") {
          return jsonResponse(
            {
              ok: false,
              error:
                "ลิงก์นี้ไม่ใช่ลิงก์วิดีโอ TikTok กรุณาส่งลิงก์ของวิดีโอเท่านั้น (ไม่รับลิงก์โปรไฟล์ ไลฟ์ หรือหน้าอื่นๆ)",
            },
            { status: 422 },
          );
        }

        if (resolved.status === "unverified") {
          return jsonResponse(
            {
              ok: false,
              error:
                "ไม่สามารถตรวจสอบลิงก์ TikTok ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือวางลิงก์วิดีโอแบบเต็ม (tiktok.com/@ชื่อ/video/...)",
            },
            { status: 503 },
          );
        }

        const { videoInfo } = resolved;
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

      // Cap the number of successful links a single customer can submit
      // across ALL their orders per Bangkok calendar day (admin-configurable,
      // off by default). Identity is resolved from the order itself (the
      // checkout contact email, or its linked Shopify customer) rather than
      // trusting the client, since that's always present for a completed
      // order even for guest checkouts.
      let orderAdmin = null;
      let orderData = null;

      if (shopSettings.dailyLimitEnabled) {
        let dailyLimitEmail = null;
        try {
          orderAdmin = await getAdminClient(shop);
          orderData = await getOrderData(orderAdmin, orderId);
          dailyLimitEmail =
            orderData?.email ||
            orderData?.customer?.email ||
            customerEmail ||
            null;
        } catch (error) {
          console.error("Daily limit: order lookup failed:", error);
          dailyLimitEmail = customerEmail || null;
        }

        if (!dailyLimitEmail) {
          return jsonResponse(
            {
              ok: false,
              error:
                "ไม่สามารถตรวจสอบโควต้ารายวันของคุณได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือติดต่อแอดมิน",
            },
            { status: 503 },
          );
        }

        const { startUtc, endUtc } = getBangkokDayBoundsUtc();
        const submittedToday = await db.tikTokUrl.count({
          where: {
            shop,
            customerEmail: dailyLimitEmail,
            metafieldUpdated: true,
            createdAt: { gte: startUtc, lt: endUtc },
          },
        });

        if (submittedToday >= shopSettings.dailyLimit) {
          return jsonResponse(
            {
              ok: false,
              error: `คุณส่งลิงก์ครบโควต้ารายวัน (${shopSettings.dailyLimit} ลิงก์) แล้ว กรุณาลองใหม่ในวันถัดไป`,
            },
            { status: 429 },
          );
        }
      }

      // Only accept TikTok videos posted from a handle the order's customer
      // has registered in ARM (admin-configurable, off by default). Identity
      // comes from the order, same as the daily limit above, never from the
      // client.
      if (platform === "tiktok" && shopSettings.requireRegisteredTiktokHandle) {
        let rejection = null;
        try {
          orderAdmin = orderAdmin || (await getAdminClient(shop));
          orderData = orderData || (await getOrderData(orderAdmin, orderId));
          rejection = await checkTikTokHandleOwnership({
            order: orderData,
            creatorHandle,
          });
        } catch (error) {
          console.error("Handle check: order lookup failed:", error);
          rejection = {
            status: 503,
            reason: "order_lookup_failed",
            error:
              "ไม่สามารถตรวจสอบบัญชี TikTok ของคุณได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือติดต่อแอดมิน",
          };
        }

        if (rejection) {
          console.log("Handle check rejected:", {
            orderId,
            creatorHandle,
            videoId,
            reason: rejection.reason,
          });
          return jsonResponse(
            { ok: false, error: rejection.error },
            { status: rejection.status },
          );
        }
      }

      // Cap the number of successfully accepted links per order
      // (an admin can raise this per-order via the Order Quota page)
      const [successfulCount, latestQuotaAdjustment] = await Promise.all([
        db.tikTokUrl.count({
          where: { shop, orderId, metafieldUpdated: true },
        }),
        db.orderQuotaAdjustment.findFirst({
          where: { shop, orderId },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      const effectiveMaxLinks =
        latestQuotaAdjustment?.newTotalQuota ?? MAX_LINKS_PER_ORDER;

      if (successfulCount >= effectiveMaxLinks) {
        return jsonResponse(
          {
            ok: false,
            error: `คุณส่งลิงก์ครบ ${effectiveMaxLinks} ลิงก์สำหรับออเดอร์นี้แล้ว ไม่สามารถส่งเพิ่มได้`,
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
      let flowTriggered = false;
      let flowTriggerError = null;
      let resolvedOrderName = orderName;
      let resolvedCustomerName = customerName;
      let resolvedCustomerEmail = customerEmail;

      try {
        // Reuse the order lookup an earlier check already did this
        // request, if any, instead of fetching it twice.
        const admin = orderAdmin || (await getAdminClient(shop));
        const order = orderData || (await getOrderData(admin, orderId));

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
        const orderCustomerEmail = order.customer?.email || order.email || null;

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

        if (metafieldUpdated) {
          try {
            const flowPayload = buildFlowTriggerPayload({
              order,
              submission: saved,
              resolvedOrderName,
              resolvedCustomerName,
              resolvedCustomerEmail,
              savedAtGmt7,
              submissionNumber: successfulCount + 1,
            });
            await triggerLinkSubmissionFlow(admin, flowPayload);
            flowTriggered = true;
          } catch (error) {
            console.error("Flow trigger failed:", error);
            flowTriggerError = String(error);
          }
        }

        if (metafieldUpdated) {
          try {
            await updateOrderNote(order, admin, savedAtGmt7);
            noteUpdated = true;
          } catch (error) {
            console.error("Note update failed:", error);
            noteError = String(error);
          }
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
          flowTriggered,
          flowTriggerError,
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
        flowTriggered,
        flowTriggerError,
      });

      // The metafield is what makes a submission count (everything else
      // filters on metafieldUpdated), so without it the link wasn't accepted.
      if (!metafieldUpdated) {
        return jsonResponse(
          { ok: false, error: "บันทึกลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
          { status: 502 },
        );
      }

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
          flowTriggered,
          flowTriggerError,
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