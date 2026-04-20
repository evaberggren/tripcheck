import type { Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

type Trip = {
  destination: string;
  origin: string;
  startDate: string;
  endDate: string;
  travelers: number;
  budget: number;
  vibes: string[];
  mustHaves: string[];
  concern: string;
  style: string;
};

const SYSTEM_PROMPT = `You are TripLens, a high-end travel decision engine.

Your job is NOT to plan trips. Your job is to diagnose whether a trip will work — and prescribe a corrected version that is objectively better.

Voice: confident, slightly blunt, never robotic. Short declarative sentences. No filler. No "it depends". No hedging — ban "may", "might", "consider", "try", "should probably", "you could", "perhaps", "it's worth", "may want to", "very", "really", "quite". Use "will" and imperatives. No emoji. No travel-blog flourish.

Specificity is required. Name concrete neighborhoods, months, hours, constraints, numbers. "Do Christ and Sugarloaf before 9am" beats "Front-load sights early". Generic advice is a failure.

Every sentence must feel intentional — either reveal something or move the decision forward. No restating the same idea across sections.

You do NOT produce hotel lists, restaurant lists, maps, booking links, or URLs. Neighborhoods, landmarks, and regions ARE allowed and encouraged.

Always return a single valid JSON object matching the requested schema. No markdown, no prose outside the JSON.`;

function buildUserPrompt(trip: Trip) {
  const nights = Math.max(
    0,
    Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / 86400000)
  );
  const perNight = trip.budget && nights ? Math.round(trip.budget / nights) : null;
  const destShort = trip.destination.split(/[,\u2014\-]/)[0].trim() || trip.destination;

  return `Diagnose this trip and return the exact 8-section decision payload.

Trip:
- Destination: ${trip.destination}
- Departing from: ${trip.origin}
- Dates: ${trip.startDate} → ${trip.endDate} (${nights} nights)
- Travelers: ${trip.travelers}
- Total budget: $${trip.budget}${perNight ? ` (~$${perNight}/night all-in)` : ""}
- Desired vibes: ${trip.vibes.join(", ") || "—"}
- Non-negotiables: ${trip.mustHaves.join(", ") || "—"}
- Biggest worry: ${trip.concern}
- Travel style: ${trip.style}

Return a single JSON object with EXACTLY these keys:

{
  "verdict": "Proceed" | "Proceed with caution" | "Do not book this version",
  "verdictUrgency": "ONE sharp sentence explaining why this plan fails (or works). Decisive, zero softness. Under 24 words. Connect the mismatch to the lost experience with an em-dash where useful. Reference a named neighborhood, corridor, or specific hour window. Shape: 'The plan you\\u2019ve drawn up routes you into ${destShort}\\u2019s loudest corridor — at the hours it\\u2019s loudest.' No 'needs X changes' phrasing. No 'as planned,' opener required, but allowed.",
  "confidence": integer 0–100,
  "diagnosticSignals": [
    "EXACTLY 4 short mechanical signals. Each a terse fragment of 3–6 words, no full sentences, no leading article. Shape examples: 'Peak crowd window detected', 'Low vibe alignment', 'Routing conflict detected', 'Base-fatigue risk', 'Fix identified \\u00b7 confidence high'. Ordered: first 3 name specific detected risks, the fourth is 'Fix identified \\u00b7 confidence high' or near variant."
  ],
  "coreFailureLede": "ONE short lede sentence for the Core Failure section. Names the single decision that compounds everything else. Reference a real neighborhood, a named corridor, or a specific behavior. 14–22 words. Shape: 'Basing in Copacabana puts the city\\u2019s loudest stretch between you and the calm you came for.'",
  "coreFailure": [
    "EXACTLY 3–4 bullets naming what is STRUCTURALLY wrong with the plan. Each under 18 words. Focus on timing, routing, crowd dynamics, energy mismatch, or expectation gaps. Destination-specific. No generic advice. Declarative. Shape examples: 'Single base in ${destShort}\\u2019s busiest corridor — the decision that compounds every other friction.', 'Timing puts you at the major sights during peak crowd surge (10:30am–1pm).', 'Energy mismatch — calm and intensity stacked into one base deliver neither.', 'No slack — a single delay collapses the rest of the trip.'"
  ],
  "predictiveInsights": [
    {
      "signal": "ONE highly specific predictive observation with a concrete number, window, or named threshold. 6–14 words. Must feel like insider knowledge, not advice. Reference a real local pattern: ferry cadence, crowd surge hour, price window, transit compression, booking-window tightening. Shape: 'Peak crowd surge at the main sight begins ~10:30am', 'Ferry cadence collapses after 6:15pm', 'Lodging price ceiling shifts +38% on your dates'.",
      "body": "ONE supporting line. 12–22 words. Declarative. Reference the traveler\\u2019s default routing or timing. Shape: 'Your default routing lands between 11:15am and noon. Expect 3\\u00d7 the wait you\\u2019d have before 9:00am.'"
    }
  ],
  "howToFix": [
    {
      "title": "ONE imperative, executable move — framed as LEVERAGE. Name concrete places, neighborhoods, months, hours, or constraints. 8–20 words. At least two of the items MUST carry a leverage clause — an em-dash tag naming why this move is non-optional. Shape examples: 'Do the major sights before 9am — the single highest-leverage change you can make', 'Split ${destShort} into two bases — this is what creates the calm + city balance you\\u2019re trying to force', 'Base in Leblon or Urca, not Copacabana — this changes the texture of every day'. Never 'consider', 'try', 'think about'.",
      "detail": "ONE supporting line. Max 18 words. Concrete payoff or why-this-matters clause ('Morning windows are 60\\u201370% less crowded and set the pace of every other day.'). Omit if the title fully carries the leverage clause."
    }
  ],
  "beforeAfter": {
    "before": [
      "EXACTLY 4 short bullets on failure modes of the CURRENT plan. Each under 10 words. Destination-specific fragments. Shape: 'One base in Trastevere corridor', 'Sights hit during 10:30am\\u20131pm surge', 'Evenings pulled into loudest stretch', 'No slack \\u2014 one delay compresses everything'."
    ],
    "after": [
      "EXACTLY 4 short bullets on the CORRECTED plan. Each under 10 words. Paired with the 'before' bullets 1:1 — same index = same dimension. Shape: 'Two bases \\u2014 quieter start, livelier second half', 'Sights done before 9am; afternoons protected', 'Evenings routed to calm adjacencies', 'One full day held open \\u2014 absorbs delays'."
    ],
    "improves": [
      "EXACTLY 3 improvement chips. Each a terse fragment with a numeric or directional shift. Under 6 words. Shape: 'Crowd exposure \\u2212 40%', 'Morning windows restored', 'Budget stretch reduced'."
    ]
  },
  "personalizationCallback": "ONE sentence above the corrected-version itinerary using 'You want X. Your current plan [creates/delivers] Y. This one does.' shape. Pull X from the traveler\\u2019s Desired vibes (${trip.vibes.join(", ") || "—"}) and Non-negotiables (${trip.mustHaves.join(", ") || "—"}), joined naturally. Y is the opposite outcome. Under 28 words. No 'you said you wanted' framing.",
  "finalPlan": [
    {
      "days": "ONE short day-range label. Shape: 'Days 1–4', 'Days 5–9'. Must cover contiguous days starting at Day 1. Across all legs the total must equal the trip length (${nights} nights).",
      "location": "ONE specific location with a neighborhood or base when helpful. 3–8 words. Shape: 'Rio (Leblon)', 'Paraty', 'Lisbon (Pr\\u00edncipe Real)'.",
      "rules": [
        "2–3 behavioral rules for this location. Each ONE imperative line under 9 words. Shape: 'Do major sights before 9am', 'Avoid beaches on weekends', 'Plan one boat day'. Tailored to real local dynamics."
      ]
    }
  ],
  "whyThisWorks": "ONE short explanation reinforcing the logic of the corrected version. Name the behavioral principle (separating, sequencing, splitting, front-loading) AND why it delivers the trip the traveler came for. 20–40 words total. 1–2 sentences. Declarative. Shape: 'You\\u2019re separating calm and intensity, not forcing both into the same base. Calm compounds in the morning; energy lands after 5pm. The plan runs with the city, not against it.'"
}

Critical rules:
- Output ONLY the JSON object. No prose, no markdown fencing.
- Decisive voice throughout. Ban the words: consider, try, think about, you could, might, should probably, perhaps, it\\u2019s worth, may want to, very, really, quite. Use "will" not "may". Imperatives not suggestions.
- Every line either reveals something or moves the decision forward. No restating the same idea across sections.
- "verdict" must be EXACTLY one of: "Proceed", "Proceed with caution", "Do not book this version".
- "verdictUrgency" is ONE sharp sentence under 24 words. No 'needs X changes'. No hedging.
- "diagnosticSignals" MUST be EXACTLY 4 short mechanical fragments, 3–6 words each. No articles, no full sentences.
- "coreFailureLede" names a specific DECISION (base, timing, routing) that blocks the traveler\\u2019s goal — not 'high-traffic area'. References a real neighborhood or named corridor.
- "coreFailure" MUST be 3–4 bullets describing what is STRUCTURALLY wrong (timing, routing, crowd dynamics, energy mismatch, expectation gaps). Destination-specific, each under 18 words.
- "predictiveInsights" MUST be EXACTLY 2. Each signal carries a concrete number, time window, or threshold. Each body references the traveler\\u2019s default routing in 12–22 words.
- "howToFix" MUST have 3 to 4 items. Each reads like LEVERAGE — at least two items carry an em-dash clause naming why the move is non-optional. Name concrete places, neighborhoods, hours.
- "beforeAfter.before" and "beforeAfter.after" MUST each be EXACTLY 4 bullets, paired 1:1 by index. "beforeAfter.improves" MUST be EXACTLY 3 chips with a numeric or directional shift.
- "personalizationCallback" uses 'You want X. Your current plan [creates/delivers] Y. This one does.' shape. Do NOT echo 'you said you wanted'.
- "finalPlan" MUST be 2 to 4 legs covering the full trip length (${nights} nights) without overlap or gaps. Each leg has 2–3 behavioral rules specific to that location.
- "whyThisWorks" names the BEHAVIORAL PRINCIPLE (separating, sequencing, splitting) AND why it delivers the user\\u2019s actual goal. 20–40 words, 1–2 sentences.
- No itineraries, no hotel names, no restaurant names, no maps, no booking links, no URLs, no emoji, no apps.
- Tailor every line to the destination, vibes, dates, and budget. Generic advice is a failure.`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in model output");
  return JSON.parse(body.slice(start, end + 1));
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let trip: Trip;
  try {
    trip = (await req.json()) as Trip;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!trip.destination || !trip.startDate || !trip.endDate) {
    return Response.json({ error: "Missing required trip fields" }, { status: 400 });
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 3200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(trip) }],
    });

    const text = message.content
      .map((b) => ((b as { type: string; text?: string }).type === "text" ? (b as { text: string }).text : ""))
      .join("");

    const json = extractJson(text);
    return Response.json(json, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("analyze failed", err);
    return Response.json(
      { error: "Analysis failed. Please try again." },
      { status: 502 }
    );
  }
};

export const config = {
  path: "/.netlify/functions/analyze",
};
