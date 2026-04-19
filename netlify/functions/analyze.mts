import type { Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

interface TripInput {
  destination?: string;
  origin?: string;
  startDate?: string;
  endDate?: string;
  travelers?: number;
  budget?: number;
  vibes?: string[];
  mustHaves?: string[];
  concern?: string;
  style?: string;
}

const SYSTEM_PROMPT = `You are TripLens, an honest travel decision analyst.

You are NOT an itinerary builder or a cheerleader. Your job is to tell the traveler
whether this specific trip, on these specific dates, with these specific preferences,
is likely to deliver the feeling they're buying it for — or quietly disappoint.

Be direct, specific, and editorial. No marketing language, no hedging, no emoji.
Reference concrete reasons (seasonality, crowd patterns, destination character,
distance from origin, budget realism) rather than vague generalities.

You must respond with a single JSON object and nothing else. No preamble, no code
fences, no trailing commentary. The JSON must conform to this shape exactly:

{
  "verdict": "Proceed" | "Proceed with caution" | "Rethink this trip",
  "confidence": number (0-100),
  "biggestRisk": string (one sentence, ≤ 180 chars, the single most important risk),
  "why": string[] (3-5 short bullet lines, each ≤ 110 chars),
  "risks": {
    "crowdRisk": "Low" | "Medium" | "High",
    "weatherRisk": "Low" | "Medium" | "High",
    "budgetStretch": "Low" | "Medium" | "High",
    "vibeMismatch": "Low" | "Medium" | "High",
    "logisticsFriction": "Low" | "Medium" | "High"
  },
  "smarterMoves": [
    { "title": string, "detail": string }, ...
  ] (2-4 items; title ≤ 70 chars, detail ≤ 150 chars),
  "alternatives": [
    { "name": string, "why": string, "tradeoff": string }, ...
  ] (exactly 3; name = destination + country; why ≤ 140 chars; tradeoff ≤ 110 chars),
  "styleNote": string (1-2 sentences framed by the traveler's style: wanderer, planner, balanced)
}

Rules:
- Calibrate confidence honestly. If signals are weak or mixed, drop below 70.
- If the destination + preferences align well, say "Proceed" and recommend light tweaks.
- If there's a clear mismatch, say "Rethink this trip" and explain why directly.
- Never invent safety warnings; focus on experience quality.
- Alternatives must be genuinely different (e.g., different country/region), not
  near-duplicates of the requested destination.`;

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let trip: TripInput;
  try {
    trip = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userMessage = buildUserMessage(trip);

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1800,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const parsed = extractJson(text);
    if (!parsed) {
      console.error("Could not parse model response:", text.slice(0, 500));
      return Response.json(fallback(trip), { status: 200 });
    }

    return Response.json(parsed, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Anthropic call failed:", err);
    return Response.json(fallback(trip), { status: 200 });
  }
};

export const config = {
  path: "/.netlify/functions/analyze",
};

function buildUserMessage(t: TripInput): string {
  const nights =
    t.startDate && t.endDate
      ? Math.max(
          0,
          Math.round(
            (Date.parse(t.endDate) - Date.parse(t.startDate)) / 86400000,
          ),
        )
      : null;

  const lines = [
    "Please analyze this trip and return only the JSON object.",
    "",
    `Destination: ${t.destination ?? "—"}`,
    `Departing from: ${t.origin ?? "—"}`,
    `Dates: ${t.startDate ?? "—"} → ${t.endDate ?? "—"}${nights !== null ? ` (${nights} nights)` : ""}`,
    `Travelers: ${t.travelers ?? 1}`,
    `Total budget (USD): ${t.budget ?? "—"}`,
    `Vibes sought: ${(t.vibes ?? []).join(", ") || "—"}`,
    `Non-negotiables: ${(t.mustHaves ?? []).join(", ") || "—"}`,
    `Biggest concern: ${t.concern ?? "—"}`,
    `Travel style: ${t.style ?? "—"}`,
  ];
  return lines.join("\n");
}

function extractJson(text: string): unknown | null {
  // Try whole string first
  try {
    return JSON.parse(text);
  } catch {
    // ignore
  }
  // Pull the first {...} block if the model wrapped it in prose or code fences.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function fallback(t: TripInput) {
  const dest = t.destination || "this destination";
  return {
    verdict: "Proceed with caution",
    confidence: 58,
    biggestRisk: `We couldn't run a full read on ${dest} — treat this as a rough second opinion, not a final call.`,
    why: [
      "Our model is momentarily unavailable; results below are heuristic.",
      `Your vibe (${(t.vibes ?? []).join(", ") || "unspecified"}) should drive timing more than price.`,
      "Shoulder-season dates usually reduce crowd and cost risk materially.",
    ],
    risks: {
      crowdRisk: "Medium",
      weatherRisk: "Medium",
      budgetStretch: "Medium",
      vibeMismatch: "Medium",
      logisticsFriction: "Low",
    },
    smarterMoves: [
      {
        title: "Try again in a moment",
        detail:
          "The model hit a transient error. Re-running usually returns a full diagnosis.",
      },
      {
        title: "Shift dates by 2–3 weeks",
        detail:
          "Most destinations see a sharp drop in crowds and rates just outside peak windows.",
      },
    ],
    alternatives: [
      {
        name: "Porto, Portugal",
        why: "Mediterranean feel with fewer tourists and lower prices than the big names.",
        tradeoff: "Fewer direct flights from North America.",
      },
      {
        name: "Oaxaca, Mexico",
        why: "Deep food culture, walkable core, and a calm pace most weeks of the year.",
        tradeoff: "Limited beach access without a side trip.",
      },
      {
        name: "Kyoto, Japan (late autumn)",
        why: "Aesthetic payoff with manageable crowds if you avoid peak foliage weekends.",
        tradeoff: "Long-haul flight and a higher daily spend.",
      },
    ],
    styleNote:
      "Whatever your style, build in one fully unscheduled day. It's the single highest-return planning move we know.",
  };
}
