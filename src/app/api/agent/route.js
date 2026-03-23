// Max 2 complete planning attempts if budget is exceeded.

import { NextResponse }          from "next/server";
import { validateDestination }   from "./validateDestination";
import { callGemini }            from "./gemini";
import { parseAgentResponse, parseBudgetFailureResponse } from "./parseAgent";
import {
  SYSTEM_PROMPT,
  buildGoalPrompt,
  buildRetryPrompt,
  buildBudgetFailurePrompt,
} from "./prompts";
import { webSearch }  from "./search";
import { getWeather } from "./weather";

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_LOOPS           = 2;   // max full planning attempts if over budget
const MAX_TOOL_CALLS      = 7;   // safety cap on tool calls per loop
const MAX_TOOL_CALL_TOTAL = 14;  // hard cap across entire request

// Minimum per-person spend to be considered a viable plan (INR)
const MIN_FOOD_PER_PERSON_PER_DAY   = 300;
const MIN_STAY_PER_PERSON_PER_NIGHT = 400;

// ── Haversine distance (km) ───────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ── Geocode a text location via Nominatim ─────────────────────────────────────

async function geocodeLocation(name) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en", "User-Agent": "TravelPlannerApp/1.0" } }
    );
    const data = await res.json();
    if (!data?.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

// ── Viability check ───────────────────────────────────────────────────────────
// Returns true if the cost is so low it almost certainly omits food and/or stay.

function isSuspiciouslyCheap(cost, travelers, tripDays) {
  const minViable =
    MIN_FOOD_PER_PERSON_PER_DAY   * travelers * tripDays +
    MIN_STAY_PER_PERSON_PER_NIGHT * travelers * Math.max(1, tripDays - 1);
  return cost < minViable;
}

// ── Tool router ───────────────────────────────────────────────────────────────

async function executeTool(toolName, toolInput) {
  console.log(`[tool] ${toolName}(${toolInput.slice(0, 80)})`);

  switch (toolName) {
    case "web_search":
      return await webSearch(toolInput);

    case "get_weather": {
      const parts     = toolInput.split(/,\s*/);
      const location  = parts[0]?.trim() ?? toolInput;
      const startDate = parts[1]?.trim() ?? "";
      const endDate   = parts[2]?.trim() ?? "";
      return await getWeather(location, startDate, endDate);
    }

    case "calculate":
      return calculate(toolInput);

    default:
      return `Unknown tool "${toolName}". Available: web_search, get_weather, calculate.`;
  }
}

// ── Input validation ──────────────────────────────────────────────────────────

function validatePayload(body) {
  const errors = [];
  const { destination, origin, startDate, endDate, budget, travelers, preferences } = body;

  if (!origin || typeof origin !== "string" || origin.trim().length < 3)
    errors.push("origin (starting point) is required — at least 3 characters");

  if (!destination || typeof destination !== "string")
    errors.push("destination is required");

  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate))
    errors.push("startDate must be YYYY-MM-DD");

  if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
    errors.push("endDate must be YYYY-MM-DD");

  if (startDate && endDate && endDate <= startDate)
    errors.push("endDate must be after startDate");

  if (typeof budget !== "number" || budget < 500)
    errors.push("budget must be a number >= 500");

  if (typeof travelers !== "number" || travelers < 1 || travelers > 20)
    errors.push("travelers must be between 1 and 20");

  if (!Array.isArray(preferences) || preferences.length === 0)
    errors.push("at least one preference is required");

  return errors;
}

// ── GET (debug) ───────────────────────────────────────────────────────────────

export async function GET(request) {
  const result = await getWeather("Mumbai", "2026-04-01", "2026-04-05");
  console.log(result);
  return NextResponse.json({ result });
}

// ── POST (main) ───────────────────────────────────────────────────────────────

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // 1. Validate payload shape
  const payloadErrors = validatePayload(body);
  if (payloadErrors.length > 0) {
    return NextResponse.json(
      { error: "Invalid request.", details: payloadErrors },
      { status: 400 }
    );
  }

  const {
    destination,
    startDate,
    endDate,
    budget,
    travelers,
    preferences,
    coordinates,       // { lat, lng } from destination map click
    origin,            // string — required
    originCoordinates, // { lat, lng } from GPS or origin map click
    transportPref,     // "any" | "flight" | "train" | "bus" | "car"
  } = body;

  const isMapSelected = !!coordinates;

  // 2. Validate destination
  const destValidation = await validateDestination(destination, isMapSelected);
  if (!destValidation.valid) {
    return NextResponse.json({ error: destValidation.reason }, { status: 422 });
  }

  const canonicalDestination = destValidation.canonicalName ?? destination;
  const tripDays = Math.ceil(
    (new Date(endDate) - new Date(startDate)) / 86400000
  );

  // 3. Resolve coordinates and compute distance
  let destCoords = coordinates ?? null;
  let origCoords = originCoordinates ?? null;
  let distanceKm = null;

  if (!destCoords) {
    destCoords = await geocodeLocation(canonicalDestination);
  }
  if (origin && !origCoords) {
    origCoords = await geocodeLocation(origin);
  }
  if (origCoords && destCoords) {
    distanceKm = haversineKm(
      origCoords.lat, origCoords.lng,
      destCoords.lat, destCoords.lng
    );
  }

  // 4. Build initial message
  const goalPrompt = buildGoalPrompt({
    destination: canonicalDestination,
    origin,
    originCoordinates: origCoords,
    startDate,
    endDate,
    tripDays,
    budget,
    travelers,
    preferences,
    transportPref: transportPref ?? "any",
    distanceKm,
  });

  let messages = [{ role: "user", content: goalPrompt }];

  const trace = [];

  // State tracked across the whole request
  let loopCount           = 0;
  let totalToolCalls      = 0;
  let bestEstimate        = Infinity;
  let lastFinalAnswer     = null;
  let lastParsedTransport = null;

  // 5. ReAct loop ─────────────────────────────────────────────────────────────
  while (loopCount < MAX_LOOPS) {
    let toolCallsThisLoop = 0;

    // Inner loop — keeps running until the LLM produces a Final Answer
    while (toolCallsThisLoop < MAX_TOOL_CALLS && totalToolCalls < MAX_TOOL_CALL_TOTAL) {

      // Call the LLM
      let llmResponse;
      try {
        llmResponse = await callGemini(SYSTEM_PROMPT, messages);
      } catch (err) {
        return NextResponse.json(
          { error: `LLM error: ${err.message}` },
          { status: 502 }
        );
      }

      const parsed = parseAgentResponse(llmResponse);

      if (parsed.thought) {
        trace.push({ type: "thought", content: parsed.thought });
      }

      // Tool call branch
      if (parsed.isToolCall) {
        trace.push({ type: "action", content: `${parsed.toolName}(${parsed.toolInput})` });

        const observation = await executeTool(parsed.toolName, parsed.toolInput);
        trace.push({ type: "observation", content: observation });

        messages.push({ role: "model", content: llmResponse });
        messages.push({ role: "user",  content: `Observation: ${observation}` });

        toolCallsThisLoop++;
        totalToolCalls++;
        continue; // stay in inner loop
      }

      // Final answer branch
      if (parsed.isFinalAnswer) {
        lastFinalAnswer = parsed.finalAnswer;
        if (parsed.transportRecommendation) {
          lastParsedTransport = parsed.transportRecommendation;
        }

        const cost = parsed.estimatedCost ?? Infinity;
        if (cost < bestEstimate) bestEstimate = cost;

        trace.push({ type: "result", content: `Estimated cost: ₹${cost.toLocaleString("en-IN")}` });

        // Check 1 — missing food/stay (suspiciously cheap)
        if (isSuspiciouslyCheap(cost, travelers, tripDays)) {
          const minFood = (MIN_FOOD_PER_PERSON_PER_DAY * travelers * tripDays).toLocaleString("en-IN");
          const minStay = (MIN_STAY_PER_PERSON_PER_NIGHT * travelers * Math.max(1, tripDays - 1)).toLocaleString("en-IN");
          const nudge =
            `Your plan costs ₹${cost.toLocaleString("en-IN")} but appears to omit accommodation and/or food costs.\n` +
            `A realistic plan for ${travelers} traveler${travelers > 1 ? "s" : ""} over ${tripDays} days must include at minimum:\n` +
            `- Food: ₹${minFood} (₹${MIN_FOOD_PER_PERSON_PER_DAY}/person/day)\n` +
            `- Stay: ₹${minStay} (₹${MIN_STAY_PER_PERSON_PER_NIGHT}/person/night)\n` +
            `Please redo the Final Answer with ALL cost categories included.`;

          messages.push({ role: "model", content: llmResponse });
          messages.push({ role: "user",  content: nudge });
          trace.push({ type: "retry", content: nudge });
          toolCallsThisLoop++;
          continue; // stay in inner loop for redo
        }

        // Check 2 — underutilising the budget
        if (cost < budget * 0.75) {
          const minTarget = Math.round(budget * 0.75).toLocaleString("en-IN");
          const pct       = Math.round((cost / budget) * 100);
          const nudge =
            `Your plan costs ₹${cost.toLocaleString("en-IN")} (${pct}% of the ₹${budget.toLocaleString("en-IN")} budget). ` +
            `This is too conservative — the user wants to spend their budget on a good trip.\n` +
            `Please upgrade the plan to reach at least ₹${minTarget} (75% of budget) by:\n` +
            `- Upgrading to a better hotel tier\n` +
            `- Adding more activities or day trips matching their preferences\n` +
            `- Including nicer restaurant options or a special dinner\n` +
            `- Adding local sightseeing or experiences\n` +
            `Keep the same destination, dates, and travel mode. Just make it a better trip.`;

          messages.push({ role: "model", content: llmResponse });
          messages.push({ role: "user",  content: nudge });
          trace.push({ type: "retry", content: nudge });
          toolCallsThisLoop++;
          continue; // stay in inner loop for redo
        }

        // Check 3 — over budget
        if (cost > budget) {
          loopCount++;
          if (loopCount < MAX_LOOPS) {
            const retryMsg = buildRetryPrompt(budget, cost, loopCount + 1);
            messages.push({ role: "model", content: llmResponse });
            messages.push({ role: "user",  content: retryMsg });
            trace.push({ type: "retry", content: retryMsg });
          }
          break; // exit inner loop, outer loop will retry
        }

        // All checks passed — return success
        return NextResponse.json({
          success:              true,
          destination:          canonicalDestination,
          itinerary:            parsed.finalAnswer,
          estimatedCost:        cost,
          budget,
          tripDays,
          trace,
          recommendedTransport: parsed.transportRecommendation ?? null,
          origin:               origin ?? null,
          distanceKm,
        });
      }

      // No recognisable structure — nudge the LLM
      messages.push({ role: "model", content: llmResponse });
      messages.push({
        role:    "user",
        content: "Please continue. Use the format: Thought: ... then either Action: tool_name(input) or ESTIMATED_COST: <number> followed by Final Answer:",
      });
      toolCallsThisLoop++;
    }
    // end inner loop
  }
  // end outer loop

  // 6. All loops exhausted — explain the budget failure
  let reasons     = [];
  let suggestions = [];
  let biggestCost = null;

  try {
    const failurePrompt   = buildBudgetFailurePrompt(budget, bestEstimate);
    const failureMessages = [...messages, { role: "user", content: failurePrompt }];
    const failureResponse = await callGemini(SYSTEM_PROMPT, failureMessages);
    const failParsed      = parseBudgetFailureResponse(failureResponse);
    reasons     = failParsed.reasons;
    suggestions = failParsed.suggestions;
    biggestCost = failParsed.biggestCost;
  } catch {
    reasons = ["The minimum trip cost exceeds your budget based on current prices."];
  }

  const suggestedBudget = bestEstimate === Infinity
    ? null
    : Math.ceil((bestEstimate * 1.1) / 1000) * 1000;

  return NextResponse.json({
    success:              false,
    destination:          canonicalDestination,
    loopsAttempted:       loopCount,
    userBudget:           budget,
    lowestEstimate:       bestEstimate === Infinity ? null : bestEstimate,
    suggestedBudget,
    reasons,
    biggestCost,
    suggestions,
    lastItineraryAttempt: lastFinalAnswer,
    trace,
    recommendedTransport: lastParsedTransport ?? null,
    origin:               origin ?? null,
    distanceKm,
  }, { status: 200 });
}