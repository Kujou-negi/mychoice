// AI（Google Gemini, 無料枠）を使って、検索結果に対して
//   1) この商品ジャンルで価格以外に重要そうな「好みプロフィール」項目を生成
//   2) 商品ごとの関連性チェック（キーワードが偶然含まれているだけの無関係な商品を除外）
//   3) 商品ごとの属性判定・原材料/容量/容器の抽出
// をまとめて1回のAI呼び出しで行う中継サーバーです。
// APIキーは Vercel の環境変数 GEMINI_API_KEY に保存し、ブラウザには一切渡しません。

const MODEL = "gemini-3.5-flash-lite";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    attributes: {
      type: "ARRAY",
      description: "この商品ジャンルの購入判断において、価格以外に重要な観点を2〜4個",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "英数字の短いID（例: additive_free）" },
          label: { type: "STRING", description: "日本語の短いラベル（例: 無添加を重視する）" },
        },
        required: ["id", "label"],
      },
    },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          relevant: { type: "BOOLEAN", description: "検索キーワードが指す商品ジャンルの実物として妥当か" },
          shortName: { type: "STRING", description: "商品名を「商品の種類＋特徴（産地やブランドなど1つだけ）」に要約した短い表示名。20文字程度が目安。ギフト訴求・送料・価格・キャンペーン文言・SEOキーワードの羅列は含めない" },
          summary: { type: "STRING", description: "商品名や説明文にある付随情報のうち、他の項目（原材料・容量・容器・属性）に当てはまらないが参考になる一言（例: 販売者名、製造元、ギフト向けかどうかなど）。無ければ空文字" },
          ingredients: { type: "STRING", description: "商品パッケージの『原材料名』表示に書かれている、食べられる成分だけをカンマ区切りで抜粋（例: 梅,砂糖,はちみつ）。瓶・容器・調理器具・保存袋など食品ではない道具や、手作りキットで『用意する材料』として書かれている瓶・道具類は絶対に含めない。内容量・産地・保存方法・製造者・容器などの情報も含めない。原材料表示が見当たらなければ空文字" },
          packaging: { type: "STRING", description: "瓶/パウチ/缶/ペットボトル/箱/パックなど。不明なら空文字" },
          quantityValue: { type: "NUMBER", description: "内容量の数値。Lはml換算、kgはg換算した値。不明なら0" },
          quantityUnit: { type: "STRING", description: "ml または g。不明なら空文字" },
          attrHits: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                hit: { type: "BOOLEAN" },
              },
              required: ["id", "hit"],
            },
          },
        },
        required: ["index", "relevant", "shortName", "attrHits"],
      },
    },
  },
  required: ["attributes", "items"],
};

function buildPrompt(keyword, items) {
  const itemsText = items
    .map((it) => `[${it.index}] 商品名: ${it.name}\n説明文: ${it.caption || "(説明文なし)"}`)
    .join("\n\n");

  return `あなたはネットショッピングの商品データを整理するアシスタントです。
ユーザーは「${keyword}」というキーワードでECサイトを検索しました。以下はその検索結果の商品一覧です。

${itemsText}

次のことを行ってください。

1. attributes: 「${keyword}」というジャンルの買い物で、価格以外にユーザーが気にしそうな観点を2〜4個選び、id（英数字、アンダースコア可）とlabel（日本語、「〜を重視する」のような短い言い回し）で挙げてください。ジャンルに応じて柔軟に選んでください（例: 食品なら無添加・産地、コーヒーならオーガニック・フェアトレード・カフェインの有無、家電なら省エネ・保証期間など）。idに"cost"は使わないでください（価格は別枠で扱います）。

2. items: 商品ごとに以下を判定してください。
- relevant: その商品が本当に「${keyword}」というジャンルの実物商品かどうか。キーワードが商品名にたまたま含まれているだけの無関係な商品（例: キャラクターグッズ、福袋、ギフト券、無関係なセット商品の一部、色や見た目の形容としてキーワードが使われているだけのもの）は false にしてください。
- shortName: 楽天の商品名はSEOのためのキーワード羅列で非常に長いことが多いので、「商品の種類＋特徴を1つだけ（産地やブランド名など）」程度に要約してください。送料・価格・キャンペーン文言（例:「送料無料」「◯円以上」「ギフト」「マラソン限定クーポン」）や、同じ単語の繰り返しは含めないでください。（例:「梅シロップ 長野県産梅使用 250ml 1本 3980円以上 送料無料...みつどんマルシェ」→「長野県産 梅シロップ」）
- summary: shortNameやingredients/packaging/quantity/attrHitsのどれにも当てはまらないが、ユーザーの参考になりそうな一言（販売者名・製造元・ギフト向けかどうかなど）。例:「飯綱町ふるさと振興公社が製造」。無ければ空文字。他の項目と同じ内容を繰り返さないこと。
- attrHits: 上記1で挙げたattributesそれぞれについて、その商品がその観点に当てはまる記載があるか（true/false）
- ingredients: 商品の『原材料名』表示に書かれている、食べられる成分だけをカンマ区切りで抜粋（例:「梅,砂糖」）。瓶・ガラス容器・蓋・調理器具など、食品ではないもの（手作りキットで「材料：梅1kg、氷砂糖1kg、瓶1つ」のように書かれている場合の「瓶」も含む）は絶対にingredientsに書かないでください。内容量の数値・産地・保存方法・製造者・販売者などもingredientsに含めず、summaryやquantityの方に入れること。原材料表示が無ければ空文字
- packaging: 容器の種類（瓶/パウチ/缶/ペットボトル/箱/パックなど、判断できなければ空文字）
- quantityValue, quantityUnit: 内容量。Lはml×1000、kgはg×1000に換算。不明なら quantityValue は 0、quantityUnit は空文字

各項目の内容が互いに重複しないようにしてください（同じ情報を複数の項目に書かない）。JSON形式のみで出力してください。`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY is not set on the server" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const keyword = (body?.keyword || "").toString();
  const items = Array.isArray(body?.items) ? body.items : [];

  if (!keyword || items.length === 0) {
    res.status(400).json({ error: "keyword and items are required" });
    return;
  }

  const prompt = buildPrompt(keyword, items);

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      }
    );

    const raw = await r.text();
    if (!r.ok) {
      res.status(r.status).json({ error: "gemini_error", status: r.status, raw: raw.slice(0, 500) });
      return;
    }

    const data = JSON.parse(raw);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      res.status(502).json({ error: "no_text_in_response", raw: raw.slice(0, 500) });
      return;
    }

    const parsed = JSON.parse(text);
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: "proxy_error", message: String(e) });
  }
}
