const RAKUTEN_APP_ID = "0151ff90-e03b-4d28-981a-dac33539f3d1";
const RAKUTEN_ACCESS_KEY = "pk_2WchspGfdU1i9gJVaf7W32Vl9z69xBQyXvw8FPTpwAX";
const ENDPOINT = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

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

  try {
    const rakutenRes = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: {
        Referer: "https://kujou-negi.github.io/mychoice/",
      },
    });
    const data = await rakutenRes.json();
    res.status(rakutenRes.status).json(data);
  } catch (e) {
    res.status(500).json({ error: "proxy_error", message: String(e) });
  }
}
