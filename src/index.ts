#!/usr/bin/env node

/**
 * Strider Labs United Airlines MCP Server
 *
 * MCP server that gives AI agents the ability to search flights, manage bookings,
 * check in, and track MileagePlus miles on United Airlines via browser automation.
 * https://striderlabs.ai
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  checkLoginStatus,
  initiateLogin,
  searchFlights,
  getFlightDetails,
  filterFlights,
  selectFlight,
  selectSeats,
  addBags,
  viewCart,
  bookFlights,
  getReservations,
  checkIn,
  getMilesBalance,
  closeBrowser,
} from "./browser.js";
import { loadSessionInfo, clearAuthData, getConfigDir } from "./auth.js";

// Initialize server
const server = new Server(
  {
    name: "strider-united",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "united_status",
        description:
          "Check United Airlines MileagePlus login status and session info. Use this to verify authentication before performing other actions.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "united_login",
        description:
          "Initiate United MileagePlus login flow. Returns a URL and instructions for the user to complete login manually. After logging in, use united_status to verify.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "united_logout",
        description:
          "Clear saved United MileagePlus session and cookies. Use this to log out or reset authentication state.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "united_search_flights",
        description:
          "Search for United Airlines flights. Returns available flights with prices, times, stops, and cabin options.",
        inputSchema: {
          type: "object",
          properties: {
            origin: {
              type: "string",
              description: "Origin airport code (e.g., 'ORD', 'LAX', 'JFK')",
            },
            destination: {
              type: "string",
              description: "Destination airport code (e.g., 'SFO', 'EWR', 'DEN')",
            },
            departureDate: {
              type: "string",
              description: "Departure date in YYYY-MM-DD format (e.g., '2025-04-15')",
            },
            returnDate: {
              type: "string",
              description: "Return date for round trips in YYYY-MM-DD format. Omit for one-way.",
            },
            passengers: {
              type: "number",
              description: "Number of passengers (default: 1)",
            },
            cabin: {
              type: "string",
              description: "Preferred cabin class: 'Economy', 'Business', or 'First' (default: Economy)",
            },
          },
          required: ["origin", "destination", "departureDate"],
        },
      },
      {
        name: "united_get_flight",
        description:
          "Get detailed information about a specific United flight including status, aircraft type, and layover details.",
        inputSchema: {
          type: "object",
          properties: {
            flightNumber: {
              type: "string",
              description: "United flight number (e.g., 'UA123' or '123')",
            },
            date: {
              type: "string",
              description: "Flight date in YYYY-MM-DD format",
            },
          },
          required: ["flightNumber", "date"],
        },
      },
      {
        name: "united_filter_flights",
        description:
          "Filter previously searched flights by stops, price range, departure/arrival times, or cabin class.",
        inputSchema: {
          type: "object",
          properties: {
            maxStops: {
              type: "number",
              description: "Maximum number of stops (0 = nonstop only, 1 = up to 1 stop)",
            },
            maxPrice: {
              type: "number",
              description: "Maximum price in USD",
            },
            departureAfter: {
              type: "string",
              description: "Earliest departure time in HH:MM format (e.g., '06:00')",
            },
            departureBefore: {
              type: "string",
              description: "Latest departure time in HH:MM format (e.g., '20:00')",
            },
            arrivalAfter: {
              type: "string",
              description: "Earliest arrival time in HH:MM format",
            },
            arrivalBefore: {
              type: "string",
              description: "Latest arrival time in HH:MM format",
            },
            cabin: {
              type: "string",
              description: "Cabin class filter: 'Economy', 'Business', or 'First'",
            },
            maxDurationMinutes: {
              type: "number",
              description: "Maximum total flight duration in minutes",
            },
          },
        },
      },
      {
        name: "united_select_flight",
        description:
          "Select a specific flight for booking. Use direction='outbound' for departing flight and 'return' for the return leg on round trips.",
        inputSchema: {
          type: "object",
          properties: {
            flightNumber: {
              type: "string",
              description: "Flight number to select (e.g., 'UA123')",
            },
            direction: {
              type: "string",
              description: "Flight direction: 'outbound' or 'return'",
              enum: ["outbound", "return"],
            },
            cabin: {
              type: "string",
              description: "Cabin class to book: 'Economy', 'Business', or 'First'",
            },
          },
          required: ["flightNumber", "direction"],
        },
      },
      {
        name: "united_select_seats",
        description:
          "Select seat assignments for a flight. Returns available seat map and confirms selections.",
        inputSchema: {
          type: "object",
          properties: {
            flightNumber: {
              type: "string",
              description: "Flight number for seat selection",
            },
            seats: {
              type: "array",
              items: { type: "string" },
              description: "Array of seat IDs to select (e.g., ['12A', '12B'])",
            },
            passengers: {
              type: "number",
              description: "Number of passengers (default: 1)",
            },
          },
          required: ["flightNumber", "seats"],
        },
      },
      {
        name: "united_add_bags",
        description:
          "Add checked baggage to the booking. United charges per bag per passenger.",
        inputSchema: {
          type: "object",
          properties: {
            bags: {
              type: "number",
              description: "Number of checked bags per passenger (e.g., 1 or 2)",
            },
            passengers: {
              type: "number",
              description: "Number of passengers (default: uses current search)",
            },
          },
          required: ["bags"],
        },
      },
      {
        name: "united_view_cart",
        description:
          "View current flight booking summary including selected flights, seats, bags, and total price.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "united_book",
        description:
          "Book the selected flights. IMPORTANT: Set confirm=true only after getting explicit user confirmation. Without confirm=true, returns a preview instead of completing the purchase.",
        inputSchema: {
          type: "object",
          properties: {
            confirm: {
              type: "boolean",
              description:
                "Set to true to complete the booking and charge payment. NEVER set to true without explicit user confirmation. Omit or set false to get a preview.",
            },
          },
        },
      },
      {
        name: "united_get_reservations",
        description:
          "View upcoming trips and reservations linked to the logged-in MileagePlus account.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "united_check_in",
        description:
          "Check in for a United Airlines flight using confirmation number and last name. Returns boarding pass information.",
        inputSchema: {
          type: "object",
          properties: {
            confirmationNumber: {
              type: "string",
              description: "Reservation confirmation number (e.g., 'ABC123')",
            },
            lastName: {
              type: "string",
              description: "Passenger last name",
            },
          },
          required: ["confirmationNumber", "lastName"],
        },
      },
      {
        name: "united_get_miles",
        description:
          "Get MileagePlus account balance, elite status, and recent activity for the logged-in user.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "united_status": {
        const sessionInfo = loadSessionInfo();
        const liveStatus = await checkLoginStatus();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  session: liveStatus,
                  savedSession: sessionInfo,
                  configDir: getConfigDir(),
                  message: liveStatus.isLoggedIn
                    ? `Logged in${liveStatus.userFirstName ? ` as ${liveStatus.userFirstName}` : ""}${
                        liveStatus.mileagePlusNumber ? ` (MileagePlus: ${liveStatus.mileagePlusNumber})` : ""
                      }`
                    : "Not logged in. Use united_login to authenticate with your MileagePlus account.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "united_login": {
        const result = await initiateLogin();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  ...result,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "united_logout": {
        clearAuthData();
        await closeBrowser();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Logged out. United MileagePlus session and cookies cleared.",
              }),
            },
          ],
        };
      }

      case "united_search_flights": {
        const { origin, destination, departureDate, returnDate, passengers = 1, cabin = "Economy" } = args as {
          origin: string;
          destination: string;
          departureDate: string;
          returnDate?: string;
          passengers?: number;
          cabin?: string;
        };

        const flights = await searchFlights({ origin, destination, departureDate, returnDate, passengers, cabin });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  search: { origin, destination, departureDate, returnDate, passengers, cabin },
                  count: flights.length,
                  flights,
                  tip: flights.length === 0
                    ? "No flights found. Try different dates or check if you need to log in first."
                    : `Found ${flights.length} flights. Use united_filter_flights to narrow results, or united_select_flight to choose one.`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "united_get_flight": {
        const { flightNumber, date } = args as { flightNumber: string; date: string };
        const details = await getFlightDetails(flightNumber, date);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, flight: details }, null, 2),
            },
          ],
        };
      }

      case "united_filter_flights": {
        const filterParams = args as {
          maxStops?: number;
          maxPrice?: number;
          departureAfter?: string;
          departureBefore?: string;
          arrivalAfter?: string;
          arrivalBefore?: string;
          cabin?: string;
          maxDurationMinutes?: number;
        };

        const result = await filterFlights(filterParams);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  appliedFilters: result.appliedFilters,
                  count: result.filtered.length,
                  flights: result.filtered,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "united_select_flight": {
        const { flightNumber, direction, cabin } = args as {
          flightNumber: string;
          direction: "outbound" | "return";
          cabin?: string;
        };

        const result = await selectFlight({ flightNumber, direction, cabin });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  message: result.message,
                  booking: result.booking,
                  nextStep: "Use united_select_seats to choose seats, or united_view_cart to review.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "united_select_seats": {
        const { flightNumber, seats, passengers } = args as {
          flightNumber: string;
          seats: string[];
          passengers?: number;
        };

        const result = await selectSeats({ flightNumber, seats, passengers });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  message: result.message,
                  selectedSeats: result.selectedSeats,
                  seatMap: result.seatMap,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "united_add_bags": {
        const { bags, passengers } = args as { bags: number; passengers?: number };
        const result = await addBags({ bags, passengers });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  message: result.message,
                  bagsAdded: result.bagsAdded,
                  estimatedFee: result.estimatedFee,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "united_view_cart": {
        const cart = await viewCart();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  booking: cart,
                  note: "Review the above details. Use united_book with confirm=true to complete the purchase.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "united_book": {
        const { confirm = false } = args as { confirm?: boolean };

        if (!confirm) {
          const summary = await viewCart();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    requiresConfirmation: true,
                    preview: summary,
                    message:
                      "Booking not completed. To book these flights, call united_book with confirm=true. " +
                      "IMPORTANT: Only do this after getting explicit user confirmation of the itinerary and total price.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = await bookFlights(true);

        if ("requiresConfirmation" in result) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    requiresConfirmation: result.requiresConfirmation,
                    preview: result.summary,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  booked: true,
                  confirmationNumber: result.confirmationNumber,
                  totalCharged: result.totalCharged,
                  passengers: result.passengers,
                  itinerary: result.itinerary,
                  message: `Booking confirmed! Confirmation number: ${result.confirmationNumber}`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "united_get_reservations": {
        const reservations = await getReservations();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  count: reservations.length,
                  reservations,
                  note:
                    reservations.length === 0
                      ? "No upcoming reservations found. Ensure you are logged in."
                      : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "united_check_in": {
        const { confirmationNumber, lastName } = args as {
          confirmationNumber: string;
          lastName: string;
        };

        const result = await checkIn({ confirmationNumber, lastName });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  message: result.message,
                  boardingPass: result.boardingPass,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "united_get_miles": {
        const milesData = await getMilesBalance();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  ...milesData,
                  note: milesData.totalMiles === "N/A"
                    ? "Could not retrieve balance. Ensure you are logged in with united_login."
                    : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Unknown tool: ${name}`,
              }),
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: false,
              error: errorMessage,
              suggestion: errorMessage.toLowerCase().includes("login") || errorMessage.toLowerCase().includes("auth")
                ? "Try running united_login to authenticate with your MileagePlus account"
                : errorMessage.toLowerCase().includes("timeout")
                ? "The page took too long to load. Try again or check your internet connection."
                : errorMessage.toLowerCase().includes("flight")
                ? "Run united_search_flights first to search for available flights."
                : undefined,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// Cleanup on server close
server.onclose = async () => {
  await closeBrowser();
};

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Strider United Airlines MCP server running");
  console.error(`Config directory: ${getConfigDir()}`);
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
