# In-App Guidance Signals

## When to use
Apply when triaging feedback where users are confused by UI flow — session replays showing repeated clicks on non-interactive elements, support tickets about "where do I find X", or WisePops survey responses citing navigation confusion.

## Patterns

### Replay confusion mapped to component
DataDog or Clarity session replay identifies a confused element by page URL and DOM selector. Map the URL to a tastic in `frontend/frontastic/tastics/` to find which component renders there, then locate it under `frontend/components/frontastic-ui/<feature>/`.

### Tooltip or empty-state gap as quick win
If replay shows a user stalling on an empty cart or zero-results page with no next-step affordance, classify as a quick-win empty-state addition. Triage to the specific frontastic-ui component — no backend or CT change required.

### Navigation confusion to header component
"Can't find account/orders" feedback traces to `frontend/components/frontastic-ui/KwhHeader/`. Check mobile nav state — collapsed menu items are a common source of confusion invisible in desktop replays.

## Pitfalls
WisePops survey responses are qualitative and can be misleading without quantitative corroboration. Do not schedule a full UX redesign based solely on open-text survey data; first confirm the friction point appears in replay or DataDog click-heatmap data.