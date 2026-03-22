// ── search.js ─────────────────────────────────────────────────────────────────
// Serper (primary) → Tavily (fallback) → graceful degradation string

import axios from "axios";

async function searchSerper(query) {
  const { data } = await axios.post(
    "https://google.serper.dev/search",
    { q: query, num: 5, gl: "in", hl: "en" },
    {
      headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
      timeout: 8000,
    }
  );

  const results = [];
  if (data.answerBox?.answer) results.push(`Answer: ${data.answerBox.answer}`);
  data.organic?.slice(0, 4).forEach((r) => results.push(`${r.title}\n${r.snippet ?? ""}`));
  if (!results.length) throw new Error("No results from Serper");
  return results.join("\n\n");
}

async function searchTavily(query) {
  const { data } = await axios.post(
    "https://api.tavily.com/search",
    { api_key: process.env.TAVILY_API_KEY, query, search_depth: "basic", max_results: 4, include_answer: true },
    { timeout: 8000 }
  );

  const results = [];
  if (data.answer) results.push(`Summary: ${data.answer}`);
  data.results?.slice(0, 3).forEach((r) => results.push(`${r.title}\n${r.content?.slice(0, 300) ?? ""}`));
  if (!results.length) throw new Error("No results from Tavily");
  return results.join("\n\n");
}

/**
 * @param {string} query
 * @returns {Promise<string>}
 */
export async function webSearch(query) {
  const q = query.replace(/^["']|["']$/g, "").trim();

  if (process.env.SERPER_API_KEY) {
    try { return await searchSerper(q); }
    catch (e) { console.warn("[search] Serper failed:", e.message); }
  }

  if (process.env.TAVILY_API_KEY) {
    try { return await searchTavily(q); }
    catch (e) { console.warn("[search] Tavily failed:", e.message); }
  }

  return `Search unavailable for "${q}". Reason based on general knowledge of Indian travel costs.`;
}