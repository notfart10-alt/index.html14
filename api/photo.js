// api/photo.js
// Flygplansbilder från Planespotters.net.
// Försöker registrering först och hexkod därefter.

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Endast GET stöds." });
  }

  const reg = String(req.query.reg || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 12);

  const hex = String(req.query.hex || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "")
    .slice(0, 6);

  if (!reg && !hex) {
    return res.status(200).json({ photos: [] });
  }

  const endpoints = [];

  if (reg) {
    endpoints.push(
      `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`
    );
  }

  if (hex) {
    endpoints.push(
      `https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex)}`
    );
  }

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        console.warn("Photo API returned:", response.status);
        continue;
      }

      const data = await response.json();

      const records = Array.isArray(data.photos)
        ? data.photos
        : [];

      const photos = records
        .map(photo => {
          const src =
            photo.thumbnail_large?.src ||
            photo.thumbnail?.src ||
            photo.image?.src ||
            "";

          const link = photo.link || "";

          return {
            src,
            link,
            photographer: photo.photographer || "",
            date: photo.date || ""
          };
        })
        .filter(photo => {
          // Acceptera bara fullständiga HTTPS-bildadresser.
          try {
            return new URL(photo.src).protocol === "https:";
          } catch {
            return false;
          }
        })
        .slice(0, 5);

      if (photos.length) {
        return res.status(200).json({ photos });
      }

    } catch (error) {
      console.error("Photo lookup failed:", error);
    }
  }

  return res.status(200).json({ photos: [] });
};
