// ===== Simple in-memory daily rate limit =====
const DAILY_LIMIT = 5;
const usage = new Map();

function getClientId(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
}

function isNewDay(lastTimestamp) {
  const last = new Date(lastTimestamp).toDateString();
  const now = new Date().toDateString();
  return last !== now;
}

// ===== OpenAI (newer SDK style) =====
import OpenAI from "openai";

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ===== Daily cap (per request / per click) =====
  const clientId = getClientId(req);
  const now = Date.now();
  const record = usage.get(clientId);

  if (!record || isNewDay(record.lastUsed)) {
    usage.set(clientId, { count: 1, lastUsed: now });
  } else {
    if (record.count >= DAILY_LIMIT) {
      return res.status(429).json({
        error: "Daily free limit reached. Upgrade to continue."
      });
    }
    record.count += 1;
    record.lastUsed = now;
  }

  // API key from Vercel environment variables
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY not configured" });
  }

  const openai = new OpenAI({ apiKey });

  const { kind, payload } = req.body || {};
  if (!kind || !payload) {
    return res.status(400).json({ error: "Missing kind or payload" });
  }

  try {
    let systemPrompt = "";
    let userPrompt = "";

    if (kind === "replies") {
      const {
        tweet_text,
        tone,
        angle,
        length,
        num_replies,
        extra_instructions
      } = payload;

      const n = Number(num_replies || 3);

      systemPrompt = `You are DebateGPT, an expert at crafting high-engagement, clever Twitter/X replies.
Generate exactly ${n} different reply options.

Tone: ${tone}
Angle: ${angle}
Length: ${length === "thread" ? "a short thread (2-4 tweets)" : length}

STARTER RULE (mandatory):
For the batch of replies, each reply must use a different starter style from this list, in order:
1) A direct claim (no filler)
2) A question
3) A reframe ("Instead of X, consider Y")
4) A short analogy/metaphor
5) A 2-bullet breakdown
(If fewer than 5 replies are requested, use the first N starter styles.)

DIVERSITY RULES (mandatory):
- Every reply must start differently (no repeated first 3 words).
- Do NOT reuse the same opener phrasing across replies.
- Do NOT start with: "Hot take", "Fair point", "I agree", "I disagree", "Let’s be real", "Here’s the nuance".
- Each reply must use a different rhetorical move: reframe, counterexample, concession, implication, call-to-action.
- Keep each reply under 260 characters unless length=thread.

${extra_instructions ? "Additional instructions: " + extra_instructions : ""}

Return ONLY valid JSON in this exact shape:
[{ "content": "reply text" }, ...]
No extra keys. No markdown. No explanations.`;

      userPrompt = `Write ${n} reply options to this tweet:\n\n"${tweet_text}"`;
    }

    else if (kind === "hooks") {
      const { topic, tone, num_hooks, extra_instructions } = payload;
      const n = Number(num_hooks || 3);

      systemPrompt = `You are a master hook writer for X/Twitter.
Generate exactly ${n} different opening hooks (first tweet of a thread).

Tone: ${tone}
Topic/context: ${topic}

Rules:
- Under 240 characters
- Each hook must start differently
- Curiosity-driven, concrete, no generic filler

${extra_instructions ? "Extra: " + extra_instructions : ""}

Return ONLY valid JSON in this exact shape:
[{ "content": "hook text" }, ...]
No markdown. No explanations.`;

      userPrompt = `Generate ${n} hooks about: ${topic}`;
    }

    else {
      return res.status(400).json({ error: "Invalid kind" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.9,
      max_tokens: payload?.length === "thread" ? 1200 : 800
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "[]";

    // Parse JSON safely
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("Invalid JSON response");
      parsed = JSON.parse(match[0]);
    }

    if (kind === "replies") {
      const replies = Array.isArray(parsed)
        ? parsed.map(r => (typeof r === "string" ? { content: r } : r))
        : [];
      return res.status(200).json({ replies });
    }

    if (kind === "hooks") {
      const hooks = Array.isArray(parsed)
        ? parsed.map(h => (typeof h === "string" ? { content: h } : h))
        : [];
      return res.status(200).json({ hooks });
    }

  } catch (error) {
    console.error("OpenAI Error:", error);
    return res.status(500).json({ error: error.message || "Failed to generate" });
  }
}