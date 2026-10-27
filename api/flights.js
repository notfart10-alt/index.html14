
module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Endast GET stöds"
    });
  }

  return res.status(503).json({
    error: "Ingen flygdatakälla är ansluten ännu",
    configured: false
  });
};
