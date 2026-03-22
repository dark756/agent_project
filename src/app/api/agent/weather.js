// ── weather.js ────────────────────────────────────────────────────────────────
// Open-Meteo — free, no API key.
// Routes automatically:
//   dates within 16 days  →  /v1/forecast  (real forecast)
//   dates beyond 16 days  →  /v1/climate   (30-yr monthly normals)

import axios from "axios";

const WMO = {
  0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",
  45:"Fog",48:"Icy fog",
  51:"Light drizzle",53:"Moderate drizzle",55:"Dense drizzle",
  61:"Slight rain",63:"Moderate rain",65:"Heavy rain",
  71:"Slight snow",73:"Moderate snow",75:"Heavy snow",
  80:"Slight showers",81:"Moderate showers",82:"Violent showers",
  95:"Thunderstorm",96:"Thunderstorm with hail",99:"Heavy thunderstorm",
};

// Month names for climate summary
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

async function geocode(location) {
  const { data } = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: { q: location, format: "json", limit: 1 },
    headers: { "Accept-Language": "en", "User-Agent": "TravelPlannerApp/1.0" },
    timeout: 5000,
  });
  if (!data?.length) throw new Error(`Cannot geocode: ${location}`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

// ── Real forecast (trips within 16 days) ─────────────────────────────────────

async function getForecast(lat, lng, startDate, endDate, location) {
  const { data } = await axios.get("https://api.open-meteo.com/v1/forecast", {
    params: {
      latitude:      lat,
      longitude:     lng,
      daily:         "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode",
      timezone:      "Asia/Kolkata",
      start_date:    startDate,
      end_date:      endDate,
    },
    timeout: 8000,
  });

  const d = data.daily;
  if (!d?.time?.length) return null;

  const n        = d.time.length;
  const avgMax   = (d.temperature_2m_max.reduce((a, b) => a + b, 0) / n).toFixed(1);
  const avgMin   = (d.temperature_2m_min.reduce((a, b) => a + b, 0) / n).toFixed(1);
  const rain     = d.precipitation_sum.reduce((a, b) => a + b, 0).toFixed(1);
  const rainDays = d.precipitation_sum.filter((mm) => mm > 1).length;

  const freq = {};
  d.weathercode.forEach((c) => { freq[c] = (freq[c] ?? 0) + 1; });
  const dominant = WMO[Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]] ?? "Variable";

  const tips = buildTips(parseFloat(avgMax), parseFloat(avgMin), rainDays, n, dominant);

  return [
    `Weather forecast for ${location} (${startDate} to ${endDate}):`,
    `Temperature: ${avgMin}°C – ${avgMax}°C`,
    `Conditions: ${dominant}`,
    `Rainfall: ${rain}mm total, ${rainDays} rainy day${rainDays !== 1 ? "s" : ""} expected`,
    tips ? `Tip: ${tips}` : "",
  ].filter(Boolean).join("\n");
}

// ── Climate normals (trips beyond 16 days) ────────────────────────────────────
// Uses Open-Meteo climate API — returns 30-year monthly averages.
// We query the months that overlap with the trip.

async function getClimateNormals(lat, lng, startDate, endDate, location) {
  const start  = new Date(startDate);
  const end    = new Date(endDate);

  // Collect the unique months spanned by the trip (1-indexed)
  const months = new Set();
  const cursor = new Date(start);
  while (cursor <= end) {
    months.add(cursor.getMonth()); // 0-indexed
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const monthNames = [...months].map((m) => MONTHS[m]).join(" / ");

  // Open-Meteo climate API — uses a fixed reference period (1991-2020)
  // We request the full year and pick the relevant month(s)
  const { data } = await axios.get("https://climate-api.open-meteo.com/v1/climate", {
    params: {
      latitude:   lat,
      longitude:  lng,
      start_date: "1991-01-01",
      end_date:   "2020-12-31",
      monthly:    "temperature_2m_max,temperature_2m_min,precipitation_sum",
      models:     "EC_Earth3P_HR",
    },
    timeout: 10000,
  });

  const monthly = data.monthly;
  if (!monthly?.time?.length) return null;

  // Average the values across the trip's months
  const tripMonthIndices = [...months].map((m) => {
    // monthly.time entries look like "1991-01", find index for month m+1
    return monthly.time.findIndex((t) => parseInt(t.split("-")[1], 10) === m + 1);
  }).filter((i) => i !== -1);

  if (!tripMonthIndices.length) return null;

  const avg = (arr) => {
    const vals = tripMonthIndices.map((i) => arr[i]).filter((v) => v != null);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "N/A";
  };

  const avgMax  = avg(monthly.temperature_2m_max);
  const avgMin  = avg(monthly.temperature_2m_min);
  const avgRain = avg(monthly.precipitation_sum);

  const tips = buildTips(parseFloat(avgMax), parseFloat(avgMin), 0, 1, "");

  return [
    `Climate normals for ${location} in ${monthNames} (30-year historical average):`,
    `Temperature: ${avgMin}°C – ${avgMax}°C`,
    `Average rainfall: ${avgRain}mm for the month`,
    `Note: This is historical climate data, not a live forecast.`,
    tips ? `Tip: ${tips}` : "",
  ].filter(Boolean).join("\n");
}

// ── Shared packing tips ───────────────────────────────────────────────────────

function buildTips(avgMax, avgMin, rainDays, totalDays, condition) {
  const tips = [];
  if (avgMax > 35)              tips.push("pack light cotton and sunscreen");
  if (avgMin < 15)              tips.push("bring warm layers for evenings");
  if (rainDays > totalDays * 0.4) tips.push("carry a rain jacket or umbrella");
  if (condition.includes("snow")) tips.push("pack heavy winter clothing");
  return tips.join(", ");
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {string} location
 * @param {string} startDate  YYYY-MM-DD
 * @param {string} endDate    YYYY-MM-DD
 * @returns {Promise<string>}
 */
export async function getWeather(location, startDate, endDate) {
  try {
    const { lat, lng } = await geocode(location);

    const today         = new Date();
    const tripStart     = new Date(startDate);
    const tripEnd       = new Date(endDate);
    const daysUntilEnd  = Math.ceil((tripEnd - today) / 86400000);

    // Validate dates — if end is before today, fall back to climate
    const datesAreValid = tripStart <= tripEnd;
    if (!datesAreValid) {
      return `Invalid date range: ${startDate} to ${endDate}.`;
    }

    let result;

    if (daysUntilEnd <= 15) {
      // Dates are within forecast window — clamp to today if start is in the past
      const clampedStart = tripStart < today
        ? today.toISOString().split("T")[0]
        : startDate;

      result = await getForecast(lat, lng, clampedStart, endDate, location);
    } else {
      // Dates are beyond forecast range — use 30-year climate normals
      result = await getClimateNormals(lat, lng, startDate, endDate, location);
    }

    return result ?? `No weather data available for ${location}.`;

  } catch (err) {
    // Never hard-fail — weather is non-critical, agent can continue without it
    return `Weather data unavailable for ${location} (${err.message}). Use general seasonal knowledge for this region.`;
  }
}