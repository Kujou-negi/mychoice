// Yahoo!ショッピング「商品検索API (v3)」の中継サーバーです。
// 楽天と違い、Referer/Originのチェックは無く、Client ID（appid）だけで呼び出せます。
// APIキーはここにしか置かず、ブラウザには一切渡しません。

const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD01bUJnMVN3WEhrJmhhc2g9WkdZMFpUVmtZakF5TmpSak5qRXlOQQ";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const keyword = (req.query.keyword || "").toString();
  // Yahoo!ショッピングAPIは最大1000件まで指定できるが、楽天側と足並みを揃えて30件にしておく
  const hits = (req.query.hits || "30").toString();

  if (!keyword) {
    res.status(400).json({ error: "keyword is required" });
    return;
  }

  const params = new URLSearchParams({
    appid: YAHOO_CLIENT_ID,
    query: keyword,
    results: hits,
  });

  try {
    const r = await fetch(
      `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?${params.toString()}`
    );
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: "invalid_json_from_yahoo", raw: text.slice(0, 500) };
    }
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: "proxy_error", message: String(e) });
  }
}
