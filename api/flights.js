// api/flights.js
// Live flygdata via ADSB.lol
// Fungerar med Vercel Serverless Functions.

module.exports = async function handler(req, res) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "s-maxage=5, stale-while-revalidate=10"
  );

  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      error: "Endast GET-anrop stöds."
    });
  }

  const API = "https://api.adsb.lol/v2";

  // Läs sökningen från index.html.
  const query = String(req.query.q || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 16);

  // Kartans centrum.
  const lat = Number(req.query.lat ?? 59.5);
  const lon = Number(req.query.lon ?? 17.5);
  const dist = Number(req.query.dist ?? 100);

  // Kontrollera att kartans koordinater är giltiga.
  if (
    !query &&
    (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(dist) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180 ||
      dist < 1
    )
  ) {
    return res.status(400).json({
      error: "Ogiltiga koordinater eller distans."
    });
  }

  if (req.query.q && !query) {
    return res.status(400).json({
      error: "Ange ett giltigt flygnummer eller en registrering."
    });
  }

  // Begränsa sökningar och kartans radie.
  const safeDist = Math.min(250, Math.max(1, dist));

  let urls = [];

  if (query) {
    // Sök både callsign och flygplansregistrering.
    urls = [
      `${API}/callsign/${encodeURIComponent(query)}`,
      `${API}/registration/${encodeURIComponent(query)}`
    ];
  } else {
    // Hämta flygplan runt kartans aktuella centrum.
    urls = [
      `${API}/lat/${lat}/lon/${lon}/dist/${safeDist}`
    ];
  }

  try {
    let aircraft = [];
    let rateLimited = false;

    for (const url of urls) {
      let response;

      try {
        response = await fetch(url, {
          headers: {
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(10000)
        });
      } catch (error) {
        console.error("Anslutningsfel till ADSB.lol:", error);
        continue;
      }

      if (response.status === 429) {
        rateLimited = true;
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

      const records = Array.isArray(data.ac)
        ? data.ac
        : [];

      if (records.length > 0) {
        aircraft = records;
        break;
      }
    }

    if (aircraft.length === 0 && rateLimited) {
      return res.status(429).json({
        error:
          "Flygdatakällan begränsar tillfälligt antalet anrop. Vänta en stund och försök igen."
      });
    }

    // Omvandla datakällans format till formatet
    // som index.html använder.
    const flights = aircraft
      .filter(plane => {
        const hasPosition =
          typeof plane.lat === "number" &&
          typeof plane.lon === "number" &&
          Number.isFinite(plane.lat) &&
          Number.isFinite(plane.lon);

        // Visa civila flygplan, inte poster som
        // uttryckligen är markerade som militära.
        const isMilitary =
          plane.mil === true ||
          plane.military === true;

        return hasPosition && !isMilitary;
      })
      .map(plane => {
        const barometricAltitude =
          typeof plane.alt_baro === "number"
            ? plane.alt_baro
            : null;

        const geometricAltitude =
          typeof plane.alt_geom === "number"
            ? plane.alt_geom
            : null;

        const altitude =
          barometricAltitude !== null
            ? barometricAltitude
            : geometricAltitude;

        const speed =
          typeof plane.gs === "number"
            ? plane.gs
            : null;

        const heading =
          typeof plane.track === "number"
            ? plane.track
            : typeof plane.true_heading === "number"
              ? plane.true_heading
              : null;

        return {
          hex: String(plane.hex || "").toLowerCase(),

          flight: String(
            plane.flight || ""
          ).trim(),

          reg: String(
            plane.r || plane.registration || ""
          ).trim(),

          type: String(
            plane.t || plane.desc || ""
          ).trim(),

          icaoType: String(
            plane.t || ""
          ).trim(),

          lat: plane.lat,
          lon: plane.lon,

          altitudeFt: altitude,

          altitudeSource:
            barometricAltitude !== null
              ? "barometric"
              : geometricAltitude !== null
                ? "geometric"
                : null,

          speedKt: speed,

          heading: heading,

          seenSeconds:
            typeof plane.seen_pos === "number"
              ? plane.seen_pos
              : typeof plane.seen === "number"
                ? plane.seen
                : null,

          onGround: plane.alt_baro === "ground"
        };
      });

    return res.status(200).json({
      source: "ADSB.lol",
      updatedAt: new Date().toISOString(),
      count: flights.length,
      flights: flights
    });

  } catch (error) {
    console.error("Flights API error:", error);

    return res.status(502).json({
      error:
        "Kunde inte hämta flygdata. Försök igen senare."
    });
  }
};
