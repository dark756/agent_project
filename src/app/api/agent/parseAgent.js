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

    // Extract TRANSPORT_RECOMMENDATION from within the final answer text.
    // The agent writes e.g. "TRANSPORT_RECOMMENDATION: Train recommended because..."
    // We look for an explicit CHOSEN_MODE: line first; if absent we scan for the
    // *first* mode keyword that appears as the subject (start) of the sentence,
    // not just any keyword mentioned in a comparison.
    const transportMatch = result.finalAnswer.match(
      /TRANSPORT_RECOMMENDATION:\s*([\s\S]+?)(?=\n\n|\n##|\n\*\*[A-Z]|\nDay |\nItinerary|$)/i
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

      // Priority 1: explicit CHOSEN_MODE: <mode> line the agent may write
      const chosenLineMatch = raw.match(/CHOSEN_MODE:\s*(\w+)/i);

      // Priority 2: find the mode that is the grammatical subject —
      // i.e. appears at the start of the text or right after "recommended:" / "using:"
      // rather than in a comparison clause like "instead of flight"
      const subjectPatterns = [
        /^(flight|train|bus|car|cab|drive)\b/i,                        // starts the text
        /\brecommended(?:\s+mode)?[:\s]+(flight|train|bus|car|cab|drive)\b/i,
        /\busing\s+(flight|train|bus|car|cab|drive)\b/i,
        /\bby\s+(flight|train|bus|car|cab|drive)\b/i,
        /\btake\s+(?:a\s+)?(flight|train|bus|car|cab)\b/i,
        /\b(flight|train|bus|car|cab|drive)\s+(?:is\s+)?recommended\b/i,
      ];

      let detectedKey = chosenLineMatch
        ? chosenLineMatch[1].toLowerCase()
        : null;

      if (!detectedKey) {
        for (const pat of subjectPatterns) {
          const m = raw.match(pat);
          if (m) {
            // grab the captured group that is the mode word
            detectedKey = (m[1] || m[0]).toLowerCase().trim();
            break;
          }
        }
      }

      // Fallback: first mode keyword anywhere (original behaviour)
      if (!detectedKey) {
        const fallback = Object.keys(modeMap).find((key) =>
          new RegExp(`\\b${key}`, "i").test(raw)
        );
        detectedKey = fallback ?? null;
      }

      const entry = detectedKey ? modeMap[detectedKey] : null;
      result.transportRecommendation = {
        mode:   entry ? entry.label : "Mixed transport",
        icon:   entry ? entry.icon  : "🚀",
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