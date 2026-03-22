// ── validateDestination.js ────────────────────────────────────────────────────
// Layer 1: blocklist + basic patterns  (instant)
// Layer 2: heuristics — vowels, repeats, keyboard mash  (instant)
// Layer 3: Nominatim geocode + importance score  (network call)

import axios from "axios";

const BLOCKLIST = new Set([
  "test","testing","asdf","qwerty","abc","abcd","xyz","aaa","hello","hi",
  "hey","place","location","destination","city","town","village","country",
  "india","world","earth","map","here","there","somewhere","anywhere",
  "nowhere","idk","na","n/a","none","null","undefined","example","sample",
  "dummy","fake","random","blah","foo","bar","baz",
]);

function hasEnoughVowels(str) {
  const letters = str.replace(/[^a-z]/gi, "");
  if (letters.length <= 4) return true;
  const vowels = (letters.match(/[aeiou]/gi) ?? []).length;
  return vowels / letters.length >= 0.2;
}

function hasRepeatedChars(str) {
  const s = str.replace(/\s/g, "").toLowerCase();
  if (s.length < 4) return false;
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] ?? 0) + 1;
  return Object.values(freq).some((n) => n / s.length > 0.6);
}

function isKeyboardMash(str) {
  return /^(asdf|qwer|zxcv|hjkl|uiop|1234|abcd)+$/i.test(str.replace(/\s/g, ""));
}

async function geocodeVerify(destination) {
  try {
    const { data } = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: { q: destination, format: "json", limit: 1, addressdetails: 0 },
      headers: { "Accept-Language": "en", "User-Agent": "TravelPlannerApp/1.0" },
      timeout: 5000,
    });

    if (!data?.length) {
      return { valid: false, reason: `We couldn't find "${destination}" on the map. Check the spelling or try a nearby city.` };
    }

    const importance = parseFloat(data[0].importance ?? 0);
    if (importance < 0.2) {
      return { valid: false, reason: `"${destination}" doesn't appear to be a well-known destination. Try being more specific (e.g. a city name).` };
    }

    const canonicalName = data[0].display_name?.split(",")[0] ?? destination;
    return { valid: true, canonicalName };
  } catch {
    // Nominatim unreachable — fail open so network issues don't block users
    return { valid: true, canonicalName: destination };
  }
}

/**
 * @param {string}  destination
 * @param {boolean} isMapSelected   Skips L1/L2 — coordinates are always real
 * @returns {Promise<{ valid: boolean, reason?: string, canonicalName?: string }>}
 */
export async function validateDestination(destination, isMapSelected = false) {
  const trimmed = destination.trim();

  if (isMapSelected) return { valid: true, canonicalName: trimmed };

  // Layer 1
  if (!trimmed || trimmed.length < 3)
    return { valid: false, reason: "Please enter a destination with at least 3 characters." };
  if (/^\d+$/.test(trimmed))
    return { valid: false, reason: "A destination can't be just numbers. Try a city or region name." };
  if (/^[^a-zA-Z]+$/.test(trimmed))
    return { valid: false, reason: "Please enter a valid place name." };
  if (BLOCKLIST.has(trimmed.toLowerCase()))
    return { valid: false, reason: `"${trimmed}" doesn't look like a real destination. Try a city like "Goa" or "Manali".` };

  // Layer 2
  if (!hasEnoughVowels(trimmed))
    return { valid: false, reason: `"${trimmed}" doesn't look like a real place name. Please check the spelling.` };
  if (hasRepeatedChars(trimmed))
    return { valid: false, reason: `"${trimmed}" doesn't look like a real destination.` };
  if (isKeyboardMash(trimmed))
    return { valid: false, reason: `"${trimmed}" doesn't look like a real destination.` };

  // Layer 3
  return await geocodeVerify(trimmed);
}