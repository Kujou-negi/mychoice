// これは「中継サーバー」担当のファイルです。
// ブラウザは楽天に直接話しかけず、このファイル(自分のサーバー)に話しかけます。
//
// 補足: 最初は fetch() を使っていましたが、fetch() は「Referer」ヘッダーを
// プログラム側から指定しても黙って無視してしまう仕様のため、
// もっと低レベルな https モジュールを使って確実にヘッダーを送るようにしています。
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
          Origin: "https://kujou-negi.github.io",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          Accept: "application/json,text/plain,*/*",
          "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
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
  // 楽天Ichiba商品検索APIは1リクエストあたり最大30件までしか返せないため、30を上限にする
  const hits = (req.query.hits || "30").toString();

  if (!keyword) {
    res.status(400).json({ error: "keyword is required" });
    return;
  }

  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    keyword,
    hits,
    // 安い順(+itemPrice)だと、キーワードが偶然含まれているだけの激安な無関係商品
    // （見積もりページや付属品など）が上位を占めてしまうため、楽天の標準の関連性順にする。
    // 価格順に並べたい場合は、取得したあとアプリ側の「並び替え」でユーザーが選べるようにしている。
    sort: "standard",
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
