import { authenticate, unauthenticated } from "../shopify.server";
import {
  formatDate,
  getCustomerStatus,
  getWeeklyLimitSettings,
  renderMessage,
  resolveMessages,
} from "../lib/weekly-limit.server";

// GET /api/weekly-limit?lang=th|en, called by the checkout widget
// (extensions/weekly-order-limit-widget) with its session token. The
// token's `sub` is the logged-in customer; it is absent for guests.
// Returns { state: "hidden" | "login" | "ok" | "full", title?, left?, message?,
// last?, limit?, count?, remaining?, date? } with text already rendered.
export async function loader({ request }) {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const json = (data, status = 200) =>
    cors(
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );

  try {
    const shop = String(sessionToken.dest || "").replace(/^https?:\/\//, "");
    const lang = new URL(request.url).searchParams.get("lang") === "th" ? "th" : "en";
    const settings = await getWeeklyLimitSettings(shop);
    if (!settings.enabled) return json({ state: "hidden" });

    const messages = resolveMessages(settings.messages)[lang];
    const customerGid = sessionToken.sub;
    if (!customerGid) {
      return json({ state: "login", title: messages.loginTitle, message: messages.login });
    }

    const { admin } = await unauthenticated.admin(shop);
    const status = await getCustomerStatus(admin, shop, customerGid, settings);
    if (!status || status.state === "exempt") return json({ state: "hidden" });

    const vars = {
      limit: status.limit,
      count: status.count,
      remaining: status.remaining,
      date: formatDate(status.nextWeek, lang),
    };
    if (status.state === "full") {
      return json({
        state: "full",
        title: renderMessage(messages.fullTitle, vars),
        message: renderMessage(messages.full, vars),
        ...vars,
      });
    }
    return json({
      state: "ok",
      title: renderMessage(messages.title, vars),
      left: renderMessage(messages.left, vars),
      message: renderMessage(status.remaining === 1 ? messages.last : messages.ok, vars),
      last: status.remaining === 1,
      ...vars,
    });
  } catch (error) {
    console.error("GET /api/weekly-limit failed:", error);
    return json({ state: "hidden", error: "status unavailable" }, 500);
  }
}

// CORS preflight (OPTIONS) is answered inside authenticate.public.checkout.
export const action = loader;
