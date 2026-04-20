// TripLens — client flow
// Entry → processing → results. One page, three views.

const views = {
  entry: document.querySelector('[data-view="entry"]'),
  processing: document.querySelector('[data-view="processing"]'),
  results: document.querySelector('[data-view="results"]'),
};

const form = document.getElementById("intakeForm");
const errorEl = document.getElementById("intakeError");
const analyzeBtn = document.getElementById("analyzeBtn");
const yearEl = document.getElementById("year");
yearEl.textContent = new Date().getFullYear();

// ------------------------------- view switching

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
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
  showView("processing");
  runProcessingAnimation();

  try {
    const result = await analyzeTrip(trip);
    // ensure processing pace feels deliberate, not instant
    await minDelay(2600);
    renderResults(trip, result);
    showView("results");
  } catch (err) {
    console.error(err);
    errorEl.textContent =
      "Something interrupted the analysis. Please try again in a moment.";
    errorEl.hidden = false;
    showView("entry");
  } finally {
    analyzeBtn.disabled = false;
  }
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

// ---------------------------- processing animation

function runProcessingAnimation() {
  const items = [...document.querySelectorAll("#processingSteps [data-step]")];
  items.forEach((li) => li.removeAttribute("data-state"));
  let idx = 0;
  items[0]?.setAttribute("data-state", "active");
  const timers = [];
  const advance = () => {
    if (idx < items.length) items[idx].setAttribute("data-state", "done");
    idx += 1;
    if (idx < items.length) {
      items[idx].setAttribute("data-state", "active");
      timers.push(setTimeout(advance, 650 + Math.random() * 250));
    }
  };
  timers.push(setTimeout(advance, 700));
}

function minDelay(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

// ---------------------------- results rendering

function renderResults(trip, r) {
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

  // style note
  document.getElementById("styleNote").textContent =
    r.styleNote ||
    `You\u2019re ${trip.style || "balanced"} \u2014 but this trip only works if you\u2019re intentional. Without a plan, it skews chaotic.`;
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
