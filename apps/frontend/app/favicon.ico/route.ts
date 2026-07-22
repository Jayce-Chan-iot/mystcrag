const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#49355f"/><circle cx="32" cy="32" r="19" fill="none" stroke="#f7f4ee" stroke-width="5" stroke-dasharray="7 3"/><circle cx="32" cy="13" r="5" fill="#b9a2c9"/></svg>`;

export function GET() {
  return new Response(favicon, {
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": "image/svg+xml"
    }
  });
}
