import { useLoaderData } from "react-router";
import db from "../db.server";

export async function loader() {
  const submissions = await db.tikTokUrl.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
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

export default function AppIndex() {
  const { submissions } = useLoaderData();

  return (
    <div style={{ padding: 24 }}>
      <ui-title-bar title="TikTok Link Submissions" />

      <div
        style={{
          background: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 16 }}>
          รายการลิงก์ที่ลูกค้าส่งมา
        </h2>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>
                <th style={{ padding: "12px 8px" }}>เวลา</th>
                <th style={{ padding: "12px 8px" }}>Order ID</th>
                <th style={{ padding: "12px 8px" }}>Order Name</th>
                <th style={{ padding: "12px 8px" }}>Customer</th>
                <th style={{ padding: "12px 8px" }}>URL</th>
                <th style={{ padding: "12px 8px" }}>Metafield</th>
                <th style={{ padding: "12px 8px" }}>Note</th>
                <th style={{ padding: "12px 8px" }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((item) => {
                const combinedError =
                  item.metafieldError || item.noteError || null;

                return (
                  <tr
                    key={item.id}
                    style={{ borderBottom: "1px solid #F2F4F7", verticalAlign: "top" }}
                  >
                    <td style={{ padding: "12px 8px", whiteSpace: "nowrap" }}>
                      {formatBangkokDateTime(item.createdAt)}
                    </td>

                    <td style={{ padding: "12px 8px", wordBreak: "break-all" }}>
                      {item.orderId}
                    </td>

                    <td style={{ padding: "12px 8px" }}>
                      {item.orderName || "-"}
                    </td>

                    <td style={{ padding: "12px 8px" }}>
                      {item.customerName || item.customerEmail || "-"}
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
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}