// ============================================================
// Resolve the public base URL a server route should publish links
// under (invite links, lead-source webhook URLs, …).
//
// Resolution order, first match wins:
//
//   1. `NEXT_PUBLIC_SITE_URL` — operator's explicit config. Trumps
//      everything; set this in production.
//   2. `X-Forwarded-Host`/`X-Forwarded-Proto` — what a reverse proxy
//      (Render, a load balancer) says the client actually hit.
//   3. The bare `Host` header + the request's own protocol.
//   4. `https://wacrm.tech` (the marketing site) with a console.warn
//      — better than crashing, but almost certainly wrong for a fork;
//      forks should set `NEXT_PUBLIC_SITE_URL`.
//
// Host headers are attacker-controlled on any deployment exposed to
// the public internet: a bare `Host`/`X-Forwarded-Host` trust would
// let someone POST with `Host: phishing.example` and get back a link
// pointing at their site. `ALLOWED_INVITE_HOSTS` (comma-separated
// hostnames) gates steps 2-3 against that — set it in production;
// unset, behavior stays permissive (today's default, not a security
// regression for forks that never configured it).
//
// Extracted from the invite-link route (`/api/account/invitations`,
// the first caller) so the lead-source webhook URL builder doesn't
// reimplement the same ~40 lines.
// ============================================================

function parseAllowedHosts(): readonly string[] | null {
  const raw = process.env.ALLOWED_INVITE_HOSTS?.trim();
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

function isHostAllowed(hostname: string, allowList: readonly string[] | null): boolean {
  if (!allowList) return true; // No allow-list → permissive (legacy behavior).
  return allowList.includes(hostname.toLowerCase());
}

export function getPublicBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const allowList = parseAllowedHosts();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedHost && isHostAllowed(forwardedHost, allowList)) {
    return `${forwardedProto || 'https'}://${forwardedHost}`;
  }

  const host = request.headers.get('host')?.trim();
  if (host && isHostAllowed(host, allowList)) {
    // The protocol on `request.url` is whatever the framework saw —
    // reliable for bare deployments where no proxy is rewriting it.
    const reqProto = new URL(request.url).protocol.replace(':', '');
    return `${reqProto}://${host}`;
  }

  if (allowList && (forwardedHost || host)) {
    console.warn('[getPublicBaseUrl] rejected non-allow-listed host:', { forwardedHost, host, allowList });
  } else {
    console.warn('[getPublicBaseUrl] could not derive base URL from request; falling back to marketing domain');
  }
  return 'https://wacrm.tech';
}
