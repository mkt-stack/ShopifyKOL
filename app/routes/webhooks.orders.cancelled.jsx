import { authenticate } from "../shopify.server";
import { orderFromWebhook, recountCustomer } from "../lib/weekly-limit.server";

// Weekly order limit: an order counts once it is paid, and stops counting
// when cancelled. Either way the customer's weekly count is rebuilt
// (app/lib/weekly-limit.server.js). Counting runs even while the rule is
// off, so turning it on mid-week starts from the right numbers.
export const action = async ({ request }) => {
  const { payload, session, admin, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!session || !admin) {
    return new Response();
  }

  const customerGid =
    payload.customer?.admin_graphql_api_id ||
    (payload.customer?.id ? `gid://shopify/Customer/${payload.customer.id}` : null);
  if (!customerGid) {
    return new Response();
  }

  try {
    const value = await recountCustomer(admin, shop, customerGid, orderFromWebhook(payload));
    console.log(`Weekly order count for ${customerGid}: ${JSON.stringify(value)}`);
  } catch (error) {
    // Returning 500 makes Shopify retry the webhook; the recount is idempotent.
    console.error(`Weekly order recount failed for ${customerGid} (${topic}):`, error);
    return new Response(null, { status: 500 });
  }

  return new Response();
};
