// api/photo.js
// Hämtar flygplansbilder från Planespotters.net.
// En bild visas bara om en matchning hittas.

module.exports = async function handler(req, res) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "s-maxage=3600, stale-while-revalidate=7200"
  );

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      error: "Endast GET-anrop stöds."
    });
  }

  const hex = String(req.query.hex || "")
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "")
    .slice(0, 6);

  const reg = String(req.query.reg || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 12);

  if (!hex && !reg) {
    return res.status(200).json({
      photos: []
    });
  }

  const endpoints = [];

  if (hex) {
    endpoints.push(
      "https://api.planespotters.net/pub/photos/hex/" +
      encodeURIComponent(hex)
    );
  }

  if (reg) {
    endpoints.push(
      "https://api.planespotters.net/pub/photos/reg/" +
      encodeURIComponent(reg)
    );
  }

  try {
    for (const endpoint of endpoints) {
      let response;

      try {
        response = await fetch(endpoint, {
          headers: {
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(8000)
        });
      } catch (error) {
        console.error("Bildtjänsten kunde inte nås:", error);
        continue;
      }

      if (!response.ok) {
        continue;
      }

      let data;

      try {
        data = await response.json();
      } catch {
        continue;
      }

      const photos = (
        Array.isArray(data.photos)
          ? data.photos
          : []
      )
        .slice(0, 5)
        .map(photo => ({
          src:
            photo.thumbnail_large?.src ||
            photo.thumbnail?.src ||
            "",

          link:
            photo.link ||
            "https://www.planespotters.net/",

          photographer:
            photo.photographer || "",

          date:
            photo.date || ""
        }))
        .filter(photo => photo.src);

      if (photos.length > 0) {
        return res.status(200).json({
          photos: photos
        });
      }
    }

    return res.status(200).json({
      photos: []
    });

  } catch (error) {
    console.error("Photo API error:", error);

    return res.status(200).json({
      photos: []
    });
  }
};
