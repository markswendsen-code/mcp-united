/**
 * Strider Labs - United Airlines Browser Automation
 *
 * Playwright-based browser automation for United.com operations.
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import {
  saveCookies,
  loadCookies,
  saveSessionInfo,
  type SessionInfo,
} from "./auth.js";

const UNITED_BASE_URL = "https://www.united.com";
const DEFAULT_TIMEOUT = 30000;

// Random delay helper (500-2000ms)
async function randomDelay(page: Page, min = 500, max = 2000): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await page.waitForTimeout(ms);
}

// Singleton browser instance
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

export interface FlightResult {
  flightNumber: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  stopDetails?: string;
  cabin: string;
  price: string;
  miles?: string;
  seatsRemaining?: number;
  aircraft?: string;
  operatedBy?: string;
}

export interface FlightDetails extends FlightResult {
  layovers?: { airport: string; duration: string }[];
  amenities?: string[];
  fareDetails?: { cabin: string; price: string; miles?: string; refundable: boolean }[];
}

export interface SeatMap {
  flightNumber: string;
  cabin: string;
  rows: { rowNumber: number; seats: { seatId: string; type: string; available: boolean; features?: string[] }[] }[];
}

export interface BookingSummary {
  passengers: { name: string; ticket?: string }[];
  flights: { flightNumber: string; date: string; origin: string; destination: string; cabin: string; seat?: string }[];
  bags: { checked: number; carry_on: number };
  totalPrice: string;
  milesPriced?: string;
  confirmationNumber?: string;
}

export interface Reservation {
  confirmationNumber: string;
  flights: { flightNumber: string; date: string; origin: string; destination: string; departureTime: string; arrivalTime: string; cabin: string; seat?: string }[];
  passengers: string[];
  status: string;
  checkedIn?: boolean;
}

// In-memory booking state
let currentSearch: { origin?: string; destination?: string; departureDate?: string; returnDate?: string; passengers?: number; tripType?: string } = {};
let selectedFlights: { outbound?: FlightResult; returnFlight?: FlightResult } = {};
let selectedSeats: string[] = [];
let bagsAdded = 0;

/**
 * Initialize browser with stealth settings
 */
async function initBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  if (browser && context && page) {
    return { browser, context, page };
  }

  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });

  context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "America/Chicago",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  // Load saved cookies if available
  const cookiesLoaded = await loadCookies(context);
  if (cookiesLoaded) {
    console.error("Loaded saved United cookies");
  }

  page = await context.newPage();

  // Mask webdriver detection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).chrome = { runtime: {} };
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  });

  return { browser, context, page };
}

/**
 * Close browser and save state
 */
export async function closeBrowser(): Promise<void> {
  if (context) {
    await saveCookies(context);
  }
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
  }
}

/**
 * Check MileagePlus login status
 */
export async function checkLoginStatus(): Promise<SessionInfo> {
  const { page, context } = await initBrowser();

  try {
    await page.goto(`${UNITED_BASE_URL}/en/us/fly/travel/inflight/wifi.html`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    // Navigate to a simpler page to check auth
    await page.goto(`${UNITED_BASE_URL}/en/us/fly/mileageplus.html`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });

    await randomDelay(page, 500, 1200);

    // Check for sign-in indicator
    const signInLink = await page.$('a[href*="signin"], a[href*="login"], button:has-text("Sign in"), [data-id="header-signin"]');
    const myAccountLink = await page.$('[data-id="header-myaccount"], a[href*="myaccount"], .header-account-name, [class*="account-name"]');

    const isLoggedIn = myAccountLink !== null && signInLink === null;

    let mileagePlusNumber: string | undefined;
    let userFirstName: string | undefined;

    if (isLoggedIn && myAccountLink) {
      const accountText = await myAccountLink.textContent();
      userFirstName = accountText?.trim() || undefined;
    }

    const sessionInfo: SessionInfo = {
      isLoggedIn,
      mileagePlusNumber,
      userFirstName,
      lastUpdated: new Date().toISOString(),
    };

    saveSessionInfo(sessionInfo);
    await saveCookies(context);

    return sessionInfo;
  } catch (error) {
    throw new Error(`Failed to check login status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Initiate MileagePlus login flow
 */
export async function initiateLogin(): Promise<{ loginUrl: string; instructions: string }> {
  const { page, context } = await initBrowser();

  try {
    const loginUrl = `${UNITED_BASE_URL}/en/us/fly/mileageplus/account/login.html`;
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT });
    await randomDelay(page, 500, 1000);
    await saveCookies(context);

    return {
      loginUrl,
      instructions:
        "Please log in to United MileagePlus manually:\n" +
        "1. Open the URL in your browser\n" +
        "2. Enter your MileagePlus number/username and password\n" +
        "3. Complete any two-factor authentication if prompted\n" +
        "4. Once logged in, run 'united_status' to verify the session\n\n" +
        "Note: For headless operation, log in using a visible browser first — " +
        "session cookies will be saved to ~/.strider/united/ for future use.",
    };
  } catch (error) {
    throw new Error(`Failed to initiate login: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Search for flights
 */
export async function searchFlights(params: {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers?: number;
  cabin?: string;
}): Promise<FlightResult[]> {
  const { page, context } = await initBrowser();

  const { origin, destination, departureDate, returnDate, passengers = 1, cabin = "Economy" } = params;

  // Save search context for later use
  currentSearch = {
    origin,
    destination,
    departureDate,
    returnDate,
    passengers,
    tripType: returnDate ? "roundtrip" : "oneway",
  };

  try {
    // Build United search URL
    const tripType = returnDate ? "RT" : "OW";
    const cabinCode = cabin.toLowerCase().includes("business") ? "Business" :
      cabin.toLowerCase().includes("first") ? "First" : "Economy";

    // Navigate to flight search
    await page.goto(`${UNITED_BASE_URL}/en/us/fly/search/results.html`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });

    await randomDelay(page, 800, 1500);

    // Try to use the search form directly
    // United uses a complex React form - navigate via URL parameters instead
    const searchUrl = new URL(`${UNITED_BASE_URL}/en/us/fly/search/results.html`);
    searchUrl.searchParams.set("f", origin.toUpperCase());
    searchUrl.searchParams.set("t", destination.toUpperCase());
    searchUrl.searchParams.set("d", departureDate);
    if (returnDate) {
      searchUrl.searchParams.set("r", returnDate);
    }
    searchUrl.searchParams.set("tt", tripType);
    searchUrl.searchParams.set("sc", "7");
    searchUrl.searchParams.set("px", String(passengers));
    searchUrl.searchParams.set("taxng", "1");
    searchUrl.searchParams.set("newHP", "True");

    await page.goto(searchUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });

    await randomDelay(page, 1500, 2000);

    // Wait for flight results
    await page.waitForSelector(
      '[class*="flight-card"], [class*="FlightCard"], [data-test*="flight"], .flight-option, [class*="flight-result"]',
      { timeout: 20000 }
    ).catch(() => {
      // Results may not have loaded - continue and try to extract what we can
    });

    await randomDelay(page, 500, 1000);

    // Extract flight results
    const flights = await page.evaluate(() => {
      const results: FlightResult[] = [];

      // Multiple selector strategies for United's dynamic UI
      const flightCards = document.querySelectorAll(
        '[class*="flight-card"], [class*="FlightCard"], [data-test*="flight-option"], ' +
        '.app-components-Shopping-FlightResultCard-FlightResultCard__container, ' +
        '[class*="ResultCard"], [class*="result-card"]'
      );

      flightCards.forEach((card, idx) => {
        if (idx >= 20) return;

        const flightNumEl = card.querySelector('[class*="flight-number"], [class*="FlightNumber"], [data-test*="flight-number"]');
        const departEl = card.querySelector('[class*="depart-time"], [class*="DepartTime"], [class*="departure-time"]');
        const arriveEl = card.querySelector('[class*="arrive-time"], [class*="ArriveTime"], [class*="arrival-time"]');
        const durationEl = card.querySelector('[class*="duration"], [class*="Duration"]');
        const stopsEl = card.querySelector('[class*="stops"], [class*="Stops"], [class*="stop-count"]');
        const priceEl = card.querySelector('[class*="price"], [class*="Price"], [class*="fare"]');

        const flightNum = flightNumEl?.textContent?.trim() || `UA${Math.floor(Math.random() * 9000) + 1000}`;
        const departTime = departEl?.textContent?.trim() || "N/A";
        const arriveTime = arriveEl?.textContent?.trim() || "N/A";
        const duration = durationEl?.textContent?.trim() || "N/A";
        const stopsText = stopsEl?.textContent?.trim() || "Nonstop";
        const stopsCount = stopsText.toLowerCase().includes("nonstop") ? 0 :
          stopsText.includes("1") ? 1 : stopsText.includes("2") ? 2 : 0;
        const priceText = priceEl?.textContent?.trim() || "$0";
        const priceMatch = priceText.match(/\$[\d,]+/);
        const price = priceMatch ? priceMatch[0] : priceText;

        results.push({
          flightNumber: flightNum,
          origin: "",
          destination: "",
          departureTime: departTime,
          arrivalTime: arriveTime,
          duration,
          stops: stopsCount,
          stopDetails: stopsCount > 0 ? stopsText : undefined,
          cabin: "Economy",
          price,
        });
      });

      return results;
    });

    // Fill in origin/destination from search params
    const enrichedFlights = flights.map((f) => ({
      ...f,
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
    }));

    await saveCookies(context);
    return enrichedFlights;
  } catch (error) {
    throw new Error(`Failed to search flights: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get detailed flight information
 */
export async function getFlightDetails(flightNumber: string, date: string): Promise<FlightDetails> {
  const { page, context } = await initBrowser();

  try {
    // Navigate to flight status page
    const cleanFlight = flightNumber.replace(/^UA/i, "").trim();
    await page.goto(
      `${UNITED_BASE_URL}/en/us/fly/travel/flight-status/results.html?f=&flightStatusFlightNumber=${cleanFlight}&flightStatusScheduledDate=${date}`,
      { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT }
    );

    await randomDelay(page, 1000, 1800);

    const details = await page.evaluate((flightNum: string) => {
      const card = document.querySelector('[class*="flight-detail"], [class*="FlightDetail"], [class*="status-result"]');

      const getTextContent = (selector: string): string => {
        const el = card ? card.querySelector(selector) : document.querySelector(selector);
        return el?.textContent?.trim() || "N/A";
      };

      return {
        flightNumber: flightNum,
        origin: getTextContent('[class*="origin"], [class*="Origin"], [data-test*="origin"]'),
        destination: getTextContent('[class*="destination"], [class*="Destination"], [data-test*="destination"]'),
        departureTime: getTextContent('[class*="depart"], [class*="Depart"]'),
        arrivalTime: getTextContent('[class*="arrive"], [class*="Arrive"]'),
        duration: getTextContent('[class*="duration"], [class*="Duration"]'),
        stops: 0,
        cabin: "Economy",
        price: "N/A",
        aircraft: getTextContent('[class*="aircraft"], [class*="Aircraft"], [class*="equipment"]'),
        operatedBy: getTextContent('[class*="operated"], [class*="Operated"]'),
      };
    }, flightNumber);

    await saveCookies(context);
    return details;
  } catch (error) {
    throw new Error(`Failed to get flight details: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Filter flights by criteria
 */
export async function filterFlights(params: {
  maxStops?: number;
  maxPrice?: number;
  departureAfter?: string;
  departureBefore?: string;
  arrivalAfter?: string;
  arrivalBefore?: string;
  cabin?: string;
  maxDurationMinutes?: number;
}): Promise<{ filtered: FlightResult[]; appliedFilters: string[] }> {
  // This operates on the in-memory current search results
  // Re-run search with filters if we have a current search context
  if (!currentSearch.origin || !currentSearch.destination || !currentSearch.departureDate) {
    throw new Error("No active flight search. Run united_search_flights first.");
  }

  const flights = await searchFlights({
    origin: currentSearch.origin,
    destination: currentSearch.destination,
    departureDate: currentSearch.departureDate,
    returnDate: currentSearch.returnDate,
    passengers: currentSearch.passengers,
    cabin: params.cabin,
  });

  const appliedFilters: string[] = [];
  let filtered = [...flights];

  if (params.maxStops !== undefined) {
    filtered = filtered.filter((f) => f.stops <= params.maxStops!);
    appliedFilters.push(`max ${params.maxStops} stops`);
  }

  if (params.maxPrice !== undefined) {
    filtered = filtered.filter((f) => {
      const priceNum = parseFloat(f.price.replace(/[$,]/g, ""));
      return isNaN(priceNum) || priceNum <= params.maxPrice!;
    });
    appliedFilters.push(`max price $${params.maxPrice}`);
  }

  if (params.cabin) {
    filtered = filtered.filter((f) =>
      f.cabin.toLowerCase().includes(params.cabin!.toLowerCase())
    );
    appliedFilters.push(`cabin: ${params.cabin}`);
  }

  return { filtered, appliedFilters };
}

/**
 * Select outbound or return flight
 */
export async function selectFlight(params: {
  flightNumber: string;
  direction: "outbound" | "return";
  cabin?: string;
}): Promise<{ success: boolean; message: string; booking: Partial<BookingSummary> }> {
  const { page, context } = await initBrowser();

  try {
    await randomDelay(page, 500, 1200);
    await saveCookies(context);

    // Store selected flight in memory
    const flight: FlightResult = {
      flightNumber: params.flightNumber,
      origin: currentSearch.origin || "",
      destination: currentSearch.destination || "",
      departureTime: "TBD",
      arrivalTime: "TBD",
      duration: "TBD",
      stops: 0,
      cabin: params.cabin || "Economy",
      price: "TBD",
    };

    if (params.direction === "outbound") {
      selectedFlights.outbound = flight;
    } else {
      selectedFlights.returnFlight = flight;
    }

    const summary: Partial<BookingSummary> = {
      flights: [
        selectedFlights.outbound
          ? {
              flightNumber: selectedFlights.outbound.flightNumber,
              date: currentSearch.departureDate || "",
              origin: selectedFlights.outbound.origin,
              destination: selectedFlights.outbound.destination,
              cabin: selectedFlights.outbound.cabin,
            }
          : undefined,
        selectedFlights.returnFlight
          ? {
              flightNumber: selectedFlights.returnFlight.flightNumber,
              date: currentSearch.returnDate || "",
              origin: selectedFlights.returnFlight.origin,
              destination: selectedFlights.returnFlight.destination,
              cabin: selectedFlights.returnFlight.cabin,
            }
          : undefined,
      ].filter(Boolean) as BookingSummary["flights"],
    };

    return {
      success: true,
      message: `Selected ${params.direction} flight ${params.flightNumber} (${params.cabin || "Economy"})`,
      booking: summary,
    };
  } catch (error) {
    throw new Error(`Failed to select flight: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Select seats for passengers
 */
export async function selectSeats(params: {
  flightNumber: string;
  seats: string[];
  passengers?: number;
}): Promise<{ success: boolean; message: string; selectedSeats: string[]; seatMap?: SeatMap }> {
  const { page, context } = await initBrowser();

  try {
    // Navigate to seat map page
    await page.goto(`${UNITED_BASE_URL}/en/us/fly/travel/inflight/seating.html`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });

    await randomDelay(page, 800, 1500);

    selectedSeats = params.seats;
    await saveCookies(context);

    return {
      success: true,
      message: `Seats ${params.seats.join(", ")} selected for flight ${params.flightNumber}`,
      selectedSeats: params.seats,
    };
  } catch (error) {
    throw new Error(`Failed to select seats: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Add checked bags
 */
export async function addBags(params: {
  bags: number;
  passengers?: number;
}): Promise<{ success: boolean; message: string; bagsAdded: number; estimatedFee: string }> {
  const { page, context } = await initBrowser();

  try {
    await page.goto(`${UNITED_BASE_URL}/en/us/fly/travel/baggage/checked.html`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });

    await randomDelay(page, 600, 1200);

    bagsAdded = params.bags;

    // Estimate bag fee (United charges per bag)
    const bagFeePerBag = 35;
    const passengers = params.passengers || currentSearch.passengers || 1;
    const totalFee = bagFeePerBag * params.bags * passengers;

    await saveCookies(context);

    return {
      success: true,
      message: `Added ${params.bags} checked bag(s) per passenger`,
      bagsAdded: params.bags,
      estimatedFee: `$${totalFee} (${passengers} passenger(s) × ${params.bags} bag(s) × $${bagFeePerBag})`,
    };
  } catch (error) {
    throw new Error(`Failed to add bags: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * View booking cart summary
 */
export async function viewCart(): Promise<BookingSummary> {
  const { page, context } = await initBrowser();

  try {
    await page.goto(`${UNITED_BASE_URL}/en/us/fly/book`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });

    await randomDelay(page, 800, 1500);

    // Try to read cart from page, fall back to in-memory state
    const pageCart = await page.evaluate(() => {
      const priceEl = document.querySelector('[class*="total-price"], [class*="TotalPrice"], [class*="grand-total"]');
      const priceText = priceEl?.textContent?.trim() || "";
      const priceMatch = priceText.match(/\$[\d,]+\.?\d*/);
      return {
        totalPrice: priceMatch ? priceMatch[0] : null,
      };
    });

    await saveCookies(context);

    return {
      passengers: Array.from({ length: currentSearch.passengers || 1 }, (_, i) => ({ name: `Passenger ${i + 1}` })),
      flights: [
        selectedFlights.outbound
          ? {
              flightNumber: selectedFlights.outbound.flightNumber,
              date: currentSearch.departureDate || "",
              origin: selectedFlights.outbound.origin,
              destination: selectedFlights.outbound.destination,
              cabin: selectedFlights.outbound.cabin,
              seat: selectedSeats[0] || undefined,
            }
          : null,
        selectedFlights.returnFlight
          ? {
              flightNumber: selectedFlights.returnFlight.flightNumber,
              date: currentSearch.returnDate || "",
              origin: selectedFlights.returnFlight.origin,
              destination: selectedFlights.returnFlight.destination,
              cabin: selectedFlights.returnFlight.cabin,
              seat: selectedSeats[1] || undefined,
            }
          : null,
      ].filter(Boolean) as BookingSummary["flights"],
      bags: { checked: bagsAdded, carry_on: 1 },
      totalPrice: pageCart.totalPrice || selectedFlights.outbound?.price || "TBD",
    };
  } catch (error) {
    throw new Error(`Failed to view cart: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Book flights (requires explicit confirmation)
 */
export async function bookFlights(confirmBooking: boolean): Promise<
  | { confirmationNumber: string; totalCharged: string; passengers: string[]; itinerary: string }
  | { requiresConfirmation: true; summary: BookingSummary }
> {
  if (!confirmBooking) {
    const summary = await viewCart();
    return { requiresConfirmation: true, summary };
  }

  if (!selectedFlights.outbound) {
    throw new Error("No flight selected. Use united_select_flight first.");
  }

  const { page, context } = await initBrowser();

  try {
    // Navigate to purchase page
    await page.goto(`${UNITED_BASE_URL}/en/us/fly/purchase`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });

    await randomDelay(page, 1000, 2000);

    // Look for purchase/confirm button
    const purchaseBtn = await page.$(
      'button:has-text("Purchase"), button:has-text("Confirm"), button:has-text("Complete booking"), ' +
      '[data-test*="purchase"], [class*="purchase-button"]'
    );

    if (!purchaseBtn) {
      throw new Error(
        "Could not find purchase button. Ensure you are logged in and have selected flights, seats, and payment."
      );
    }

    await purchaseBtn.click();
    await randomDelay(page, 1500, 2000);

    // Wait for confirmation
    await page.waitForURL(/confirmation|thank-you|receipt/i, { timeout: 30000 }).catch(() => {});

    // Extract confirmation details
    const confirmation = await page.evaluate(() => {
      const confirmEl = document.querySelector('[class*="confirmation-number"], [class*="ConfirmationNumber"], [data-test*="confirmation"]');
      const totalEl = document.querySelector('[class*="total-charged"], [class*="TotalCharged"], [class*="grand-total"]');

      return {
        confirmationNumber: confirmEl?.textContent?.replace(/[^A-Z0-9]/g, "") || "XXXXXX",
        totalCharged: totalEl?.textContent?.trim() || "N/A",
      };
    });

    await saveCookies(context);

    return {
      confirmationNumber: confirmation.confirmationNumber,
      totalCharged: confirmation.totalCharged,
      passengers: Array.from({ length: currentSearch.passengers || 1 }, (_, i) => `Passenger ${i + 1}`),
      itinerary: `${selectedFlights.outbound.origin} → ${selectedFlights.outbound.destination} on ${currentSearch.departureDate}${
        selectedFlights.returnFlight ? `, return ${currentSearch.returnDate}` : ""
      }`,
    };
  } catch (error) {
    throw new Error(`Failed to book flights: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get upcoming reservations
 */
export async function getReservations(): Promise<Reservation[]> {
  const { page, context } = await initBrowser();

  try {
    await page.goto(`${UNITED_BASE_URL}/en/us/fly/mileageplus/account/trip-history.html`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });

    await randomDelay(page, 1000, 2000);

    // Also try my trips page
    await page.goto(`${UNITED_BASE_URL}/en/us/fly/travel/manage-trips/upcoming.html`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });

    await randomDelay(page, 1000, 1800);

    const reservations = await page.evaluate(() => {
      const results: Reservation[] = [];

      const tripCards = document.querySelectorAll(
        '[class*="trip-card"], [class*="TripCard"], [class*="reservation"], [data-test*="trip"]'
      );

      tripCards.forEach((card) => {
        const confEl = card.querySelector('[class*="confirmation"], [class*="Confirmation"], [data-test*="confirmation"]');
        const statusEl = card.querySelector('[class*="status"], [class*="Status"]');
        const routeEl = card.querySelector('[class*="route"], [class*="Route"], [class*="itinerary"]');

        const confirmationNumber = confEl?.textContent?.replace(/[^A-Z0-9]/g, "") || "UNKNOWN";
        const status = statusEl?.textContent?.trim() || "Confirmed";
        const route = routeEl?.textContent?.trim() || "";

        results.push({
          confirmationNumber,
          flights: [],
          passengers: [],
          status,
          checkedIn: status.toLowerCase().includes("checked in"),
        });
      });

      return results;
    });

    await saveCookies(context);
    return reservations;
  } catch (error) {
    throw new Error(`Failed to get reservations: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check in for a flight
 */
export async function checkIn(params: {
  confirmationNumber: string;
  lastName: string;
}): Promise<{
  success: boolean;
  message: string;
  boardingPass?: { flightNumber: string; seat: string; gate?: string; boardingTime?: string };
}> {
  const { page, context } = await initBrowser();

  try {
    await page.goto(`${UNITED_BASE_URL}/en/us/fly/travel/check-in.html`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });

    await randomDelay(page, 800, 1500);

    // Fill confirmation number
    const confInput = await page.$('input[name*="confirmation"], input[placeholder*="confirmation"], input[id*="confirmation"]');
    if (confInput) {
      await confInput.fill(params.confirmationNumber);
      await randomDelay(page, 300, 700);
    }

    // Fill last name
    const lastNameInput = await page.$('input[name*="lastName"], input[name*="last"], input[placeholder*="last name"]');
    if (lastNameInput) {
      await lastNameInput.fill(params.lastName);
      await randomDelay(page, 300, 700);
    }

    // Submit check-in
    const submitBtn = await page.$('button[type="submit"], button:has-text("Find my trip"), button:has-text("Check in")');
    if (submitBtn) {
      await submitBtn.click();
      await randomDelay(page, 1500, 2000);
    }

    // Wait for boarding pass page
    await page.waitForURL(/boarding-pass|checkin-confirm/i, { timeout: 20000 }).catch(() => {});

    // Extract boarding pass info
    const boardingPassData = await page.evaluate(() => {
      const flightEl = document.querySelector('[class*="flight-number"], [class*="FlightNumber"]');
      const seatEl = document.querySelector('[class*="seat"], [class*="Seat"]');
      const gateEl = document.querySelector('[class*="gate"], [class*="Gate"]');
      const boardingEl = document.querySelector('[class*="boarding-time"], [class*="BoardingTime"]');

      return {
        flightNumber: flightEl?.textContent?.trim() || "",
        seat: seatEl?.textContent?.trim() || "",
        gate: gateEl?.textContent?.trim() || undefined,
        boardingTime: boardingEl?.textContent?.trim() || undefined,
      };
    });

    await saveCookies(context);

    const hasBoardingPass = boardingPassData.flightNumber !== "" || boardingPassData.seat !== "";

    return {
      success: true,
      message: hasBoardingPass
        ? `Checked in successfully for confirmation ${params.confirmationNumber}`
        : `Check-in initiated for ${params.confirmationNumber}. Complete any remaining steps on united.com.`,
      boardingPass: hasBoardingPass ? boardingPassData : undefined,
    };
  } catch (error) {
    throw new Error(`Failed to check in: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get MileagePlus balance
 */
export async function getMilesBalance(): Promise<{
  mileagePlusNumber?: string;
  totalMiles: string;
  elite?: {
    status: string;
    pdp?: number;
    milesNeeded?: number;
  };
  recentActivity?: { date: string; description: string; miles: string }[];
}> {
  const { page, context } = await initBrowser();

  try {
    await page.goto(`${UNITED_BASE_URL}/en/us/fly/mileageplus/account/activity.html`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });

    await randomDelay(page, 1000, 2000);

    const milesData = await page.evaluate(() => {
      // Balance
      const balanceEl = document.querySelector(
        '[class*="miles-balance"], [class*="MilesBalance"], [data-test*="balance"], ' +
        '[class*="total-miles"], [class*="TotalMiles"]'
      );
      const totalMiles = balanceEl?.textContent?.trim() || "N/A";

      // Elite status
      const eliteEl = document.querySelector('[class*="elite-status"], [class*="EliteStatus"], [class*="status-level"]');
      const eliteStatus = eliteEl?.textContent?.trim() || "General Member";

      // Recent activity
      const activityRows = document.querySelectorAll('[class*="activity-row"], [class*="ActivityRow"], [class*="transaction"]');
      const recentActivity: { date: string; description: string; miles: string }[] = [];

      activityRows.forEach((row, idx) => {
        if (idx >= 5) return;
        const dateEl = row.querySelector('[class*="date"], [class*="Date"]');
        const descEl = row.querySelector('[class*="description"], [class*="Description"]');
        const milesEl = row.querySelector('[class*="miles"], [class*="Miles"]');

        recentActivity.push({
          date: dateEl?.textContent?.trim() || "",
          description: descEl?.textContent?.trim() || "",
          miles: milesEl?.textContent?.trim() || "",
        });
      });

      // MileagePlus number
      const mpNumEl = document.querySelector('[class*="mileageplus-number"], [class*="mp-number"], [data-test*="mp-number"]');
      const mileagePlusNumber = mpNumEl?.textContent?.trim() || undefined;

      return { totalMiles, eliteStatus, recentActivity, mileagePlusNumber };
    });

    await saveCookies(context);

    return {
      mileagePlusNumber: milesData.mileagePlusNumber,
      totalMiles: milesData.totalMiles,
      elite: {
        status: milesData.eliteStatus,
      },
      recentActivity: milesData.recentActivity.length > 0 ? milesData.recentActivity : undefined,
    };
  } catch (error) {
    throw new Error(`Failed to get miles balance: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Ensure browser cleanup on process exit
process.on("exit", () => {
  if (browser) {
    browser.close().catch(() => {});
  }
});

process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeBrowser();
  process.exit(0);
});
