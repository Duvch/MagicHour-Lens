// ─── MagicHour Lens – Cloudflare Worker Proxy ───
// Proxies requests to MagicHour API with a shared key.
// Tracks daily usage per install ID via KV.

const MH_API = "https://api.magichour.ai/v1";

// Endpoints that cost a credit (project creation only)
const CREDIT_ENDPOINTS = [
  "/face-swap-photo",
  "/ai-image-editor",
  "/image-background-remover",
  "/ai-image-upscaler",
  "/ai-clothes-changer",
];

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  // Allow Chrome extension origins and localhost for dev
  const allowed =
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("http://localhost");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-MH-Install-Id",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request, env),
    },
  });
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ─── Credits check endpoint ───
    if (path === "/api/credits" && request.method === "GET") {
      return handleCreditsCheck(request, env);
    }

    // ─── Proxy to MagicHour API ───
    if (path.startsWith("/v1/")) {
      return handleProxy(request, env, path.slice(3)); // strip /v1 prefix → /endpoint
    }

    return jsonResponse({ error: "Not found" }, 404, request, env);
  },
};

async function handleCreditsCheck(request, env) {
  const installId = request.headers.get("X-MH-Install-Id");
  if (!installId || installId.length < 8) {
    return jsonResponse({ error: "Missing or invalid install ID" }, 400, request, env);
  }

  const limit = parseInt(env.DAILY_LIMIT) || 10;
  const used = await getUsedCredits(env, installId);
  const remaining = Math.max(0, limit - used);

  return jsonResponse({ remaining, limit, used }, 200, request, env);
}

async function handleProxy(request, env, endpoint) {
  const installId = request.headers.get("X-MH-Install-Id");
  if (!installId || installId.length < 8) {
    return jsonResponse({ error: "Missing or invalid install ID" }, 400, request, env);
  }

  const isCreditEndpoint = CREDIT_ENDPOINTS.some((ep) => endpoint === ep);

  // Check daily limit before project creation
  if (isCreditEndpoint) {
    const limit = parseInt(env.DAILY_LIMIT) || 10;
    const used = await getUsedCredits(env, installId);
    if (used >= limit) {
      return jsonResponse(
        {
          error: "Daily free limit reached",
          message: `You've used all ${limit} free transforms for today. Add your own API key in settings for unlimited use, or try again tomorrow.`,
          remaining: 0,
          limit,
        },
        429,
        request,
        env
      );
    }
  }

  // Forward request to MagicHour API
  const mhUrl = MH_API + endpoint;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${env.MH_API_KEY}`);
  headers.delete("X-MH-Install-Id");

  const mhResponse = await fetch(mhUrl, {
    method: request.method,
    headers,
    body: request.method !== "GET" ? request.body : undefined,
  });

  // Deduct credit only on successful project creation
  if (isCreditEndpoint && mhResponse.ok) {
    await deductCredit(env, installId);
  }

  // Return MagicHour response with CORS headers
  const responseHeaders = new Headers(mhResponse.headers);
  const cors = corsHeaders(request, env);
  for (const [k, v] of Object.entries(cors)) {
    responseHeaders.set(k, v);
  }

  return new Response(mhResponse.body, {
    status: mhResponse.status,
    headers: responseHeaders,
  });
}

// ─── KV Helpers ───

function kvKey(installId) {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  return `credits:${installId}:${date}`;
}

async function getUsedCredits(env, installId) {
  const val = await env.CREDITS.get(kvKey(installId));
  return val ? parseInt(val, 10) : 0;
}

async function deductCredit(env, installId) {
  const key = kvKey(installId);
  const current = await getUsedCredits(env, installId);
  // TTL of 48h so old keys auto-expire
  await env.CREDITS.put(key, String(current + 1), { expirationTtl: 172800 });
}
