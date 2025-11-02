// public/app.js
// Modern Salon Booking Application

document.addEventListener('DOMContentLoaded', async () => {
  const app = new SalonBookingApp();
  await app.init();
});

class SalonBookingApp {
  constructor() {
    // DOM refs
    this.elements = {
      calendar: document.getElementById('calendar'),
      modal: document.getElementById('booking-modal'),
      form: document.getElementById('booking-form'),
      serviceSelect: document.getElementById('service-select'),
      customerName: document.getElementById('customer-name'),
      customerEmail: document.getElementById('customer-email'),
      customerPhone: document.getElementById('customer-phone'),
      appointmentDatetime: document.getElementById('appointment-datetime'),
      closeModalBtn: document.getElementById('close-modal'),
      cancelBookingBtn: document.getElementById('cancel-booking')
    };

    // App state
    this.state = {
      services: [],
      staff: [],          // 👈 NEW: staff list for allocation
      bookings: [],
      selectedSlot: null,
      calendar: null
    };

    this.modalManager = new ModalManager('booking-modal');
  }

  async init() {
    try {
      loading.show('Initializing booking system...');

      // 1. load services
      await this.loadServices();

      // 2. load staff (for assignment)
      await this.loadStaff();

      // 3. calendar
      this.setupCalendar();

      // 4. events
      this.setupEventListeners();

      // 5. form validation
      this.setupFormValidation();

      toast.success('Booking system ready!');
    } catch (error) {
      console.error('Initialization error:', error);
      toast.error('Failed to initialize booking system');
    } finally {
      loading.hide();
    }
  }

  // ----------------------------------------------------
  // SERVICES
  // ----------------------------------------------------
  async loadServices() {
    const result = await apiRequest('/api/services');

    if (result.success) {
      this.state.services = result.data;
      this.populateServiceSelect();
    } else {
      this.state.services = this.getDefaultServices();
      this.populateServiceSelect();
      toast.warning('Using offline service list');
    }
  }

  getDefaultServices() {
    return [
      // Manicures
      { id: 'manicure-basic', name: 'Basic Manicure', duration: 30, price: 250, category: 'Manicures' },
      { id: 'manicure-deluxe', name: 'Deluxe Manicure', duration: 45, price: 400, category: 'Manicures' },
      { id: 'manicure-gel', name: 'Gel Manicure', duration: 60, price: 500, category: 'Manicures' },
      { id: 'manicure-acrylic', name: 'Acrylic Full Set', duration: 90, price: 650, category: 'Manicures' },

      // Pedicures
      { id: 'pedicure-basic', name: 'Basic Pedicure', duration: 45, price: 350, category: 'Pedicures' },
      { id: 'pedicure-deluxe', name: 'Deluxe Pedicure', duration: 60, price: 500, category: 'Pedicures' },
      { id: 'pedicure-spa', name: 'Spa Pedicure', duration: 90, price: 700, category: 'Pedicures' },

      // Massages
      { id: 'massage-swedish', name: 'Swedish Massage (60min)', duration: 60, price: 850, category: 'Massages' },
      { id: 'massage-deep', name: 'Deep Tissue (60min)', duration: 60, price: 950, category: 'Massages' },
      { id: 'massage-hotstone', name: 'Hot Stone (75min)', duration: 75, price: 1100, category: 'Massages' },

      // Facials
      { id: 'facial-basic', name: 'Basic Facial', duration: 60, price: 750, category: 'Facials' },
      { id: 'facial-deluxe', name: 'Deluxe Facial', duration: 90, price: 1200, category: 'Facials' },

      // Waxing
      { id: 'wax-brows', name: 'Eyebrow Wax', duration: 15, price: 200, category: 'Waxing' },
      { id: 'wax-underarm', name: 'Underarm Wax', duration: 20, price: 250, category: 'Waxing' },
      { id: 'wax-brazilian', name: 'Brazilian Wax', duration: 30, price: 550, category: 'Waxing' },
      { id: 'wax-legs', name: 'Full Leg Wax', duration: 45, price: 600, category: 'Waxing' },

      // Specialty
      { id: 'service-lash', name: 'Eyelash Extensions', duration: 120, price: 1250, category: 'Specialty' },
      { id: 'service-brow', name: 'Microblading', duration: 120, price: 3000, category: 'Specialty' }
    ];
  }

  populateServiceSelect() {
    const select = this.elements.serviceSelect;
    select.innerHTML = '<option value="" disabled selected>Choose your treatment</option>';

    const categories = {};
    this.state.services.forEach(service => {
      if (!categories[service.category]) {
        categories[service.category] = [];
      }
      categories[service.category].push(service);
    });

    Object.entries(categories).forEach(([category, services]) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = category;

      services.forEach(service => {
        const option = document.createElement('option');
        option.value = service.id;
        option.textContent = `${service.name} - ${formatCurrency(service.price)} (${service.duration} min)`;
        option.dataset.duration = service.duration;
        option.dataset.price = service.price;
        optgroup.appendChild(option);
      });

      select.appendChild(optgroup);
    });
  }

  // ----------------------------------------------------
  // STAFF (NEW)
  // ----------------------------------------------------
  async loadStaff() {
    try {
      const res = await fetch('/api/staff');
      if (!res.ok) {
        console.warn('Could not load staff from /api/staff');
        this.state.staff = [];
        return;
      }
      const staff = await res.json();
      this.state.staff = Array.isArray(staff) ? staff : [];
    } catch (err) {
      console.error('Error loading staff', err);
      this.state.staff = [];
    }
  }

  // ----------------------------------------------------
  // CALENDAR
  // ----------------------------------------------------
  setupCalendar() {
    if (!window.FullCalendar) {
      throw new Error('FullCalendar library not loaded');
    }

    this.state.calendar = new FullCalendar.Calendar(this.elements.calendar, {
      initialView: 'timeGridWeek',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'timeGridWeek,timeGridDay'
      },
      slotMinTime: '08:00:00',
      slotMaxTime: '20:00:00',
      slotDuration: '00:30:00',
      selectable: true,
      selectMirror: true,
      select: (info) => this.handleDateSelect(info),
      events: (info, success, fail) => this.fetchEvents(info, success, fail),
      eventClick: (info) => this.handleEventClick(info),
      eventDisplay: 'block',
      height: 'auto',
      nowIndicator: true,
      editable: false,
      selectOverlap: false,
      eventOverlap: false,
      allDaySlot: false,
      selectConstraint: {
        startTime: '08:00:00',
        endTime: '20:00:00'
      },
      businessHours: {
        daysOfWeek: [1, 2, 3, 4, 5, 6],
        startTime: '08:00',
        endTime: '20:00'
      },
      eventClassNames: (arg) => {
        if (dateUtils.isPast(arg.event.start)) {
          return ['past-event'];
        }
        return [];
      }
    });

    this.state.calendar.render();
  }

  async fetchEvents(fetchInfo, successCallback, failureCallback) {
    try {
      const params = new URLSearchParams({
        from: fetchInfo.startStr,
        to: fetchInfo.endStr
      });

      const result = await apiRequest(`/api/bookings?${params}`);

      if (result.success) {
        const events = result.data.map(booking => {
          const service = this.state.services.find(s => s.id === booking.service_id);
          const status = booking.status || 'BOOKED';

          // colour by status
          let bg = '#9333ea'; // BOOKED
          if (status === 'IN_SESSION') bg = '#f97316';
          if (status === 'COMPLETED_PAID') bg = '#22c55e';
          if (status === 'CANCELLED') bg = '#9ca3af';

          return {
            id: booking.id,
            title: service?.name || 'Booking',
            start: booking.start_time,
            end: booking.end_time,
            backgroundColor: bg,
            borderColor: bg,
            extendedProps: {
              customer: booking.customer_name,
              service: service?.name,
              price: booking.price ?? service?.price ?? 0,
              reference: booking.reference,
              status,
              employee_id: booking.employee_id || '',
              employee_name: booking.employee_name || ''
            }
          };
        });

        successCallback(events);
      } else {
        failureCallback(result.error);
      }
    } catch (error) {
      console.error('Error fetching events:', error);
      if (failureCallback) failureCallback(error);
    }
  }

  handleDateSelect(selectInfo) {
    // prevent past
    if (dateUtils.isPast(selectInfo.start)) {
      toast.warning('Cannot book appointments in the past');
      selectInfo.view.calendar.unselect();
      return;
    }

    this.state.selectedSlot = {
      start: selectInfo.start,
      end: selectInfo.end
    };

    this.elements.appointmentDatetime.value = dateUtils.formatForInput(selectInfo.start);
    this.modalManager.open();
    selectInfo.view.calendar.unselect();
  }

  // ----------------------------------------------------
  // EVENT CLICK → actions
  // ----------------------------------------------------
  async handleEventClick(clickInfo) {
    const event = clickInfo.event;
    const props = event.extendedProps;

    const service = props.service || 'Unknown';
    const customer = props.customer || 'Unknown';
    const price = formatCurrency(props.price || 0);
    const time = dateUtils.format(event.start, 'full');
    const currentStatus = props.status || 'BOOKED';
    const currentEmployee =
      props.employee_name ||
      (props.employee_id ? props.employee_id : 'Unassigned');

    const choice = prompt(
      [
        `📅 Booking`,
        `Service: ${service}`,
        `Customer: ${customer}`,
        `Employee: ${currentEmployee}`,
        `Price: ${price}`,
        `Time: ${time}`,
        `Current status: ${currentStatus}`,
        '',
        'Choose action:',
        '1 = Mark IN_SESSION',
        '2 = Mark COMPLETED_PAID',
        '3 = Cancel booking',
        '4 = Assign / change employee',
        '5 = Unassign employee',
        '0 = Do nothing'
      ].join('\n')
    );

    switch (choice) {
      case '1':
        await this.updateBookingStatus(event.id, 'IN_SESSION');
        break;
      case '2':
        await this.updateBookingStatus(event.id, 'COMPLETED_PAID');
        break;
      case '3':
        await this.cancelBooking(event.id);
        break;
      case '4':
        await this.assignBookingToStaff(event.id);
        break;
      case '5':
        await this.unassignBooking(event.id);
        break;
      default:
        // nothing
        break;
    }
  }

  // ----------------------------------------------------
  // PATCH HELPERS
  // ----------------------------------------------------
  async updateBookingStatus(bookingId, status) {
    const result = await apiRequest(`/api/bookings?id=${bookingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });

    if (result.success) {
      toast.success(`Booking marked as ${status}`);
      this.state.calendar.refetchEvents();
    } else {
      toast.error(result.error || 'Failed to update booking');
    }
  }

  // allocate / change employee
  async assignBookingToStaff(bookingId) {
    if (!this.state.staff || this.state.staff.length === 0) {
      toast.error('No staff loaded. Add staff via /api/staff first.');
      return;
    }

    // build quick picker
    const lines = this.state.staff.map((s, idx) => {
      const name = s.full_name || s.name || s.display_name || s.id;
      return `${idx + 1}. ${name} (${s.id})`;
    });

    const which = prompt(
      [
        'Select staff number to assign:',
        ...lines,
        '',
        '0 = cancel'
      ].join('\n')
    );

    if (!which || which === '0') return;

    const index = Number(which) - 1;
    const staff = this.state.staff[index];
    if (!staff) {
      toast.error('Invalid staff selection');
      return;
    }

    const payload = {
      employee_id: staff.id,
      employee_name: staff.full_name || staff.name || staff.display_name || staff.id
    };

    const result = await apiRequest(`/api/bookings?id=${bookingId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    if (result.success) {
      toast.success(`Booking assigned to ${payload.employee_name}`);
      this.state.calendar.refetchEvents();
    } else {
      toast.error(result.error || 'Failed to assign booking');
    }
  }

  // unassign
  async unassignBooking(bookingId) {
    const result = await apiRequest(`/api/bookings?id=${bookingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ employee_id: '' })
    });

    if (result.success) {
      toast.success('Booking unassigned');
      this.state.calendar.refetchEvents();
    } else {
      toast.error(result.error || 'Failed to unassign booking');
    }
  }

  async cancelBooking(bookingId) {
    const result = await apiRequest(`/api/bookings?id=${bookingId}`, {
      method: 'DELETE'
    });

    if (result.success) {
      toast.success('Appointment cancelled successfully');
      this.state.calendar.refetchEvents();
    } else {
      toast.error(result.error || 'Failed to cancel appointment');
    }
  }

  // ----------------------------------------------------
  // UI / FORM
  // ----------------------------------------------------
  setupEventListeners() {
    // close modal
    if (this.elements.closeModalBtn) {
      this.elements.closeModalBtn.addEventListener('click', () => {
        this.modalManager.close();
      });
    }

    if (this.elements.cancelBookingBtn) {
      this.elements.cancelBookingBtn.addEventListener('click', () => {
        this.modalManager.close();
      });
    }

    // submit
    if (this.elements.form) {
      this.elements.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleBookingSubmit();
      });
    }

    // service change
    if (this.elements.serviceSelect) {
      this.elements.serviceSelect.addEventListener('change', (e) => {
        const option = e.target.selectedOptions[0];
        if (option && option.dataset.duration) {
          this.updateEndTime(parseInt(option.dataset.duration, 10));
        }
      });
    }
  }

  updateEndTime(durationMinutes) {
    const datetime = this.elements.appointmentDatetime.value;
    if (datetime) {
      const startTime = new Date(datetime);
      const endTime = dateUtils.addMinutes(startTime, durationMinutes);
      console.log('Appointment will end at:', dateUtils.format(endTime, 'time'));
    }
  }

  setupFormValidation() {
    if (this.elements.customerEmail) {
      this.elements.customerEmail.dataset.validate = 'required,email';
    }
    if (this.elements.customerPhone) {
      this.elements.customerPhone.dataset.validate = 'required,phone';
    }

    const inputs = this.elements.form.querySelectorAll('input[data-validate]');
    inputs.forEach(input => {
      input.addEventListener('blur', () => {
        const rules = input.dataset.validate.split(',');
        rules.forEach(rule => {
          const validator = validators[rule.trim()];
          if (validator) {
            const result = validator(input.value);
            if (!result.valid) {
              showFieldError(input, result.message);
            } else {
              clearFieldError(input);
            }
          }
        });
      });

      input.addEventListener('input', () => {
        clearFieldError(input);
      });
    });
  }

  async handleBookingSubmit() {
    const validation = validateForm(this.elements.form);
    if (!validation.isValid) {
      toast.error('Please fix the form errors');
      return;
    }

    const formData = {
      customer_name: this.elements.customerName.value.trim(),
      email: this.elements.customerEmail.value.trim(),
      cellphone: this.elements.customerPhone.value.trim(),
      service_id: this.elements.serviceSelect.value,
      start_time: new Date(this.elements.appointmentDatetime.value).toISOString()
    };

    if (!formData.service_id) {
      toast.error('Please select a service');
      return;
    }

    const result = await apiRequest('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(formData)
    });

    if (result.success) {
      const service = this.state.services.find(s => s.id === formData.service_id);
      toast.success(
        `✨ Booking confirmed for ${service?.name || 'your service'}! See you at Sassy De'Beaute!`,
        5000
      );

      this.state.calendar.refetchEvents();
      this.modalManager.close();
      this.elements.form.reset();
    } else {
      toast.error(result.error || 'Failed to create booking');
    }
  }
}

// Service Worker (optional)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // navigator.serviceWorker.register('/sw.js');
  });
}
