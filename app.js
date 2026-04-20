// TripLens — client flow
// Entry → results (instant). A subtle overlay acknowledges the analysis
// without blocking the page; the API call updates the results silently
// once it returns.

const views = {
  entry: document.querySelector('[data-view="entry"]'),
  results: document.querySelector('[data-view="results"]'),
};

const form = document.getElementById("intakeForm");
const errorEl = document.getElementById("intakeError");
const analyzeBtn = document.getElementById("analyzeBtn");
const analyzingOverlay = document.getElementById("analyzingOverlay");
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

  // 1. Generate instant results from the user's inputs and render them.
  const instant = generateInstantResult(trip);
  latestTrip = trip;
  latestResult = instant;
  latestShareId = null;
  resetShareState();
  renderResults(trip, instant);

  // 2. Swap view immediately — no processing gate.
  showView("results");

  // 3. Subtle non-blocking overlay: fades in, lingers briefly, fades out.
  flashAnalyzingOverlay();

  // 4. Fire the real analysis in the background and swap in silently.
  analyzeTrip(trip)
    .then((real) => {
      if (real && typeof real === "object") {
        latestResult = real;
        latestShareId = null;
        resetShareState();
        renderResults(trip, real, { silent: true });
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

// ---------------------------- non-blocking analyzing overlay

function flashAnalyzingOverlay() {
  if (!analyzingOverlay) return;
  analyzingOverlay.hidden = false;
  analyzingOverlay.dataset.state = "in";
  // After ~1.5s, begin fade-out.
  setTimeout(() => {
    analyzingOverlay.dataset.state = "out";
  }, 1500);
  // Hide fully after the fade-out completes.
  setTimeout(() => {
    analyzingOverlay.dataset.state = "";
    analyzingOverlay.hidden = true;
  }, 2400);
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
    peaceful: `As planned, this trip will feel crowded instead of calm.`,
    luxury: `As planned, this trip will feel generic instead of elevated.`,
    aesthetic: `As planned, this trip will feel ordinary instead of photogenic.`,
    adventure: `As planned, this trip will feel padded instead of adventurous.`,
    social: `As planned, this trip will feel quiet instead of social.`,
  };
  const firstVibe = vibes[0];
  const verdictOutcome =
    outcomeByVibe[firstVibe] ||
    `As planned, this trip will feel busier than what you\u2019re hoping for.`;

  const biggestRiskByConcern = {
    crowds: `Basing in one high-traffic area of ${dest} puts you in constant noise \u2014 and blocks the calm you actually want.`,
    weather: `Your dates land inside ${dest}\u2019s worst weather window \u2014 and block the conditions you came for.`,
    cost: `Your current budget puts you in ${dest}\u2019s most generic layer \u2014 and blocks the quality you actually want.`,
    disappointment: `Your current routing stretches ${dest} across one base \u2014 and blocks the trip you\u2019re imagining.`,
  };
  const biggestRisk = biggestRiskByConcern[concern] || biggestRiskByConcern.crowds;

  const why = [
    `Your dates put ${dest} inside its busiest visitor window`,
    `One base won\u2019t deliver the variety this destination needs`,
    `Your vibes lean ${vibes[0] || "calm"}; default routing runs the other way`,
    `Without early starts, the best hours are already gone`,
  ];

  const howToFix = [
    {
      title: `Shift your base to a quieter side of ${dest}`,
      detail: "Single highest-leverage move \u2014 it changes the texture of every day.",
    },
    {
      title: "Do the major sights before 9am, not midday",
      detail: "Morning windows are 60\u201370% less crowded and set the whole day's pace.",
    },
    {
      title: `Split ${dest} into two bases instead of one`,
      detail: "Separates the calm from the intensity \u2014 both work better alone.",
    },
    {
      title: "Keep one full day unplanned",
      detail: "Unplanned slack is where the memorable moments actually land.",
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
    verdictPosition: "We would book this \u2014 with the changes below.",
    verdictUrgency: "This trip needs 2\u20133 key changes to actually work.",
    verdictOutcome,
    confidence: 78,
    biggestRisk,
    patternInsight: buildPatternInsight(trip),
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
      "This version delivers your goal: the trip you actually came for, without the friction.",
    personalizationCallback: "",
    finalPlan,
    planTeaser,
    whyThisWorks:
      "you\u2019re separating calm and intensity instead of forcing both into one rhythm.",
    finalPlanOwnership: "",
    styleNote: `You\u2019re ${style} \u2014 but ${dest} punishes loose planning. Without early starts and a split, the trip defaults to crowded and forgettable.`,
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

  const verdictPositionEl = document.getElementById("verdictPosition");
  const verdictPosition = (r.verdictPosition || "").toString().trim() || defaultPosition(verdictKey);
  verdictPositionEl.textContent = verdictPosition;

  const verdictOutcomeEl = document.getElementById("verdictOutcome");
  const verdictOutcome = (r.verdictOutcome || r.verdictSummary || "").toString().trim();
  if (verdictOutcome) {
    verdictOutcomeEl.textContent = verdictOutcome;
    verdictOutcomeEl.hidden = false;
  } else {
    verdictOutcomeEl.textContent = "";
    verdictOutcomeEl.hidden = true;
  }

  // urgency line — creates action pressure under the verdict headline
  const verdictUrgencyEl = document.getElementById("verdictUrgency");
  const urgencyText = (r.verdictUrgency || "").toString().trim() || defaultUrgency(verdictKey);
  if (urgencyText && verdictKey !== "proceed") {
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
    planCta.disabled = true;
    const label = planCta.querySelector(".cta__label");
    const original = label ? label.textContent : "";
    if (label) label.textContent = "Day-by-day planning is coming soon";
    setTimeout(() => {
      if (label && original) label.textContent = original;
      planCta.disabled = false;
    }, 2400);
  });
}

const savePlanBtn = document.getElementById("savePlanBtn");
if (savePlanBtn) {
  const savedLabel = "Saved \u2713";
  const defaultLabel = savePlanBtn.textContent.trim();
  savePlanBtn.addEventListener("click", () => {
    if (savePlanBtn.dataset.saved === "true") return;
    savePlanBtn.dataset.saved = "true";
    savePlanBtn.textContent = savedLabel;
    setTimeout(() => {
      savePlanBtn.dataset.saved = "";
      savePlanBtn.textContent = defaultLabel;
    }, 2800);
  });
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

function defaultPosition(key) {
  if (key === "proceed") return "We would book this trip.";
  if (key === "rethink") return "We would not book this trip as planned.";
  return "We would book this — with the changes below.";
}

function defaultUrgency(key) {
  if (key === "proceed") return "";
  if (key === "rethink") return "This trip needs major changes before it can work.";
  return "This trip needs 2–3 key changes to actually work.";
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
  const descriptors = describeTripVibes(trip);
  const joined = joinDescriptors(descriptors) || "calm, intentional";
  return `This version actually delivers the ${joined} trip you\u2019re looking for.`;
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
    return "You told us what you want — this version actually delivers that.";
  }
  return `You said you want ${joined} \u2014 this version actually delivers that.`;
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
// Produces a short, slightly unexpected observation keyed off the user's
// own inputs. Meant to create the "oh wow, that's true" moment in the
// instant result — the background API can still replace this with a
// destination-specific model insight.

function buildPatternInsight(trip) {
  const vibes = trip.vibes || [];
  const mustHaves = trip.mustHaves || [];
  const has = (x) => vibes.includes(x) || mustHaves.includes(x);

  if (has("peaceful") && has("social")) {
    return "Most people get this wrong by trying to force calm and nightlife into the same base.";
  }
  if (has("peaceful") && has("beach")) {
    return "You picked peaceful, but the default routing puts you in the busiest beach zone.";
  }
  if (has("aesthetic") && has("low-crowds")) {
    return "The spots that photograph best are the ones everyone else already found.";
  }
  if (has("luxury") && has("adventure")) {
    return "Luxury and adventure pull in opposite directions — one base almost always sacrifices one.";
  }
  if (has("adventure") && has("walkable")) {
    return "Walkable bases feel calm — but quietly cut off the trips you actually came for.";
  }
  if (trip.concern === "cost" && has("luxury")) {
    return "Your budget lands in the most generic tier — the one spend that rarely pays off.";
  }
  if (trip.concern === "crowds") {
    return "Your dates are fine — it’s your setup that puts you inside the crowd.";
  }
  if (trip.concern === "weather") {
    return "Most people miss that the weather risk here is the routing, not the season.";
  }
  if (trip.concern === "disappointment") {
    return "The disappointment almost always comes from one base, not from the destination.";
  }
  return "Most people get this wrong by trying to do everything from one base.";
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

// ---------------------------- share (generate view-only link)

const shareBtn = document.getElementById("shareBtn");
const shareStatusEl = document.getElementById("shareStatus");
const shareBlock = document.getElementById("shareBlock");

function resetShareState() {
  if (!shareBtn) return;
  shareBtn.disabled = false;
  shareBtn.dataset.state = "";
  const label = shareBtn.querySelector(".share__label");
  if (label) label.textContent = "Send this to someone you\u2019re traveling with";
  if (shareStatusEl) shareStatusEl.textContent = "";
}

async function createShare() {
  if (!latestTrip || !latestResult) return null;
  if (latestShareId) return latestShareId;
  const res = await fetch("/.netlify/functions/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trip: latestTrip, result: latestResult }),
  });
  if (!res.ok) throw new Error(`Share failed: ${res.status}`);
  const data = await res.json();
  latestShareId = data.id;
  return latestShareId;
}

function shareUrlFor(id) {
  const base = window.location.origin;
  return `${base}/?share=${encodeURIComponent(id)}`;
}

async function copyShareUrl(url) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    // fall through to fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = url;
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

if (shareBtn) {
  shareBtn.addEventListener("click", async () => {
    if (!latestTrip || !latestResult) return;
    const label = shareBtn.querySelector(".share__label");
    shareBtn.disabled = true;
    shareBtn.dataset.state = "working";
    if (label) label.textContent = "Creating link\u2026";
    if (shareStatusEl) shareStatusEl.textContent = "";

    try {
      const id = await createShare();
      const url = shareUrlFor(id);
      const copied = await copyShareUrl(url);
      shareBtn.dataset.state = "done";
      if (label) label.textContent = copied ? "Link copied \u2713" : "Link ready";
      if (shareStatusEl) {
        shareStatusEl.textContent = copied
          ? "Pasted to your clipboard — send it to anyone you\u2019re traveling with."
          : url;
      }
    } catch (err) {
      console.warn("Share link failed", err);
      shareBtn.disabled = false;
      shareBtn.dataset.state = "error";
      if (label) label.textContent = "Try again";
      if (shareStatusEl) shareStatusEl.textContent = "Couldn\u2019t create a link just now.";
    }
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

