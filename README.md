# @striderlabs/mcp-united

United Airlines MCP server — let AI agents search flights, manage bookings, check in, and track MileagePlus miles via browser automation.

Built by [Strider Labs](https://striderlabs.ai).

## Features

- **Flight Search** — Search flights by origin, destination, dates, and passenger count
- **Flight Details** — Get detailed info on any United flight including status and aircraft
- **Smart Filtering** — Filter results by stops, price, cabin class, and times
- **Seat Selection** — Select specific seats for your flights
- **Bag Management** — Add checked baggage with fee estimates
- **Booking** — Complete flight purchases with explicit confirmation required
- **Reservation Management** — View upcoming trips linked to your MileagePlus account
- **Online Check-In** — Check in and retrieve boarding passes
- **MileagePlus Balance** — View miles, elite status, and recent activity
- **Session Persistence** — Cookies automatically saved to `~/.strider/united/`

## Installation

```bash
npm install -g @striderlabs/mcp-united
npx playwright install chromium
```

## Usage with Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "united": {
      "command": "npx",
      "args": ["@striderlabs/mcp-united"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `united_status` | Check MileagePlus login status |
| `united_login` | Initiate login flow |
| `united_logout` | Clear session and cookies |
| `united_search_flights` | Search flights (origin, dest, dates, passengers) |
| `united_get_flight` | Get detailed flight info |
| `united_filter_flights` | Filter by stops/price/times/cabin |
| `united_select_flight` | Select outbound or return flight |
| `united_select_seats` | Choose seat assignments |
| `united_add_bags` | Add checked baggage |
| `united_view_cart` | Review booking summary |
| `united_book` | Complete booking (requires confirm=true) |
| `united_get_reservations` | View upcoming trips |
| `united_check_in` | Check in and get boarding pass |
| `united_get_miles` | Get MileagePlus balance and elite status |

## Session Storage

Cookies are saved to `~/.strider/united/` between sessions:
- `cookies.json` — Browser cookies
- `session.json` — Session metadata (login state, MileagePlus number)

## Getting Started

1. Start the server and run `united_login` to get the login URL
2. Log in to United.com in your browser — session cookies are saved automatically
3. Run `united_status` to confirm authentication
4. Search flights with `united_search_flights`

## Booking Safety

`united_book` requires `confirm=true` to actually purchase tickets. Without it, the tool returns a preview only. **Never pass `confirm=true` without explicit user confirmation of the itinerary and total cost.**

## Example Workflow

```
1. united_login           → Get login URL
2. united_status          → Confirm logged in
3. united_search_flights  → Search ORD→SFO April 15
4. united_filter_flights  → Filter to nonstop only
5. united_select_flight   → Pick UA flight
6. united_select_seats    → Choose seat 22A
7. united_add_bags        → Add 1 checked bag
8. united_view_cart       → Review total
9. united_book            → Book (with confirm=true after user confirms)
```

## Known Limitations

- Requires manual login (United does not support programmatic authentication)
- Browser automation may break if United updates their UI
- CAPTCHAs require manual intervention
- Payment methods must be pre-configured in your United account

## License

MIT — Strider Labs
