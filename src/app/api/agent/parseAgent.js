// ── parseAgent.js ─────────────────────────────────────────────────────────────

/**
 * Parses raw LLM ReAct text into structured fields.
 * @param {string} text
 */
export function parseAgentResponse(text) {
  const result = {
    thought:       null,
    isToolCall:    false,
    toolName:      null,
    toolInput:     null,
    isFinalAnswer: false,
    estimatedCost: null,
    finalAnswer:   null,
    raw:           text,
  };

  const thoughtMatch = text.match(/Thought:\s*(.+?)(?=\n(?:Action:|ESTIMATED_COST:|Final Answer:)|$)/s);
  if (thoughtMatch) result.thought = thoughtMatch[1].trim();

  // Action: tool_name(input) — greedy match inside parens, handle multiline input
  const actionMatch = text.match(/Action:\s*(\w+)\((.+?)\)\s*$/ms);
  if (actionMatch) {
    result.isToolCall = true;
    result.toolName   = actionMatch[1].trim().toLowerCase();
    result.toolInput  = actionMatch[2].trim();
    return result;
  }

  const finalMatch = text.match(/Final Answer:\s*\n?([\s\S]+)$/i);
  if (finalMatch) {
    result.isFinalAnswer = true;
    result.finalAnswer   = finalMatch[1].trim();

    // Extract TRANSPORT_RECOMMENDATION from within the final answer text
    const transportMatch = result.finalAnswer.match(
      /TRANSPORT_RECOMMENDATION:\s*(.+?)(?=\n\n|\n[A-Z]|$)/is
    );
    if (transportMatch) {
      const raw = transportMatch[1].trim();
      const modeMap = {
        flight: { icon: "✈️", label: "Flight" },
        train:  { icon: "🚆", label: "Train"  },
        bus:    { icon: "🚌", label: "Bus"    },
        car:    { icon: "🚗", label: "Car / Self-drive" },
        cab:    { icon: "🚗", label: "Car / Cab" },
        drive:  { icon: "🚗", label: "Self-drive" },
      };
      const detected = Object.entries(modeMap).find(([key]) =>
        new RegExp(`\\b${key}`, "i").test(raw)
      );
      result.transportRecommendation = {
        mode:   detected ? detected[1].label : "Mixed transport",
        icon:   detected ? detected[1].icon  : "🚀",
        reason: raw,
      };
    }
  }

  // Strip commas — LLM sometimes ignores the "no commas" instruction
  const costMatch = text.match(/ESTIMATED_COST:\s*(\d[\d,]*)/i);
  if (costMatch) {
    result.estimatedCost = parseInt(costMatch[1].replace(/,/g, ""), 10);
  }

  return result;
}

/**
 * Parses the budget-failure explanation response.
 */
export function parseBudgetFailureResponse(text) {
  const reasons = [];
  const suggestions = [];
  let biggestCost = null;

  const reasonsBlock = text.match(/REASONS:\s*([\s\S]+?)(?=BIGGEST_COST:|$)/i);
  if (reasonsBlock) {
    reasonsBlock[1].split("\n")
      .map((l) => l.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean)
      .forEach((r) => reasons.push(r));
  }

  const biggestMatch = text.match(/BIGGEST_COST:\s*(.+)/i);
  if (biggestMatch) biggestCost = biggestMatch[1].trim();

  const suggestionsBlock = text.match(/SUGGESTIONS:\s*([\s\S]+?)$/i);
  if (suggestionsBlock) {
    suggestionsBlock[1].split("\n")
      .map((l) => l.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean)
      .forEach((s) => suggestions.push(s));
  }

  return { reasons, biggestCost, suggestions };
}