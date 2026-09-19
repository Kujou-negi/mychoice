// AI（Google Gemini, 無料枠）を使って、検索結果に対して
//   1) この商品ジャンルで価格以外に重要そうな「好みプロフィール」項目（属性・チェックボックス）を生成
//   2) この商品ジャンルで比較したい客観的なスペック項目（specFields。食品なら容量・原材料、家電なら接続方式など）を生成
//   3) 商品ごとの関連性チェック（キーワードが偶然含まれているだけの無関係な商品を除外）
//   4) 商品ごとの属性判定・スペック値の抽出
// をまとめて1回のAI呼び出しで行う中継サーバーです。
// APIキーは Vercel の環境変数 GEMINI_API_KEY に保存し、ブラウザには一切渡しません。

const MODEL = "gemini-3.5-flash-lite";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    attributes: {
      type: "ARRAY",
      description: "この商品ジャンルの購入判断において、価格以外に重要な「好み・こだわり」の観点を2〜4個（チェックボックスとして表示し、該当するかどうかで比較する）",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "英数字の短いID（例: additive_free）" },
          label: { type: "STRING", description: "日本語の短いラベル（例: 無添加を重視する）" },
        },
        required: ["id", "label"],
      },
    },
    specFields: {
      type: "ARRAY",
      description: "このジャンルの商品を比較するときに見たい、客観的な仕様・スペック項目を2〜3個。好み判断ではなく事実情報（例: 食品なら『容量』『原材料』『容器』、キーボードなら『接続方式』『キースイッチ』『サイズ』、衣類なら『サイズ』『素材』『カラー』、家電なら『対応OS』『画面サイズ』など）。ジャンルに完全に合わせて自由に選んでよい。ただし食品・飲料ジャンルの場合は、必ず内容量・数量を表す項目を1つ含め、そのidは必ず'qty'、labelは必ず『容量』にすること（値そのものは250ml・全形10枚・6個入りなど何でもよいが、id/labelは固定）",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "英数字の短いID（例: connection_type）" },
          label: { type: "STRING", description: "日本語の短い見出し（例: 接続方式）。2〜5文字程度" },
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
          origin: { type: "STRING", description: "食品・飲料の『原材料の産地』となる都道府県名（例: 長野県）。食品・飲料ジャンルで、かつ商品名・説明文から読み取れる場合のみ。地名（紀州、南高梅など）は分かる範囲で都道府県名に変換する。食品・飲料以外のジャンル（家電・雑貨・衣類など）では、販売元やメーカーの所在地であっても絶対に設定せず、必ず空文字にする" },
          maker: { type: "STRING", description: "製造者・販売者・ブランド名（例: 飯綱町ふるさと振興公社）。読み取れなければ空文字" },
          feature: { type: "STRING", description: "商品の特徴を一言で（15文字程度）。origin・maker・specs・attributesのどれとも重複しない情報。無ければ空文字" },
          specs: {
            type: "ARRAY",
            description: "上記specFieldsそれぞれについて、この商品での値を商品名・説明文から抽出したもの",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING", description: "specFieldsのidと対応させる" },
                value: { type: "STRING", description: "短い値（例: 250ml, 有線, メカニカル(茶軸), Mサイズ）。読み取れなければ空文字" },
              },
              required: ["id", "value"],
            },
          },
          quantityValue: { type: "NUMBER", description: "内容量・重量・体積を表す数値。Lはml換算、kgはg換算した値。単価計算に使うための補助情報で、genreに重量/体積の概念が無ければ0でよい" },
          quantityUnit: { type: "STRING", description: "ml または g。無ければ空文字" },
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
        required: ["index", "relevant", "shortName", "specs", "attrHits"],
      },
    },
  },
  required: ["attributes", "specFields", "items"],
};

function buildPrompt(keyword, items) {
  const itemsText = items
    .map((it) => `[${it.index}] 商品名: ${it.name}\n説明文: ${it.caption || "(説明文なし)"}`)
    .join("\n\n");

  return `あなたはネットショッピングの商品データを整理するアシスタントです。
ユーザーは「${keyword}」というキーワードでECサイトを検索しました。以下はその検索結果の商品一覧です。

${itemsText}

次のことを行ってください。

1. attributes: 「${keyword}」というジャンルの買い物で、価格以外にユーザーが気にしそうな「好み・こだわり」の観点を2〜4個選び、id（英数字、アンダースコア可）とlabel（日本語、「〜を重視する」のような短い言い回し）で挙げてください。ジャンルに応じて柔軟に選んでください（例: 食品なら無添加・産地、コーヒーならオーガニック・フェアトレード・カフェインの有無、キーボードなら無線接続・静音性・コンパクトさなど）。idに"cost"は使わないでください（価格は別枠で扱います）。

2. specFields: 「${keyword}」というジャンルの商品を並べて比較するときに見たい、客観的な仕様・スペック項目を2〜3個選んでください。好みではなく事実情報です。ジャンルに完全に合わせて自由に選んでください（例: 食品・飲料なら『容量』『原材料』『容器』、キーボードなら『接続方式』『キースイッチ』『サイズ』、衣類なら『サイズ』『素材』、家電なら『画面サイズ』『対応OS』など）。idは英数字、labelは日本語で2〜5文字程度の短い見出しにしてください。食品ではないジャンルに『原材料』『容量(ml/g)』のような食品向け項目を無理に当てはめないでください。「${keyword}」が食品・飲料ジャンルの場合は、内容量・数量を表す項目を必ず1つ含め、そのidは必ず"qty"、labelは必ず「容量」にしてください（画面上で価格のすぐ下に表示するため、idを固定する必要があります。値の書き方は250ml・全形10枚・6個入りなど自由）。

3. items: 商品ごとに以下を判定してください。
- relevant: その商品自体が「${keyword}」と呼べる物かどうか。falseにするのは、キーワードが商品名にたまたま含まれているだけで商品自体は別物の場合だけです（例: 関連キャラクターグッズ、福袋、ギフト券、無関係なセット商品の一部、色や見た目の形容としてキーワードが使われているだけのもの）。「${keyword}」という言葉が指しうる範囲（同じ言葉の別ジャンル・別用途・別ブランドなど）は狭く決めつけず、商品自体がその言葉で呼ばれる実物であれば relevant は true としてください（ユーザーが想定していそうな用途に絞り込みすぎないこと）。
- shortName: 楽天の商品名はSEOのためのキーワード羅列で非常に長いことが多いので、「商品の種類＋特徴を1つだけ（産地やブランド名など）」程度に要約してください。送料・価格・キャンペーン文言（例:「送料無料」「◯円以上」「ギフト」「マラソン限定クーポン」）や、同じ単語の繰り返しは含めないでください。（例:「梅シロップ 長野県産梅使用 250ml 1本 3980円以上 送料無料...みつどんマルシェ」→「長野県産 梅シロップ」）
- origin: 「${keyword}」が食品・飲料のジャンルの場合のみ、原材料の産地となる都道府県名を商品名・説明文から抽出してください（例:「長野県」）。地名だけが書かれている場合（紀州→和歌山県、南高梅→和歌山県など）は分かる範囲で都道府県名に変換してください。食品・飲料以外のジャンル（家電・雑貨・衣類・日用品など）の場合は、販売元やメーカーの所在地が分かっても origin には入れず、必ず空文字にしてください（メーカー名は次のmakerに書きます）。
- maker: 販売者・製造者・ブランド名など（例:「飯綱町ふるさと振興公社」「みつどんマルシェ」）。商品名や説明文にあれば抽出し、なければ空文字。
- feature: 商品の特徴を一言で（15文字程度）。origin・maker・specs・attrHitsのどれとも重複しない情報を書いてください（例:「無添加でじっくり手作り」）。無ければ空文字。
- specs: 上記2のspecFieldsそれぞれについて、この商品での値を商品名・説明文から抽出し、idと短いvalue（例:「250ml」「有線」「メカニカル(茶軸)」「Mサイズ」）の組で返してください。読み取れなければvalueは空文字。食品の『原材料』にあたる項目では、食べられる成分だけをカンマ区切りで（瓶・容器・調理器具・手作りキットの道具類は絶対に含めない）。
- attrHits: 上記1で挙げたattributesそれぞれについて、その商品がその観点に当てはまる記載があるか（true/false）
- quantityValue, quantityUnit: 重さ(g/kg)または体積(ml/L)で表せる内容量がある場合のみ設定（Lはml×1000、kgはg×1000に換算）。単価計算にだけ使う補助情報なので、該当しないジャンルでは quantityValue を 0、quantityUnit を空文字にしてください。

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
