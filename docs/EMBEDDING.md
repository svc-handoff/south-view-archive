# Embed the public archive

The standalone archive is the primary experience. An official South-View website can place its exploration page inside an iframe; this delivery does not change or replace the live website. Contributions, optional email sign-in, private receipts, and staff review open in a full window, outside the iframe, so they do not depend on third-party authentication cookies.

## Deployment and configuration

Deploy `apps/nextjs` as a standard Next.js Node application, using the workspace lockfile and build instructions in the root README. Retain the `.next` server build and generated `public/vendor/maplibre/` files; the application is not a static export. Set `NEXT_PUBLIC_SITE_URL` to the public HTTPS origin **before building**, and `BETTER_AUTH_URL` to that same standalone origin. Person records generate permanent canonical URLs such as `/people/john-lewis`, without iframe or return-state parameters.

Set `NEXT_PUBLIC_MAP_STYLE_URL` if using another MapLibre-compatible style or a self-hosted tile service. Preserve the attribution required by that style and its data providers. `NEXT_PUBLIC_MAP_ATTRIBUTION` can add attribution; it does not remove the provider’s built-in attribution. Database credentials belong only in server environment variables, never in the iframe URL or `NEXT_PUBLIC_*` values.

## Website markup

The current origin is `https://south-view-archive.vercel.app`; use a custom HTTPS origin here if one is configured later. The map fills the iframe viewport, with floating search below the shared 64px navigation bar. People results open on demand; a search or theme deep link opens its results automatically. In `embed=1`, “Open full map” is directly available in the navigation bar (an external-link icon on phones), and archive/contribution links open a separate window. The same logo and responsive menu are used on standalone pages. Cooperative map gestures let visitors scroll the surrounding website.

```html
<section aria-labelledby="south-view-map-heading">
  <h2 id="south-view-map-heading">Explore South-View’s stories</h2>
  <iframe
    src="https://south-view-archive.vercel.app/explore?embed=1"
    title="South-View people, places, and historical records"
    width="100%"
    height="780"
    style="display:block; width:100%; height:80vh; min-height:560px; border:0"
    loading="lazy"
    referrerpolicy="strict-origin-when-cross-origin"
  ></iframe>
  <p>
    <a href="https://south-view-archive.vercel.app/explore" target="_blank" rel="noopener noreferrer"
      >Open the archive in a full window</a
    >
    ·
    <a href="https://south-view-archive.vercel.app/contribute" target="_blank" rel="noopener noreferrer"
      >Share a memory or source</a
    >
  </p>
</section>
```

Public exploration needs no camera, microphone, location, or account permission. This version does not record or upload audio. Keep full-window and contribution links outside the iframe so they remain available when embedded content is blocked. An optional iframe `sandbox` must permit the tested script, provider-request, and new-window behavior; contribution links need to open the standalone site. Do not disable authentication origin checks to make embedded login work. The archive does not depend on parent-window messaging.

## Allowed parent websites

The archive’s `Content-Security-Policy: frame-ancestors` controls which websites may embed it. Keep the list to `'self'` and the official South-View origins configured in `apps/nextjs/next.config.ts`. The current official site’s observed wrapper is `https://18fc460d-2b61-480a-be02-baae6cf5798d.filesusr.com`; this exact origin is allowed. Recheck the published frame chain if the official website is rebuilt. An iframe provider such as a website-builder wrapper may introduce another ancestor; inspect the real published frame chain before adding **that exact origin**. Do not add a wildcard provider domain to work around an unknown parent.

If the official website sets its own Content Security Policy, its `frame-src` must allow the deployed archive origin. Do not set `X-Frame-Options: SAMEORIGIN` at a reverse proxy, since it would conflict with the authorized cross-origin embed. These headers need to be checked again on the deployed response; a hosting platform can override application headers.

## Links and return behavior

- `/explore` is the standalone map; `/explore?embed=1` is the embedded view.
- `/people/[id]` is a permanent, directly renderable person record. Source citations point to numbered source entries on that page, and original collection links open in a new tab.
- Exploration links carry the current scope, search, theme, selected person, map center, and zoom. Opening a person record carries the internal exploration path in `from` so “Back to the map” restores the view.
- Atlanta scope includes both city and cemetery places; the cemetery outline remains visible. User zooming out to level 14 or below widens the scope without recentering. Zooming to level 15 or above near the cemetery returns to cemetery scope. The separate thresholds prevent flicker; initial fitting, explicit area controls, resize, and restored URLs retain their chosen scope. The single South-View location button returns to the cemetery.
- The `from` value accepts only an internal `/explore` path. An external or malformed return target falls back to that person’s map selection.
- Share the standalone exploration or canonical person URL. Remove `embed=1` and `from` from public person links.
- Embedded `/contribute` links, including the selected-person action, use `target="_blank"`. Sign-in (`/sign-in`), the contributor's account (`/my-contributions`), and staff review (`/admin/contributions`) belong in the standalone site. Ordinary sign-in does not grant reviewer permission.
- `/submissions/[id]#receipt=…` is private. Never paste it into the official page, iframe configuration, or public share links. Claiming a guest contribution requires both its receipt and an account with the matching verified contact email.
- Share `/contributions/[id]` after publication for public content, citations, and contributor credit. Contacts, original files, unapproved photos, and internal review notes stay private.

## Embed acceptance check

1. Open the published official website at desktop and phone widths, then at 200% browser zoom. Ensure the iframe has usable height and can scroll without covering the outer page’s navigation.
2. Navigate with a keyboard: search, theme filters, person results, a record, sources, and the standalone link. A visitor must be able to browse without using the map.
3. Select a person, switch between cemetery and Atlanta, open the permanent record, and return. Confirm preserved selection, filter, and map state.
4. Block the tile host or disable WebGL. Check that the list and person pages remain usable, with a clear map error state.
5. Confirm the official parent can frame the archive and an unrelated origin cannot. Check canonical URLs and shared links use the deployment origin and standalone routes.
6. Open both the general and person-specific contribution links from the iframe. Confirm they open a separate window, preserve the selected person where relevant, and perform optional email login outside the iframe. Development codes are read only from the private filesystem outbox; validate real SMTP separately on deployment.

Local rendering does not verify production headers, the live website builder's iframe chain, real email delivery, or physical wayfinding accuracy. See [community data and review](COMMUNITY-DATA.md) and [authentication, mail, and private photographs](COMMUNITY-SERVICES.md) for operational configuration.
