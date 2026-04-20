// TripLens — client flow
// Entry → brief diagnostic phase → 8-section decision page.

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

// ---------------------------- date defaults

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

// ---------------------------- form submission

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

  const instant = generateInstantResult(trip);
  latestTrip = trip;
  latestResult = instant;
  latestShareId = null;
  resetShareState();
  resetSavePanel();
  renderResults(trip, instant);

  await runDiagnosticPhase(trip, instant);
  showView("results");

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
// ~1s streaming signals before results land. Real analysis runs in background.

function runDiagnosticPhase(trip, instant) {
  if (!diagnosticPhase || !diagnosticPhaseList) return Promise.resolve();
  const signals = (instant && Array.isArray(instant.diagnosticSignals) && instant.diagnosticSignals.length)
    ? instant.diagnosticSignals
    : generateDiagnosticSignals(trip);

  diagnosticPhaseList.innerHTML = "";
  diagnosticPhase.hidden = false;
  diagnosticPhase.dataset.state = "in";

  const stepDelay = 180;
  const initialDelay = 80;

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

    const total = initialDelay + signals.length * stepDelay + 260;
    setTimeout(() => {
      diagnosticPhase.dataset.state = "out";
    }, total);
    setTimeout(() => {
      diagnosticPhase.dataset.state = "";
      diagnosticPhase.hidden = true;
      resolve();
    }, total + 280);
  });
}

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

  signals.push("Fix identified \u00b7 confidence high");
  return signals.slice(0, 4);
}

// 2 predictive, specific insights with numbers
function generatePredictiveInsights(trip) {
  const dest = shortDestination(trip.destination);
  const vibes = trip.vibes || [];
  const mustHaves = trip.mustHaves || [];
  const has = (x) => vibes.includes(x) || mustHaves.includes(x);
  const d = dest || "this destination";

  const insights = [];

  insights.push({
    signal: `Peak crowd surge at the main sight begins ~10:30am`,
    body: `Your default routing lands between 11:15am and noon. Expect 3\u00d7 the wait you\u2019d have before 9:00am.`,
  });

  if (has("beach") || /amalfi|capri|cinque|positano|santorini|tulum|mykonos|ibiza|algarve|rio/i.test(d)) {
    insights.push({
      signal: `Ferry cadence collapses after 6:15pm`,
      body: `Last reliable crossings leave before sunset. Two of your default evenings land after the last boat.`,
    });
  } else if (has("luxury") || trip.concern === "cost") {
    insights.push({
      signal: `Lodging price ceiling shifts +38% on your dates`,
      body: `You sit inside the upper-pricing band. Moving arrival by 48 hours drops nightly rate materially.`,
    });
  } else if (/tokyo|paris|london|new york|rome/i.test(d)) {
    insights.push({
      signal: `Neighborhood transit compresses after 11:00pm`,
      body: `Late-night returns from nightlife zones add 25\u201340 minutes each way. Next-morning windows erode.`,
    });
  } else {
    insights.push({
      signal: `Booking window tightens 11\u201314 days out`,
      body: `Your current dates hit the last reliable release. Delay now and options narrow sharply.`,
    });
  }

  return insights.slice(0, 2);
}

// Before vs After — 4 paired bullets + 3 improvement chips
function generateBeforeAfter(trip) {
  const dest = shortDestination(trip.destination);
  const vibes = trip.vibes || [];
  const mustHaves = trip.mustHaves || [];
  const has = (x) => vibes.includes(x) || mustHaves.includes(x);

  const before = [
    `One base in ${dest}\u2019s busiest corridor`,
    "Major sights hit during 10:30am\u20131pm surge",
    "Evenings pulled into the loudest stretch",
    "No slack \u2014 one delay compresses the trip",
  ];
  const after = [
    `Two bases \u2014 quieter start, livelier second half`,
    "Major sights done before 9am; afternoons protected",
    "Evenings routed to calm adjacencies",
    "One full day held open \u2014 absorbs delays",
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

// Core failure — 2–4 short bullets about what's structurally wrong
function generateCoreFailure(trip) {
  const dest = shortDestination(trip.destination);
  const vibes = trip.vibes || [];
  const mustHaves = trip.mustHaves || [];
  const has = (x) => vibes.includes(x) || mustHaves.includes(x);
  const nights = nightsBetween(trip.startDate, trip.endDate);

  const bullets = [];

  bullets.push(
    `Single base in ${dest}\u2019s busiest corridor \u2014 the decision that compounds every other friction.`
  );

  if (has("peaceful") || has("low-crowds") || trip.concern === "crowds") {
    bullets.push(
      "Timing puts you at the major sights during peak crowd surge (10:30am\u20131pm)."
    );
  } else if (has("aesthetic")) {
    bullets.push(
      "You land in the most-photographed corners at the hours they\u2019re most photographed."
    );
  } else {
    bullets.push(
      "Routing burns daylight on logistics between sights instead of inside them."
    );
  }

  if (has("peaceful") && (has("social") || has("adventure"))) {
    bullets.push(
      "Energy mismatch \u2014 calm and intensity stacked into one base deliver neither."
    );
  } else if (has("luxury") && trip.concern === "cost") {
    bullets.push(
      "Budget lands in the generic tier \u2014 the one spend that rarely pays off."
    );
  } else if (nights <= 4) {
    bullets.push(
      "Trip length is too short for the routing this plan commits to."
    );
  } else if (nights >= 8) {
    bullets.push(
      "No pacing shift \u2014 one base for 8+ nights flattens the trip."
    );
  } else {
    bullets.push(
      "No slack \u2014 a single delay collapses the rest of the trip."
    );
  }

  return bullets.slice(0, 4);
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

function generateInstantResult(trip) {
  const nights = nightsBetween(trip.startDate, trip.endDate);
  const dest = trip.destination || "this trip";
  const vibes = trip.vibes || [];
  const style = trip.style || "balanced";
  const concern = trip.concern || "crowds";

  const legANights = Math.max(1, Math.ceil(nights / 2));
  const legBNights = Math.max(1, nights - legANights);
  const legADays = `Days 1\u2013${legANights}`;
  const legBDays = nights > legANights
    ? `Days ${legANights + 1}\u2013${nights}`
    : "";

  const urgencyByVibe = {
    peaceful: `The plan you\u2019ve drawn up routes you into ${dest}\u2019s loudest corridor \u2014 at the hours it\u2019s loudest.`,
    luxury: `Your budget lands in ${dest}\u2019s most generic tier \u2014 and blocks the elevated trip you came for.`,
    aesthetic: `You\u2019ve routed yourself into the corners everyone else is already photographing \u2014 flat aesthetic.`,
    adventure: `The days get eaten by logistics and caf\u00e9s \u2014 the adventure never lands.`,
    social: `You\u2019re in the quiet zones at the wrong hours \u2014 and miss the energy you came for.`,
  };
  const firstVibe = vibes[0];
  const verdictUrgency =
    urgencyByVibe[firstVibe] ||
    `As planned, this trip runs on the default tourist routing \u2014 not the one you came for.`;

  const coreLedeByConcern = {
    crowds: `Basing in ${dest}\u2019s busiest corridor puts the loudest stretch between you and what you came for.`,
    weather: `Your dates land in ${dest}\u2019s worst weather window \u2014 and block the conditions you came for.`,
    cost: `Your budget lands you in ${dest}\u2019s generic tier \u2014 the one spend that rarely pays off.`,
    disappointment: `Running ${dest} from one base stretches the trip thin \u2014 the version you\u2019re imagining never lands.`,
  };
  const coreFailureLede = coreLedeByConcern[concern] || coreLedeByConcern.crowds;

  const coreFailureList = generateCoreFailure(trip);

  const howToFix = [
    {
      title: `Do the major sights before 9am \u2014 the single highest-leverage change you can make`,
      detail: "Morning windows are 60\u201370% less crowded and set the pace of every other day.",
    },
    {
      title: `Split ${dest} into two bases \u2014 this is what creates the calm + city balance you\u2019re trying to force`,
      detail: "Separates intensity from recovery. Both work better alone than stacked.",
    },
    {
      title: `Shift your base away from the tourist corridor`,
      detail: "Your base changes the texture of every day, not just one.",
    },
    {
      title: "Keep one full day unplanned",
      detail: "Slack is where the memorable moments actually land.",
    },
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

  const whyThisWorks = `You\u2019re separating calm and intensity, not forcing both into the same base. Calm compounds in the morning; energy lands after 5pm. The plan runs with the city, not against it.`;

  return {
    verdict: "Proceed with caution",
    verdictUrgency,
    confidence: 78,
    diagnosticSignals: generateDiagnosticSignals(trip),
    coreFailureLede,
    coreFailure: coreFailureList,
    predictiveInsights: generatePredictiveInsights(trip),
    beforeAfter: generateBeforeAfter(trip),
    howToFix,
    personalizationCallback: "",
    finalPlan,
    whyThisWorks,
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
    `${trip.destination} \u00b7 ${nights} night${nights === 1 ? "" : "s"} \u00b7 ${arriveLabel}`;

  // 1. verdict
  const verdictCard = document.getElementById("verdictCard");
  const verdictKey = normalizeVerdict(r.verdict);
  verdictCard.dataset.verdict = verdictKey;
  document.getElementById("verdictHeadline").textContent = verdictPhrase(verdictKey);

  const verdictUrgencyEl = document.getElementById("verdictUrgency");
  const urgencyText = (r.verdictUrgency || r.verdictOutcome || "").toString().trim() || defaultUrgency(verdictKey);
  verdictUrgencyEl.textContent = urgencyText;

  const conf = clamp(Number(r.confidence) || 0, 0, 100);
  document.getElementById("confidenceFill").style.width = `${conf}%`;
  document.getElementById("confidenceValue").textContent = `${Math.round(conf)}%`;

  // 2. core failure
  const coreFailureLedeEl = document.getElementById("coreFailureLede");
  const coreLede = (r.coreFailureLede || r.biggestRisk || "").toString().trim();
  if (coreFailureLedeEl) {
    if (coreLede) {
      coreFailureLedeEl.textContent = coreLede;
      coreFailureLedeEl.hidden = false;
    } else {
      coreFailureLedeEl.textContent = "";
      coreFailureLedeEl.hidden = true;
    }
  }
  const coreFailureList = document.getElementById("coreFailureList");
  if (coreFailureList) {
    coreFailureList.innerHTML = "";
    const bullets = Array.isArray(r.coreFailure) && r.coreFailure.length
      ? r.coreFailure
      : (Array.isArray(r.why) && r.why.length ? r.why : generateCoreFailure(trip));
    bullets.slice(0, 4).forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      coreFailureList.appendChild(li);
    });
  }

  // 3. predictive insights
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

  // 4. prescription
  const howToFixList = document.getElementById("howToFixList");
  howToFixList.innerHTML = "";
  const fixes = (r.howToFix && r.howToFix.length ? r.howToFix : r.smarterMoves || []).slice(0, 4);
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

  // 5. before vs after
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

  // 6. corrected version (final plan)
  const finalPlanSection = document.getElementById("finalPlanSection");
  const finalPlanList = document.getElementById("finalPlanList");
  const callbackEl = document.getElementById("personalizationCallback");
  if (callbackEl) {
    callbackEl.textContent = buildPersonalizationCallback(trip, r.personalizationCallback);
  }

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

  // 7. why this works
  const whyEl = document.getElementById("whyThisWorksBody");
  if (whyEl) {
    const whyText = (r.whyThisWorks || "").toString().trim() ||
      "You\u2019re separating calm and intensity, not forcing both into the same base. The plan runs with the city, not against it.";
    whyEl.textContent = whyText;
  }
}

// ---------------------------- verdict CTAs + retry actions

const planCta = document.getElementById("planCta");
if (planCta) {
  planCta.addEventListener("click", () => {
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
  if (s.startsWith("rethink") || s.includes("do not book") || s.includes("don\u2019t") || s.includes("don't") || s.includes("bad")) return "rethink";
  if (s.startsWith("proceed")) return "proceed";
  return "caution";
}

function verdictPhrase(key) {
  if (key === "proceed") return "Proceed";
  if (key === "rethink") return "Do not book this version";
  return "Proceed with caution";
}

function defaultUrgency(key) {
  if (key === "proceed") return "The plan holds. Book it.";
  if (key === "rethink") return "This plan will not deliver what you came for. Replace it.";
  return "The plan you\u2019ve drawn up routes you into the loudest version of this trip \u2014 at the worst hours.";
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function joinDescriptors(words) {
  if (!words.length) return "";
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, ${words[words.length - 1]}`;
}

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
    return "You want the version that actually works. Your current plan isn\u2019t it. This one is.";
  }
  return `You want ${joined}. Your current plan delivers the opposite. This one does.`;
}

function shortDestination(dest) {
  const raw = (dest || "").toString().trim();
  if (!raw) return "this trip";
  return raw.split(/[,\u2014\-]/)[0].trim() || raw;
}

// ---------------------------- presets

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

  const group = document.querySelector('.chips[data-name="vibes"]');
  if (group) group.dispatchEvent(new Event("change", { bubbles: true }));

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
    sharePanelCopy.textContent = copied ? "Copied" : "Couldn\u2019t copy";
    setTimeout(() => {
      sharePanelCopy.dataset.state = "";
      sharePanelCopy.textContent = "Copy";
    }, 2200);
  });
}

// ---------------------------- shared-view mode

function enterSharedView() {
  sharedViewActive = true;
  document.body.dataset.shared = "true";
  const banner = document.getElementById("sharedBanner");
  if (banner) banner.hidden = false;

  if (views.entry) views.entry.hidden = true;

  if (shareBlock) shareBlock.hidden = true;
  const verdictActions = document.querySelector(".verdict__actions");
  if (verdictActions) verdictActions.hidden = true;
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
  }
})();
