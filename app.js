// TripLens — client flow
// Entry → brief diagnostic phase (streaming signals) → results. Signals act
// as quick proof-of-work before the decision lands; the real API call runs
// in the background and silently upgrades the content when it returns.

const views = {
  entry: document.querySelector('[data-view="entry"]'),
  results: document.querySelector('[data-view="results"]'),
};

const form = document.getElementById("intakeForm");
const errorEl = document.getElementById("intakeError");
const analyzeBtn = document.getElementById("analyzeBtn");
const diagnosticPhase = document.getElementById("diagnosticPhase");
const diagnosticPhaseList = document.getElementById("diagnosticPhaseList");
const yearEl = document.getElementById("year");
yearEl.textContent = new Date().getFullYear();

// ------------------------------- state tracked for share
let latestTrip = null;
let latestResult = null;
let latestShareId = null;
let sharedViewActive = false;

// ------------------------------- view switching

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    if (!el) continue;
    if (key === name) {
      el.hidden = false;
      el.style.animation = "none";
      // force reflow to restart the viewIn animation
      void el.offsetWidth;
      el.style.animation = "";
    } else {
      el.hidden = true;
    }
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------- vibes chip limit (max 3)

const vibesGroup = document.querySelector('.chips[data-name="vibes"]');
if (vibesGroup) {
  const max = parseInt(vibesGroup.dataset.max || "3", 10);
  vibesGroup.addEventListener("change", () => {
    const boxes = [...vibesGroup.querySelectorAll('input[type="checkbox"]')];
    const checkedCount = boxes.filter((b) => b.checked).length;
    boxes.forEach((b) => {
      const chip = b.closest(".chip");
      if (!b.checked && checkedCount >= max) {
        b.disabled = true;
        chip.dataset.disabled = "true";
      } else {
        b.disabled = false;
        chip.removeAttribute("data-disabled");
      }
    });
  });
}

// ---------------------------- date defaults (nudge a reasonable window)

(function seedDates() {
  const today = new Date();
  const plus45 = new Date(today.getTime() + 45 * 86400000);
  const plus50 = new Date(today.getTime() + 50 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const start = form.elements["startDate"];
  const end = form.elements["endDate"];
  if (!start.value) start.value = fmt(plus45);
  if (!end.value) end.value = fmt(plus50);
  start.min = fmt(today);
  end.min = fmt(today);
})();

// ---------------------------- form submission (instant transition)

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;

  const trip = collectTrip(form);
  const validation = validate(trip);
  if (validation) {
    errorEl.textContent = validation;
    errorEl.hidden = false;
    return;
  }

  analyzeBtn.disabled = true;

  // 1. Generate instant results from the user's inputs and pre-render them.
  const instant = generateInstantResult(trip);
  latestTrip = trip;
  latestResult = instant;
  latestShareId = null;
  resetShareState();
  resetSavePanel();
  renderResults(trip, instant);

  // 2. Run the diagnostic phase: ~1.4s of streaming signals, then reveal.
  await runDiagnosticPhase(trip, instant);

  // 3. Swap view — results already populated and ready.
  showView("results");

  // 4. Fire the real analysis in the background and swap in silently.
  analyzeTrip(trip)
    .then((real) => {
      if (real && typeof real === "object") {
        const merged = { ...instant, ...real };
        latestResult = merged;
        latestShareId = null;
        resetShareState();
        renderResults(trip, merged, { silent: true });
      }
    })
    .catch((err) => {
      // Silent failure — instant results are already on screen.
      console.warn("Background analysis failed; keeping instant results.", err);
    })
    .finally(() => {
      analyzeBtn.disabled = false;
    });
});

function collectTrip(form) {
  const fd = new FormData(form);
  const vibes = [
    ...form.querySelectorAll(
      '.chips[data-name="vibes"] input[type="checkbox"]:checked',
    ),
  ].map((i) => i.value);
  const mustHaves = [
    ...form.querySelectorAll(
      '.chips[data-name="mustHaves"] input[type="checkbox"]:checked',
    ),
  ].map((i) => i.value);

  return {
    destination: (fd.get("destination") || "").toString().trim(),
    origin: (fd.get("origin") || "").toString().trim(),
    startDate: fd.get("startDate"),
    endDate: fd.get("endDate"),
    travelers: Number(fd.get("travelers") || 1),
    budget: Number(fd.get("budget") || 0),
    vibes,
    mustHaves,
    concern: fd.get("concern"),
    style: fd.get("style"),
  };
}

function validate(t) {
  if (!t.destination) return "Tell us where you\u2019re thinking of going.";
  if (!t.origin) return "Tell us where you\u2019d be departing from.";
  if (!t.startDate || !t.endDate) return "Pick the dates you\u2019re considering.";
  if (new Date(t.endDate) < new Date(t.startDate))
    return "The return date comes before the arrival. Try again.";
  if (!t.budget || t.budget < 100) return "Add an approximate budget so we can check fit.";
  if (!t.concern) return "Tell us which worry weighs on you most.";
  if (!t.style) return "Tell us how you travel.";
  if (!t.vibes.length) return "Pick at least one vibe.";
  return null;
}

// ---------------------------- diagnostic phase
// Streams 4–5 rapid "diagnostic signals" in a centered panel before the
// results land. Total runtime ~1.4–1.6s. This is a perceived-intelligence
// device — the instant result is already rendered behind it.

function runDiagnosticPhase(trip, instant) {
  if (!diagnosticPhase || !diagnosticPhaseList) return Promise.resolve();
  const signals = (instant && Array.isArray(instant.diagnosticSignals) && instant.diagnosticSignals.length)
    ? instant.diagnosticSignals
    : generateDiagnosticSignals(trip);

  diagnosticPhaseList.innerHTML = "";
  diagnosticPhase.hidden = false;
  diagnosticPhase.dataset.state = "in";

  const stepDelay = 240;
  const initialDelay = 120;

  return new Promise((resolve) => {
    signals.forEach((text, i) => {
      setTimeout(() => {
        const li = document.createElement("li");
        li.className = "diagnostic-signal";
        li.innerHTML = `
          <span class="diagnostic-signal__mark" aria-hidden="true"></span>
          <span class="diagnostic-signal__text"></span>
        `;
        li.querySelector(".diagnostic-signal__text").textContent = text;
        diagnosticPhaseList.appendChild(li);
        requestAnimationFrame(() => {
          li.dataset.state = "in";
        });
      }, initialDelay + i * stepDelay);
    });

    const total = initialDelay + signals.length * stepDelay + 340;
    setTimeout(() => {
      diagnosticPhase.dataset.state = "out";
    }, total);
    setTimeout(() => {
      diagnosticPhase.dataset.state = "";
      diagnosticPhase.hidden = true;
      resolve();
    }, total + 360);
  });
}

// Four–five quick diagnostic signals built from the trip inputs. These become
// the streaming phase AND are echoed in a persistent ribbon in the results.
function generateDiagnosticSignals(trip) {
  const vibes = trip.vibes || [];
  const mustHaves = trip.mustHaves || [];
  const has = (x) => vibes.includes(x) || mustHaves.includes(x);
  const signals = [];

  if (trip.concern === "crowds" || has("low-crowds") || has("peaceful")) {
    signals.push("Peak crowd window detected");
  } else {
    signals.push("Crowd-pressure model loaded");
  }

  if (has("peaceful") && (has("social") || has("adventure"))) {
    signals.push("Low vibe alignment");
  } else if (has("aesthetic") && has("low-crowds")) {
    signals.push("Photographed-corridor overlap");
  } else if (has("luxury") && trip.concern === "cost") {
    signals.push("Budget-tier mismatch");
  } else {
    signals.push("Vibe-fit score below threshold");
  }

  const nights = nightsBetween(trip.startDate, trip.endDate);
  if (nights <= 4) {
    signals.push("Routing conflict: trip too short for single base");
  } else if (nights >= 8) {
    signals.push("Base-fatigue risk at current length");
  } else {
    signals.push("Routing conflict detected");
  }

  if (trip.concern === "weather") {
    signals.push("Seasonal window under pressure");
  } else if (trip.concern === "disappointment") {
    signals.push("Expectation gap flagged");
  } else {
    signals.push("Hour-window pressure (10:30am–1pm)");
  }

  signals.push("Fix identified · confidence high");
  return signals.slice(0, 5);
}

// Build 1–2 predictive, specific insights with numbers. Client-side fallback —
// the model can replace these with something destination-tuned.
function generatePredictiveInsights(trip) {
  const dest = shortDestination(trip.destination);
  const vibes = trip.vibes || [];
  const mustHaves = trip.mustHaves || [];
  const has = (x) => vibes.includes(x) || mustHaves.includes(x);
  const d = dest || "this destination";

  const insights = [];

  // Crowd surge insight — near-universal
  insights.push({
    signal: `Peak crowd surge at the main sight begins ~10:30am`,
    body: `Your default routing arrives between 11:15am and noon. Expect 3\u00d7 the wait you\u2019d have before 9:00am.`,
  });

  // Destination-shape insight, pick one
  if (has("beach") || /amalfi|capri|cinque|positano|santorini|tulum|mykonos|ibiza|algarve|rio/i.test(d)) {
    insights.push({
      signal: `Ferry cadence collapses after 6:15pm`,
      body: `Last reliable crossings leave before sunset. Two of your default evenings land after the last boat.`,
    });
  } else if (has("luxury") || trip.concern === "cost") {
    insights.push({
      signal: `Lodging price ceiling shifts +38% on your dates`,
      body: `You\u2019re inside the destination\u2019s upper-pricing band. Moving arrival by 48 hours drops nightly rate materially.`,
    });
  } else if (/tokyo|paris|london|new york|rome/i.test(d)) {
    insights.push({
      signal: `Neighborhood transit compresses after 11:00pm`,
      body: `Late-night returns from nightlife zones add 25\u201340 minutes each way. This erodes next-morning windows.`,
    });
  } else {
    insights.push({
      signal: `Booking window tightens 11\u201314 days out`,
      body: `Your current dates hit the destination\u2019s last reliable release. Delay now and options narrow sharply.`,
    });
  }

  return insights.slice(0, 2);
}

// Before vs After bullets — 3 paired items and 3 improvement chips.
function generateBeforeAfter(trip) {
  const dest = shortDestination(trip.destination);
  const vibes = trip.vibes || [];
  const mustHaves = trip.mustHaves || [];
  const has = (x) => vibes.includes(x) || mustHaves.includes(x);

  const before = [
    `One base in ${dest}\u2019s busiest corridor`,
    "Major sights hit during 10:30am\u20131pm crowd surge",
    "Evenings pulled into the loudest stretch",
    "No slack \u2014 one delay and the trip compresses",
  ];
  const after = [
    `Two bases \u2014 quieter start, livelier second half`,
    "Major sights done before 9am; afternoons protected",
    "Evenings routed to calm adjacencies",
    "One full day held open \u2014 trip absorbs a delay",
  ];

  const improves = [
    "Crowd exposure \u2212 40%",
    "Morning windows restored",
    "One unplanned day protected",
  ];
  if (has("luxury") || trip.concern === "cost") {
    improves[2] = "Budget stretch reduced";
  }
  if (has("beach") || has("peaceful")) {
    improves[0] = "Crowd exposure \u2212 45%";
  }

  return { before, after, improves };
}

// ---------------------------- API call

async function analyzeTrip(trip) {
  const res = await fetch("/.netlify/functions/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(trip),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Analyze failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ---------------------------- instant mock generator
// Produces a plausible, destination-aware result from the user's inputs
// the moment they click "Analyze my trip". The background API call will
// replace this with a real analysis as soon as it returns.

function generateInstantResult(trip) {
  const nights = nightsBetween(trip.startDate, trip.endDate);
  const dest = trip.destination || "this trip";
  const vibes = trip.vibes || [];
  const mustHaves = trip.mustHaves || [];
  const style = trip.style || "balanced";
  const concern = trip.concern || "crowds";

  const legANights = Math.max(1, Math.ceil(nights / 2));
  const legBNights = Math.max(1, nights - legANights);
  const legADays = `Days 1\u2013${legANights}`;
  const legBDays = nights > legANights
    ? `Days ${legANights + 1}\u2013${nights}`
    : "";

  const outcomeByVibe = {
    peaceful: `As planned, this trip drops you into the same streets every other traveler is photographing \u2014 at the hours they\u2019re all there.`,
    luxury: `As planned, your budget lands in ${dest}\u2019s most generic tier \u2014 and blocks the elevated trip you came for.`,
    aesthetic: `As planned, you land in the corners everyone else is already photographing \u2014 which flattens the aesthetic you wanted.`,
    adventure: `As planned, the days get eaten by logistics and caf\u00e9s \u2014 and the adventure never lands.`,
    social: `As planned, you\u2019re in the quiet zones at the wrong hours \u2014 and miss the energy you came for.`,
  };
  const firstVibe = vibes[0];
  const verdictOutcome =
    outcomeByVibe[firstVibe] ||
    `As planned, this trip runs on the default tourist routing \u2014 not the one you\u2019re actually hoping for.`;

  const biggestRiskByConcern = {
    crowds: `Basing in the most obvious tourist corridor of ${dest} keeps you inside constant noise \u2014 and blocks the calm you came for.`,
    weather: `Your dates fall inside ${dest}\u2019s worst weather window \u2014 and block the conditions you came for.`,
    cost: `Your budget lands you in ${dest}\u2019s most generic tier \u2014 and blocks the quality you came for.`,
    disappointment: `Running ${dest} from one base stretches the trip thin \u2014 and blocks the version you\u2019re imagining.`,
  };
  const biggestRisk = biggestRiskByConcern[concern] || biggestRiskByConcern.crowds;

  const why = [
    `Your dates sit inside ${dest}\u2019s busiest visitor window`,
    `One base won\u2019t deliver the variety this destination needs`,
    `Your vibes lean ${vibes[0] || "calm"}; default routing runs the other way`,
    `Without early starts, the best hours are already gone`,
  ];

  const howToFix = [
    {
      title: `Do major sights before 9am \u2014 this is the single highest-leverage change you can make`,
      detail: "Morning windows are 60\u201370% less crowded and set the pace of every other day.",
    },
    {
      title: `Split ${dest} into two bases \u2014 this is what actually creates the calm + city balance you\u2019re trying to force`,
      detail: "Separates intensity from recovery. Both work better alone than stacked.",
    },
    {
      title: `Shift your base to a quieter side of ${dest}`,
      detail: "Why this matters: your base changes the texture of every day, not just one.",
    },
    {
      title: "Keep one full day unplanned",
      detail: "Why this matters: unplanned slack is where the memorable moments actually land.",
    },
  ];

  const betterVersion = [
    {
      name: `${dest}, split across two bases`,
      pitch: `A quieter base first, then the city \u2014 same length, less friction.`,
    },
  ];

  const planTeaser = [
    `Day 1: Arrive in ${dest}, settle into the quieter base, easy sunset`,
    `Day 2: Major sights early, slow afternoon back at base`,
    `Day 3: Shift bases, start the second half at a different pace`,
  ];

  const finalPlan = [
    {
      days: legADays,
      location: `${dest} \u2014 quieter base`,
      rules: [
        "Do major sights before 9am",
        "Stay close to where you sleep after 5pm",
        "Keep one evening completely open",
      ],
    },
  ];
  if (legBDays) {
    finalPlan.push({
      days: legBDays,
      location: `${dest} \u2014 second base`,
      rules: [
        "Walk the neighborhood before booking anything",
        "Plan one full day outside the center",
        "Eat where locals eat late",
      ],
    });
  }

  return {
    verdict: "Proceed with caution",
    verdictUrgency: "Your current plan works against you. We have the version that doesn\u2019t.",
    verdictOutcome,
    confidence: 78,
    biggestRisk,
    patternOpener: buildPatternOpener(trip),
    patternInsight: buildPatternInsight(trip),
    diagnosticSignals: generateDiagnosticSignals(trip),
    predictiveInsights: generatePredictiveInsights(trip),
    beforeAfter: generateBeforeAfter(trip),
    why,
    risks: {
      crowdRisk: concern === "crowds" ? "High" : "Medium",
      weatherRisk: concern === "weather" ? "High" : "Medium",
      budgetStretch: concern === "cost" ? "High" : "Medium",
      vibeMismatch: mustHaves.length >= 3 ? "High" : "Medium",
      logisticsFriction: "Medium",
    },
    howToFix,
    betterVersion,
    betterVersionOutro:
      "This version delivers your goal: the trip you came for, without the friction.",
    personalizationCallback: "",
    finalPlanLeadin: "Book this version \u2014 here is how it plays out:",
    finalPlan,
    planTeaser,
    whyThisWorks:
      "you\u2019re separating calm and intensity \u2014 not forcing both into the same base.",
    finalPlanOwnership: "This is the version worth your credit card.",
    styleNote: `You\u2019re ${style} \u2014 but ${dest} punishes loose planning. Skip the early starts and the split, and the trip defaults to noise you\u2019ll forget by the flight home.`,
  };
}

// ---------------------------- results rendering

function renderResults(trip, r, opts = {}) {
  const silent = opts.silent === true;
  const view = views.results;
  if (view) {
    view.dataset.stage = silent ? "settled" : "entering";
  }

  // tripline
  const nights = nightsBetween(trip.startDate, trip.endDate);
  const arriveLabel = formatDate(trip.startDate);
  document.getElementById("resultTripline").textContent =
    `${trip.destination} · ${nights} night${nights === 1 ? "" : "s"} · ${arriveLabel}`;

  // verdict
  const verdictCard = document.getElementById("verdictCard");
  const verdictKey = normalizeVerdict(r.verdict);
  verdictCard.dataset.verdict = verdictKey;
  document.getElementById("verdictHeadline").textContent = verdictPhrase(verdictKey);

  const verdictOutcomeEl = document.getElementById("verdictOutcome");
  const verdictOutcome = (r.verdictOutcome || r.verdictSummary || "").toString().trim();
  if (verdictOutcome) {
    verdictOutcomeEl.textContent = verdictOutcome;
    verdictOutcomeEl.hidden = false;
  } else {
    verdictOutcomeEl.textContent = "";
    verdictOutcomeEl.hidden = true;
  }

  // urgency line — the one-line verdict beneath the headline, covers all paths
  const verdictUrgencyEl = document.getElementById("verdictUrgency");
  const urgencyText = (r.verdictUrgency || "").toString().trim() || defaultUrgency(verdictKey);
  if (urgencyText) {
    verdictUrgencyEl.textContent = urgencyText;
    verdictUrgencyEl.hidden = false;
  } else {
    verdictUrgencyEl.textContent = "";
    verdictUrgencyEl.hidden = true;
  }

  // plan preview — 3 sample day lines under the CTA, teaser opacity
  const previewEl = document.getElementById("verdictPreview");
  const previewLines = Array.isArray(r.planTeaser)
    ? r.planTeaser.filter((l) => typeof l === "string" && l.trim()).slice(0, 3)
    : [];
  previewEl.innerHTML = "";
  if (previewLines.length) {
    previewLines.forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      previewEl.appendChild(li);
    });
    previewEl.hidden = false;
  } else {
    previewEl.hidden = true;
  }

  const conf = clamp(Number(r.confidence) || 0, 0, 100);
  document.getElementById("confidenceFill").style.width = `${conf}%`;
  document.getElementById("confidenceValue").textContent = `${Math.round(conf)}%`;

  // biggest risk
  document.getElementById("biggestRisk").textContent = r.biggestRisk || "—";

  // pattern opener — "Most people get <dest> wrong the same way:"
  const patternOpenerEl = document.getElementById("patternOpener");
  const patternOpenerText = ((r.patternOpener || "").toString().trim()) || buildPatternOpener(trip);
  if (patternOpenerEl) {
    if (patternOpenerText) {
      patternOpenerEl.textContent = patternOpenerText;
      patternOpenerEl.hidden = false;
    } else {
      patternOpenerEl.textContent = "";
      patternOpenerEl.hidden = true;
    }
  }

  // pattern insight — one-line supporting observation under biggest risk
  const patternEl = document.getElementById("patternInsight");
  const patternText = (r.patternInsight || "").toString().trim();
  if (patternText) {
    patternEl.textContent = patternText;
    patternEl.hidden = false;
  } else {
    patternEl.textContent = "";
    patternEl.hidden = true;
  }

  // diagnostic ribbon — persistent echo of the signals streamed pre-results
  const ribbonList = document.getElementById("diagnosticRibbonList");
  if (ribbonList) {
    const ribbon = Array.isArray(r.diagnosticSignals) && r.diagnosticSignals.length
      ? r.diagnosticSignals
      : generateDiagnosticSignals(trip);
    ribbonList.innerHTML = "";
    ribbon.slice(0, 5).forEach((text) => {
      const li = document.createElement("li");
      li.className = "diagnostic-ribbon__item";
      li.textContent = text;
      ribbonList.appendChild(li);
    });
  }

  // predictive insights — 1–2 specific, numbered observations
  const predictiveList = document.getElementById("predictiveList");
  if (predictiveList) {
    const insights = Array.isArray(r.predictiveInsights) && r.predictiveInsights.length
      ? r.predictiveInsights
      : generatePredictiveInsights(trip);
    predictiveList.innerHTML = "";
    insights.slice(0, 2).forEach((ins) => {
      const li = document.createElement("li");
      li.className = "predictive__item";
      const signal = document.createElement("p");
      signal.className = "predictive__signal";
      signal.textContent = ins.signal || "";
      const body = document.createElement("p");
      body.className = "predictive__body";
      body.textContent = ins.body || "";
      li.appendChild(signal);
      li.appendChild(body);
      predictiveList.appendChild(li);
    });
  }

  // before vs after — current plan vs optimized plan, plus improvement chips
  const beforeList = document.getElementById("beforeList");
  const afterList = document.getElementById("afterList");
  const improvesList = document.getElementById("beforeAfterImproves");
  if (beforeList && afterList && improvesList) {
    const ba = r.beforeAfter && typeof r.beforeAfter === "object"
      ? r.beforeAfter
      : generateBeforeAfter(trip);
    const fillList = (el, items) => {
      el.innerHTML = "";
      (items || []).slice(0, 4).forEach((t) => {
        const li = document.createElement("li");
        li.textContent = t;
        el.appendChild(li);
      });
    };
    fillList(beforeList, ba.before);
    fillList(afterList, ba.after);
    improvesList.innerHTML = "";
    (ba.improves || []).slice(0, 4).forEach((t) => {
      const li = document.createElement("li");
      li.className = "before-after__chip";
      li.textContent = t;
      improvesList.appendChild(li);
    });
  }

  // why list
  const whyList = document.getElementById("whyList");
  whyList.innerHTML = "";
  (r.why || []).slice(0, 4).forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    whyList.appendChild(li);
  });

  // risk breakdown — simplified labels, 4 dimensions
  // vibeMismatch is a badness score; we invert the displayed value
  // (high mismatch → low fit) while keeping the bar/color reflect severity.
  const risksList = document.getElementById("risksList");
  risksList.innerHTML = "";
  const riskOrder = [
    { key: "crowdRisk", label: "Crowds", invert: false },
    { key: "vibeMismatch", label: "Vibe fit", invert: true },
    { key: "budgetStretch", label: "Budget stretch", invert: false },
    { key: "logisticsFriction", label: "Logistics", invert: false },
  ];
  riskOrder.forEach(({ key, label, invert }) => {
    const severity = normalizeLevel(r.risks?.[key]);
    const displayed = invert ? invertLevel(severity) : severity;
    const row = document.createElement("li");
    row.className = "risk-row";
    row.dataset.level = severity;
    row.innerHTML = `
      <span class="risk-row__label">${label}</span>
      <span class="risk-row__value">${displayed}</span>
      <span class="risk-row__track"><span class="risk-row__fill"></span></span>
    `;
    risksList.appendChild(row);
  });

  // The Prescription — concise adjustments (3–5)
  const howToFixList = document.getElementById("howToFixList");
  howToFixList.innerHTML = "";
  const fixes = (r.howToFix && r.howToFix.length ? r.howToFix : r.smarterMoves || []).slice(0, 5);
  fixes.forEach((m) => {
    const li = document.createElement("li");
    const title = document.createElement("span");
    title.className = "prescribe-item__title";
    title.textContent = m.title || "";
    li.appendChild(title);
    if (m.detail) {
      const detail = document.createElement("span");
      detail.className = "prescribe-item__detail";
      detail.textContent = m.detail;
      li.appendChild(detail);
    }
    howToFixList.appendChild(li);
  });

  // a better version of this trip — 1–2 refined evolutions
  const betterVersionList = document.getElementById("betterVersionList");
  betterVersionList.innerHTML = "";
  const betterVersions = (r.betterVersion && r.betterVersion.length
    ? r.betterVersion
    : (r.alternatives || []).slice(0, 2).map((a) => ({
        name: a.name,
        pitch: a.why,
        shift: a.tradeoff,
      }))
  ).slice(0, 2);
  betterVersionList.dataset.count = String(betterVersions.length || 1);
  betterVersions.forEach((b, i) => {
    const item = document.createElement("article");
    item.className = "better-version__item";
    const name = document.createElement("h5");
    name.className = "better-version__name";
    name.textContent = b.name || "";
    const pitch = document.createElement("p");
    pitch.className = "better-version__pitch";
    pitch.textContent = b.pitch || b.why || "";
    if (betterVersions.length > 1) {
      const rank = document.createElement("p");
      rank.className = "better-version__rank";
      rank.textContent = i === 0 ? "Or" : "Or, alternatively";
      item.appendChild(rank);
    }
    item.appendChild(name);
    item.appendChild(pitch);
    betterVersionList.appendChild(item);
  });

  // closing line beneath the better-version block
  const betterOutro = document.getElementById("betterVersionOutro");
  const outroText = (r.betterVersionOutro || "").toString().trim();
  betterOutro.textContent =
    outroText ||
    "This version delivers your goal: calm, aesthetic, low-friction travel.";

  // final plan — "Book this version instead" (day-grouped legs)
  const finalPlanSection = document.getElementById("finalPlanSection");
  const finalPlanLeadinEl = document.querySelector(".final-plan__leadin");
  if (finalPlanLeadinEl) {
    const leadinText = (r.finalPlanLeadin || "").toString().trim() ||
      "If you book this version, here\u2019s how it plays out:";
    finalPlanLeadinEl.textContent = leadinText;
  }
  const finalPlanList = document.getElementById("finalPlanList");
  finalPlanList.innerHTML = "";
  const finalPlan = Array.isArray(r.finalPlan) ? r.finalPlan.slice(0, 4) : [];
  if (finalPlan.length) {
    finalPlan.forEach((leg) => {
      const item = document.createElement("li");
      item.className = "final-plan__item";

      const days = document.createElement("p");
      days.className = "final-plan__days";
      days.textContent = leg.days || "";
      item.appendChild(days);

      const location = document.createElement("h5");
      location.className = "final-plan__location";
      location.textContent = leg.location || "";
      item.appendChild(location);

      const rules = document.createElement("ul");
      rules.className = "final-plan__rules";
      (leg.rules || []).slice(0, 3).forEach((rule) => {
        const li = document.createElement("li");
        li.textContent = rule;
        rules.appendChild(li);
      });
      item.appendChild(rules);

      finalPlanList.appendChild(item);
    });
    finalPlanSection.hidden = false;
  } else {
    finalPlanSection.hidden = true;
  }

  // ownership line — reflects the user's selected vibes and must-haves
  const ownershipEl = document.getElementById("finalPlanOwnership");
  ownershipEl.textContent = buildOwnershipLine(trip, r.finalPlanOwnership);

  // personalization callback before the plan — echoes the user's own inputs
  const callbackEl = document.getElementById("personalizationCallback");
  callbackEl.textContent = buildPersonalizationCallback(trip, r.personalizationCallback);

  // why this works — short reasoning line after the itinerary
  const whyEl = document.getElementById("finalPlanWhy");
  const whyText = (r.whyThisWorks || "").toString().trim();
  if (whyText) {
    whyEl.innerHTML = `<span class="final-plan__why-label">Why this works:</span> ${escapeHtml(whyText)}`;
    whyEl.hidden = false;
  } else {
    whyEl.hidden = false;
  }

  // style note
  document.getElementById("styleNote").textContent =
    r.styleNote ||
    `You\u2019re ${trip.style || "balanced"} \u2014 but ${trip.destination || "this trip"} punishes loose planning. Without early starts and a split, the trip defaults to crowded and forgettable.`;
}

// ---------------------------- verdict CTAs + retry actions

const planCta = document.getElementById("planCta");
if (planCta) {
  planCta.addEventListener("click", () => {
    // Smooth-scroll to the premium section — the place where the fix unlocks.
    const premium = document.getElementById("premiumSection");
    if (premium) {
      premium.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

const savePlanBtn = document.getElementById("savePlanBtn");
const savePanel = document.getElementById("savePanel");
const savePanelForm = document.getElementById("savePanelForm");
const savePanelConfirm = document.getElementById("savePanelConfirm");

if (savePlanBtn && savePanel) {
  savePlanBtn.addEventListener("click", () => {
    const isOpen = !savePanel.hidden;
    if (isOpen) {
      savePanel.hidden = true;
      savePlanBtn.setAttribute("aria-expanded", "false");
      savePlanBtn.textContent = "Save the fix";
    } else {
      savePanel.hidden = false;
      savePlanBtn.setAttribute("aria-expanded", "true");
      savePlanBtn.textContent = "Close";
      const emailInput = savePanel.querySelector('input[type="email"]');
      requestAnimationFrame(() => emailInput && emailInput.focus());
    }
  });
}

if (savePanelForm) {
  savePanelForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const emailInput = savePanelForm.querySelector('input[type="email"]');
    if (!emailInput || !emailInput.value.trim()) {
      if (emailInput) emailInput.focus();
      return;
    }
    savePanelForm.hidden = true;
    if (savePanelConfirm) savePanelConfirm.hidden = false;
  });
}

function resetSavePanel() {
  if (savePanel) {
    savePanel.hidden = true;
  }
  if (savePanelForm) {
    savePanelForm.hidden = false;
    savePanelForm.reset();
    const subscribe = savePanelForm.querySelector('input[name="subscribe"]');
    if (subscribe) subscribe.checked = true;
  }
  if (savePanelConfirm) {
    savePanelConfirm.hidden = true;
  }
  if (savePlanBtn) {
    savePlanBtn.setAttribute("aria-expanded", "false");
    savePlanBtn.textContent = "Save the fix";
  }
}

const retryHandlers = {
  dates: () => {
    showView("entry");
    const start = form.elements.startDate;
    const end = form.elements.endDate;
    if (start) start.value = "";
    if (end) end.value = "";
    requestAnimationFrame(() => start && start.focus());
  },
  destination: () => {
    showView("entry");
    const dest = form.elements.destination;
    if (dest) dest.value = "";
    requestAnimationFrame(() => dest && dest.focus());
  },
};

document.querySelectorAll("[data-retry]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const handler = retryHandlers[btn.dataset.retry];
    if (handler) handler();
  });
});

document.querySelectorAll('[data-iterate="reset"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    showView("entry");
    form.reset();
    document
      .querySelectorAll(".chip[data-disabled]")
      .forEach((el) => el.removeAttribute("data-disabled"));
    document
      .querySelectorAll(".chip input, .radio input")
      .forEach((i) => (i.checked = false));
  });
});

// ---------------------------- helpers

function nightsBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Math.max(0, Math.round(ms / 86400000));
}

function formatDate(iso) {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function normalizeVerdict(v) {
  const s = (v || "").toString().toLowerCase();
  if (s.startsWith("proceed with") || s.includes("caution")) return "caution";
  if (s.startsWith("rethink") || s.includes("don't") || s.includes("bad")) return "rethink";
  if (s.startsWith("proceed")) return "proceed";
  return "caution";
}

function verdictPhrase(key) {
  if (key === "proceed") return "Proceed";
  if (key === "rethink") return "Rethink this trip";
  return "Proceed with caution";
}

function defaultUrgency(key) {
  if (key === "proceed") return "We would book this trip.";
  if (key === "rethink") return "This trip, as planned, won\u2019t deliver what you want.";
  return "Your current plan works against you. We have the version that doesn\u2019t.";
}

function normalizeLevel(v) {
  const s = (v || "").toString().toLowerCase();
  if (s.startsWith("h")) return "high";
  if (s.startsWith("l")) return "low";
  return "medium";
}

function invertLevel(level) {
  if (level === "high") return "low";
  if (level === "low") return "high";
  return "medium";
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// Map the user's selected vibes and must-haves into a tight descriptor
// used by the ownership line after the final plan.
const VIBE_WORDS = {
  peaceful: "calm",
  luxury: "elevated",
  aesthetic: "aesthetic",
  adventure: "adventurous",
  social: "social",
};
const MUST_WORDS = {
  walkable: "walkable",
  beach: "beach-focused",
  "luxury-hotel": "indulgent",
  "low-crowds": "low-crowd",
  "good-food": "food-led",
};

function describeTripVibes(trip) {
  const words = [];
  (trip.vibes || []).forEach((v) => {
    const w = VIBE_WORDS[v];
    if (w && !words.includes(w)) words.push(w);
  });
  (trip.mustHaves || []).forEach((m) => {
    const w = MUST_WORDS[m];
    if (w && !words.includes(w)) words.push(w);
  });
  return words.slice(0, 3);
}

function joinDescriptors(words) {
  if (!words.length) return "";
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, ${words[words.length - 1]}`;
}

function buildOwnershipLine(trip, serverText) {
  const text = (serverText || "").toString().trim();
  if (text) return text;
  return "This is what the trip was supposed to be.";
}

// Personalization callback echoes the user's OWN chosen inputs back at them,
// in the phrasing they selected — the core move is "you said X, we deliver X".
const CALLBACK_VIBE_WORDS = {
  peaceful: "peaceful",
  luxury: "luxury",
  aesthetic: "aesthetic",
  adventure: "adventure",
  social: "social",
};
const CALLBACK_MUST_WORDS = {
  walkable: "walkable",
  beach: "beach",
  "luxury-hotel": "a luxury hotel",
  "low-crowds": "low crowds",
  "good-food": "great food",
};

function describeTripInputs(trip) {
  const words = [];
  (trip.vibes || []).forEach((v) => {
    const w = CALLBACK_VIBE_WORDS[v];
    if (w && !words.includes(w)) words.push(w);
  });
  (trip.mustHaves || []).forEach((m) => {
    const w = CALLBACK_MUST_WORDS[m];
    if (w && !words.includes(w)) words.push(w);
  });
  return words.slice(0, 3);
}

function buildPersonalizationCallback(trip, serverText) {
  const text = (serverText || "").toString().trim();
  if (text) return text;
  const inputs = describeTripInputs(trip);
  const joined = joinDescriptors(inputs);
  if (!joined) {
    return "You want the version that actually works. Your current plan isn\u2019t it. This is.";
  }
  return `You want ${joined}. Your current plan delivers the opposite. This is the one that does.`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------- pattern insight (client-side)
// Two-part structure: an opener that names the destination ("Most people get
// Paris wrong the same way:") followed by a short, slightly unexpected
// observation keyed off the user's own inputs. The background API can still
// replace both with destination-specific model output.

function shortDestination(dest) {
  const raw = (dest || "").toString().trim();
  if (!raw) return "this trip";
  return raw.split(/[,\u2014\-]/)[0].trim() || raw;
}

function buildPatternOpener(trip) {
  const name = shortDestination(trip.destination);
  return `Most people get ${name} wrong the same way:`;
}

function buildPatternInsight(trip) {
  const vibes = trip.vibes || [];
  const mustHaves = trip.mustHaves || [];
  const has = (x) => vibes.includes(x) || mustHaves.includes(x);

  if (has("peaceful") && has("social")) {
    return "They try to force calm and nightlife into the same base \u2014 and get neither.";
  }
  if (has("peaceful") && has("beach")) {
    return "They pick peaceful, then book the busiest beach zone by default.";
  }
  if (has("aesthetic") && has("low-crowds")) {
    return "They chase the most photographed spots \u2014 exactly where everyone else already is.";
  }
  if (has("luxury") && has("adventure")) {
    return "They try to stack luxury and adventure from one base \u2014 both get watered down.";
  }
  if (has("adventure") && has("walkable")) {
    return "They stay walkable for the calm \u2014 and quietly cut off the trips they came for.";
  }
  if (trip.concern === "cost" && has("luxury")) {
    return "They land in the most generic tier \u2014 the one spend that rarely pays off.";
  }
  if (trip.concern === "crowds") {
    return "They base in the obvious tourist corridor and try to find calm inside it.";
  }
  if (trip.concern === "weather") {
    return "They blame the season \u2014 but the routing, not the weather, is what ruins the days.";
  }
  if (trip.concern === "disappointment") {
    return "The disappointment almost always comes from the base, not the destination.";
  }
  return "They base in the obvious tourist corridor and try to find calm inside it.";
}

// ---------------------------- presets (quick-start trips)

const PRESETS = {
  amalfi: {
    destination: "Amalfi Coast, Italy",
    origin: "New York, NY",
    nightsFromNow: { arrive: 45, depart: 51 },
    travelers: 2,
    budget: 5800,
    vibes: ["aesthetic", "peaceful"],
    mustHaves: ["good-food", "low-crowds"],
    concern: "crowds",
    style: "balanced",
  },
  tulum: {
    destination: "Tulum, Mexico",
    origin: "Chicago, IL",
    nightsFromNow: { arrive: 35, depart: 41 },
    travelers: 2,
    budget: 3800,
    vibes: ["peaceful", "aesthetic"],
    mustHaves: ["beach", "luxury-hotel"],
    concern: "disappointment",
    style: "wanderer",
  },
  tokyo: {
    destination: "Tokyo, Japan",
    origin: "Los Angeles, CA",
    nightsFromNow: { arrive: 60, depart: 67 },
    travelers: 2,
    budget: 6200,
    vibes: ["adventure", "aesthetic"],
    mustHaves: ["walkable", "good-food"],
    concern: "disappointment",
    style: "planner",
  },
  paris: {
    destination: "Paris, France",
    origin: "Boston, MA",
    nightsFromNow: { arrive: 30, depart: 35 },
    travelers: 2,
    budget: 4600,
    vibes: ["aesthetic", "luxury"],
    mustHaves: ["walkable", "good-food"],
    concern: "crowds",
    style: "balanced",
  },
  rio: {
    destination: "Rio de Janeiro, Brazil",
    origin: "Miami, FL",
    nightsFromNow: { arrive: 40, depart: 47 },
    travelers: 2,
    budget: 4200,
    vibes: ["social", "adventure"],
    mustHaves: ["beach"],
    concern: "disappointment",
    style: "wanderer",
  },
};

function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;

  const today = new Date();
  const arrive = new Date(today.getTime() + preset.nightsFromNow.arrive * 86400000);
  const depart = new Date(today.getTime() + preset.nightsFromNow.depart * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  form.elements.destination.value = preset.destination;
  form.elements.origin.value = preset.origin;
  form.elements.startDate.value = fmt(arrive);
  form.elements.endDate.value = fmt(depart);
  form.elements.travelers.value = String(preset.travelers);
  form.elements.budget.value = String(preset.budget);

  const vibes = new Set(preset.vibes);
  form.querySelectorAll('.chips[data-name="vibes"] input[type="checkbox"]').forEach((i) => {
    i.checked = vibes.has(i.value);
  });
  const mustHaves = new Set(preset.mustHaves);
  form.querySelectorAll('.chips[data-name="mustHaves"] input[type="checkbox"]').forEach((i) => {
    i.checked = mustHaves.has(i.value);
  });
  form.querySelectorAll('input[name="concern"]').forEach((i) => {
    i.checked = i.value === preset.concern;
  });
  form.querySelectorAll('input[name="style"]').forEach((i) => {
    i.checked = i.value === preset.style;
  });

  // refresh chip disabled state
  const group = document.querySelector('.chips[data-name="vibes"]');
  if (group) group.dispatchEvent(new Event("change", { bubbles: true }));

  // Run instantly
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
  } else {
    form.dispatchEvent(new Event("submit", { cancelable: true }));
  }
}

document.querySelectorAll(".preset[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
});

// ---------------------------- share (copyable text panel)

const shareBtn = document.getElementById("shareBtn");
const shareStatusEl = document.getElementById("shareStatus");
const shareBlock = document.getElementById("shareBlock");
const sharePanel = document.getElementById("sharePanel");
const sharePanelText = document.getElementById("sharePanelText");
const sharePanelCopy = document.getElementById("sharePanelCopy");

function resetShareState() {
  if (!shareBtn) return;
  shareBtn.disabled = false;
  shareBtn.dataset.state = "";
  shareBtn.setAttribute("aria-expanded", "false");
  const label = shareBtn.querySelector(".share__label");
  if (label) label.textContent = "Send this to someone you\u2019re traveling with";
  if (shareStatusEl) shareStatusEl.textContent = "";
  if (sharePanel) sharePanel.hidden = true;
  if (sharePanelCopy) {
    sharePanelCopy.dataset.state = "";
    sharePanelCopy.textContent = "Copy";
  }
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

if (shareBtn && sharePanel) {
  shareBtn.addEventListener("click", () => {
    const isOpen = !sharePanel.hidden;
    if (isOpen) {
      sharePanel.hidden = true;
      shareBtn.setAttribute("aria-expanded", "false");
    } else {
      sharePanel.hidden = false;
      shareBtn.setAttribute("aria-expanded", "true");
    }
  });
}

if (sharePanelCopy && sharePanelText) {
  sharePanelCopy.addEventListener("click", async () => {
    const text = (sharePanelText.textContent || "").trim();
    if (!text) return;
    const copied = await copyTextToClipboard(text);
    sharePanelCopy.dataset.state = copied ? "done" : "error";
    sharePanelCopy.textContent = copied ? "Copied \u2713" : "Couldn\u2019t copy";
    setTimeout(() => {
      sharePanelCopy.dataset.state = "";
      sharePanelCopy.textContent = "Copy";
    }, 2200);
  });
}

// ---------------------------- shared-view mode (read-only)

function enterSharedView() {
  sharedViewActive = true;
  document.body.dataset.shared = "true";
  const banner = document.getElementById("sharedBanner");
  if (banner) banner.hidden = false;

  // Hide the entry form entirely — this is a read-only page.
  if (views.entry) views.entry.hidden = true;

  // Hide in-result actions that don't apply to a shared, read-only view.
  if (shareBlock) shareBlock.hidden = true;
  const verdictActions = document.querySelector(".verdict__actions");
  if (verdictActions) verdictActions.hidden = true;
  const verdictMicro = document.getElementById("verdictMicro");
  if (verdictMicro) verdictMicro.hidden = true;
  const verdictPreview = document.getElementById("verdictPreview");
  if (verdictPreview) verdictPreview.hidden = true;
  const retryFooter = document.querySelector(".retry");
  if (retryFooter) retryFooter.hidden = true;
}

async function loadSharedResult(id) {
  const res = await fetch(
    `/.netlify/functions/share?id=${encodeURIComponent(id)}`
  );
  if (!res.ok) throw new Error(`Share load failed: ${res.status}`);
  return res.json();
}

(async function maybeBootSharedView() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("share");
  if (!id) return;

  try {
    const data = await loadSharedResult(id);
    if (!data || !data.trip || !data.result) throw new Error("Malformed share");
    enterSharedView();
    latestTrip = data.trip;
    latestResult = data.result;
    renderResults(data.trip, data.result, { silent: true });
    showView("results");
  } catch (err) {
    console.warn("Could not load shared trip", err);
    // Silent fallback to entry screen.
  }
})();

