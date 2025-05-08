document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements with null checks
  const getElement = (id) => {
    const el = document.getElementById(id);
    if (!el) console.error(`Element with ID ${id} not found`);
    return el;
  };

  // Initialize elements
  const calendarEl = getElement('calendar');
  const modal = getElement('booking-modal');
  const closeModalBtn = getElement('close-modal');
  const cancelBookingBtn = getElement('cancel-booking');
  const bookingForm = getElement('booking-form');
  const loadingIndicator = getElement('loading-indicator');
  const serviceSelect = getElement('service-select');

  // Check if essential elements exist
  if (!calendarEl || !modal || !bookingForm || !serviceSelect) {
    console.error('Essential elements missing from DOM');
    return;
  }

  // Comprehensive Salon Services Data
  const defaultServices = [
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

  // State
  let selectedSlot = null;
  let services = [];
  let calendar = null;

  // Initialize the application
  async function init() {
    try {
      showLoading();

      // Try to load services from API, fallback to default
      try {
        services = await loadServices();
        console.log('Services loaded from API:', services);
        if (!services || services.length === 0) {
          throw new Error('No services returned from API');
        }
      } catch (error) {
        console.warn('Using default services:', error);
        services = defaultServices;
      }

      populateServiceSelect();
      initCalendar();
      setupEventListeners();

      // Debug: Verify select element
      console.log('Service select element:', serviceSelect);
      serviceSelect.addEventListener('click', (e) => {
        console.log('Select clicked, options:', serviceSelect.options.length);
      });

    } catch (error) {
      console.error('Initialization error:', error);
      showError('Failed to initialize. Please refresh the page.');
    } finally {
      hideLoading();
    }
  }

  // Load available services from API
  async function loadServices() {
    try {
      const response = await fetch('/api/services');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error loading services:', error);
      throw error;
    }
  }

  // Populate service dropdown with grouped options
  function populateServiceSelect() {
    serviceSelect.innerHTML = '';

    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select a service...';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    serviceSelect.appendChild(defaultOption);

    // Group services by category
    const categories = {};
    services.forEach(service => {
      if (!categories[service.category]) {
        categories[service.category] = [];
      }
      categories[service.category].push(service);
    });

    // Create optgroups for each category
    Object.keys(categories).forEach(category => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = category;

      categories[category].forEach(service => {
        const option = document.createElement('option');
        option.value = service.id;
        option.textContent = `${service.name} - R${service.price} (${service.duration} min)`;
        option.dataset.duration = service.duration;
        option.dataset.price = service.price;
        optgroup.appendChild(option);
      });

      serviceSelect.appendChild(optgroup);
    });

    // Force dropdown styling
    serviceSelect.style.display = 'block';
    serviceSelect.style.opacity = '1';
    serviceSelect.style.visibility = 'visible';
    serviceSelect.style.height = 'auto';
  }

  // Initialize FullCalendar
  function initCalendar() {
    if (!window.FullCalendar) {
      throw new Error('FullCalendar library not loaded');
    }

    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'timeGridWeek',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'timeGridWeek,timeGridDay'
      },
      slotMinTime: '08:00:00',
      slotMaxTime: '20:00:00',
      selectable: true,
      selectMirror: true,
      select: handleDateSelect,
      events: fetchEvents,
      eventClick: handleEventClick,
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
      }
    });

    calendar.render();
  }

  // Fetch events for calendar
  async function fetchEvents(fetchInfo, successCallback, failureCallback) {
    try {
      const params = new URLSearchParams({
        from: fetchInfo.startStr,
        to: fetchInfo.endStr
      });

      const response = await fetch(`/api/bookings?${params}`);
      if (!response.ok) {
        throw new Error('Failed to load bookings');
      }

      const bookings = await response.json();
      const events = bookings.map(booking => ({
        id: booking.id,
        title: services.find(s => s.id === booking.service_id)?.name || 'Booking',
        start: booking.start_time,
        end: booking.end_time,
        backgroundColor: '#8B5FBF',
        borderColor: '#6D3FA8',
        extendedProps: {
          customer: booking.customer_name,
          service: services.find(s => s.id === booking.service_id)?.name,
          price: services.find(s => s.id === booking.service_id)?.price
        }
      }));

      successCallback(events);
    } catch (error) {
      console.error('Error fetching events:', error);
      if (failureCallback) failureCallback(error);
    }
  }

  // Handle date selection
  function handleDateSelect(selectInfo) {
    selectedSlot = {
      start: selectInfo.start,
      end: selectInfo.end
    };

    const datetimeInput = getElement('appointment-datetime');
    if (datetimeInput) {
      datetimeInput.value = formatDateTimeForInput(selectInfo.start);
    }

    openModal();
    selectInfo.view.calendar.unselect();
  }
  // Handle event click to show booking details and confirm cancellation
  function handleEventClick(clickInfo) {
    const serviceName = clickInfo.event.extendedProps.service || 'Unknown Service';
    const customerName = clickInfo.event.extendedProps.customer || 'Unknown Customer';
    const price = clickInfo.event.extendedProps.price || 'Price not available';

    const eventTime = clickInfo.event.start.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const confirmMsg = `💅 ${serviceName}\n👤 ${customerName}\n💰 R${price}\n⏰ ${eventTime}\n\nDo you want to cancel this appointment?`;

    if (confirm(confirmMsg)) {
      deleteAppointment(clickInfo.event.id);
    }
  }
  // Delete appointment from backend
  async function deleteAppointment(bookingId) {
    try {
      showLoading();
      const response = await fetch(`/api/bookings?id=${bookingId}`, { method: 'DELETE' });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to cancel appointment');
      }

      calendar.refetchEvents();
      alert('🚫 Appointment cancelled successfully.');
    } catch (err) {
      console.error('Error cancelling appointment:', err);
      showError(err.message);
    } finally {
      hideLoading();
    }
  }
  // Format date for datetime-local input
  function formatDateTimeForInput(date) {
    const pad = num => num.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // Open modal
  function openModal() {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    const nameInput = getElement('customer-name');
    if (nameInput) nameInput.focus();
  }

  // Close modal
  function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    if (bookingForm) bookingForm.reset();
    selectedSlot = null;
  }

  // Show loading indicator
  function showLoading() {
    if (loadingIndicator) loadingIndicator.classList.remove('hidden');
  }

  // Hide loading indicator
  function hideLoading() {
    if (loadingIndicator) loadingIndicator.classList.add('hidden');
  }

  // Show error message
  function showError(message) {
    alert(message);
  }

  // Setup event listeners
  function setupEventListeners() {
    if (closeModalBtn) {
      closeModalBtn.addEventListener('click', closeModal);
    }

    if (cancelBookingBtn) {
      cancelBookingBtn.addEventListener('click', closeModal);
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModal();
        }
      });
    }

    if (bookingForm) {
      bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleBookingSubmit();
      });

      // Update end time when service changes
      serviceSelect.addEventListener('change', function () {
        const selectedOption = this.options[this.selectedIndex];
        if (selectedOption.value && selectedOption.dataset.duration) {
          const duration = parseInt(selectedOption.dataset.duration);
          const datetimeInput = getElement('appointment-datetime');
          if (datetimeInput && datetimeInput.value) {
            const startTime = new Date(datetimeInput.value);
            const endTime = new Date(startTime.getTime() + duration * 60000);
            // You could display this to the user if you have an end time display
          }
        }
      });
    }
  }

  // Handle booking form submission
  async function handleBookingSubmit() {
    const nameInput = getElement('customer-name');
    const emailInput = getElement('customer-email');
    const phoneInput = getElement('customer-phone');
    const datetimeInput = getElement('appointment-datetime');
    const serviceOption = serviceSelect.options[serviceSelect.selectedIndex];

    if (!nameInput || !emailInput || !phoneInput || !serviceSelect || !datetimeInput) {
      showError('Form elements missing');
      return;
    }

    const formData = {
      customer_name: nameInput.value.trim(),
      email: emailInput.value.trim(),
      cellphone: phoneInput.value.trim(),
      service_id: serviceSelect.value,
      service_name: serviceOption.text,
      start_time: datetimeInput.value
    };

    // Basic client-side validation
    if (!formData.customer_name || !formData.email || !formData.cellphone || !formData.service_id || !formData.start_time) {
      showError('Please fill in all required fields');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      showError('Please enter a valid email address');
      return;
    }

    // Validate phone format (South African)
    const phoneRegex = /^0[6-8]\d{8}$/;
    if (!phoneRegex.test(formData.cellphone)) {
      showError('Please enter a valid South African cellphone number (e.g., 0821234567)');
      return;
    }

    try {
      showLoading();

      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Booking failed');
      }

      // Success - refresh calendar and close modal
      if (calendar) calendar.refetchEvents();
      closeModal();
      alert(`✨ Booking confirmed for ${formData.service_name}! ✨\n\nSee you at Sassy Melanin!`);
    } catch (error) {
      console.error('Booking error:', error);
      showError(`Error: ${error.message}`);
    } finally {
      hideLoading();
    }
  }

  // Start the application
  init();
});