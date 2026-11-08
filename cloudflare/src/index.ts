export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url),
      path = url.pathname;
    let response: Response;
    if (
      path.startsWith("/api/") ||
      path === "/health/" ||
      path === "/auth/google/start/" ||
      path === "/auth/google/callback/"
    ) {
      let backend: URL;
      try {
        backend = new URL(env.FYDE_API_URL);
        const local = ["localhost", "127.0.0.1"].includes(url.hostname);
        if (
          (backend.protocol !== "https:" && !local) ||
          backend.username ||
          backend.password ||
          backend.pathname !== "/" ||
          backend.search ||
          backend.hash ||
          backend.hostname === "example.invalid" ||
          !env.FYDE_EDGE_KEY
        )
          throw new Error();
      } catch {
        return Response.json(
          {
            error: "unavailable",
            message: "Fyde is waiting for its backend deployment.",
          },
          { status: 503 },
        );
      }
      backend.pathname = path;
      backend.search = url.search;
      const headers = new Headers();
      for (const key of ["authorization", "content-type", "origin", "accept"]) {
        const value = request.headers.get(key);
        if (value) headers.set(key, value);
      }
      const cookie = (request.headers.get("cookie") || "")
        .split(";")
        .map((p) => p.trim())
        .filter(
          (p) => p.startsWith("fyde_session=") || p.startsWith("fyde_oauth="),
        )
        .join("; ");
      if (cookie) headers.set("Cookie", cookie);
      headers.set("X-Fyde-Edge-Key", env.FYDE_EDGE_KEY);
      headers.set(
        "X-Fyde-Client-IP",
        request.headers.get("CF-Connecting-IP") || "unknown",
      );
      try {
        response = await fetch(
          new Request(backend, {
            method: request.method,
            headers,
            body: ["GET", "HEAD"].includes(request.method)
              ? undefined
              : request.body,
            redirect: "manual",
          }),
        );
      } catch {
        response = Response.json(
          {
            error: "unavailable",
            message: "Fyde is temporarily unavailable. Please retry.",
          },
          { status: 503 },
        );
      }
    } else response = await env.ASSETS.fetch(request);
    const result = new Response(response.body, response);
    result.headers.set("X-Content-Type-Options", "nosniff");
    result.headers.set("Referrer-Policy", "no-referrer");
    result.headers.set("X-Frame-Options", "DENY");
    result.headers.set(
      "Cross-Origin-Opener-Policy",
      "same-origin-allow-popups",
    );
    result.headers.set("X-Robots-Tag", "noindex, nofollow");
    result.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    if (url.protocol === "https:")
      result.headers.set("Strict-Transport-Security", "max-age=31536000");
    return result;
  },
} satisfies ExportedHandler<Env>;
