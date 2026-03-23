"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import s from "./page.module.css";

const MapSelector = dynamic(() => import("./components/Map"), { ssr: false });

// ── Budget constants ──────────────────────────────────────────────────────────
const MIN_PER_DAY_PER_PERSON = 500;
const MAX_PER_DAY_PER_PERSON = 30000;
const BUDGET_STEP             = 1000;

const PREFERENCES = [
  { id: "adventure", label: "Adventure"     },
  { id: "cultural",  label: "Cultural"      },
  { id: "food",      label: "Food & Cuisine"},
  { id: "relaxing",  label: "Relaxing"      },
  { id: "nature",    label: "Nature"        },
  { id: "shopping",  label: "Shopping"      },
];

// ── Transport mode options ────────────────────────────────────────────────────
const TRANSPORT_MODES = [
  { id: "any",   label: "No preference", icon: "🔀" },
  { id: "flight",label: "Flight",        icon: "✈️" },
  { id: "train", label: "Train",         icon: "🚆" },
  { id: "bus",   label: "Bus",           icon: "🚌" },
  { id: "car",   label: "Car / Self-drive", icon: "🚗" },
];

const TRACE_META = {
  thought:     { label: "Thought",     className: "traceThought"     },
  action:      { label: "Action",      className: "traceAction"      },
  observation: { label: "Observation", className: "traceObservation" },
  result:      { label: "Result",      className: "traceResult"      },
  retry:       { label: "Retry",       className: "traceRetry"       },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={s.toast}>
      <span className={s.toastIcon}>⚠️</span>
      <span>{message}</span>
      <button type="button" className={s.toastClose} onClick={onClose}>✕</button>
    </div>
  );
}

function ProcessingScreen() {
  return (
    <div className={s.processingPage}>
      <div className={s.processingCard}>
        <div className={s.spinner} />
        <p className={s.processingTitle}>Planning your trip</p>
        <p className={s.processingSubtitle}>
          The agent is researching destinations, prices, and activities…
        </p>
      </div>
    </div>
  );
}

function DatePickerPopup({ label, value, onChange, minDate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);
  const formatted = value
    ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;
  return (
    <div ref={ref} className={s.datePickerWrapper}>
      <label className={s.label}>{label}</label>
      <button type="button" onClick={() => setOpen((o) => !o)} className={s.dateButton}>
        <span>📅</span>
        <span className={formatted ? s.dateValue : s.datePlaceholder}>{formatted ?? "Select date"}</span>
      </button>
      {open && (
        <div className={s.calendarPopup}>
          <input type="date" value={value} min={minDate ?? ""}
            onChange={(e) => { onChange(e.target.value); setOpen(false); }}
            className={s.nativeDateInput} />
        </div>
      )}
    </div>
  );
}

// ── Agent trace (collapsible) ─────────────────────────────────────────────────

function AgentTrace({ trace }) {
  const [open, setOpen] = useState(false);
  if (!trace?.length) return null;
  return (
    <div>
      <button type="button" className={s.traceToggle} onClick={() => setOpen((o) => !o)}>
        Agent reasoning ({trace.length} steps)
        <span className={`${s.traceChevron} ${open ? s.traceChevronOpen : ""}`}>▼</span>
      </button>
      {open && (
        <div className={s.traceList}>
          {trace.map((item, i) => {
            const meta = TRACE_META[item.type] ?? TRACE_META.thought;
            return (
              <div key={i} className={`${s.traceItem} ${s[meta.className]}`}>
                <div className={s.traceLabel}>{meta.label}</div>
                {item.content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Itinerary body ─────────────────────────────────────────────────────────────

function ItineraryBody({ text }) {
  return (
    <div className={s.itineraryBody}>
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

// ── Result screen ─────────────────────────────────────────────────────────────

function ResultScreen({ result, onReset }) {
  const isSuccess = result.success;
  const itineraryText = isSuccess ? result.itinerary : result.suggestedItinerary;
  const fmt = (n) => n?.toLocaleString("en-IN") ?? "—";

  return (
    <div className={s.resultPage}>

      {/* ── Main card ── */}
      <div className={s.resultCard}>

        {/* Header */}
        <div className={s.header}>
          <div className={s.headerIcon}>{isSuccess ? "✅" : "⚠️"}</div>
          <div>
            <h1 className={s.title}>
              {isSuccess ? `Your trip to ${result.destination}` : `Budget too low for ${result.destination}`}
            </h1>
            <p className={s.subtitle}>
              {isSuccess
                ? `Estimated cost ₹${fmt(result.estimatedCost)} · ${result.tripDays} days`
                : `We tried ${result.loopsAttempted} times — minimum found was ₹${fmt(result.lowestEstimate)}`}
            </p>
          </div>
        </div>

        {/* ── Transport recommendation (shown if available) ── */}
        {result.recommendedTransport && (
          <div className={s.transportBadge}>
            <span className={s.transportIcon}>
              {result.recommendedTransport.icon ?? "🚀"}
            </span>
            <div>
              <p className={s.transportTitle}>
                Recommended: {result.recommendedTransport.mode}
              </p>
              <p className={s.transportReason}>
                {result.recommendedTransport.reason}
              </p>
            </div>
          </div>
        )}

        {/* ── Summary bar (success only) ── */}
        {isSuccess && (
          <div className={s.summaryBar}>
            <div className={s.summaryItem}>
              <span className={s.summaryLabel}>Destination</span>
              <span className={s.summaryValue}>{result.destination}</span>
            </div>
            <div className={s.summaryDivider} />
            <div className={s.summaryItem}>
              <span className={s.summaryLabel}>Duration</span>
              <span className={s.summaryValue}>{result.tripDays} days</span>
            </div>
            <div className={s.summaryDivider} />
            <div className={s.summaryItem}>
              <span className={s.summaryLabel}>Estimated Cost</span>
              <span className={s.summaryValueGreen}>₹{fmt(result.estimatedCost)}</span>
            </div>
            <div className={s.summaryDivider} />
            <div className={s.summaryItem}>
              <span className={s.summaryLabel}>Your Budget</span>
              <span className={s.summaryValue}>₹{fmt(result.budget)}</span>
            </div>
          </div>
        )}

        {/* ── Budget warning banner (failure only) ── */}
        {!isSuccess && (
          <div className={s.budgetWarningBanner}>
            <p className={s.budgetWarningTitle}>
              Budget insufficient
            </p>
            <p className={s.budgetWarningBody}>
              Your budget of ₹{fmt(result.userBudget)} is short by ₹{fmt(result.lowestEstimate - result.userBudget)}.
              {result.biggestCost && ` Biggest cost driver: ${result.biggestCost}.`}
            </p>

            {result.reasons?.length > 0 && (
              <>
                <p className={s.summaryLabel} style={{ marginBottom: 6 }}>Why it costs more:</p>
                <ul className={s.budgetReasonsList}>
                  {result.reasons.map((r, i) => (
                    <li key={i} className={s.budgetReasonsItem}>{r}</li>
                  ))}
                </ul>
              </>
            )}

            {result.suggestions?.length > 0 && (
              <>
                <p className={s.summaryLabel} style={{ marginBottom: 6 }}>Ways to reduce cost:</p>
                <ul className={s.budgetSuggestionsList}>
                  {result.suggestions.map((s2, i) => (
                    <li key={i} className={s.budgetSuggestionsItem}>{s2}</li>
                  ))}
                </ul>
              </>
            )}

            <div className={s.suggestedBudgetPill}>
              Suggested budget: ₹{fmt(result.suggestedBudget)}
            </div>
          </div>
        )}

        {/* ── Itinerary (always shown if available) ── */}
        {itineraryText ? (
          <>
            {!isSuccess && (
              <div className={s.itineraryNote}>
                The itinerary below is the closest the agent could get to your budget.
                It requires ₹{fmt(result.lowestEstimate)}. Use it as a reference or increase your budget.
              </div>
            )}
            <h2 className={s.itineraryTitle}>
              {isSuccess ? "Your Itinerary" : "Closest Itinerary Found"}
            </h2>
            <ItineraryBody text={itineraryText} />
          </>
        ) : (
          !isSuccess && (
            <p style={{ color: "#a0aec0", fontSize: 14, marginTop: 8 }}>
              The agent was unable to produce an itinerary for this destination within any reasonable budget range.
            </p>
          )
        )}

      </div>

      {/* ── Agent trace card ── */}
      {result.trace?.length > 0 && (
        <div className={s.resultCard}>
          <AgentTrace trace={result.trace} />
        </div>
      )}

      {/* ── Plan another trip ── */}
      <button type="button" className={s.resetBtn} onClick={onReset}>
        ← Plan another trip
      </button>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function Home() {
  const [locationMode, setLocationMode]   = useState("text");
  const [mapLocation, setMapLocation]     = useState(null);
  const [isLoading, setIsLoading]         = useState(false);
  const [agentResult, setAgentResult]     = useState(null);
  const [toast, setToast]                 = useState(null);

  // ── Origin state (mirrors destination pattern) ───────────────────────────
  const [originMode, setOriginMode]       = useState("text");   // "text" | "gps" | "map"
  const [originMapLocation, setOriginMapLocation] = useState(null);
  const [gpsLoading, setGpsLoading]       = useState(false);
  const [originMapVisible, setOriginMapVisible]   = useState(false);

  const [formData, setFormData] = useState({
    destination:   "",
    origin:        "",           // text origin
    startDate:     "",
    endDate:       "",
    budget:        null,
    travelers:     1,
    preferences:   [],
    transportPref: "any",        // preferred transport mode id
  });

  const today = new Date().toISOString().split("T")[0];

  // ── Derived values ───────────────────────────────────────────────────────

  const tripDays = (() => {
    if (!formData.startDate || !formData.endDate) return 1;
    const diff = Math.ceil((new Date(formData.endDate) - new Date(formData.startDate)) / 86400000);
    return Math.max(1, diff);
  })();

  const travelers  = formData.travelers;
  const sliderMin  = Math.ceil((MIN_PER_DAY_PER_PERSON * travelers * tripDays) / BUDGET_STEP) * BUDGET_STEP;
  const sliderMax  = Math.floor((MAX_PER_DAY_PER_PERSON * travelers * tripDays) / BUDGET_STEP) * BUDGET_STEP;
  const snappedDefault = Math.round((sliderMin + (sliderMax - sliderMin) * 0.15) / BUDGET_STEP) * BUDGET_STEP;
  const budget = formData.budget === null
    ? snappedDefault
    : Math.min(sliderMax, Math.max(sliderMin, formData.budget));
  const perDayPerPerson = Math.round(budget / travelers / tripDays);
  const datesSelected   = formData.startDate && formData.endDate;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function setField(key, value) { setFormData((prev) => ({ ...prev, [key]: value })); }
  function showToast(msg)       { setToast(msg); }

  function switchMode(mode) {
    setLocationMode(mode);
    if (mode === "text") setMapLocation(null);
    setField("destination", "");
  }

  function handleMapSelect(loc) {
    setMapLocation(loc);
    setField("destination", loc.label);
  }

  function togglePref(id) {
    setFormData((prev) => ({
      ...prev,
      preferences: prev.preferences.includes(id)
        ? prev.preferences.filter((p) => p !== id)
        : [...prev.preferences, id],
    }));
  }

  function handleTravelersChange(delta) {
    setField("travelers", Math.max(1, travelers + delta));
    setField("budget", null);
  }

  // ── Origin helpers ───────────────────────────────────────────────────────

  function switchOriginMode(mode) {
    setOriginMode(mode);
    setOriginMapLocation(null);
    setField("origin", "");
    if (mode === "map") setOriginMapVisible(true);
    else setOriginMapVisible(false);
  }

  function handleOriginMapSelect(loc) {
    setOriginMapLocation(loc);
    setField("origin", loc.label);
  }

  async function handleGPSClick() {
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported by your browser.");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        // Reverse geocode to get a human-readable label
        try {
          const { data } = await axios.get(
            "https://nominatim.openstreetmap.org/reverse",
            { params: { format: "json", lat, lon: lng }, headers: { "Accept-Language": "en" } }
          );
          const addr = data.address ?? {};
          const label =
            addr.city || addr.city_district || addr.town ||
            addr.village || addr.county || addr.state ||
            data.display_name?.split(",")[0] ||
            `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          setOriginMapLocation({ lat, lng, label });
          setField("origin", label);
        } catch {
          const label = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          setOriginMapLocation({ lat, lng, label });
          setField("origin", label);
        } finally {
          setGpsLoading(false);
        }
      },
      (err) => {
        setGpsLoading(false);
        if (err.code === 1) showToast("Location permission denied. Please allow access or type your city.");
        else showToast("Could not get your location. Please try again or type it manually.");
      },
      { timeout: 10000 }
    );
  }

  function clearOrigin() {
    setOriginMode("text");
    setOriginMapLocation(null);
    setOriginMapVisible(false);
    setField("origin", "");
  }

  // ── Origin: resolve label for payload ────────────────────────────────────

  function resolvedOrigin() {
    if (originMode === "text") return formData.origin.trim();
    if (originMapLocation) return originMapLocation.label;
    return "";
  }

  function resolvedOriginCoords() {
    if (originMode !== "text" && originMapLocation) {
      return { lat: originMapLocation.lat, lng: originMapLocation.lng };
    }
    return null;
  }

  //////////////////////////////////////////////////////
  async function handleSubmit1() {
    await axios.get("/api/agent");
  }
  //////////////////////////////////////////////////

  async function handleSubmit() {
    const destination = locationMode === "text"
      ? formData.destination.trim()
      : mapLocation?.label ?? "";

    if (!destination)                      return showToast("Please select a destination.");
    if (!formData.startDate)               return showToast("Please select a start date.");
    if (!formData.endDate)                 return showToast("Please select an end date.");
    if (formData.preferences.length === 0) return showToast("Please select at least one preference.");

    const origin = resolvedOrigin();
    if (!origin || origin.length < 3) return showToast("Please enter your starting point (city or location).");

    const payload = {
      destination,
      coordinates:       mapLocation ? { lat: mapLocation.lat, lng: mapLocation.lng } : null,
      origin:            origin || null,
      originCoordinates: resolvedOriginCoords(),
      startDate:         formData.startDate,
      endDate:           formData.endDate,
      tripDays,
      budget,
      travelers,
      preferences:       formData.preferences,
      transportPref:     formData.transportPref,
    };

    setIsLoading(true);

    try {
      const { data } = await axios.post("/api/agent", payload);
      console.log(data);
      setAgentResult(data);
    } catch (err) {
      console.log(err.response);
      const status = err?.response?.status;
      const apiMsg = err?.response?.data?.error ?? "";

      let userMsg;
      if (status === 502 && apiMsg.includes("RATE_LIMITED")) {
        userMsg = "The AI is rate limited right now. Please wait 30 seconds and try again.";
      } else if (status === 502) {
        userMsg = "The AI service is temporarily unavailable. Please try again shortly.";
      } else if (status === 422) {
        userMsg = apiMsg;
      } else if (status === 400) {
        userMsg = "Invalid request — please check your inputs and try again.";
      } else if (apiMsg) {
        userMsg = apiMsg;
      } else {
        userMsg = "Something went wrong. Please try again.";
      }

      showToast(userMsg);
    } finally {
      setIsLoading(false);
    }
  }

  // ── Screen routing ───────────────────────────────────────────────────────

  if (agentResult) {
    return (
      <ResultScreen
        result={agentResult}
        onReset={() => setAgentResult(null)}
      />
    );
  }

  if (isLoading) return <ProcessingScreen />;

  // ── Form ─────────────────────────────────────────────────────────────────

  return (
    <div className={s.page}>
      <div className={s.bgBlob1} />
      <div className={s.bgBlob2} />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <div className={s.card}>
        <div className={s.header}>
          <div className={s.headerIcon}>✈️</div>
          <div>
            <h1 className={s.title}>Travel Planner</h1>
            <p className={s.subtitle}>AI-powered itinerary, built around your budget</p>
          </div>
        </div>

        {/* 1. Destination */}
        <section className={s.section}>
          <h2 className={s.sectionTitle}><span className={s.step}>1</span> Destination</h2>
          <div className={s.toggleBar}>
            <button type="button"
              onClick={() => switchMode("text")}
              className={`${s.toggleBtn} ${locationMode === "text" ? s.toggleActive : ""}`}
            >✏️ Type it</button>
            <button type="button"
              onClick={() => switchMode("map")}
              className={`${s.toggleBtn} ${locationMode === "map" ? s.toggleActive : ""}`}
            >🗺️ Pick on map</button>
          </div>
          {locationMode === "text" && (
            <input type="text" placeholder="e.g. Goa, Manali, Kerala backwaters..."
              value={formData.destination}
              onChange={(e) => setField("destination", e.target.value)}
              className={s.textInput} />
          )}
          {locationMode === "map" && (
            <div className={s.mapWrapper}>
              {/* Unmount the map once a pin is chosen — keeps only one Leaflet
                  instance alive at a time and avoids the "container reused" error */}
              {!mapLocation && (
                <MapSelector setLocation={handleMapSelect} markerPos={null} />
              )}
              {mapLocation ? (
                <div className={s.mapBadge}>
                  📌 {mapLocation.label}
                  <button type="button" className={s.clearBtn}
                    onClick={() => { setMapLocation(null); setField("destination", ""); }}>✕</button>
                </div>
              ) : (
                <p className={s.mapHint}>Click anywhere on the map to drop a pin</p>
              )}
            </div>
          )}
        </section>

        {/* 2. Starting Point */}
        <section className={s.section}>
          <h2 className={s.sectionTitle}><span className={s.step}>2</span> Starting Point</h2>
          <p className={s.prefHint}>Where are you travelling from? The agent uses this to find transport options and factor in travel costs.</p>

          {/* Mode toggle bar */}
          <div className={s.toggleBar}>
            <button type="button"
              onClick={() => switchOriginMode("text")}
              className={`${s.toggleBtn} ${originMode === "text" ? s.toggleActive : ""}`}
            >✏️ Type it</button>
            <button type="button"
              onClick={() => handleGPSClick()}
              className={`${s.toggleBtn} ${originMode === "gps" ? s.toggleActive : ""}`}
              disabled={gpsLoading}
            >
              {gpsLoading ? "📡 Locating…" : "📍 Use my location"}
            </button>
            <button type="button"
              onClick={() => switchOriginMode("map")}
              className={`${s.toggleBtn} ${originMode === "map" ? s.toggleActive : ""}`}
            >🗺️ Pick on map</button>
          </div>

          {/* Text input */}
          {originMode === "text" && !originMapLocation && (
            <input
              type="text"
              placeholder="e.g. Mumbai, Delhi, Pune…"
              value={formData.origin}
              onChange={(e) => setField("origin", e.target.value)}
              className={s.textInput}
            />
          )}

          {/* GPS / map result badge */}
          {originMapLocation && (
            <div className={s.mapBadge}>
              {originMode === "gps" ? "📍" : "📌"} {originMapLocation.label}
              <button type="button" className={s.clearBtn} onClick={clearOrigin}>✕</button>
            </div>
          )}

          {/* Origin map — only mounted when map mode is active AND no location yet.
               Passing markerPos={null} intentionally: the map unmounts on selection
               so there is never a stale Leaflet container with a marker to sync. */}
          {originMode === "map" && !originMapLocation && (
            <div className={s.mapWrapper}>
              <MapSelector setLocation={handleOriginMapSelect} markerPos={null} />
              <p className={s.mapHint}>Click anywhere to set your starting point</p>
            </div>
          )}
        </section>

        {/* 3. Dates */}
        <section className={s.section}>
          <h2 className={s.sectionTitle}><span className={s.step}>3</span> Travel Dates</h2>
          <div className={s.dateRow}>
            <DatePickerPopup label="Start Date" value={formData.startDate} minDate={today}
              onChange={(v) => { setField("startDate", v); if (formData.endDate && v > formData.endDate) setField("endDate", ""); setField("budget", null); }} />
            <DatePickerPopup label="End Date" value={formData.endDate} minDate={formData.startDate || today}
              onChange={(v) => { setField("endDate", v); setField("budget", null); }} />
          </div>
          {datesSelected && (
            <p className={s.tripDaysBadge}>🗓️ {tripDays} day{tripDays !== 1 ? "s" : ""}</p>
          )}
        </section>

        {/* 4. Travelers */}
        <section className={s.section}>
          <h2 className={s.sectionTitle}><span className={s.step}>4</span> Travelers</h2>
          <label className={s.label}>Number of people</label>
          <div className={s.travelerRow}>
            <button type="button" className={s.counterBtn} onClick={() => handleTravelersChange(-1)}>−</button>
            <span className={s.counterValue}>{travelers}</span>
            <button type="button" className={s.counterBtn} onClick={() => handleTravelersChange(+1)}>+</button>
          </div>
        </section>

        {/* 5. Budget */}
        <section className={s.section}>
          <h2 className={s.sectionTitle}><span className={s.step}>5</span> Budget</h2>
          <div className={s.budgetDisplay}>
            <span className={s.budgetAmount}>₹{budget.toLocaleString("en-IN")}</span>
            <span className={s.budgetPerDay}>≈ ₹{perDayPerPerson.toLocaleString("en-IN")} / person / day</span>
          </div>
          <input type="range" min={sliderMin} max={sliderMax} step={BUDGET_STEP} value={budget}
            onChange={(e) => setField("budget", parseFloat(e.target.value))}
            className={s.slider} />
          <div className={s.sliderLabels}>
            <span>₹{sliderMin.toLocaleString("en-IN")}</span>
            <span>₹{sliderMax.toLocaleString("en-IN")}</span>
          </div>
          <p className={s.sliderNote}>
            ₹{MIN_PER_DAY_PER_PERSON.toLocaleString("en-IN")}–₹{MAX_PER_DAY_PER_PERSON.toLocaleString("en-IN")} per person per day
            {!datesSelected && " · select dates above to refine this range"}
          </p>
        </section>

        {/* 6. Trip Vibe */}
        <section className={s.section}>
          <h2 className={s.sectionTitle}><span className={s.step}>6</span> Trip Vibe</h2>
          <p className={s.prefHint}>Pick all that apply</p>
          <div className={s.prefGrid}>
            {PREFERENCES.map((pref) => {
              const selected = formData.preferences.includes(pref.id);
              return (
                <button key={pref.id} type="button" onClick={() => togglePref(pref.id)}
                  className={`${s.prefChip} ${selected ? s.prefChipSelected : ""}`}>
                  {selected && <span className={s.checkmark}>✓ </span>}
                  {pref.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* 7. Transport Preference */}
        <section className={s.section}>
          <h2 className={s.sectionTitle}><span className={s.step}>7</span> Travel Mode Preference</h2>
          <p className={s.prefHint}>The agent will verify feasibility based on distance and budget, but will respect your preference.</p>
          <div className={s.transportGrid}>
            {TRANSPORT_MODES.map((mode) => {
              const selected = formData.transportPref === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setField("transportPref", mode.id)}
                  className={`${s.transportChip} ${selected ? s.transportChipSelected : ""}`}
                >
                  <span className={s.transportChipIcon}>{mode.icon}</span>
                  <span>{mode.label}</span>
                  {selected && <span className={s.checkmark}> ✓</span>}
                </button>
              );
            })}
          </div>
        </section>

        <button type="button" onClick={handleSubmit} className={s.submitBtn}>
          Plan My Trip
        </button>
        {/* <button type="button" onClick={handleSubmit1} className={s.submitBtn}>
          debug
        </button> */}
      </div>
    </div>
  );
}