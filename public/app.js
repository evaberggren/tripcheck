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

// Remember the last submitted trip so "try different dates" etc. can prefill
let lastTrip = null;

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
  lastTrip = trip;

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

  const conf = clamp(Number(r.confidence) || 0, 0, 100);
  document.getElementById("confidenceFill").style.width = `${conf}%`;
  document.getElementById("confidenceValue").textContent = `${Math.round(conf)}%`;

  // biggest risk
  document.getElementById("biggestRisk").textContent = r.biggestRisk || "—";

  // why list
  const whyList = document.getElementById("whyList");
  whyList.innerHTML = "";
  (r.why || []).forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    whyList.appendChild(li);
  });

  // risk breakdown
  const risksList = document.getElementById("risksList");
  risksList.innerHTML = "";
  const riskOrder = [
    ["crowdRisk", "Crowd risk"],
    ["weatherRisk", "Weather risk"],
    ["budgetStretch", "Budget stretch"],
    ["vibeMismatch", "Vibe mismatch"],
    ["logisticsFriction", "Logistics friction"],
  ];
  riskOrder.forEach(([key, label]) => {
    const level = normalizeLevel(r.risks?.[key]);
    const row = document.createElement("li");
    row.className = "risk-row";
    row.dataset.level = level;
    row.innerHTML = `
      <span class="risk-row__label">${label}</span>
      <span class="risk-row__value">${level}</span>
      <span class="risk-row__track"><span class="risk-row__fill"></span></span>
    `;
    risksList.appendChild(row);
  });

  // smarter move
  const smarterList = document.getElementById("smarterList");
  smarterList.innerHTML = "";
  (r.smarterMoves || []).forEach((m) => {
    const li = document.createElement("li");
    const p = document.createElement("p");
    const title = document.createElement("strong");
    title.textContent = m.title || "";
    p.appendChild(title);
    if (m.detail) {
      const span = document.createElement("span");
      span.textContent = m.detail;
      p.appendChild(span);
    }
    li.appendChild(p);
    smarterList.appendChild(li);
  });

  // alternatives
  const altGrid = document.getElementById("alternativesGrid");
  altGrid.innerHTML = "";
  (r.alternatives || []).slice(0, 3).forEach((a, i) => {
    const card = document.createElement("article");
    card.className = "alt-card";
    card.innerHTML = `
      <span class="alt-card__rank">Option ${String(i + 1).padStart(2, "0")}</span>
      <h5 class="alt-card__name"></h5>
      <p class="alt-card__why"></p>
      <p class="alt-card__tradeoff"></p>
    `;
    card.querySelector(".alt-card__name").textContent = a.name || "";
    card.querySelector(".alt-card__why").textContent = a.why || "";
    card.querySelector(".alt-card__tradeoff").textContent = a.tradeoff || "";
    altGrid.appendChild(card);
  });

  // style note
  document.getElementById("styleNote").textContent =
    r.styleNote || "";
}

// ---------------------------- iterate buttons

document.querySelector(".iterate__buttons").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-iterate]");
  if (!btn) return;
  const action = btn.dataset.iterate;
  showView("entry");
  // restore last trip so tweaks are easy
  if (lastTrip) {
    restoreTrip(lastTrip);
    if (action === "dates") {
      setTimeout(() => form.elements["startDate"].focus(), 250);
    } else if (action === "destination") {
      form.elements["destination"].value = "";
      setTimeout(() => form.elements["destination"].focus(), 250);
    } else if (action === "budget") {
      setTimeout(() => form.elements["budget"].focus(), 250);
    } else if (action === "reset") {
      form.reset();
      document
        .querySelectorAll(".chip[data-disabled]")
        .forEach((el) => el.removeAttribute("data-disabled"));
      document
        .querySelectorAll(".chip input, .radio input")
        .forEach((i) => (i.checked = false));
      lastTrip = null;
    }
  }
});

function restoreTrip(t) {
  form.elements["destination"].value = t.destination || "";
  form.elements["origin"].value = t.origin || "";
  form.elements["startDate"].value = t.startDate || "";
  form.elements["endDate"].value = t.endDate || "";
  form.elements["travelers"].value = t.travelers || 2;
  form.elements["budget"].value = t.budget || "";

  // reset chips
  form.querySelectorAll(".chip input, .radio input").forEach((i) => (i.checked = false));
  (t.vibes || []).forEach((v) => {
    const i = form.querySelector(
      `.chips[data-name="vibes"] input[value="${CSS.escape(v)}"]`,
    );
    if (i) i.checked = true;
  });
  (t.mustHaves || []).forEach((v) => {
    const i = form.querySelector(
      `.chips[data-name="mustHaves"] input[value="${CSS.escape(v)}"]`,
    );
    if (i) i.checked = true;
  });
  if (t.concern) {
    const c = form.querySelector(
      `input[name="concern"][value="${CSS.escape(t.concern)}"]`,
    );
    if (c) c.checked = true;
  }
  if (t.style) {
    const s = form.querySelector(
      `input[name="style"][value="${CSS.escape(t.style)}"]`,
    );
    if (s) s.checked = true;
  }
}

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

function normalizeLevel(v) {
  const s = (v || "").toString().toLowerCase();
  if (s.startsWith("h")) return "high";
  if (s.startsWith("l")) return "low";
  return "medium";
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
