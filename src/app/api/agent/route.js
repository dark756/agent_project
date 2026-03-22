//API_KEY=AIzaSyAwxz10hj5BShF1rT7QG7ybpC7yqMkpKjU
// Max 3 complete planning attempts if budget is exceeded.

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

const MAX_LOOPS          = 2;    // max full planning attempts
const MAX_TOOL_CALLS     = 7;   // safety cap on tool calls per loop to avoid infinite loops
const MAX_TOOL_CALL_TOTAL = 14;  // hard cap across entire request

// ── Tool router ───────────────────────────────────────────────────────────────

async function executeTool(toolName, toolInput) {
  console.log(`[tool] ${toolName}(${toolInput.slice(0, 80)})`);

  switch (toolName) {
    case "web_search": {
      return await webSearch(toolInput);
    }

    case "get_weather": {
      const parts = toolInput.split(/,\s*/);
      const location  = parts[0]?.trim() ?? toolInput;
      const startDate = parts[1]?.trim() ?? "";
      const endDate   = parts[2]?.trim() ?? "";
      return await getWeather(location, startDate, endDate);
    }

    case "calculate": {
      return calculate(toolInput);
    }

    default:
      return `Unknown tool "${toolName}". Available tools: web_search, get_weather, calculate.`;
  }
}

// ── Input validation ──────────────────────────────────────────────────────────

function validatePayload(body) {
  const errors = [];
  const { destination, startDate, endDate, budget, travelers, preferences } = body;

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

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(request) {
   const location = "Mumbai";
  const startDate = "2026-04-01";
  const endDate = "2026-04-05";

  const result = await getWeather(location, startDate, endDate);
  console.log(result);
    return NextResponse.json({result})
}



export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // ── 1. Validate payload shape ─────────────────────────────────────────────
  const payloadErrors = validatePayload(body);
  if (payloadErrors.length > 0) {
    return NextResponse.json(
      { error: "Invalid request.", details: payloadErrors },
      { status: 400 }
    );
  }

  const { destination, startDate, endDate, budget, travelers, preferences, coordinates } = body;
  const isMapSelected = !!coordinates;

  // ── 2. Validate destination ───────────────────────────────────────────────
  const destValidation = await validateDestination(destination, isMapSelected);
  if (!destValidation.valid) {
    return NextResponse.json({ error: destValidation.reason }, { status: 422 });
  }

  const canonicalDestination = destValidation.canonicalName ?? destination;
  const tripDays = Math.ceil(
    (new Date(endDate) - new Date(startDate)) / 86400000
  );

  // ── 3. Build initial message history ─────────────────────────────────────
  const goalPrompt = buildGoalPrompt({
    destination: canonicalDestination,
    startDate, endDate, tripDays, budget, travelers, preferences,
  });

  let messages = [{ role: "user", content: goalPrompt }];

  // Trace collects every Thought / Action / Observation for the frontend
  const trace = [];

  let loopCount        = 0;
  let totalToolCalls   = 0;
  let bestEstimate     = Infinity;
  let lastFinalAnswer  = null;

  // ── 4. ReAct loop ─────────────────────────────────────────────────────────
  while (loopCount < MAX_LOOPS) {
    let toolCallsThisLoop = 0;

    // Inner tool-use loop — runs until LLM produces a Final Answer
    while (toolCallsThisLoop < MAX_TOOL_CALLS && totalToolCalls < MAX_TOOL_CALL_TOTAL) {
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

      // Record thought in trace
      if (parsed.thought) {
        trace.push({ type: "thought", content: parsed.thought });
      }

      // ── Tool call branch ──────────────────────────────────────────────────
      if (parsed.isToolCall) {
        trace.push({
          type:    "action",
          content: `${parsed.toolName}(${parsed.toolInput})`,
        });

        const observation = await executeTool(parsed.toolName, parsed.toolInput);
        trace.push({ type: "observation", content: observation });

        // Append to conversation history
        messages.push({ role: "model",  content: llmResponse });
        messages.push({ role: "user",   content: `Observation: ${observation}` });

        toolCallsThisLoop++;
        totalToolCalls++;
        continue;   // stay in inner loop
      }

      // ── Final answer branch ───────────────────────────────────────────────
      if (parsed.isFinalAnswer) {
        lastFinalAnswer = parsed.finalAnswer;

        const cost = parsed.estimatedCost ?? Infinity;
        if (cost < bestEstimate) bestEstimate = cost;

        trace.push({
          type:    "result",
          content: `Estimated cost: ₹${cost.toLocaleString("en-IN")}`,
        });

        // Budget satisfied — return success
        if (cost <= budget) {
          return NextResponse.json({
            success:      true,
            destination:  canonicalDestination,
            itinerary:    parsed.finalAnswer,
            estimatedCost: cost,
            budget,
            tripDays,
            trace,
          });
        }

        // Over budget — prepare retry
        loopCount++;
        if (loopCount < MAX_LOOPS) {
          const retryMsg = buildRetryPrompt(budget, cost, loopCount + 1);
          messages.push({ role: "model", content: llmResponse });
          messages.push({ role: "user",  content: retryMsg });
          trace.push({ type: "retry", content: retryMsg });
        }
        break;   // exit inner loop, outer loop will retry
      }

      // ── No recognisable structure — nudge the LLM ────────────────────────
      messages.push({ role: "model", content: llmResponse });
      messages.push({
        role:    "user",
        content: "Please continue. Remember to use the format: Thought: ... then either Action: tool_name(input) or ESTIMATED_COST: <number> followed by Final Answer:",
      });
      toolCallsThisLoop++;
    }
  }

  // ── 5. All loops exhausted — ask LLM to explain the budget failure ────────
  let reasons     = [];
  let suggestions = [];
  let biggestCost = null;

  try {
    const failurePrompt = buildBudgetFailurePrompt(budget, bestEstimate);
    const failureMessages = [
      ...messages,
      { role: "user", content: failurePrompt },
    ];
    const failureResponse = await callGemini(SYSTEM_PROMPT, failureMessages);
    const parsed = parseBudgetFailureResponse(failureResponse);
    reasons     = parsed.reasons;
    suggestions = parsed.suggestions;
    biggestCost = parsed.biggestCost;
  } catch {
    // Non-critical — return what we have
    reasons = ["The minimum trip cost exceeds your budget based on current prices."];
  }

  // Suggest 10% above lowest estimate, rounded to nearest ₹1000
  const suggestedBudget = Math.ceil((bestEstimate * 1.1) / 1000) * 1000;

  return NextResponse.json({
    success:        false,
    destination:    canonicalDestination,
    loopsAttempted: loopCount,
    userBudget:     budget,
    lowestEstimate: bestEstimate === Infinity ? null : bestEstimate,
    suggestedBudget,
    reasons,
    biggestCost,
    suggestions,
    lastItineraryAttempt: lastFinalAnswer,  // show user the closest attempt
    trace,
  }, { status: 200 });   // 200 not 400 — the request succeeded, trip just needs more budget
}