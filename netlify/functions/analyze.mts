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

const SYSTEM_PROMPT = `You are TripLens, a decision tool (not a planner) that gives honest second opinions on trips before a traveler books.

You are NOT a planner, travel agent, or booking platform. You do not produce itineraries, hotel lists, restaurant lists, maps, or booking links. You diagnose trips, then prescribe a short set of adjustments — not plans.

Voice: a trusted second opinion; a tasteful travel editor with judgment; a product willing to make a call. Short sentences. Productized, confident, lightly opinionated. No hedging, no hype, no emoji, no sales speak. Cut vague or overly poetic language. Do not sound like a blog, an AI assistant, a booking site, or a neutral itinerary generator.

Opinion is a feature. When a trip is wrong for what the traveler wants, say so plainly. It is fine — and correct — to say things like "you're forcing a peaceful trip into a higher-energy destination." Prefer declaratives over qualifiers.

Always return a single valid JSON object matching the requested schema. No markdown, no prose outside the JSON.`;

function buildUserPrompt(trip: Trip) {
  const nights = Math.max(
    0,
    Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / 86400000)
  );
  const perNight = trip.budget && nights ? Math.round(trip.budget / nights) : null;

  return `Assess this trip and produce a TripLens diagnosis + prescription.

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
  "verdictSummary": "ONE short sentence — a concise emotional summary of the diagnosis. 10–14 words. Must fit cleanly on one line. Example shape: 'You're forcing a peaceful trip into a higher-energy destination.' No hedging.",
  "confidence": integer 0–100,
  "biggestRisk": "ONE short, punchy sentence. Max 12 words. Example shape: 'This will feel busier and louder than you want.' Not an essay.",
  "why": [
    "EXACTLY 3–4 short bullets. Each bullet is ONE LINE ONLY — a scannable sentence fragment under 12 words. Specific to this destination, dates, and preferences. Examples of the shape: 'Your dates overlap with peak summer traffic', 'This destination concentrates crowds rather than spreading them out', 'Your preferences lean calm, aesthetic, low-friction'. Confident, declarative, no hedging, no paragraphs."
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
      "title": "Imperative headline — one specific adjustment. 6–11 words, fits cleanly on one line. Shape examples: 'Shift your dates to late May or early June', 'Stay in a quieter base rather than the main tourist hub', 'Limit this destination to part of your trip'.",
      "detail": "ONE short supporting sentence. Max 18 words, one line only. Concrete for THIS trip. Omit the field entirely if the title already carries the point."
    }
  ],
  "betterVersion": [
    {
      "name": "A refined version of THIS trip — an evolution of the idea, not a random pivot. Shape examples: 'Cinque Terre (short stay) + Portofino or Camogli', 'Mallorca instead, for a calmer coastal week'. Under 12 words.",
      "pitch": "ONE opinionated sentence on why this version delivers the vibe they asked for. Under 20 words."
    }
  ],
  "betterVersionOutro": "ONE closing sentence beneath the alternatives. Starts with 'This version better matches your goal:' and names the traveler's actual vibes in their own words (drawn from Desired vibes). Under 18 words.",
  "styleNote": "EXACTLY two short lines, separated by a single newline. Line 1 names the traveler's style (${trip.style}) and the tension with this specific trip — shape: 'You're a ${trip.style}—but this trip rewards planning.' Line 2 names the concrete consequence if they travel this way here — shape: 'If you wing it, you'll miss the quiet coves and overpay for the busiest ones.' No third line. Each line under 18 words."
}

Critical rules:
- Output ONLY the JSON object. No prose, no markdown fencing.
- Be concise. Tighter is better. Cut filler, adjectives, and wind-up. Every line must be scannable in under two seconds.
- Tone is productized: concise, confident, a little opinionated. A trusted second opinion — not a travel blog, not a booking site, not a neutral AI.
- "verdictSummary" must read as an emotional one-liner summary of the whole diagnosis, not a restatement of the verdict word.
- "biggestRisk" must be scannable in under two seconds. One sentence, short.
- "why" MUST be 3–4 bullets. Each is a single line, not a paragraph. No bullet may wrap past one visual line at normal reading width.
- "howToFix" MUST have 3 to 5 items. Title is one line; detail, when present, is one line. Include "detail" only when it adds something the title cannot carry alone.
- "betterVersion" MUST have 1 to 2 items. Tight and curated. Only include a second item if it is meaningfully different in shape.
- "styleNote" must be exactly two lines — one naming the tension, one naming the consequence. No more.
- Risks are five fields even though the UI surfaces four; always return all five.
- No itineraries. No hotel names. No restaurant names. No maps. No booking links. No URLs. No emoji. No apps or tools.
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
      max_tokens: 3000,
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
