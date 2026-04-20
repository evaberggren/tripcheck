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

const SYSTEM_PROMPT = `You are TripLens, a decision engine (not a planner) that delivers authoritative verdicts on trips before a traveler books.

You are NOT a planner, travel agent, or booking platform. You do not produce itineraries, hotel lists, restaurant lists, maps, or booking links. You diagnose trips and prescribe a short set of specific, executable adjustments — not plans.

Voice: a trusted expert, not a helpful assistant. Decisive. Authoritative. Lightly opinionated. Short declarative sentences. No hedging — no "may", "might", "consider", "try", "should probably", "you could". Use "will" and imperatives. Say "Base in Leblon", not "Consider basing in Leblon". Say "This will not deliver the calm you want", not "This may not deliver the calm you want". No hype, no emoji, no sales speak, no travel-blog flourish.

Specificity is required. Name concrete places, neighborhoods, months, hours, and constraints. "Do Christ and Sugarloaf before 9am" beats "Front-load sights early". "Replace nightlife with hikes (Pedra Bonita, Dois Irmãos)" beats "Treat adventure as hikes, not nightlife". Generic advice is a failure.

Every sentence must add value. No filler, no wind-up, no explanation of the obvious. The user should finish reading and already know what to do differently.

Always return a single valid JSON object matching the requested schema. No markdown, no prose outside the JSON.`;

function buildUserPrompt(trip: Trip) {
  const nights = Math.max(
    0,
    Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / 86400000)
  );
  const perNight = trip.budget && nights ? Math.round(trip.budget / nights) : null;

  return `Assess this trip and produce a TripLens diagnosis + prescription + final plan.

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
  "verdict": "Proceed" | "Proceed with caution" | "Rethink this trip",
  "verdictPosition": "ONE definitive sentence stating your book/don't-book position. Use EXACTLY one of these three shapes, chosen to match the verdict: for 'Proceed' use 'We would book this trip.'; for 'Proceed with caution' use 'We would book this — with the changes below.'; for 'Rethink this trip' use 'We would not book this trip as planned.' No hedging. No variations.",
  "verdictOutcome": "ONE short declarative outcome sentence naming what this trip will FEEL like as planned. 10–14 words. Begin with 'As planned,' and use 'will' not 'may'. Name the emotional consequence, not the tension. Example shape: 'As planned, this trip will feel crowded instead of calm.'",
  "confidence": integer 0–100,
  "biggestRisk": "ONE short punchy sentence stating what will happen, not what might. Max 12 words. Use 'will', not 'could'. Example shape: 'This will feel busier and louder than you want.'",
  "why": [
    "EXACTLY 3–4 short bullets. Each is ONE LINE — a scannable sentence fragment under 12 words. Specific to this destination, dates, preferences. Declarative, no hedging. Examples of shape: 'Your dates sit inside peak European holiday traffic', 'This destination concentrates crowds into two streets', 'Your vibes lean calm; this city runs loud until 2am'."
  ],
  "risks": {
    "crowdRisk": "Low" | "Medium" | "High",
    "weatherRisk": "Low" | "Medium" | "High",
    "budgetStretch": "Low" | "Medium" | "High",
    "vibeMismatch": "Low" | "Medium" | "High",
    "logisticsFriction": "Low" | "Medium" | "High"
  },
  "howToFix": [
    {
      "title": "ONE specific, executable instruction in imperative voice. Name concrete places, neighborhoods, months, hours, or constraints. 6–12 words. Shape examples: 'Base in Leblon or Urca, not Copacabana', 'Do Christ and Sugarloaf before 9am', 'Shift dates to late May or early June', 'Replace nightlife with hikes (Pedra Bonita, Dois Irmãos)', 'Cut Rio to 5 nights; add Paraty'. Never vague. No 'consider', 'try', 'think about'.",
      "detail": "ONE tight supporting line. Max 16 words. Explains the why or names the concrete payoff. Omit the field entirely if the title stands alone."
    }
  ],
  "betterVersion": [
    {
      "name": "A refined evolution of THIS trip — not a random pivot. Name specific places. Shape examples: 'Cinque Terre (3 nights) + Portofino', 'Mallorca instead — quieter coast, same length'. Under 12 words.",
      "pitch": "ONE declarative sentence on what this version delivers. Under 18 words. No 'may', no 'might'."
    }
  ],
  "betterVersionOutro": "ONE closing sentence beneath the alternatives. Starts with 'This version delivers your goal:' and names the traveler's actual vibes in their own words (drawn from Desired vibes). Under 18 words.",
  "finalPlan": [
    {
      "days": "ONE short day-range label for this leg. Shape: 'Days 1–4', 'Days 5–9'. Must cover contiguous days starting at Day 1. Across all legs the total must equal the trip length (${nights} nights).",
      "location": "ONE specific location with a neighborhood or base when helpful. 3–8 words. Shape examples: 'Rio (Leblon)', 'Paraty', 'Lisbon (Príncipe Real)'.",
      "rules": [
        "2–3 behavioral rules for this location. Each is ONE imperative line under 9 words. Shape examples: 'Do major sights before 9am', 'Avoid beaches on weekends', 'Stay in historic center', 'Plan one boat day'. No generic filler. Tailored to this location's real dynamics."
      ]
    }
  ],
  "styleNote": "EXACTLY two short lines, separated by a single newline. Line 1 names the tension between the traveler's style (${trip.style}) and this specific trip — shape: 'You're a ${trip.style}—but this trip rewards planning.' Line 2 states the concrete consequence declaratively — shape: 'Wing it and you'll miss the quiet coves and overpay for the busy ones.' No third line. Each line under 18 words."
}

Critical rules:
- Output ONLY the JSON object. No prose, no markdown fencing.
- Decisive voice throughout. Use "will" not "may", imperatives not suggestions. Ban the words: consider, try, think about, you could, might, should probably, perhaps, it's worth, may want to.
- Every line must be scannable in under two seconds. Cut filler, adjectives, wind-up.
- "verdictPosition" is a definitive book/don't-book statement. Use one of the three exact shapes above — match the verdict.
- "verdictOutcome" must begin with "As planned," and name the FEELING of the trip as planned.
- "biggestRisk" must name what will happen, not what could.
- "why" MUST be 3–4 bullets. Each is a single line.
- "howToFix" MUST have 3 to 5 items. Each step is specific and executable: name concrete places, neighborhoods, months, hours, or numbers. Include "detail" only when it adds something the title cannot carry alone.
- "betterVersion" MUST have 1 to 2 items. Tight and curated.
- "finalPlan" MUST be 2 to 4 legs. Together the day ranges must cover the full trip length (${nights} nights) without overlap or gaps, starting at Day 1. Each leg has 2–3 behavioral rules specific to that location — not generic "book early" filler. Reflect the prescribed upgrades (better neighborhoods, splits, timing) rather than the user's original plan.
- "styleNote" must be exactly two lines.
- Risks are five fields even though the UI surfaces four; always return all five.
- No itineraries. No hotel names. No restaurant names. No maps. No booking links. No URLs. No emoji. No apps or tools. (Neighborhoods, landmarks, and regions ARE allowed and encouraged for specificity.)
- Tailor every line to the destination, vibes, dates, and budget given. Generic advice is a failure.`;
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
      max_tokens: 3600,
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
