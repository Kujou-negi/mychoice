import https from "node:https";

const RAKUTEN_APP_ID = "0151ff90-e03b-4d28-981a-dac33539f3d1";
const RAKUTEN_ACCESS_KEY = "pk_2WchspGfdU1i9gJVaf7W32Vl9z69xBQyXvw8FPTpwAX";

function rakutenGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "openapi.rakuten.co.jp",
        path,
        method: "GET",
        headers: {
          Referer: "https://kujou-negi.github.io/mychoice/",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 500, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const keyword = (req.query.keyword || "").toString();
  const hits = (req.query.hits || "20").toString();

  if (!keyword) {
    res.status(400).json({ error: "keyword is required" });
    return;
  }

  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    keyword,
    hits,
    sort: "+itemPrice",
    format: "json",
  });

  const path = `/ichibams/api/IchibaItem/Search/20260701?${params.toString()}`;

  try {
    const { status, body } = await rakutenGet(path);
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      data = { error: "invalid_json_from_rakuten", raw: body.slice(0, 500) };
    }
    res.status(status).json(data);
  } catch (e) {
    res.status(500).json({ error: "proxy_error", message: String(e) });
  }
}
