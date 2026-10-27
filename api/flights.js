// api/flights.js
// Live-data för civila flygplan via ADSB.lol.
// Vercel Serverless Function.

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=10");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Endast GET stöds." });
  }

  const API = "https://api.adsb.lol/v2";

  const query = String(req.query.q || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 16);

  const lat = Number(req.query.lat ?? 59.5);
  const lon = Number(req.query.lon ?? 17.5);
  const requestedDist = Number(req.query.dist ?? 250);

  if (
    !query &&
    (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(requestedDist) ||
      lat < -90 || lat > 90 ||
      lon < -180 || lon > 180 ||
      requestedDist < 1
    )
  ) {
    return res.status(400).json({
      error: "Ogiltiga koordinater eller sökradie."
    });
  }

  if (req.query.q && !query) {
    return res.status(400).json({
      error: "Ange ett giltigt flygnummer eller en registrering."
    });
  }

  // ADSB.lol tillåter högst 250 nautiska mil.
  const dist = Math.min(250, Math.max(1, requestedDist));

  let urls;

  if (query) {
    const looksLikeRegistration =
      query.includes("-") ||
      /^[A-Z]{1,3}[0-9]{1,5}$/.test(query);

    const registrationUrl =
      `${API}/registration/${encodeURIComponent(query)}`;

    const callsignUrl =
      `${API}/callsign/${encodeURIComponent(query)}`;

    // Prova den mest sannolika söktypen först.
    urls = looksLikeRegistration
      ? [registrationUrl, callsignUrl]
      : [callsignUrl, registrationUrl];
  } else {
    urls = [
      `${API}/lat/${lat}/lon/${lon}/dist/${dist}`
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

        if (Array.isArray(data.ac) && data.ac.length) {
          aircraft = data.ac;
          break;
        }
      } catch (error) {
        upstreamFailed = true;
        console.error("ADSB.lol request failed:", error);
      }
    }

    if (!aircraft.length && rateLimited) {
      return res.status(429).json({
        error: "Flygdatakällan är tillfälligt överbelastad. Försök igen om en stund."
      });
    }

    if (!aircraft.length && upstreamFailed) {
      return res.status(502).json({
        error: "Flygdatakällan kunde inte nås. Försök igen senare."
      });
    }

    const flights = aircraft
      .filter(plane => {
        const hasPosition =
          typeof plane.lat === "number" &&
          typeof plane.lon === "number" &&
          Number.isFinite(plane.lat) &&
          Number.isFinite(plane.lon);

        // Filtrera bort flygplan som uttryckligen flaggats
        // som militära av datakällan.
        const isMilitary =
          plane.mil === true ||
          plane.military === true;

        return hasPosition && !isMilitary;
      })
      .map(plane => {
        const baro =
          typeof plane.alt_baro === "number"
            ? plane.alt_baro
            : null;

        const geom =
          typeof plane.alt_geom === "number"
            ? plane.alt_geom
            : null;

        return {
          hex: String(plane.hex || "").toLowerCase(),
          flight: String(plane.flight || "").trim(),
          reg: String(plane.r || plane.registration || "").trim(),
          type: String(plane.t || plane.desc || "").trim(),
          icaoType: String(plane.t || "").trim(),

          lat: plane.lat,
          lon: plane.lon,

          altitudeFt: baro !== null ? baro : geom,

          altitudeSource:
            baro !== null
              ? "barometric"
              : geom !== null
                ? "geometric"
                : null,

          speedKt:
            typeof plane.gs === "number" ? plane.gs : null,

          heading:
            typeof plane.track === "number"
              ? plane.track
              : typeof plane.true_heading === "number"
                ? plane.true_heading
                : null,

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
      flights
    });

  } catch (error) {
    console.error("Flights API error:", error);

    return res.status(502).json({
      error: "Ett oväntat fel inträffade när flygdata hämtades."
    });
  }
};
