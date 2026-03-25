import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const db = (await import("../db.server")).default;

  const submissions = await db.tikTokUrl.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return { submissions };
};

function formatDateTime(value) {
  try {
    return new Date(value).toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

export default function AppIndex() {
  const { submissions } = useLoaderData();

  return (
    <s-page heading="TikTok Link Submissions">
      <s-section heading="รายการลิงก์ที่ลูกค้าส่งมา">
        {submissions.length === 0 ? (
          <s-paragraph>ยังไม่มีข้อมูล</s-paragraph>
        ) : (
          <div style={{ marginTop: "16px", overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "14px",
              }}
            >
              <thead>
                <tr>
                  <th style={cellHead}>เวลา</th>
                  <th style={cellHead}>Order ID</th>
                  <th style={cellHead}>Order Name</th>
                  <th style={cellHead}>Customer Email</th>
                  <th style={cellHead}>URL</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((item) => (
                  <tr key={item.id}>
                    <td style={cellBody}>{formatDateTime(item.createdAt)}</td>
                    <td style={cellBody}>{item.orderId}</td>
                    <td style={cellBody}>{item.orderName || "-"}</td>
                    <td style={cellBody}>{item.customerEmail || "-"}</td>
                    <td style={cellBody}>
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.url}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const cellHead = {
  textAlign: "left",
  padding: "10px",
  borderBottom: "1px solid #ddd",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const cellBody = {
  textAlign: "left",
  padding: "10px",
  borderBottom: "1px solid #eee",
  verticalAlign: "top",
  wordBreak: "break-word",
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};