import { getAdminClient } from "../lib/tiktok-submission.server";
import {
  fetchArmProfile,
  estimateRegistrationDate,
  addArmHandle,
  isValidHandleType,
} from "../lib/arm-client.server";

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
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization",
  );

  return new Response(JSON.stringify(data), { ...init, headers });
}

const CUSTOMER_FIELDS = `
  id
  email
  displayName
  firstName
  lastName
  lineUid: metafield(namespace: "custom", key: "line_uid") { value }
  gender: metafield(namespace: "custom", key: "gender") { id value compareDigest }
  dob: metafield(namespace: "custom", key: "dob") { id value compareDigest }
`;

async function getCustomerById(admin, customerId) {
  const resp = await admin.graphql(
    `#graphql
    query GetCustomerProfile($id: ID!) {
      customer(id: $id) { ${CUSTOMER_FIELDS} }
    }`,
    { variables: { id: toCustomerGid(customerId) } },
  );
  const json = await resp.json();
  if (json.errors?.length) {
    throw new Error(`Customer query failed: ${JSON.stringify(json.errors)}`);
  }
  return json?.data?.customer || null;
}

async function getCustomerByEmail(admin, email) {
  const resp = await admin.graphql(
    `#graphql
    query FindCustomerByEmail($query: String!) {
      customers(first: 1, query: $query) {
        nodes { ${CUSTOMER_FIELDS} }
      }
    }`,
    { variables: { query: `email:${email}` } },
  );
  const json = await resp.json();
  if (json.errors?.length) {
    throw new Error(`Customer search failed: ${JSON.stringify(json.errors)}`);
  }
  return json?.data?.customers?.nodes?.[0] || null;
}

async function resolveCustomer(admin, { customerId, customerEmail }) {
  if (customerId) return getCustomerById(admin, customerId);
  if (customerEmail) return getCustomerByEmail(admin, customerEmail);
  return null;
}

async function setCustomerMetafields(admin, customer, { gender, dob }) {
  const metafields = [];

  if (gender !== undefined) {
    metafields.push({
      ownerId: customer.id,
      namespace: "custom",
      key: "gender",
      type: "single_line_text_field",
      value: String(gender),
      ...(customer.gender?.compareDigest
        ? { compareDigest: customer.gender.compareDigest }
        : {}),
    });
  }

  if (dob !== undefined) {
    metafields.push({
      ownerId: customer.id,
      namespace: "custom",
      key: "dob",
      type: "date",
      value: String(dob),
      ...(customer.dob?.compareDigest
        ? { compareDigest: customer.dob.compareDigest }
        : {}),
    });
  }

  if (metafields.length === 0) return;

  const resp = await admin.graphql(
    `#graphql
    mutation SetCustomerMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    { variables: { metafields } },
  );
  const json = await resp.json();
  if (json.errors?.length) {
    throw new Error(`metafieldsSet failed: ${JSON.stringify(json.errors)}`);
  }
  const userErrors = json?.data?.metafieldsSet?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error(`metafieldsSet userErrors: ${JSON.stringify(userErrors)}`);
  }
}

function buildProfileResponse(customer, armProfile) {
  const lineUid = customer?.lineUid?.value || null;

  return {
    ok: true,
    identity: {
      name: customer?.displayName || null,
      email: customer?.email || null,
      gender: customer?.gender?.value || null,
      dob: customer?.dob?.value || null,
    },
    line: {
      connected: Boolean(lineUid),
    },
    program: {
      affiliateNumber: armProfile?.internal_id || null,
      registrationDate: estimateRegistrationDate(armProfile),
      registered: Boolean(armProfile),
    },
    handles: {
      tiktok: armProfile?.handles?.tiktok?.data || [],
      shopee: armProfile?.handles?.shopee?.data || [],
      lazada: armProfile?.handles?.lazada?.data || [],
      affiliate_plus: armProfile?.handles?.affiliate_plus?.data || [],
    },
  };
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

    const armProfile = await fetchArmProfile({
      lineUid: customer.lineUid?.value,
      email: customer.email,
    });

    return jsonResponse(buildProfileResponse(customer, armProfile));
  } catch (error) {
    console.error("GET /api/affiliate-profile failed:", error);
    return jsonResponse(
      { ok: false, error: "โหลดข้อมูลโปรไฟล์ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}

async function handlePost(request) {
  try {
    const body = await request.json();
    const shop = typeof body?.shop === "string" ? body.shop : "";
    const customerId = typeof body?.customerId === "string" ? body.customerId : "";

    if (!shop || !customerId) {
      return jsonResponse(
        { ok: false, error: "ข้อมูลไม่ครบ กรุณาลองใหม่อีกครั้ง" },
        { status: 400 },
      );
    }

    const admin = await getAdminClient(shop);
    const customer = await resolveCustomer(admin, { customerId });

    if (!customer) {
      return jsonResponse({ ok: false, error: "ไม่พบข้อมูลลูกค้า" }, { status: 404 });
    }

    // Reject any attempt to write ARM-computed fields directly — they only
    // ever come from ARM, never from a client-supplied value.
    const gender = typeof body?.gender === "string" ? body.gender : undefined;
    const dob = typeof body?.dob === "string" ? body.dob : undefined;

    if (gender !== undefined || dob !== undefined) {
      await setCustomerMetafields(admin, customer, { gender, dob });
    }

    let handleResult = null;
    if (body?.addHandle && typeof body.addHandle === "object") {
      const { type, value } = body.addHandle;
      if (!isValidHandleType(type) || typeof value !== "string" || !value.trim()) {
        return jsonResponse(
          { ok: false, error: "ข้อมูลบัญชีที่ต้องการเพิ่มไม่ถูกต้อง" },
          { status: 400 },
        );
      }
      handleResult = await addArmHandle({
        lineUid: customer.lineUid?.value,
        handleType: type,
        handleValue: value.trim(),
      });
      if (!handleResult.ok) {
        return jsonResponse(
          { ok: false, error: handleResult.message || "เพิ่มบัญชีไม่สำเร็จ" },
          { status: 409 },
        );
      }
    }

    // Re-resolve so the response reflects what was just written.
    const refreshedCustomer = await getCustomerById(admin, customer.id);
    const armProfile = await fetchArmProfile({
      lineUid: refreshedCustomer.lineUid?.value,
      email: refreshedCustomer.email,
    });

    return jsonResponse(buildProfileResponse(refreshedCustomer, armProfile));
  } catch (error) {
    console.error("POST /api/affiliate-profile failed:", error);
    return jsonResponse(
      { ok: false, error: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", details: String(error) },
      { status: 500 },
    );
  }
}

async function handleRequest(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
      },
    });
  }

  if (request.method === "GET") return handleGet(request);
  if (request.method === "POST") return handlePost(request);

  return jsonResponse({ ok: false, error: "Method not allowed" }, { status: 405 });
}

export async function loader({ request }) {
  return handleRequest(request);
}

export async function action({ request }) {
  return handleRequest(request);
}
