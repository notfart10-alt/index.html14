```javascript
// api/photo.js
// Flygplansbilder och reservsökningar.
// Vercel Serverless Function.

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "s-maxage=1800, stale-while-revalidate=3600"
  );

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Endast GET stöds." });
  }

  const clean = (value, maxLength) =>
    String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9 -]/g, "")
      .slice(0, maxLength);

  const reg = clean(req.query.reg, 15).toUpperCase();
  const hex = clean(req.query.hex, 6).toLowerCase();

  if (!reg && !hex) {
    return res.status(400).json({
      error: "Registrering eller ICAO-hexkod krävs."
    });
  }

  const searchTerm = reg || hex;

  const searchLinks = {
    google:
      "https://www.google.com/search?tbm=isch&q=" +
      encodeURIComponent(searchTerm + " aircraft"),

    jetphotos:
      "https://www.jetphotos.com/search?q=" +
      encodeURIComponent(reg || searchTerm),

    planespotters:
      "https://www.planespotters.net/search?q=" +
      encodeURIComponent(reg || searchTerm)
  };

  const endpoints = [];

  if (reg) {
    endpoints.push(
      "https://api.planespotters.net/pub/photos/reg/" +
      encodeURIComponent(reg)
    );
  }

  if (hex) {
    endpoints.push(
      "https://api.planespotters.net/pub/photos/hex/" +
      encodeURIComponent(hex)
    );
  }

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) continue;

      const data = await response.json();

      const photos = (Array.isArray(data.photos) ? data.photos : [])
        .map(photo => {
          const thumbnail =
            photo.thumbnail_large?.src ||
            photo.thumbnail?.src ||
            photo.image?.src ||
            null;

          return {
            src: thumbnail,
            link: photo.link || null,
            photographer: photo.photographer || null,
            date: photo.date || null,
            source: "Planespotters.net"
          };
        })
        .filter(photo => {
          if (!photo.src) return false;

          try {
            const url = new URL(photo.src);
            return url.protocol === "https:";
          } catch {
            return false;
          }
        });

      if (photos.length) {
        return res.status(200).json({
          found: true,
          photos,
          searchLinks
        });
      }
    } catch (error) {
      console.error("Planespotters lookup failed:", error.message);
    }
  }

  // Ingen bild hittades. Skicka riktiga söklänkar i stället
  // för att returnera en trasig eller påhittad bildadress.
  return res.status(200).json({
    found: false,
    photos: [],
    searchLinks,
    message: "Ingen direkt bild hittades. Prova bildsökningarna."
  });
};
```
