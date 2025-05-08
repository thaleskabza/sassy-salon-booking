import redis from './_redis.js';
import { nanoid } from 'nanoid';

async function fetchAllBookings() {
  const keys = await redis.sMembers('bookings:all');
  return Promise.all(
    keys.map(key => redis.hGetAll(key))
  );
}

async function validateService(service_id) {
  const exists = await redis.exists(`service:${service_id}`);
  if (!exists) {
    throw new Error(`Service ${service_id} not found`);
  }
  return redis.hGetAll(`service:${service_id}`);
}

async function checkBookingConflict(service_id, start_time, end_time) {
  const allBookings = await fetchAllBookings();
  return allBookings.some(booking => {
    const bookingStart = new Date(booking.start_time);
    const bookingEnd = new Date(booking.end_time);
    const newStart = new Date(start_time);
    const newEnd = new Date(end_time);
    
    return (
      booking.service_id === service_id &&
      !(newEnd <= bookingStart || newStart >= bookingEnd)
    );
  });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const { from, to, cellphone } = req.query;
      let all = await fetchAllBookings();
      
      if (from && to) {
        const start = new Date(from), end = new Date(to);
        all = all.filter(b => new Date(b.start_time) >= start && new Date(b.end_time) <= end);
      }
      if (cellphone) {
        all = all.filter(b => b.cellphone === cellphone);
      }
      return res.status(200).json(all);
    } catch (err) {
      console.error('Error listing bookings:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { customer_name, email, cellphone, service_id, start_time } = req.body;
      
      // Validate service exists
      const service = await validateService(service_id);
      
      // Calculate end time
      const durationMs = Number(service.duration) * 60000;
      const end_time = new Date(new Date(start_time).getTime() + durationMs).toISOString();
      
      // Check for booking conflicts
      if (await checkBookingConflict(service_id, start_time, end_time)) {
        return res.status(409).json({ error: 'Time slot unavailable' });
      }
      
      // Create booking
      const id = nanoid();
      const reference = `SM-${nanoid(6).toUpperCase()}`;
      const booking = { 
        id,
        customer_name,
        email,
        cellphone,
        service_id,
        start_time,
        end_time,
        status: 'CONFIRMED',
        reference,
        created_at: new Date().toISOString()
      };
      
      await redis.hSet(`booking:${id}`, booking);
      await redis.sAdd('bookings:all', `booking:${id}`);
      
      return res.status(201).json(booking);
    } catch (err) {
      console.error('Error creating booking:', err);
      if (err.message.includes('Service not found')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}