import { useLoaderData, useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const BASE_MAX_LINKS_PER_ORDER = 10;

function toOrderGid(orderId) {
  if (typeof orderId === "string" && orderId.startsWith("gid://")) {
    return orderId;
  }
  return `gid://shopify/Order/${orderId}`;
}

function normalizeOrderName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function parseOrderNames(value) {
  const parts = String(value || "")
    .split(/[\s,]+/)
    .map((part) => normalizeOrderName(part))
    .filter(Boolean);
  return [...new Set(parts)];
}

async function findOrderByName(admin, orderName) {
  const resp = await admin.graphql(
    `#graphql
    query FindOrderByName($query: String!) {
      orders(first: 1, query: $query) {
        edges {
          node {
            id
            name
          }
        }
      }
    }`,
    { variables: { query: `name:${orderName}` } },
  );
  const json = await resp.json();
  if (json.errors?.length) {
    throw new Error(`Order search failed: ${JSON.stringify(json.errors)}`);
  }
  return json?.data?.orders?.edges?.[0]?.node || null;
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  const adjustments = await db.orderQuotaAdjustment.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return { adjustments };
}

async function applyQuotaAdjustment({ admin, session, orderName, extraQuota, adjustedBy }) {
  let order;
  try {
    order = await findOrderByName(admin, orderName);
  } catch (error) {
    return { orderName, ok: false, error: `ค้นหาออเดอร์ไม่สำเร็จ: ${String(error)}` };
  }

  if (!order) {
    return { orderName, ok: false, error: `ไม่พบออเดอร์ชื่อ ${orderName}` };
  }

  const orderId = toOrderGid(order.id);

  const latest = await db.orderQuotaAdjustment.findFirst({
    where: { shop: session.shop, orderId },
    orderBy: { createdAt: "desc" },
  });
  const previousTotal = latest?.newTotalQuota ?? BASE_MAX_LINKS_PER_ORDER;
  const newTotalQuota = previousTotal + extraQuota;

  if (newTotalQuota < 0) {
    return {
      orderName,
      ok: false,
      error: `โควต้ารวมใหม่จะติดลบ (${newTotalQuota}) กรุณาตรวจสอบจำนวนที่ระบุ`,
    };
  }

  const created = await db.orderQuotaAdjustment.create({
    data: {
      shop: session.shop,
      orderId,
      orderName: order.name,
      extraQuota,
      newTotalQuota,
      adjustedBy,
    },
  });

  return { orderName, ok: true, adjustment: created };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const rawOrderNames = formData.get("orderName");
  const rawExtraQuota = formData.get("extraQuota");
  const adjustedBy = String(formData.get("adjustedBy") || "").trim();

  const orderNames = parseOrderNames(rawOrderNames);
  const extraQuota = Number.parseInt(rawExtraQuota, 10);

  if (orderNames.length === 0) {
    return jsonResp(
      { ok: false, error: "กรุณาระบุชื่อออเดอร์ เช่น #1234 (คั่นหลายออเดอร์ด้วยจุลภาคหรือเว้นวรรค)" },
      400,
    );
  }
  if (!Number.isFinite(extraQuota) || extraQuota === 0) {
    return jsonResp(
      { ok: false, error: "กรุณาระบุจำนวนโควต้าที่ต้องการเพิ่ม (ไม่เป็นศูนย์)" },
      400,
    );
  }
  if (!adjustedBy) {
    return jsonResp({ ok: false, error: "กรุณาระบุชื่อผู้ทำรายการ" }, 400);
  }

  const results = [];
  for (const orderName of orderNames) {
    const result = await applyQuotaAdjustment({
      admin,
      session,
      orderName,
      extraQuota,
      adjustedBy,
    });
    results.push(result);
  }

  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  return jsonResp({
    ok: failed.length === 0,
    partial: succeeded.length > 0 && failed.length > 0,
    results,
    succeeded,
    failed,
  });
}

function formatBangkokDateTime(dateValue) {
  try {
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok",
    }).format(new Date(dateValue));
  } catch {
    return String(dateValue);
  }
}

const inputStyle = {
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 4,
};

const btnStyle = (variant = "default") => ({
  padding: "7px 14px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid",
  ...(variant === "primary"
    ? { background: "#2563EB", color: "white", borderColor: "#2563EB" }
    : variant === "danger"
      ? { background: "white", color: "#B42318", borderColor: "#FECACA" }
      : { background: "white", color: "#374151", borderColor: "#D1D5DB" }),
});

export default function OrderQuotaPage() {
  const { adjustments } = useLoaderData();
  const fetcher = useFetcher();

  const [orderName, setOrderName] = useState("");
  const [extraQuota, setExtraQuota] = useState("");
  const [adjustedBy, setAdjustedBy] = useState("");
  const formRef = useRef(null);

  const submitting = fetcher.state !== "idle";
  const result = fetcher.data;

  useEffect(() => {
    if (result?.ok) {
      setOrderName("");
      setExtraQuota("");
      formRef.current?.querySelector('textarea[name="orderName"]')?.focus();
    }
  }, [result]);

  function handleSubmit(e) {
    e.preventDefault();
    fetcher.submit(
      { orderName, extraQuota, adjustedBy },
      { method: "post" },
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <ui-title-bar title="Order Quota" />

      {/* Form panel */}
      <div
        style={{
          background: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>
          เพิ่มโควต้าพิเศษให้ออเดอร์
        </h3>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "#6B7280" }}>
          ปกติแต่ละออเดอร์ส่งลิงก์ได้สูงสุด {BASE_MAX_LINKS_PER_ORDER} ลิงก์
          ใช้ฟอร์มนี้เพื่อเพิ่ม (หรือลด) โควต้าเฉพาะออเดอร์ที่ต้องการ
          สามารถใส่ได้หลายออเดอร์พร้อมกัน โดยคั่นด้วยจุลภาค (,) เว้นวรรค
          หรือขึ้นบรรทัดใหม่
        </p>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 12,
            alignItems: "end",
          }}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>ชื่อออเดอร์ (ใส่ได้หลายรายการ)</label>
            <textarea
              name="orderName"
              style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
              placeholder="เช่น #1234, #1235 #1236 หรือขึ้นบรรทัดใหม่"
              value={orderName}
              onChange={(e) => setOrderName(e.target.value)}
              required
            />
          </div>
          <div>
            <label style={labelStyle}>จำนวนโควต้าที่เพิ่ม</label>
            <input
              type="number"
              name="extraQuota"
              style={inputStyle}
              placeholder="เช่น 5 หรือ -5"
              value={extraQuota}
              onChange={(e) => setExtraQuota(e.target.value)}
              required
            />
          </div>
          <div>
            <label style={labelStyle}>ผู้ทำรายการ</label>
            <input
              type="text"
              name="adjustedBy"
              style={inputStyle}
              placeholder="ชื่อแอดมิน"
              value={adjustedBy}
              onChange={(e) => setAdjustedBy(e.target.value)}
              required
            />
          </div>
          <div>
            <button
              type="submit"
              style={{
                ...btnStyle("primary"),
                opacity: submitting ? 0.6 : 1,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
              disabled={submitting}
            >
              {submitting ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </div>
        </form>

        {result ? (
          <div
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              background: result.ok ? "#F0FDF4" : result.partial ? "#FFFBEB" : "#FFF1F2",
              border: `1px solid ${result.ok ? "#86EFAC" : result.partial ? "#FDE68A" : "#FECDD3"}`,
              color: result.ok ? "#166534" : result.partial ? "#92400E" : "#9F1239",
            }}
          >
            {result.results ? (
              <div>
                {result.succeeded?.length ? (
                  <div style={{ marginBottom: result.failed?.length ? 6 : 0 }}>
                    ✓ เพิ่มโควต้าสำเร็จ {result.succeeded.length} ออเดอร์:{" "}
                    {result.succeeded
                      .map(
                        (r) =>
                          `${r.adjustment.orderName} (รวม ${r.adjustment.newTotalQuota} ลิงก์)`,
                      )
                      .join(", ")}
                  </div>
                ) : null}
                {result.failed?.length ? (
                  <div>
                    ✗ ล้มเหลว {result.failed.length} ออเดอร์:{" "}
                    {result.failed
                      .map((r) => `${r.orderName}: ${r.error}`)
                      .join("; ")}
                  </div>
                ) : null}
              </div>
            ) : (
              `เกิดข้อผิดพลาด: ${result.error}`
            )}
          </div>
        ) : null}
      </div>

      {/* History panel */}
      <div
        style={{
          background: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>
          ประวัติการปรับโควต้า{" "}
          <span style={{ color: "#6B7280", fontWeight: 400, fontSize: 14 }}>
            ({adjustments.length} รายการ)
          </span>
        </h2>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #E5E7EB",
                  background: "#F9FAFB",
                }}
              >
                <th style={{ padding: "12px 8px" }}>เวลา</th>
                <th style={{ padding: "12px 8px" }}>Order Name</th>
                <th style={{ padding: "12px 8px" }}>ผู้ทำรายการ</th>
                <th style={{ padding: "12px 8px" }}>โควต้าที่เพิ่ม</th>
                <th style={{ padding: "12px 8px" }}>โควต้ารวมใหม่</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map((item) => (
                <tr
                  key={item.id}
                  style={{
                    borderBottom: "1px solid #F2F4F7",
                    verticalAlign: "top",
                  }}
                >
                  <td style={{ padding: "12px 8px", whiteSpace: "nowrap" }}>
                    {formatBangkokDateTime(item.createdAt)}
                  </td>
                  <td style={{ padding: "12px 8px", fontWeight: 600 }}>
                    {item.orderName}
                  </td>
                  <td style={{ padding: "12px 8px" }}>{item.adjustedBy}</td>
                  <td
                    style={{
                      padding: "12px 8px",
                      color: item.extraQuota >= 0 ? "#027A48" : "#B42318",
                      fontWeight: 600,
                    }}
                  >
                    {item.extraQuota >= 0 ? "+" : ""}
                    {item.extraQuota}
                  </td>
                  <td style={{ padding: "12px 8px", fontWeight: 600 }}>
                    {item.newTotalQuota}
                  </td>
                </tr>
              ))}
              {adjustments.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      padding: "32px 8px",
                      textAlign: "center",
                      color: "#6B7280",
                    }}
                  >
                    ยังไม่มีการปรับโควต้า
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
