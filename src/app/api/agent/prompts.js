// ── prompts.js ────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are an expert Indian travel planning agent.
Reason step by step and use tools to research real options before producing an itinerary.
Never guess prices — always search for them.

TOOLS AVAILABLE:
- web_search(query)                              : search flights, hotels, activities, tips
- get_weather(location, start_date, end_date)    : weather forecast for trip dates
- calculate(expression)                          : safe math e.g. calculate(12000 + 3500 * 5)

STRICT OUTPUT FORMAT — follow exactly on every response:

When using a tool:
Thought: <your reasoning>
Action: tool_name(input)

When ready to produce the itinerary:
Thought: <final reasoning and cost verification>
ESTIMATED_COST: <total cost as plain integer in INR — no commas, no ₹>
Final Answer:
<full day-by-day itinerary>

VIABILITY RULES (MANDATORY — failure to follow = invalid plan):
- Every itinerary MUST include accommodation costs (hotel/hostel/guesthouse per night).
- Every itinerary MUST include food/meal costs per day per person.
- A plan with zero accommodation or zero food budget is INVALID and will be rejected.
- Minimum realistic costs to include: ₹300/person/day for food, ₹400/person/night for accommodation.
- If the budget genuinely cannot cover travel + food + stay + at least one activity, do NOT produce a Final Answer that fits — instead report the true minimum cost.
- ESTIMATED_COST must equal the sum of: travel (to/from) + accommodation (all nights) + food (all days) + activities. Never omit any category.

TRANSPORT RULES:
- If an origin city is provided, always research travel options FROM that origin to the destination.
- Choose the transport mode that best fits distance, budget, and user preference:
  * Under 200 km → prefer car/bus/train; flag if flight seems overkill
  * 200–600 km → train or flight depending on time and budget
  * Over 600 km → flight usually cheapest in time; train if budget is very tight
  * Mountain/hilly terrain → note road conditions; prefer train or flight over bus for long distances
- If the user stated a transport preference, respect it unless it is physically impossible (e.g. flight to a location with no airport — in that case explain clearly).
- Always include the cost of travel from origin to destination AND return journey in ESTIMATED_COST.
- Provide a TRANSPORT_RECOMMENDATION line in your Final Answer explaining why you chose that mode.

PLANNING RULES:
- You have a strict budget of 5 LLM turns total. Be efficient.
- In your first response, call web_search for flights/trains from origin AND mention what you will search next.
- Aim to gather all information within 3-4 tool calls before producing the Final Answer.
- Do not call the same tool twice with nearly identical queries.
- All prices in INR (₹)
- Search for travel-from-origin first, then accommodation, then activities
- Always call get_weather before finalising
- Always call calculate to verify total fits the budget
- ESTIMATED_COST must be an integer on its own line (e.g. ESTIMATED_COST: 47500)
- Final Answer must include:
  1. A TRANSPORT_RECOMMENDATION section at the top
  2. A per-day breakdown
  3. A cost summary table with columns: Category | Cost (₹) — must include Travel, Accommodation, Food, Activities

BUDGET UTILISATION RULE (CRITICAL):
- The budget is not just a ceiling — it is the user's intended spend. Treat it as a target range.
- Your plan MUST utilise at least 75% of the total budget. A plan using less than 75% is poor quality.
- If your first-pass plan comes in well under budget, upgrade it: better hotel tier, more activities, nicer restaurants, or additional day trips — until you reach the 75–100% range.
- Never default to the cheapest option. Match accommodation and activity quality to the budget level.
- Use calculate() to check: if ESTIMATED_COST < budget * 0.75, you must upgrade the plan before finalising.`;

export function buildGoalPrompt({
  destination, origin, originCoordinates, startDate, endDate, tripDays,
  budget, travelers, preferences, transportPref, distanceKm
}) {
  const prefList = preferences.length > 0 ? preferences.join(", ") : "general sightseeing";

  const originLine = origin
    ? `- Origin (starting point): ${origin}${originCoordinates ? ` (lat: ${originCoordinates.lat.toFixed(4)}, lng: ${originCoordinates.lng.toFixed(4)})` : ""}`
    : "- Origin: not specified (assume traveller will find their own way to the destination)";

  const distanceLine = distanceKm
    ? `- Approximate straight-line distance origin→destination: ${distanceKm} km`
    : "";

  const transportLine = transportPref && transportPref !== "any"
    ? `- User's preferred transport mode: ${transportPref} (respect this unless infeasible)`
    : "- User has no transport preference — recommend the best option";

  return `Plan a trip to ${destination}.

Trip details:
- Dates: ${startDate} to ${endDate} (${tripDays} day${tripDays !== 1 ? "s" : ""})
- Travelers: ${travelers} person${travelers !== 1 ? "s" : ""}
- Total budget: ₹${budget.toLocaleString("en-IN")} (₹${Math.round(budget / travelers / tripDays).toLocaleString("en-IN")} per person per day)
- Preferences: ${prefList}
${originLine}
${distanceLine}
${transportLine}

IMPORTANT:
1. Research travel options FROM the origin to ${destination}.
2. The budget of ₹${budget.toLocaleString("en-IN")} must cover travel (both ways) + accommodation (${tripDays - 1} nights) + food (${tripDays} days × ${travelers} people) + activities.
3. Never produce an itinerary that omits accommodation or food. An itinerary covering only transport is invalid.
4. Recommend and justify the transport mode based on distance, terrain, and budget.
5. Verify everything fits within ₹${budget.toLocaleString("en-IN")} total using calculate().
6. Your ESTIMATED_COST must be between ₹${Math.round(budget * 0.75).toLocaleString("en-IN")} (75%) and ₹${budget.toLocaleString("en-IN")} (100%). If your total is below ₹${Math.round(budget * 0.75).toLocaleString("en-IN")}, upgrade the accommodation, add activities or experiences, or improve meal quality until you hit this range.`;
}

export function buildRetryPrompt(budget, estimatedCost, loopNumber) {
  const over = (estimatedCost - budget).toLocaleString("en-IN");
  if (loopNumber === 2) {
    return `Your plan costs ₹${estimatedCost.toLocaleString("en-IN")}, which is ₹${over} over the ₹${budget.toLocaleString("en-IN")} budget.
Try again with cheaper options:
- Budget airlines or connecting flights instead of direct; or switch to train/bus if distance allows
- Guesthouses or 2-star hotels instead of 3-star+
- Replace paid activities with free alternatives
- Search specifically for "budget" or "cheap" options
REMINDER: You must still include accommodation AND food costs. Do not drop these categories.`;
  }
  return `Still ₹${over} over budget. Final attempt — find the absolute minimum viable trip:
- Cheapest possible transport (bus, train, or cheapest flight)
- Hostels or dormitory accommodation only
- Free activities and street food
- Reduce non-essential days if needed
REMINDER: Even the minimum plan must include stay and food. If genuinely impossible within budget, state that clearly in the Final Answer with the true minimum cost including all categories.`;
}

export function buildBudgetFailurePrompt(budget, lowestEstimate) {
  return `The trip cannot be planned within ₹${budget.toLocaleString("en-IN")}.
The minimum achievable cost is approximately ₹${lowestEstimate.toLocaleString("en-IN")} (covering travel + accommodation + food + at least basic activities).

Provide:
1. Three specific reasons why (cite costs you found)
2. The single biggest cost driver
3. Two concrete suggestions to reduce cost

Format:
REASONS:
- reason 1
- reason 2
- reason 3
BIGGEST_COST: <item and amount>
SUGGESTIONS:
- suggestion 1
- suggestion 2`;
}