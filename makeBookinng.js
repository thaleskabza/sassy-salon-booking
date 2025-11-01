// seed-november-bookings.js
// run with: node seed-november-bookings.js

const BASE_URL = 'http://localhost:3000/api/bookings';

// how many fake bookings to create
const TOTAL = 30;

// your existing service ids in Redis (update to your real ones)
const SERVICE_IDS = [
  'facial-deluxe',
  'facial-antiage',
  'mani-basic',
  'pedicure',
  'makeup',
  'hair-braids',
];

// some SA-ish first/last names
const FIRST_NAMES = [
  'Kabelo', 'Thandi', 'Lerato', 'Sipho', 'Nandi',
  'Sibusiso', 'Kyle', 'Elizabeth', 'Anele', 'Boitumelo',
  'Karabo', 'Ayanda', 'Noluthando', 'Zanele', 'Tshepo',
];

const LAST_NAMES = [
  'Modipa', 'Mkhize', 'Nkosi', 'Petersen', 'Naidoo',
  'van der Merwe', 'Molefe', 'Mabaso', 'Ngcobo', 'Mokgadi',
  'Bolton', 'Flynn', 'Dlamini', 'Mthethwa', 'Khumalo',
];

// helper to get random item
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// generate unique-ish email per booking
function makeEmail(first, last, idx) {
  const safeLast = last.toLowerCase().replace(/\s+/g, '');
  const safeFirst = first.toLowerCase();
  return `${safeFirst}.${safeLast}.${idx}@demo.local`;
}

// SA-style cellphone: 0 + 2 digits + 7 digits
function makeCell(idx) {
  // cycle prefixes
  const prefixes = ['083', '084', '061', '067', '073', '074'];
  const prefix = prefixes[idx % prefixes.length];
  const tail = String(1000000 + idx * 13).padStart(7, '0').slice(-7);
  return `${prefix}${tail}`;
}

// generate a random November 2025 date/time in salon hours
function makeRandomNovDate() {
  // November 2025 is 1–30 November
  const day = 1 + Math.floor(Math.random() * 30); // 1..30
  // salon hours: 08:00 to 16:00 — choose a slot
  const hourSlots = [8, 9, 10, 11, 12, 13, 14, 15];
  const hour = pick(hourSlots);
  const minute = Math.random() > 0.5 ? 30 : 0; // 00 or 30

  // build date in local time (South Africa +02:00)
  const d = new Date(Date.UTC(2025, 9, day, hour - 2, minute, 0)); 
  // 10 = November (0-based), and we subtract 2h to make final ISO align to +02:00 visually

  return d.toISOString(); // e.g. 2025-11-12T08:30:00.000Z
}

// main
(async function seed() {
  console.log(`Seeding ${TOTAL} bookings for November 2025 ...`);

  for (let i = 0; i < TOTAL; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const customer_name = `${first} ${last}`;
    const email = makeEmail(first, last, i + 1);
    const cellphone = makeCell(i + 1);
    const service_id = pick(SERVICE_IDS);
    const start_time = makeRandomNovDate();

    const payload = {
      customer_name,
      email,
      cellphone,
      service_id,
      start_time,
      // we LET the API calculate end_time from service.duration
      // and we LET the API allocate employee (RR)
    };

    try {
      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error(`❌ ${i + 1}/${TOTAL} failed -> ${res.status}: ${txt}`);
      } else {
        const json = await res.json();
        console.log(
          `✅ ${i + 1}/${TOTAL} booked: ${json.customer_name} → ${json.service_id} @ ${json.start_time} (emp: ${json.employee_id || 'auto'})`
        );
      }
    } catch (err) {
      console.error(`❌ ${i + 1}/${TOTAL} error`, err);
    }
  }

  console.log('Done.');
})();
