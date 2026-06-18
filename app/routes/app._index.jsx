import { useLoaderData } from "react-router";
import { useState, useMemo } from "react";
import db from "../db.server";

export async function loader() {
  const submissions = await db.tikTokUrl.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return { submissions };
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

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [postDateFrom, setPostDateFrom] = useState("");
  const [postDateTo, setPostDateTo] = useState("");
  const [creatorHandleFilter, setCreatorHandleFilter] = useState("");

  const hasFilter =
    dateFrom || dateTo || postDateFrom || postDateTo || creatorHandleFilter;

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

      return true;
    });
  }, [submissions, dateFrom, dateTo, postDateFrom, postDateTo, creatorHandleFilter]);

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setPostDateFrom("");
    setPostDateTo("");
    setCreatorHandleFilter("");
  }

  return (
    <div style={{ padding: 24 }}>
      <ui-title-bar title="TikTok Link Submissions" />

      {/* Filter panel */}
      <div
        style={{
          background: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>ตัวกรอง</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 12,
            alignItems: "end",
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
          {hasFilter ? (
            <div style={{ paddingTop: 18 }}>
              <button style={btnStyle("danger")} onClick={clearFilters}>
                ล้างตัวกรอง
              </button>
            </div>
          ) : null}
        </div>
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
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

          <div style={{ display: "flex", gap: 8 }}>
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
          </div>
        </div>

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
              {filtered.map((item) => {
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
              {filtered.length === 0 ? (
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
      </div>
    </div>
  );
}
