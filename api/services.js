// api/services.js
import redis from './_redis.js';

const allServices = [
  // Manicures
  { id: 'manicure-basic', name: 'Basic Manicure', duration: 30, price: 25, category: 'Manicures' },
  { id: 'manicure-deluxe', name: 'Deluxe Manicure', duration: 45, price: 40, category: 'Manicures' },
  { id: 'manicure-gel', name: 'Gel Manicure', duration: 60, price: 50, category: 'Manicures' },
  { id: 'manicure-acrylic', name: 'Acrylic Full Set', duration: 90, price: 65, category: 'Manicures' },
  { id: 'manicure-dip', name: 'Dip Powder Manicure', duration: 75, price: 55, category: 'Manicures' },

  // Pedicures
  { id: 'pedicure-basic', name: 'Basic Pedicure', duration: 45, price: 35, category: 'Pedicures' },
  { id: 'pedicure-deluxe', name: 'Deluxe Pedicure', duration: 60, price: 50, category: 'Pedicures' },
  { id: 'pedicure-gel', name: 'Gel Pedicure', duration: 75, price: 60, category: 'Pedicures' },
  { id: 'pedicure-spa', name: 'Spa Pedicure', duration: 90, price: 70, category: 'Pedicures' },
  { id: 'pedicure-athlete', name: "Athlete's Pedicure", duration: 60, price: 55, category: 'Pedicures' },

  // Massages
  { id: 'massage-swedish', name: 'Swedish Massage (60min)', duration: 60, price: 85, category: 'Massages' },
  { id: 'massage-deep', name: 'Deep Tissue (60min)', duration: 60, price: 95, category: 'Massages' },
  { id: 'massage-hotstone', name: 'Hot Stone (75min)', duration: 75, price: 110, category: 'Massages' },
  { id: 'massage-couples', name: 'Couples Massage (90min)', duration: 90, price: 160, category: 'Massages' },
  { id: 'massage-prenatal', name: 'Prenatal Massage (60min)', duration: 60, price: 90, category: 'Massages' },

  // Waxing Services
  { id: 'wax-brows', name: 'Eyebrow Wax', duration: 15, price: 20, category: 'Waxing' },
  { id: 'wax-lip', name: 'Lip Wax', duration: 10, price: 12, category: 'Waxing' },
  { id: 'wax-chin', name: 'Chin Wax', duration: 10, price: 15, category: 'Waxing' },
  { id: 'wax-underarm', name: 'Underarm Wax', duration: 20, price: 25, category: 'Waxing' },
  { id: 'wax-brazilian', name: 'Brazilian Wax', duration: 30, price: 55, category: 'Waxing' },
  { id: 'wax-legs', name: 'Full Leg Wax', duration: 45, price: 60, category: 'Waxing' },

  // Facials
  { id: 'facial-basic', name: 'Basic Facial', duration: 60, price: 75, category: 'Facials' },
  { id: 'facial-deluxe', name: 'Deluxe Facial', duration: 90, price: 120, category: 'Facials' },
  { id: 'facial-acne', name: 'Acne Treatment', duration: 75, price: 95, category: 'Facials' },
  { id: 'facial-antiage', name: 'Anti-Aging Facial', duration: 90, price: 130, category: 'Facials' },

  // Specialty Services
  { id: 'service-henna', name: 'Henna Tattoo', duration: 45, price: 35, category: 'Specialty' },
  { id: 'service-lash', name: 'Eyelash Extensions', duration: 120, price: 125, category: 'Specialty' },
  { id: 'service-brow', name: 'Microblading', duration: 120, price: 300, category: 'Specialty' }
];

// 👇 this is the part bookings.js will use
export async function ensureServicesSeeded() {
  const existingServices = await redis.sMembers('services:all');
  if (existingServices.length === 0) {
    await Promise.all(
      allServices.map(async (service) => {
        // store as a hash
        await redis.hSet(`service:${service.id}`, service);
        // store reference in the set
        await redis.sAdd('services:all', `service:${service.id}`);
      })
    );
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    await ensureServicesSeeded();
    const ids = await redis.sMembers('services:all');
    const services = await Promise.all(ids.map((id) => redis.hGetAll(id)));
    return res.status(200).json(services);
  } catch (err) {
    console.error('Error fetching services:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
