import { useLoaderData, useRevalidator } from "react-router";
import { useState, useMemo, useEffect } from "react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const PAGE_SIZE = 100;

function toOrderGid(orderId) {
  if (typeof orderId === "string" && orderId.startsWith("gid://")) {
    return orderId;
  }
  return `gid://shopify/Order/${orderId}`;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Fetches each order's customer "line_uid" metafield live from Shopify, for
// filtering only — not persisted to the TikTokUrl row.
async function fetchLineUidByOrderId(admin, orderIds) {
  const lineUidByOrderId = {};
  const chunks = chunkArray(orderIds, 100);

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const resp = await admin.graphql(
          `#graphql
          query GetOrdersLineUid($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Order {
                id
                customer {
                  metafield(namespace: "custom", key: "line_uid") {
                    value
                  }
                }
              }
            }
          }`,
          { variables: { ids: chunk.map(toOrderGid) } },
        );
        const json = await resp.json();
        const nodes = json?.data?.nodes || [];
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (node?.customer?.metafield?.value) {
            lineUidByOrderId[chunk[i]] = node.customer.metafield.value;
          }
        }
      } catch (error) {
        console.error("Failed to fetch line_uid for order chunk:", error);
      }
    }),
  );

  return lineUidByOrderId;
}

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const submissions = await db.tikTokUrl.findMany({
    orderBy: { createdAt: "desc" },
  });

  const uniqueOrderIds = [...new Set(submissions.map((s) => s.orderId))];
  const lineUidByOrderId = await fetchLineUidByOrderId(admin, uniqueOrderIds);

  const withLineUid = submissions.map((item) => ({
    ...item,
    lineUid: lineUidByOrderId[item.orderId] || null,
  }));

  return { submissions: withLineUid };
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

function toBangkokDate(dateValue) {
  if (!dateValue) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
    }).format(new Date(dateValue));
  } catch {
    return "";
  }
}

function getPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "tiktok.com" || host.endsWith(".tiktok.com") || host === "vt.tiktok.com") {
      return "tiktok";
    }
    if (host === "shp.ee" || host.endsWith(".shp.ee") || host === "shopee.co.th" || host.endsWith(".shopee.co.th")) {
      return "shopee";
    }
  } catch {
    // ignore
  }
  return "other";
}

function StatusBadge({ ok }) {
  const style = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    background: ok ? "#D1FADF" : "#FEE4E2",
    color: ok ? "#027A48" : "#B42318",
  };
  return <span style={style}>{ok ? "Success" : "Failed"}</span>;
}

function ErrorText({ text }) {
  if (!text) return <span style={{ color: "#667085" }}>-</span>;
  return (
    <div
      title={text}
      style={{
        maxWidth: 320,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        color: "#B42318",
      }}
    >
      {text}
    </div>
  );
}

function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  // Build page list with ellipsis
  const pageNums = [];
  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= currentPage - 2 && i <= currentPage + 2)
    ) {
      pageNums.push(i);
    }
  }
  const items = [];
  for (let i = 0; i < pageNums.length; i++) {
    if (i > 0 && pageNums[i] - pageNums[i - 1] > 1) {
      items.push("…");
    }
    items.push(pageNums[i]);
  }

  const btnBase = {
    padding: "5px 10px",
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
    border: "1px solid #D1D5DB",
    lineHeight: 1.4,
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <button
        style={{
          ...btnBase,
          background: currentPage === 1 ? "#F3F4F6" : "white",
          color: currentPage === 1 ? "#9CA3AF" : "#374151",
          cursor: currentPage === 1 ? "not-allowed" : "pointer",
        }}
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        &laquo; ก่อนหน้า
      </button>

      {items.map((item, idx) =>
        item === "…" ? (
          <span key={`e${idx}`} style={{ padding: "0 4px", color: "#6B7280" }}>
            …
          </span>
        ) : (
          <button
            key={item}
            style={{
              ...btnBase,
              background: item === currentPage ? "#2563EB" : "white",
              color: item === currentPage ? "white" : "#374151",
              borderColor: item === currentPage ? "#2563EB" : "#D1D5DB",
              fontWeight: item === currentPage ? 700 : 400,
            }}
            onClick={() => onPageChange(item)}
          >
            {item}
          </button>
        ),
      )}

      <button
        style={{
          ...btnBase,
          background: currentPage === totalPages ? "#F3F4F6" : "white",
          color: currentPage === totalPages ? "#9CA3AF" : "#374151",
          cursor: currentPage === totalPages ? "not-allowed" : "pointer",
        }}
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        ถัดไป &raquo;
      </button>

      <span style={{ marginLeft: 8, fontSize: 13, color: "#6B7280" }}>
        หน้า {currentPage} / {totalPages}
      </span>
    </div>
  );
}

function exportToCSV(data, filename) {
  const headers = [
    "เวลาที่ส่ง",
    "Order Name",
    "Customer",
    "Creator Handle",
    "Post Date",
    "URL",
    "Metafield",
    "Note",
    "Error",
  ];
  const rows = data.map((item) => [
    formatBangkokDateTime(item.createdAt),
    item.orderName || "",
    item.customerName || item.customerEmail || "",
    item.creatorHandle ? `@${item.creatorHandle}` : "",
    item.postDate ? formatBangkokDateTime(item.postDate) : "",
    item.url,
    item.metafieldUpdated ? "Success" : "Failed",
    item.noteUpdated ? "Success" : "Failed",
    item.metafieldError || item.noteError || "",
  ]);

  const csv = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

export default function AppIndex() {
  const { submissions } = useLoaderData();
  const revalidator = useRevalidator();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [postDateFrom, setPostDateFrom] = useState("");
  const [postDateTo, setPostDateTo] = useState("");
  const [creatorHandleFilter, setCreatorHandleFilter] = useState("");
  const [customerEmailFilter, setCustomerEmailFilter] = useState("");
  const [lineUidFilter, setLineUidFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessResult, setReprocessResult] = useState(null);
  const [fixingNames, setFixingNames] = useState(false);
  const [fixNamesResult, setFixNamesResult] = useState(null);
  const [fixingCustomerInfo, setFixingCustomerInfo] = useState(false);
  const [fixCustomerInfoResult, setFixCustomerInfoResult] = useState(null);

  const activeFilterCount = [
    dateFrom,
    dateTo,
    postDateFrom,
    postDateTo,
    creatorHandleFilter,
    customerEmailFilter,
    lineUidFilter,
    platformFilter !== "all" ? platformFilter : "",
  ].filter(Boolean).length;
  const hasFilter = activeFilterCount > 0;

  const filtered = useMemo(() => {
    return submissions.filter((item) => {
      const itemDate = toBangkokDate(item.createdAt);
      if (dateFrom && itemDate < dateFrom) return false;
      if (dateTo && itemDate > dateTo) return false;

      if (postDateFrom || postDateTo) {
        const itemPostDate = item.postDate ? toBangkokDate(item.postDate) : "";
        if (postDateFrom && (!itemPostDate || itemPostDate < postDateFrom))
          return false;
        if (postDateTo && (!itemPostDate || itemPostDate > postDateTo))
          return false;
      }

      if (creatorHandleFilter) {
        const handle = (item.creatorHandle || "").toLowerCase();
        const query = creatorHandleFilter.toLowerCase().replace(/^@/, "");
        if (!handle.includes(query)) return false;
      }

      if (customerEmailFilter) {
        const email = (item.customerEmail || "").toLowerCase();
        if (!email.includes(customerEmailFilter.toLowerCase())) return false;
      }

      if (lineUidFilter) {
        const lineUid = (item.lineUid || "").toLowerCase();
        if (!lineUid.includes(lineUidFilter.toLowerCase())) return false;
      }

      if (platformFilter !== "all") {
        if (getPlatform(item.url) !== platformFilter) return false;
      }

      return true;
    });
  }, [
    submissions,
    dateFrom,
    dateTo,
    postDateFrom,
    postDateTo,
    creatorHandleFilter,
    customerEmailFilter,
    lineUidFilter,
    platformFilter,
  ]);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    dateFrom,
    dateTo,
    postDateFrom,
    postDateTo,
    creatorHandleFilter,
    customerEmailFilter,
    lineUidFilter,
    platformFilter,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setPostDateFrom("");
    setPostDateTo("");
    setCreatorHandleFilter("");
    setCustomerEmailFilter("");
    setLineUidFilter("");
    setPlatformFilter("all");
  }

  async function handleReprocess() {
    setReprocessing(true);
    setReprocessResult({ ok: true, inProgress: true, total: null, processed: 0, success: 0, failed: 0 });

    let offset = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let grandTotal = null;

    try {
      while (true) {
        const res = await fetch(`/api/reprocess?offset=${offset}`, { method: "POST" });
        const data = await res.json();

        if (!data.ok) {
          setReprocessResult({ ok: false, error: data.error || "Unknown error" });
          break;
        }

        grandTotal = data.total;
        totalSuccess += data.success;
        totalFailed += data.failed;
        offset = data.nextOffset;

        setReprocessResult({
          ok: true,
          inProgress: data.hasMore,
          total: grandTotal,
          processed: offset,
          success: totalSuccess,
          failed: totalFailed,
        });

        if (!data.hasMore || data.batchSize === 0) break;
      }

      revalidator.revalidate();
    } catch (e) {
      setReprocessResult({ ok: false, error: String(e) });
    } finally {
      setReprocessing(false);
    }
  }

  async function handleFixOrderNames() {
    setFixingNames(true);
    setFixNamesResult({ ok: true, inProgress: true, total: null, processed: 0, success: 0, failed: 0 });

    let offset = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let grandTotal = null;

    try {
      while (true) {
        const res = await fetch(`/api/fix-order-names?offset=${offset}`, { method: "POST" });
        const data = await res.json();

        if (!data.ok) {
          setFixNamesResult({ ok: false, error: data.error || "Unknown error" });
          break;
        }

        grandTotal = data.total;
        totalSuccess += data.success;
        totalFailed += data.failed;
        offset = data.nextOffset;

        setFixNamesResult({
          ok: true,
          inProgress: data.hasMore,
          total: grandTotal,
          processed: offset,
          success: totalSuccess,
          failed: totalFailed,
        });

        if (!data.hasMore || data.batchSize === 0) break;
      }

      revalidator.revalidate();
    } catch (e) {
      setFixNamesResult({ ok: false, error: String(e) });
    } finally {
      setFixingNames(false);
    }
  }

  async function handleFixCustomerInfo() {
    setFixingCustomerInfo(true);
    setFixCustomerInfoResult({ ok: true, inProgress: true, total: null, processed: 0, success: 0, failed: 0 });

    let offset = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let grandTotal = null;

    try {
      while (true) {
        const res = await fetch(`/api/fix-customer-info?offset=${offset}`, { method: "POST" });
        const data = await res.json();

        if (!data.ok) {
          setFixCustomerInfoResult({ ok: false, error: data.error || "Unknown error" });
          break;
        }

        grandTotal = data.total;
        totalSuccess += data.success;
        totalFailed += data.failed;
        offset = data.nextOffset;

        setFixCustomerInfoResult({
          ok: true,
          inProgress: data.hasMore,
          total: grandTotal,
          processed: offset,
          success: totalSuccess,
          failed: totalFailed,
        });

        if (!data.hasMore || data.batchSize === 0) break;
      }

      revalidator.revalidate();
    } catch (e) {
      setFixCustomerInfoResult({ ok: false, error: String(e) });
    } finally {
      setFixingCustomerInfo(false);
    }
  }

  const paginationBar = (
    <Pagination
      currentPage={currentPage}
      totalPages={totalPages}
      onPageChange={setCurrentPage}
    />
  );

  return (
    <div style={{ padding: 24 }}>
      <ui-title-bar title="TikTok Link Submissions" />

      {/* Filter panel */}
      <div
        style={{
          background: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: filtersOpen ? 20 : "12px 20px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 600,
              color: "#111827",
            }}
          >
            <span
              style={{
                display: "inline-block",
                transform: filtersOpen ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s ease",
                fontSize: 12,
                color: "#6B7280",
              }}
            >
              ▶
            </span>
            ตัวกรอง
            {activeFilterCount > 0 ? (
              <span
                style={{
                  display: "inline-block",
                  background: "#2563EB",
                  color: "white",
                  borderRadius: 999,
                  padding: "1px 8px",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {activeFilterCount}
              </span>
            ) : null}
          </button>

          {hasFilter ? (
            <button style={btnStyle("danger")} onClick={clearFilters}>
              ล้างตัวกรอง
            </button>
          ) : null}
        </div>

        {filtersOpen ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 12,
              alignItems: "end",
              marginTop: 16,
            }}
          >
            <div>
              <label style={labelStyle}>เวลาที่ส่ง (จาก)</label>
              <input
                type="date"
                style={inputStyle}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>เวลาที่ส่ง (ถึง)</label>
              <input
                type="date"
                style={inputStyle}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Post Date (จาก)</label>
              <input
                type="date"
                style={inputStyle}
                value={postDateFrom}
                onChange={(e) => setPostDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Post Date (ถึง)</label>
              <input
                type="date"
                style={inputStyle}
                value={postDateTo}
                onChange={(e) => setPostDateTo(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Creator Handle</label>
              <input
                type="text"
                style={inputStyle}
                placeholder="@username"
                value={creatorHandleFilter}
                onChange={(e) => setCreatorHandleFilter(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Customer Email</label>
              <input
                type="text"
                style={inputStyle}
                placeholder="customer@email.com"
                value={customerEmailFilter}
                onChange={(e) => setCustomerEmailFilter(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Line UID</label>
              <input
                type="text"
                style={inputStyle}
                placeholder="Line UID"
                value={lineUidFilter}
                onChange={(e) => setLineUidFilter(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Platform</label>
              <select
                style={inputStyle}
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
              >
                <option value="all">ทั้งหมด</option>
                <option value="tiktok">TikTok</option>
                <option value="shopee">Shopee</option>
              </select>
            </div>
          </div>
        ) : null}
      </div>

      {/* Table panel */}
      <div
        style={{
          background: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 20,
        }}
      >
        {/* Header row: title + export buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>
            รายการลิงก์ที่ลูกค้าส่งมา{" "}
            <span style={{ color: "#6B7280", fontWeight: 400, fontSize: 14 }}>
              ({filtered.length} รายการ
              {hasFilter ? ` จาก ${submissions.length}` : ""})
            </span>
          </h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              style={btnStyle()}
              onClick={() =>
                exportToCSV(
                  filtered,
                  `tiktok-links-filtered-${toBangkokDate(new Date())}.csv`,
                )
              }
            >
              Export Filtered ({filtered.length})
            </button>
            <button
              style={btnStyle("primary")}
              onClick={() =>
                exportToCSV(
                  submissions,
                  `tiktok-links-all-${toBangkokDate(new Date())}.csv`,
                )
              }
            >
              Export All ({submissions.length})
            </button>
            <button
              style={{
                ...btnStyle(),
                borderColor: "#F59E0B",
                color: "#92400E",
                background: "#FFFBEB",
                opacity: reprocessing ? 0.6 : 1,
                cursor: reprocessing ? "not-allowed" : "pointer",
              }}
              disabled={reprocessing}
              onClick={handleReprocess}
            >
              {reprocessing ? "กำลัง Reprocess..." : "Reprocess Failed (7 วัน)"}
            </button>
            <button
              style={{
                ...btnStyle(),
                borderColor: "#8B5CF6",
                color: "#4C1D95",
                background: "#F5F3FF",
                opacity: fixingNames ? 0.6 : 1,
                cursor: fixingNames ? "not-allowed" : "pointer",
              }}
              disabled={fixingNames}
              onClick={handleFixOrderNames}
            >
              {fixingNames ? "กำลัง Fix Order Names..." : "Fix Missing Order Names"}
            </button>
            <button
              style={{
                ...btnStyle(),
                borderColor: "#0EA5E9",
                color: "#075985",
                background: "#F0F9FF",
                opacity: fixingCustomerInfo ? 0.6 : 1,
                cursor: fixingCustomerInfo ? "not-allowed" : "pointer",
              }}
              disabled={fixingCustomerInfo}
              onClick={handleFixCustomerInfo}
            >
              {fixingCustomerInfo ? "กำลัง Fix Customer Info..." : "Fix Missing Customer Info"}
            </button>
          </div>
        </div>

        {/* Reprocess result banner */}
        {reprocessResult ? (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              background: reprocessResult.ok ? (reprocessResult.inProgress ? "#FFFBEB" : "#F0FDF4") : "#FFF1F2",
              border: `1px solid ${reprocessResult.ok ? (reprocessResult.inProgress ? "#FCD34D" : "#86EFAC") : "#FECDD3"}`,
              color: reprocessResult.ok ? (reprocessResult.inProgress ? "#92400E" : "#166534") : "#9F1239",
            }}
          >
            {!reprocessResult.ok
              ? `เกิดข้อผิดพลาด: ${reprocessResult.error}`
              : reprocessResult.inProgress
                ? `⏳ กำลัง Reprocess... ${reprocessResult.processed}${reprocessResult.total ? `/${reprocessResult.total}` : ""} รายการ — สำเร็จ ${reprocessResult.success}, ข้อผิดพลาด ${reprocessResult.failed}`
                : `✓ Reprocess เสร็จสิ้น: ${reprocessResult.total} รายการ — สำเร็จ ${reprocessResult.success}, ยังมีข้อผิดพลาด ${reprocessResult.failed}`}
          </div>
        ) : null}

        {/* Fix order names result banner */}
        {fixNamesResult ? (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              background: fixNamesResult.ok ? (fixNamesResult.inProgress ? "#F5F3FF" : "#F0FDF4") : "#FFF1F2",
              border: `1px solid ${fixNamesResult.ok ? (fixNamesResult.inProgress ? "#C4B5FD" : "#86EFAC") : "#FECDD3"}`,
              color: fixNamesResult.ok ? (fixNamesResult.inProgress ? "#4C1D95" : "#166534") : "#9F1239",
            }}
          >
            {!fixNamesResult.ok
              ? `เกิดข้อผิดพลาด: ${fixNamesResult.error}`
              : fixNamesResult.inProgress
                ? `⏳ กำลัง Fix Order Names... ${fixNamesResult.processed}${fixNamesResult.total ? `/${fixNamesResult.total}` : ""} รายการ — อัปเดตแล้ว ${fixNamesResult.success}`
                : `✓ Fix Order Names เสร็จสิ้น: อัปเดต ${fixNamesResult.success} รายการ, ไม่สำเร็จ ${fixNamesResult.failed}`}
          </div>
        ) : null}

        {/* Fix customer info result banner */}
        {fixCustomerInfoResult ? (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              background: fixCustomerInfoResult.ok ? (fixCustomerInfoResult.inProgress ? "#F0F9FF" : "#F0FDF4") : "#FFF1F2",
              border: `1px solid ${fixCustomerInfoResult.ok ? (fixCustomerInfoResult.inProgress ? "#7DD3FC" : "#86EFAC") : "#FECDD3"}`,
              color: fixCustomerInfoResult.ok ? (fixCustomerInfoResult.inProgress ? "#075985" : "#166534") : "#9F1239",
            }}
          >
            {!fixCustomerInfoResult.ok
              ? `เกิดข้อผิดพลาด: ${fixCustomerInfoResult.error}`
              : fixCustomerInfoResult.inProgress
                ? `⏳ กำลัง Fix Customer Info... ${fixCustomerInfoResult.processed}${fixCustomerInfoResult.total ? `/${fixCustomerInfoResult.total}` : ""} รายการ — อัปเดตแล้ว ${fixCustomerInfoResult.success}`
                : `✓ Fix Customer Info เสร็จสิ้น: อัปเดต ${fixCustomerInfoResult.success} รายการ, ไม่สำเร็จ ${fixCustomerInfoResult.failed}`}
          </div>
        ) : null}

        {/* Pagination — top */}
        <div style={{ marginBottom: 12 }}>{paginationBar}</div>

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
                <th style={{ padding: "12px 8px" }}>Customer</th>
                <th style={{ padding: "12px 8px" }}>Creator Handle</th>
                <th style={{ padding: "12px 8px" }}>Post Date</th>
                <th style={{ padding: "12px 8px" }}>URL</th>
                <th style={{ padding: "12px 8px" }}>Metafield</th>
                <th style={{ padding: "12px 8px" }}>Note</th>
                <th style={{ padding: "12px 8px" }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((item) => {
                const combinedError =
                  item.metafieldError || item.noteError || null;
                return (
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
                    <td style={{ padding: "12px 8px" }}>
                      {item.orderName || "-"}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      {item.customerName || item.customerEmail || "-"}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      {item.creatorHandle ? `@${item.creatorHandle}` : "-"}
                    </td>
                    <td style={{ padding: "12px 8px", whiteSpace: "nowrap" }}>
                      {item.postDate
                        ? formatBangkokDateTime(item.postDate)
                        : "-"}
                    </td>
                    <td style={{ padding: "12px 8px", wordBreak: "break-all" }}>
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.url}
                      </a>
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <StatusBadge ok={item.metafieldUpdated} />
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <StatusBadge ok={item.noteUpdated} />
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <ErrorText text={combinedError} />
                    </td>
                  </tr>
                );
              })}
              {paginated.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      padding: "32px 8px",
                      textAlign: "center",
                      color: "#6B7280",
                    }}
                  >
                    ไม่พบข้อมูลที่ตรงกับตัวกรอง
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Pagination — bottom */}
        <div style={{ marginTop: 16 }}>{paginationBar}</div>
      </div>
    </div>
  );
}
