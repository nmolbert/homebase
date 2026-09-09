// First-run seed: everything from the three spreadsheets, so the app opens
// already populated with the household's plan and the full home manual.
import { Db, getSetting, insertRow, setSetting, uid } from "./db.ts";

export function seedIfEmpty(db: Db) {
  if (getSetting(db, "seeded", false)) return;
  seedAll(db);
  setSetting(db, "seeded", true);
}

export function seedAll(db: Db) {
  // ---- people ---------------------------------------------------------------
  const nick = insertRow(db, "people", { name: "Nick", color: "#1f6f5b", sort: 0 });
  const alex = insertRow(db, "people", { name: "Alex", color: "#b3562f", sort: 1 });

  // ---- settings defaults ----------------------------------------------------
  setSetting(db, "household_name", "Home Base");
  setSetting(db, "timezone", "America/Los_Angeles");
  setSetting(db, "mode", "prepurchase"); // 'prepurchase' | 'owner'
  setSetting(db, "home", {
    address: "",
    city: "",
    sqft: "",
    year_built: "",
    beds_baths: "",
    purchase_price: "",
    close_date: "",
    build_type: "new", // 'new' | 'resale'
    climate_note: "Location still TBD. Seasonal defaults assume a mild, freeze-free climate; edit the seasonal lists once you know the house.",
  });
  setSetting(db, "notify", {
    daily_hour: 8, // local hour for day-of reminders
    digest_day: 0, // 0 = Sunday
    digest_hour: 8,
    warranty_days: 90,
    email: true,
    push: true,
    budget_alerts: true,
  });
  setSetting(db, "budget_start_month", new Date().toISOString().slice(0, 7));

  // ---- accounts (Alex's sheet + room for individual ones) -------------------
  const jointChecking = insertRow(db, "accounts", { name: "Joint checking", type: "checking", sort: 0 });
  const jointHysa = insertRow(db, "accounts", { name: "Joint HYSA", type: "savings", sort: 1 });
  const taxHysa = insertRow(db, "accounts", { name: "Tax HYSA (1099 reserve)", type: "savings", sort: 2, on_budget: 0 });
  insertRow(db, "accounts", { name: "Nick — personal checking", type: "checking", owner_id: nick, sort: 3 });
  insertRow(db, "accounts", { name: "Alex — personal checking", type: "checking", owner_id: alex, sort: 4 });

  // ---- income sources (Alex's Salary tab) -----------------------------------
  insertRow(db, "income_sources", {
    person_id: alex, name: "UCLA — base salary + call", kind: "w2", gross_annual: 210000, tax_rate: 0.40,
    deferrals: JSON.stringify([{ name: "DCP (7% of $64,050)", amount: 4483.5 }, { name: "457(b)", amount: 12000 }]),
    notes: "$200k base + $10k additional call. Retirement deferrals come off before tax.", sort: 0,
  });
  insertRow(db, "income_sources", {
    person_id: alex, name: "Olive View — 1099 (21 h/wk @ $225/hr) + call", kind: "1099", gross_annual: 236800, tax_rate: 0.45,
    deferrals: "[]", notes: "$226,800 + $10k call. 45% set aside to the Tax HYSA every month.", sort: 1,
  });
  insertRow(db, "income_sources", {
    person_id: nick, name: "Nissim Tutoring — salary", kind: "w2", gross_annual: 90000, tax_rate: 0.35,
    deferrals: JSON.stringify([{ name: "401(k) 7%", amount: 6300 }]), notes: "", sort: 2,
  });
  insertRow(db, "income_sources", {
    person_id: nick, name: "Personal training — 1099", kind: "1099", gross_annual: 24000, tax_rate: 0.45,
    deferrals: "[]", notes: "Client sessions + new signups. 45% reserved for tax.", sort: 3,
  });

  // ---- categories (Nick's Monthly Budget tab) -------------------------------
  const cats: [string, string, number?, string?][] = [
    ["Housing", "Mortgage / Rent"], ["Housing", "Property Tax"], ["Housing", "Homeowners / Renters Insurance"],
    ["Housing", "HOA Fees"], ["Housing", "Home Maintenance & Repairs", 0, "maintenance"],
    ["Housing", "Home Improvements", 0, "improvement"],
    ["Utilities", "Electricity & Gas"], ["Utilities", "Water & Sewer"], ["Utilities", "Internet & Cable"], ["Utilities", "Phone"],
    ["Transportation", "Car Payment"], ["Transportation", "Auto Insurance"], ["Transportation", "Gas / Fuel"],
    ["Transportation", "Car Maintenance & Repairs"], ["Transportation", "Parking & Tolls"],
    ["Food", "Groceries"], ["Food", "Dining Out & Takeout"],
    ["Health & Fitness", "Health Insurance"], ["Health & Fitness", "Medical & Dental"],
    ["Health & Fitness", "Gym / Training Supplies"], ["Health & Fitness", "Supplements"],
    ["Personal", "Clothing & Personal Care"], ["Personal", "Subscriptions (Streaming/Apps)"], ["Personal", "Hobbies & Entertainment"],
    ["Debt Payments", "Credit Card Payments"], ["Debt Payments", "Student Loans", 1000],
    ["Savings & Investing", "Emergency Fund"], ["Savings & Investing", "Retirement (401k / Roth IRA)"],
    ["Savings & Investing", "Brokerage / Investing"], ["Savings & Investing", "Home Down Payment Fund"],
    ["Savings & Investing", "Honeymoon Fund"],
    ["Business (Coaching/Marketing)", "Marketing Tools & Software"], ["Business (Coaching/Marketing)", "Coaching Certifications / CEUs"],
    ["Business (Coaching/Marketing)", "Business Travel"],
    ["Insurance", "Life Insurance"], ["Insurance", "Disability Insurance"],
    ["Giving", "Charitable Donations"], ["Giving", "Gifts"],
    ["Miscellaneous", "Pet Care"], ["Miscellaneous", "Miscellaneous / Unexpected"],
  ];
  const catIds: Record<string, string> = {};
  cats.forEach(([g, n, b, link], i) => {
    catIds[n] = insertRow(db, "categories", { group_name: g, name: n, kind: "expense", monthly_budget: b ?? 0, home_link: link ?? null, sort: i });
  });
  const incomeCats: [string, string][] = [
    ["Income", "Salary / Paycheck"], ["Income", "1099 / Contract Pay"], ["Income", "Coaching Income"],
    ["Income", "Bonus / Commission"], ["Income", "Interest & Dividends"], ["Income", "Other Income"],
  ];
  incomeCats.forEach(([g, n], i) => {
    catIds[n] = insertRow(db, "categories", { group_name: g, name: n, kind: "income", sort: 100 + i });
  });
  catIds["Transfer"] = insertRow(db, "categories", { group_name: "Transfers", name: "Transfer between accounts", kind: "transfer", sort: 200 });

  // ---- paycheck plan / allocations (Alex's Monthly spending tab) ------------
  insertRow(db, "allocations", { name: "Mortgage (estimate until the house is bought)", kind: "fixed", amount: 14000, category_id: catIds["Mortgage / Rent"], sort: 0 });
  insertRow(db, "allocations", { name: "Alex — student loan payment", kind: "fixed", amount: 1000, category_id: catIds["Student Loans"], sort: 1 });
  insertRow(db, "allocations", { name: "Joint HYSA savings", kind: "transfer", amount: 5000, account_id: jointHysa, sort: 2 });
  insertRow(db, "allocations", { name: "1099 tax reserve → Tax HYSA", kind: "tax_reserve", amount: 0, account_id: taxHysa, notes: "Computed from every 1099 source's tax rate.", sort: 3 });

  // ---- goals (Nick's Savings Goals tab) -------------------------------------
  insertRow(db, "goals", { name: "Home Down Payment", target: 352600, target_date: "2026-10-01", account_id: jointHysa, notes: "Target ~20% of $1.763M purchase price", sort: 0 });
  insertRow(db, "goals", { name: "Honeymoon Fund", target: 15000, target_date: "2026-12-01", notes: "~200k Chase UR points already earmarked separately", sort: 1 });
  insertRow(db, "goals", { name: "Emergency Fund", target: 30000, target_date: "2026-12-31", notes: "Aim for 3–6 months of expenses", sort: 2 });
  insertRow(db, "goals", { name: "Long-Term Investing / Wealth Building", target: 0, target_date: "2030-01-01", notes: "Ongoing brokerage/retirement contributions — set a target if desired", sort: 3 });

  // ---- home: systems + appliances (Home Vitals, Appliances, Manuals tabs) ---
  const systems: [string, number?][] = [
    ["Furnace / Heating", 18], ["Central A/C / Heat Pump", 15], ["Water Heater", 10], ["Roof", 25],
    ["Electrical Panel", 30], ["Main Water Shutoff"], ["Gas Shutoff"], ["Sump Pump / Drainage"],
    ["Sewer / Septic", 40], ["Windows", 25], ["Garage Door / Opener", 12], ["Irrigation / Sprinklers", 10],
    ["Chimney / Fireplace"], ["Foundation / Slab"], ["Solar System", 27], ["Thermostat", 10],
  ];
  const assetIds: Record<string, string> = {};
  systems.forEach(([n, life], i) => {
    assetIds[n] = insertRow(db, "assets", { category: "system", name: n, lifespan_years: life ?? null, sort: i });
  });
  const appliances: [string, number][] = [
    ["Refrigerator", 13], ["Range / Oven", 15], ["Dishwasher", 10], ["Microwave", 9], ["Washer", 11],
    ["Dryer", 13], ["Range Hood / Vent", 14], ["Garbage Disposal", 10], ["Water Softener / Filter", 12],
  ];
  appliances.forEach(([n, life], i) => {
    assetIds[n] = insertRow(db, "assets", { category: "appliance", name: n, lifespan_years: life, sort: 50 + i });
  });

  // ---- maintenance tasks (Maintenance + Reminders tabs) ---------------------
  const tasks: [string, string, number, string?, string?, number?][] = [
    // name, area, every months, notes, asset, est cost
    ["Replace HVAC air filter", "HVAC", 2, "Filter size is on the Central A/C record", "Central A/C / Heat Pump", 20],
    ["Test smoke & CO detectors", "Safety", 1, "Push the test button on each"],
    ["Clean range hood filter", "Kitchen", 1, "Degrease in hot soapy water", "Range Hood / Vent"],
    ["Clean dishwasher filter", "Kitchen", 1, "Bottom-center of the tub", "Dishwasher"],
    ["Test GFCI / AFCI outlets", "Safety", 1, "Press TEST then RESET on each"],
    ["Run water in unused drains", "Plumbing", 1, "Keeps traps full so sewer gas stays out"],
    ["Clean garbage disposal", "Kitchen", 3, "Ice + vinegar; run cold water", "Garbage Disposal"],
    ["Replace fridge water filter", "Kitchen", 6, "Note the filter part number on the fridge record", "Refrigerator", 50],
    ["Inspect / clean gutters", "Exterior", 6, "Spring and fall — after leaves drop, before rains", undefined, 150],
    ["Review Home Base records", "Admin", 6, "Log the year's improvements, vendors, receipts"],
    ["Flush water heater", "Plumbing", 12, "Drain sediment; extends its life", "Water Heater"],
    ["HVAC professional service", "HVAC", 12, "Book the tech from Vendors — spring, before the heat", "Central A/C / Heat Pump", 200],
    ["Replace detector batteries", "Safety", 12, "Even hardwired units have backups"],
    ["Deep clean dryer vent", "Laundry", 12, "Lint buildup is a fire risk", "Dryer", 120],
    ["Reseal grout / caulk (wet areas)", "Bathrooms", 12, "Tubs, showers, sinks", undefined, 40],
    ["Inspect roof & flashing", "Exterior", 12, "Binoculars are fine; note anything odd", "Roof"],
    ["Test sump pump", "Plumbing", 12, "Pour water in the pit; it should kick on", "Sump Pump / Drainage"],
    ["Service irrigation", "Yard", 12, "Adjust for the season", "Irrigation / Sprinklers", 100],
    ["Chimney inspection / sweep", "Safety", 12, "Only if there is a fireplace", "Chimney / Fireplace", 200],
    ["Review homeowners insurance", "Admin", 12, "Check coverage against the Home Inventory total"],
    ["Lubricate & test garage door", "Exterior", 12, "Lube rollers; test balance and auto-reverse", "Garage Door / Opener"],
    ["Touch up exterior paint / seal deck", "Exterior", 30, "Every 2–3 years", undefined, 500],
    ["Replace washer supply hoses", "Laundry", 60, "$10 hoses prevent four-figure floods", "Washer", 30],
    ["Replace braided supply lines (toilets/sinks)", "Plumbing", 60, "Cheapest insurance in the house", undefined, 60],
    ["Check water pressure / PRV", "Plumbing", 48, "Failing regulator = pressure creep", undefined, 0],
  ];
  tasks.forEach(([n, area, months, notes, asset, cost], i) => {
    insertRow(db, "maintenance_tasks", {
      name: n, area, interval_months: months, notes: notes ?? "", asset_id: asset ? assetIds[asset] : null,
      est_cost: cost ?? 0, sort: i,
    });
  });

  // ---- warranties (Warranty Tracker tab) ------------------------------------
  const warr: [string, string, string, string, number?, string?][] = [
    ["Builder", "Workmanship / fit & finish", "Builder", "Cosmetic & finish defects — drywall, paint, trim, tile", 12],
    ["Builder", "Systems", "Builder", "Plumbing, electrical, HVAC, ductwork defects", 24],
    ["Builder", "Structural", "Builder / warranty co.", "Major structural elements — foundation, framing, load-bearing", 120],
    ["Systems & exterior", "Roof", "Roofing mfr + installer", "Material + workmanship", undefined, "Roof"],
    ["Systems & exterior", "Water heater", "Mfr (label on unit)", "Tank / heat exchanger — varies by model", undefined, "Water Heater"],
    ["Systems & exterior", "HVAC equipment", "Mfr + installer", "Compressor & parts (often needs registration!)", undefined, "Central A/C / Heat Pump"],
    ["Systems & exterior", "Windows", "Window mfr", "Glass seals & frames", undefined, "Windows"],
    ["Systems & exterior", "Garage door opener", "Mfr", "Motor & parts", 12, "Garage Door / Opener"],
    ["Systems & exterior", "Solar panels", "Solar mfr", "Panel performance", 300, "Solar System"],
    ["Systems & exterior", "Solar inverter", "Solar mfr", "Inverter unit", 144, "Solar System"],
    ["Systems & exterior", "Solar workmanship", "Installer", "Install / roof penetration", 120, "Solar System"],
    ["Appliances", "Refrigerator", "Mfr", "Parts & labor", 12, "Refrigerator"],
    ["Appliances", "Range / oven", "Mfr", "Parts & labor", 12, "Range / Oven"],
    ["Appliances", "Dishwasher", "Mfr", "Parts & labor", 12, "Dishwasher"],
    ["Appliances", "Microwave", "Mfr", "Parts & labor", 12, "Microwave"],
    ["Appliances", "Range hood", "Mfr", "Parts & labor", 12, "Range Hood / Vent"],
    ["Appliances", "Washer", "Mfr", "Parts & labor", 12, "Washer"],
    ["Appliances", "Dryer", "Mfr", "Parts & labor", 12, "Dryer"],
  ];
  warr.forEach(([g, n, p, c, months, asset], i) => {
    insertRow(db, "warranties", { group_name: g, name: n, provider: p, covers: c, length_months: months ?? null, asset_id: asset ? assetIds[asset] : null, sort: i });
  });

  // ---- vendors (trade placeholders) -----------------------------------------
  ["Plumber", "Electrician", "HVAC Tech", "Handyman", "Roofer", "Landscaper / Gardener", "Pest Control",
    "House Cleaner", "Appliance Repair", "Painter", "General Contractor", "Home Insurance Agent"]
    .forEach((t, i) => insertRow(db, "vendors", { trade: t, sort: i }));

  // ---- documents ------------------------------------------------------------
  ["Purchase Agreement", "Closing Disclosure / Settlement", "Deed", "Title Insurance Policy", "Property Survey / Plat",
    "Home Inspection Report", "Seller Disclosures", "Homeowners Insurance Policy", "Property Tax Records",
    "Mortgage / Loan Documents", "HOA Docs / CC&Rs", "Permits & Certificates of Occupancy",
    "Appliance Manuals & Warranties", "Paint / Materials Receipts", "Contractor Contracts & Warranties",
    "Builder Warranty Booklet", "As-built Plans / Pre-drywall Photos"]
    .forEach((n, i) => insertRow(db, "documents", { name: n, sort: i }));

  // ---- utilities ------------------------------------------------------------
  ["Electric", "Natural gas", "Water / sewer", "Trash & recycling", "Internet", "Solar (lease/PPA?)",
    "Home / pest service", "HOA dues", "Streaming / other"]
    .forEach((s, i) => insertRow(db, "utilities", { service: s, sort: i }));

  // ---- emergency quick reference -------------------------------------------
  const em: [string, string, string?][] = [
    ["Shutoffs", "Water main shutoff", "Location + which way to turn. Photo helps."],
    ["Shutoffs", "Gas shutoff", "Location. Needs a wrench — don't turn back on yourself."],
    ["Shutoffs", "Main electrical breaker", "Panel location + main breaker position."],
    ["Shutoffs", "Water heater shutoff", "Cold-in valve + gas/breaker for it."],
    ["Contacts", "Gas company (emergency)", "24/7 leak line"],
    ["Contacts", "Electric utility (outages)"], ["Contacts", "Water / sewer utility"],
    ["Contacts", "Plumber", "From Vendors"], ["Contacts", "Electrician"], ["Contacts", "HVAC"],
    ["Contacts", "Builder warranty line", "First years only"], ["Contacts", "Insurance claims (24/7)", "Policy # too"],
    ["Contacts", "Non-emergency police"], ["Contacts", "Poison control", "1-800-222-1222 (US)"],
    ["If this happens…", "Burst pipe / flooding", "Shut water main → kill power to area → call plumber"],
    ["If this happens…", "Smell of gas", "Leave now → call gas co from outside → don't use switches/phone inside"],
    ["If this happens…", "Power outage", "Check main breaker → check utility outage map → report"],
    ["If this happens…", "No hot water", "Check water-heater breaker/pilot → then call"],
    ["If this happens…", "Sewage backup", "Stop using water → call plumber"],
  ];
  em.forEach(([s, l, note], i) => {
    const isScenario = s.startsWith("If");
    insertRow(db, "emergency", { section: s, label: l, value: isScenario ? note : "", note: isScenario ? "" : note ?? "", sort: i });
  });

  // ---- lifespans reference --------------------------------------------------
  const life: [string, string, string, string, string, string, number | null, string][] = [
    ["Heating, cooling & air", "Central A/C (condenser)", "Split system", "Rinse coil; keep clear; change filter", "Pro service yearly", "15–20 yrs", 15, "High runtime in hot climates — annual service earns its keep. Shade on the unit helps."],
    ["Heating, cooling & air", "Furnace", "Gas", "Annual safety & burner check", "Yearly", "15–25 yrs", 18, "If all-electric build, you'll have a heat pump instead."],
    ["Heating, cooling & air", "Heat pump", "All-electric", "Annual service; keep coils clear", "Yearly", "12–18 yrs", 15, "Does both heating & cooling, so more runtime than a furnace. Common in new CA builds."],
    ["Heating, cooling & air", "Ductwork", "Sheet metal/flex", "Inspect & seal leaks", "Every 3–5 yrs", "20–30+ yrs", 25, "Sealed ducts cut A/C bills noticeably."],
    ["Heating, cooling & air", "Thermostat", "Smart", "—", "Replace when dated", "8–12 yrs", 10, "Software support ends before the hardware fails, usually."],
    ["Heating, cooling & air", "Air filter", "1\" or media", "Replace", "Every 1–3 months", "—", null, "Tracked on the Maintenance page."],
    ["Roofing & exterior", "Roof — asphalt shingle", "Architectural", "Inspect after storms", "Yearly", "20–30 yrs", 25, "KEEP IF your roof is shingle. Sun & heat age shingles faster."],
    ["Roofing & exterior", "Roof — tile", "Clay / concrete", "Inspect; replace cracked tiles", "Yearly", "Tiles 50+ yrs", 50, "KEEP IF tile. The tiles last decades but the underlayment beneath is the real clock."],
    ["Roofing & exterior", "↳ tile underlayment", "Felt / synthetic", "Replaced when re-roofing", "—", "20–30 yrs", 25, "This — not the tile — is what you'll actually re-do. Budget for it."],
    ["Roofing & exterior", "Roof — flat", "TPO / foam", "Inspect; recoat foam", "Yearly (recoat ~5 yr)", "15–25 yrs", 20, "KEEP IF flat. Foam roofs need periodic recoating to hit the long end."],
    ["Roofing & exterior", "Gutters", "Aluminum", "Clean out", "Twice a year", "20–30 yrs", 25, "Spring & fall are on the Maintenance page."],
    ["Roofing & exterior", "Exterior paint", "—", "Wash; touch up", "Repaint every 7–10 yr", "7–10 yrs", 8, "Stucco itself lasts 50+; it's the paint/coat that refreshes."],
    ["Roofing & exterior", "Exterior caulk / sealant", "Windows, trim", "Reseal cracked joints", "Every ~5 yrs", "5 yrs", 5, "Cheap; prevents water intrusion."],
    ["Roofing & exterior", "Windows", "Dual-pane vinyl", "Clean tracks; check seals", "—", "20–30 yrs", 25, "Foggy glass = failed seal, often replaceable per-pane."],
    ["Roofing & exterior", "Garage door opener", "Belt/chain", "Lube; test balance & auto-reverse", "Yearly", "10–15 yrs", 12, "The door itself lasts 20–30 yrs; the opener is the shorter clock."],
    ["Roofing & exterior", "Solar panels", "Rooftop PV", "Rinse; monitor output", "Inspect yearly", "25–30 yrs", 27, "CA mandates solar on most new builds. Panels are warrantied ~25 yr."],
    ["Roofing & exterior", "↳ solar inverter", "String / micro", "—", "Monitor", "10–15 yrs", 12, "The inverter fails well before the panels — plan for one swap in the panels' life."],
    ["Water & plumbing", "Water heater — tank", "Gas / electric", "Flush sediment yearly", "Yearly", "8–12 yrs", 10, "KEEP IF you have a tank. Flushing yearly meaningfully extends it."],
    ["Water & plumbing", "Water heater — tankless", "Gas", "Descale / flush yearly", "Yearly", "15–20 yrs", 18, "KEEP IF tankless. Descaling matters most where water is hard."],
    ["Water & plumbing", "Water heater — heat pump", "Hybrid electric", "Clean air filter & coil", "Yearly", "10–15 yrs", 13, "KEEP IF a hybrid/heat-pump unit — increasingly common in new CA builds."],
    ["Water & plumbing", "Pressure regulator (PRV)", "Inline", "Check house pressure", "Every 3–5 yrs", "7–12 yrs", 10, "Failing PRV = pressure creep that stresses everything downstream."],
    ["Water & plumbing", "Braided supply lines", "Washer/toilet/sink", "Replace proactively", "Every 5–8 yrs", "5–8 yrs", 5, "$10 hoses prevent four-figure floods."],
    ["Water & plumbing", "Garbage disposal", "1/2–3/4 hp", "Run cold water; ice-clean", "—", "8–12 yrs", 10, ""],
    ["Water & plumbing", "Toilet internals", "Flapper/fill valve", "Replace when running", "—", "4–5 yrs", 5, "The toilet lasts decades; the guts wear out."],
    ["Water & plumbing", "Sewer lateral", "PVC/ABS", "Camera inspect", "Every 3–5 yrs", "Decades", 40, "Avoid flushing wipes."],
    ["Kitchen appliances", "Refrigerator", "French-door", "Clean coils; swap water filter", "Filter ~6 mo", "10–15 yrs", 13, "Coil cleaning yearly keeps it efficient."],
    ["Kitchen appliances", "Dishwasher", "Built-in", "Clean filter; wipe seals", "Filter monthly", "9–12 yrs", 10, "Builder-grade units cluster at the lower end."],
    ["Kitchen appliances", "Range / oven", "Gas or electric", "Clean; check burners/elements", "—", "13–16 yrs", 15, ""],
    ["Kitchen appliances", "Microwave", "Over-the-range", "Clean vent filter", "Filter monthly", "8–10 yrs", 9, "Shortest-lived kitchen appliance, usually."],
    ["Kitchen appliances", "Range hood", "Vented", "Degrease filter", "Monthly", "12–15 yrs", 14, ""],
    ["Laundry", "Washer", "Front/top load", "Clean gasket; replace hoses", "Hoses every 5 yr", "10–13 yrs", 11, "Leave the door ajar to prevent gasket mildew (front-loaders)."],
    ["Laundry", "Dryer", "Electric/gas", "Clean lint every load; vent yearly", "Vent yearly", "12–14 yrs", 13, "Lint in the vent duct is a genuine fire risk."],
    ["Other systems", "Electrical panel", "200A", "Inspect if issues", "—", "25–40 yrs", 30, ""],
    ["Other systems", "GFCI / AFCI outlets", "Kitchen/bath", "Push test button", "Monthly", "10–15 yrs", 12, "If the test button won't reset, replace it."],
    ["Other systems", "Smoke detectors", "Hardwired", "Test; change battery yearly", "Test monthly", "10 yrs", 10, "Replace the whole unit at 10 yrs — the sensor degrades."],
    ["Other systems", "CO detectors", "Hardwired", "Test monthly", "Test monthly", "5–7 yrs", 7, "Shorter replacement clock than smoke alarms."],
    ["Other systems", "Irrigation system", "Drip/spray", "Seasonal check; adjust", "Seasonally", "Controller ~10 yr", 10, "Valves last 15–20 yrs; the controller is the shorter part."],
    ["Other systems", "Fire extinguisher", "Kitchen ABC", "Check gauge", "—", "10–12 yrs", 11, "Replace or service when the needle leaves green."],
  ];
  life.forEach(([sec, item, variant, care, interval, lifespan, plan, notes], i) => {
    insertRow(db, "lifespans", { section: sec, item, variant, care, interval, lifespan, plan_years: plan, notes, sort: i });
  });

  // ---- checklists -----------------------------------------------------------
  const add = (list: string, rows: (string | [string, string?, string?, string?, string?])[], section?: string) => {
    rows.forEach((r, i) => {
      const [text, detail, priority, fills, applies] = Array.isArray(r) ? r : [r];
      insertRow(db, "checklist_items", { list, section: section ?? null, text, detail: detail ?? null, priority: priority ?? null, fills: fills ?? null, applies_to: applies ?? null, sort: i + (section ? sectionOffset(section) : 0) });
    });
  };
  const sectionOffsets: Record<string, number> = {};
  let nextOffset = 0;
  function sectionOffset(s: string) {
    if (!(s in sectionOffsets)) { sectionOffsets[s] = nextOffset; nextOffset += 100; }
    return sectionOffsets[s];
  }

  add("escrow", [
    ["Save the full inspection report (PDF)", "After inspection"], ["Save all seller disclosures", "In contract"],
    ["Save the seller's property info / repair history", "In contract"], ["Get the appliance list & any manuals from seller", "Before close"],
    ["Ask seller for paint colors / finishes used", "Before close"], ["Ask seller for their vendor list (who serviced what)", "Before close"],
    ["Request permit history from the city / county", "Due diligence"], ["Save the property survey / plat map", "Due diligence"],
    ["Note the age of roof, HVAC, water heater (from inspection)", "After inspection"], ["Photograph the electrical panel & any labels", "Final walkthrough"],
    ["Photograph & locate all shutoffs (water, gas)", "Final walkthrough"], ["Photograph serial plates on major appliances", "Final walkthrough"],
    ["Confirm which appliances/fixtures convey with the sale", "In contract"], ["Save HOA docs / CC&Rs if applicable", "Due diligence"],
    ["Save the closing disclosure & settlement statement", "At close"], ["Get all keys, remotes, garage codes, gate fobs", "At close"],
    ["Note purchase price & date (your cost basis starts here)", "At close"],
  ]);
  add("first30", [
    ["Change / rekey all exterior locks", "", "High"], ["Locate & label the main water shutoff", "", "High"],
    ["Locate & label the gas shutoff", "", "High"], ["Find the electrical panel & map every breaker", "", "High"],
    ["Test all smoke & CO detectors; replace batteries", "", "High"], ["Replace HVAC air filter", "", "High"],
    ["Set up homeowners insurance & save the policy", "", "High"], ["Transfer / set up utilities (power, gas, water, internet)", "", "High"],
    ["Note every appliance model & serial (Systems & Appliances page)", "", "Medium"], ["Note system details & ages (Systems & Appliances page)", "", "Medium"],
    ["Film an insurance video walkthrough of belongings", "", "Medium"], ["Locate water heater; note age & set temp (~120°F)", "", "Medium"],
    ["Find & test the garage door manual release", "", "Medium"], ["Update address (USPS, banks, licenses, subscriptions)", "", "Medium"],
    ["Register every appliance with its manufacturer", "", "Medium"], ["Program thermostat / set up smart home", "", "Low"],
    ["Deep clean before furniture arrives", "", "Low"], ["Meet the neighbors; note trash / recycling days", "", "Low"],
    ["Locate breaker for each major appliance & label", "", "Low"],
  ]);
  const q = (section: string, rows: [string, string, string][]) =>
    add("questions", rows.map(([t, fills, applies]) => [t, "", "", fills, applies] as [string, string, string, string, string]), section);
  q("Warranties", [
    ["Exact length of the workmanship, systems, and structural warranties?", "Warranties", "New"],
    ["When does each warranty clock start — closing or certificate of occupancy?", "Warranties", "New"],
    ["Who administers the structural warranty (e.g. a third party like 2-10)?", "Warranties", "New"],
    ["Can I have a copy of the warranty booklet?", "Documents", "New"],
    ["How do I submit claims — and is there a formal 11-month process?", "Warranties", "New"],
  ]);
  q("Systems & specs", [
    ["HVAC make, model, and SEER rating?", "Systems", "Both"],
    ["Water heater type (tank / tankless / heat pump) and capacity?", "Systems", "Both"],
    ["Roof material and its manufacturer warranty length?", "Lifespans", "Both"],
    ["Window brand and warranty?", "Systems", "Both"], ["Electrical panel size (amps)?", "Systems", "Both"],
    ["Full appliance list with model numbers, plus the manuals?", "Appliances", "Both"],
  ]);
  q("Solar", [
    ["Is the solar owned, leased, or a PPA?", "Utilities", "New"],
    ["If leased/PPA, what are the exact terms I'd inherit?", "Documents", "New"],
    ["Who warranties the panels and the inverter, and for how long?", "Warranties", "New"],
  ]);
  q("Behind the walls", [
    ["Can I get the plumbing & electrical rough-in photos (pre-drywall)?", "Documents", "New"],
    ["Can I get the as-built plans?", "Documents", "New"],
    ["Where are all the shutoffs — is there a manifold / panel diagram?", "Emergency", "Both"],
  ]);
  q("The build", [
    ["Who are the subcontractors (roofer, plumber, HVAC, electrician)?", "Vendors", "New"],
    ["Is there a certificate of occupancy?", "Documents", "New"], ["Were all permits finaled / closed out?", "Documents", "Both"],
  ]);
  q("Ongoing", [
    ["Is there an HOA? What are the dues and CC&Rs?", "Utilities", "Both"], ["Who are the utility providers?", "Utilities", "Both"],
    ["Typical monthly utility costs for a comparable unit?", "Utilities", "Both"],
  ]);
  q("If it's a resale", [
    ["Age of the roof, HVAC, and water heater — with receipts?", "Systems", "Resale"],
    ["What have you repaired or replaced — any transferable warranties?", "Projects", "Resale"],
    ["Any recurring issues — leaks, drainage, pests?", "Systems", "Resale"],
    ["Which vendors have you trusted for work here?", "Vendors", "Resale"],
    ["What paint colors / brands did you use, by room?", "Paint & finishes", "Resale"],
    ["Can I see the seller disclosures and permit history for past work?", "Documents", "Resale"],
  ]);
  add("closing", [
    ["Walls & ceilings", "Dents, scuffs, nail pops, paint drips, uneven texture"], ["Trim & doors", "Gaps, caulk lines, doors that stick or don't latch"],
    ["Floors", "Scratches, cracked tiles, loose planks, squeaks, gaps"], ["Windows", "Scratches, broken seals, smooth operation, screens present"],
    ["Cabinets & counters", "Chips, misaligned doors, drawer glides, seams"], ["Fixtures & faucets", "Leaks, water pressure, hot/cold correct, drainage"],
    ["Appliances", "All present, powered, run a test cycle"], ["Outlets & switches", "Every one works; test GFCIs; cover plates on"],
    ["HVAC", "Heating AND cooling both blow at every vent"], ["Exterior", "Stucco/siding finish, paint, grading away from house"],
    ["Garage", "Door opens/reverses, weather seal, no cracks"],
  ]);
  add("walkthrough11", [
    ["Drywall cracks", "Settling cracks at corners, over doors/windows"], ["Nail pops", "Popped screws/nails showing through paint"],
    ["Doors out of square", "Sticking, gaps, latches that have shifted"], ["Grout & caulk", "Cracked or shrunk grout/caulk in wet areas"],
    ["Tile & flooring", "New cracks, lifting, hollow spots"], ["Windows & seals", "Fogging (failed seal), drafts, hard operation"],
    ["Roof & attic", "Stains, daylight, displaced insulation (if accessible)"], ["Plumbing", "Any slow leaks under sinks, at water heater, hose bibs"],
    ["Exterior cracks", "Stucco/foundation cracks, separation at joints"], ["Concrete", "Driveway/walkway cracks beyond hairline"],
    ["HVAC performance", "Uneven rooms, noises, weak airflow"], ["Electrical", "Any dead outlets, tripping breakers, flickering"],
    ["Water intrusion", "Stains at ceilings, base of walls, around windows"],
  ]);
  add("seasonal_spring", [
    ["Change HVAC filter & book A/C service before summer", "Beat the heat-wave rush", "HVAC"],
    ["Test smoke & CO detectors; check fire extinguisher", "", "Safety"], ["Clear gutters & check roof after winter rains", "", "Exterior"],
    ["Visual leak check — under sinks, water heater, hose bibs", "", "Plumbing"], ["Replace fridge water filter; clean dishwasher filter", "", "Appliances"],
    ["Clean behind/under fridge, bathroom fans, dryer vent", "", "Cleaning"], ["Deep clean; air out screens & patio furniture", "", "Cleaning"],
    ["Service irrigation; set summer watering schedule", "", "Yard"], ["Audit phone subscriptions for anything to cancel", "Settings → your name → Subscriptions", "Digital"],
    ["Update phone/computer apps & back up photos", "", "Digital"],
  ]);
  add("seasonal_fall", [
    ["Change HVAC filter; test heating before it's needed", "", "HVAC"], ["Clear gutters before the rainy season", "", "Exterior"],
    ["Re-test smoke & CO detectors; replace batteries", "", "Safety"], ["Reseal grout & caulk in wet areas", "", "Bathrooms"],
    ["Flush water heater (yearly)", "", "Plumbing"], ["Trim back dry brush / clear flammables near the house", "Good practice anywhere", "Fire"],
    ["Check weatherstripping & door seals", "", "Exterior"], ["Review home insurance vs. Home Inventory value", "", "Admin"],
    ["Log the year's improvements in Home Base", "", "Admin"], ["Audit subscriptions again; update apps", "", "Digital"],
    ["Winterize outdoor plumbing (only if you get freezes)", "Skip in freeze-free climates", "Plumbing"],
  ]);
}
