import https from "node:https";

function get(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const result = await get("httpbin.org", "/get", {
      Referer: "https://kujou-negi.github.io/mychoice/",
    });
    res.status(200).json({ from: "httpbin", raw: result.body });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
