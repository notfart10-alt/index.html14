```javascript
// api/flights.js
// Liveflygdata från ADSB.lol för Vercel.

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=10");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Endast GET stöds." });
  }

  const API = "https://api.adsb.lol/v2";

  const q = String(req.query.q || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 16);

  const lat = Number(req.query.lat ?? 58.6);
  const lon = Number(req.query.lon ?? 15.2);
  const dist = Number(req.query.dist ?? 250);

  if (req.query.q && !q) {
    return res.status(400).json({
      error: "Ange ett giltigt flygnummer eller en registrering."
    });
  }

  if (!q && (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(dist) ||
    lat < -90 || lat > 90 ||
    lon < -180 || lon > 180 ||
    dist < 1
  )) {
    return res.status(400).json({
      error: "Ogiltiga koordinater eller sökradie."
    });
  }

  const radius = Math.min(250, Math.max(1, dist));

  let urls;

  if (q) {
    const looksLikeRegistration =
      q.includes("-") || /^[A-Z]{1,3}[0-9]{1,5}$/.test(q);

    const byRegistration =
      `${API}/reg/${encodeURIComponent(q)}`;

    const byCallsign =
      `${API}/callsign/${encodeURIComponent(q)}`;

    urls = looksLikeRegistration
      ? [byRegistration, byCallsign]
      : [byCallsign, byRegistration];
  } else {
    urls = [
      `${API}/lat/${lat}/lon/${lon}/dist/${radius}`
    ];
  }

  try {
    let aircraft = [];
    let rateLimited = false;
    let upstreamFailed = false;

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000)
        });

        if (response.status === 429) {
          rateLimited = true;
          continue;
        }

        if (!response.ok) {
          upstreamFailed = true;
          continue;
        }

        const data = await response.json();

        if (Array.isArray(data.ac)) {
          aircraft = data.ac;
          break;
        }
      } catch (error) {
        upstreamFailed = true;
        console.error("ADSB.lol:", error.message);
      }
    }

    if (!aircraft.length && rateLimited) {
      return res.status(429).json({
        error: "För många förfrågningar. Vänta en stund och försök igen."
      });
    }

    if (!aircraft.length && upstreamFailed) {
      return res.status(502).json({
        error: "Flygdatakällan kunde inte nås just nu."
      });
    }

    const flights = aircraft
      .filter(p =>
        typeof p.lat === "number" &&
        typeof p.lon === "number" &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        p.lat >= -90 && p.lat <= 90 &&
        p.lon >= -180 && p.lon <= 180 &&
        p.mil !== true &&
        p.military !== true
      )
      .map(p => {
        const baro =
          typeof p.alt_baro === "number" ? p.alt_baro : null;

        const geom =
          typeof p.alt_geom === "number" ? p.alt_geom : null;

        return {
          hex: String(p.hex || "").toLowerCase(),
          flight: String(p.flight || "").trim(),
          reg: String(p.r || p.registration || "").trim(),
          type: String(p.t || p.desc || "").trim(),
          icaoType: String(p.t || "").trim(),

          lat: p.lat,
          lon: p.lon,

          altitudeFt: baro !== null ? baro : geom,

          speedKt: typeof p.gs === "number" ? p.gs : null,

          heading:
            typeof p.track === "number"
              ? p.track
              : typeof p.true_heading === "number"
                ? p.true_heading
                : null,

          seenSeconds:
            typeof p.seen_pos === "number"
              ? p.seen_pos
              : typeof p.seen === "number"
                ? p.seen
                : null,

          onGround: p.alt_baro === "ground",

          // Transponderkod, exempelvis 7700 eller 7500.
          squawk: String(p.squawk || "").trim(),

          airline: String(p.airline || "").trim(),
          origin: p.origin || null,
          destination: p.destination || null
        };
      });

    return res.status(200).json({
      source: "ADSB.lol",
      updatedAt: new Date().toISOString(),
      count: flights.length,
      flights
    });

  } catch (error) {
    console.error("Flights API error:", error);

    return res.status(502).json({
      error: "Ett oväntat fel inträffade när flygdata hämtades."
    });
  }
};
```
