// ── gemini.js ─────────────────────────────────────────────────────────────────

import axios from "axios";

const GEMINI_MODEL  = "gemini-2.5-flash-lite";
const GEMINI_URL    = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_RETRIES   = 4;
const BASE_DELAY_MS = 2000; // doubles each retry: 2s → 4s → 8s → 16s

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * @param {string} systemPrompt
 * @param {{ role: "user"|"model"|"assistant", content: string }[]} messages
 * @returns {Promise<string>}
 */
export async function callGemini(systemPrompt, messages) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");

  const contents = messages.map((m) => ({
    role:  m.role === "assistant" ? "model" : m.role,
    parts: [{ text: m.content }],
  }));

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature:     0.4,
      maxOutputTokens: 2048,
      topP:            0.8,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  };

  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data } = await axios.post(
        `${GEMINI_URL}?key=${key}`,
        body,
        { headers: { "Content-Type": "application/json" }, timeout: 30000 }
      );

      const candidate = data.candidates?.[0];
      if (!candidate) {
        const reason = data.promptFeedback?.blockReason;
        throw new Error(reason ? `Gemini blocked: ${reason}` : "Gemini returned no candidates");
      }
      if (candidate.finishReason === "SAFETY") {
        throw new Error("Gemini blocked response (safety).");
      }

      const text = candidate.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text.trim()) throw new Error("Gemini returned an empty response.");

      return text; // ✓ success

    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
console.log("ERROR DATA:", err.response?.data);
      // These status codes are retryable
      const isRateLimit   = status === 429;
      const isOverloaded  = status === 503;
      const isServerError = status >= 500 && status < 600 && status !== 503;

      const shouldRetry = (isRateLimit || isOverloaded || isServerError) && attempt < MAX_RETRIES - 1;

      if (!shouldRetry) break; // not retryable or final attempt — exit loop

      // Respect Retry-After header if Gemini sends one, otherwise use exponential backoff
      const retryAfterHeader = err?.response?.headers?.["retry-after"];
      const waitMs = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : BASE_DELAY_MS * Math.pow(2, attempt);

      console.warn(
        `[gemini] ${status} on attempt ${attempt + 1}/${MAX_RETRIES} — waiting ${waitMs / 1000}s before retry`
      );

      await sleep(waitMs);
    }
  }

  // All retries exhausted — throw with a clear message
  const status = lastError?.response?.status;
  if (status === 429) {
    throw new Error("RATE_LIMITED: Gemini API rate limit reached. Please wait a moment and try again.");
  }
  throw lastError;
}