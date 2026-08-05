// Modern Utility Functions for Salon Booking System

// Toast Notification System
class ToastManager {
    constructor() {
      this.container = this.createContainer();
    }
  
    createContainer() {
      let container = document.querySelector('.toast-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
      }
      return container;
    }
  
    show(message, type = 'info', duration = 4000) {
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      
      const icons = {
        success: `<svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--success)">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>`,
        error: `<svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--error)">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>`,
        warning: `<svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--warning)">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>`,
        info: `<svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--primary)">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>`
      };
      
      toast.innerHTML = `
        ${icons[type] || icons.info}
        <div class="toast-content">
          <div class="toast-message">${message}</div>
        </div>
      `;
      
      this.container.appendChild(toast);
      
      setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => toast.remove(), 300);
      }, duration);
      
      return toast;
    }
  
    success(message, duration) {
      return this.show(message, 'success', duration);
    }
  
    error(message, duration) {
      return this.show(message, 'error', duration);
    }
  
    warning(message, duration) {
      return this.show(message, 'warning', duration);
    }
  
    info(message, duration) {
      return this.show(message, 'info', duration);
    }
  }
  
  // Initialize global toast manager
  const toast = new ToastManager();
  
  // Loading State Manager
  class LoadingManager {
    constructor() {
      this.indicator = document.getElementById('loading-indicator');
      this.count = 0;
    }
  
    show(message = 'Loading...') {
      this.count++;
      if (this.indicator) {
        this.indicator.classList.remove('hidden');
        const messageEl = this.indicator.querySelector('p');
        if (messageEl) messageEl.textContent = message;
      }
    }
  
    hide() {
      this.count = Math.max(0, this.count - 1);
      if (this.count === 0 && this.indicator) {
        this.indicator.classList.add('hidden');
      }
    }
  }
  
  const loading = new LoadingManager();
  
  // Form Validation Utilities
  const validators = {
    email: (value) => {
      const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return {
        valid: regex.test(value),
        message: 'Please enter a valid email address'
      };
    },
  
    phone: (value) => {
      const regex = /^0[6-8]\d{8}$/;
      return {
        valid: regex.test(value),
        message: 'Please enter a valid South African phone number (e.g., 0821234567)'
      };
    },
  
    required: (value) => {
      return {
        valid: value && value.trim().length > 0,
        message: 'This field is required'
      };
    },
  
    minLength: (length) => (value) => {
      return {
        valid: value && value.length >= length,
        message: `Must be at least ${length} characters`
      };
    },
  
    maxLength: (length) => (value) => {
      return {
        valid: value && value.length <= length,
        message: `Must be no more than ${length} characters`
      };
    }
  };
  
  // Form Validation Helper
  function validateForm(formElement) {
    const inputs = formElement.querySelectorAll('[required], [data-validate]');
    let isValid = true;
    const errors = [];
  
    inputs.forEach(input => {
      const validationRules = input.dataset.validate?.split(',') || ['required'];
      
      validationRules.forEach(rule => {
        const validator = validators[rule.trim()];
        if (validator) {
          const result = validator(input.value);
          if (!result.valid) {
            isValid = false;
            errors.push({
              field: input.name || input.id,
              message: result.message
            });
            
            // Add visual error state
            input.classList.add('error');
            showFieldError(input, result.message);
          } else {
            input.classList.remove('error');
            clearFieldError(input);
          }
        }
      });
    });
  
    return { isValid, errors };
  }
  
  function showFieldError(input, message) {
    clearFieldError(input);
    const errorEl = document.createElement('div');
    errorEl.className = 'field-error';
    errorEl.textContent = message;
    errorEl.style.color = 'var(--error)';
    errorEl.style.fontSize = '0.875rem';
    errorEl.style.marginTop = '0.25rem';
    input.parentNode.appendChild(errorEl);
  }
  
  function clearFieldError(input) {
    const errorEl = input.parentNode.querySelector('.field-error');
    if (errorEl) errorEl.remove();
  }
  
  // API Helper Functions
  async function apiRequest(url, options = {}) {
    try {
      loading.show();

      // Automatically attach auth token when available
      const authHeaders = (typeof AuthClient !== 'undefined') ? AuthClient.authHeaders() : {};

      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
          ...options.headers
        }
      });

      const data = await response.json();

      // Token expired mid-session
      if (response.status === 401 && typeof AuthClient !== 'undefined') {
        AuthClient.logout();
        return { success: false, error: 'Session expired' };
      }

      // Subscription lapsed mid-session
      if (response.status === 402) {
        window.location.href = '/subscribe.html';
        return { success: false, error: 'Subscription required' };
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Request failed');
      }

      return { success: true, data };
    } catch (error) {
      console.error('API Error:', error);
      return { success: false, error: error.message };
    } finally {
      loading.hide();
    }
  }
  
  // Date & Time Utilities
  const dateUtils = {
    format(date, format = 'short') {
      const d = new Date(date);
      const options = {
        short: { month: 'short', day: 'numeric', year: 'numeric' },
        long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
        time: { hour: '2-digit', minute: '2-digit' },
        full: { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit' 
        }
      };
  
      return d.toLocaleString('en-US', options[format] || options.short);
    },
  
    formatForInput(date) {
      const d = new Date(date);
      const pad = num => num.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
  
    addMinutes(date, minutes) {
      return new Date(new Date(date).getTime() + minutes * 60000);
    },
  
    isToday(date) {
      const today = new Date();
      const d = new Date(date);
      return d.toDateString() === today.toDateString();
    },
  
    isPast(date) {
      return new Date(date) < new Date();
    }
  };
  
  // Currency Formatter
  function formatCurrency(amount, currency = 'ZAR') {
    const value = Number(amount) || 0;
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2
    }).format(value).replace('ZAR', 'R');
  }
  
  // Debounce Function
  function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  
  // Local Storage Helper
  const storage = {
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        console.error('Storage Error:', error);
        return false;
      }
    },
  
    get(key, defaultValue = null) {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
      } catch (error) {
        console.error('Storage Error:', error);
        return defaultValue;
      }
    },
  
    remove(key) {
      try {
        localStorage.removeItem(key);
        return true;
      } catch (error) {
        console.error('Storage Error:', error);
        return false;
      }
    },
  
    clear() {
      try {
        localStorage.clear();
        return true;
      } catch (error) {
        console.error('Storage Error:', error);
        return false;
      }
    }
  };
  
  // Modal Helper
  class ModalManager {
    constructor(modalId) {
      this.modal = document.getElementById(modalId);
      this.content = this.modal?.querySelector('.modal-content');
      this.setupEventListeners();
    }
  
    setupEventListeners() {
      if (!this.modal) return;
  
      // Close on backdrop click
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.close();
        }
      });
  
      // Close on ESC key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen()) {
          this.close();
        }
      });
  
      // Close button
      const closeBtn = this.modal.querySelector('.close-button');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.close());
      }
    }
  
    open() {
      if (this.modal) {
        this.modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Focus first input
        setTimeout(() => {
          const firstInput = this.content?.querySelector('input, select, textarea');
          if (firstInput) firstInput.focus();
        }, 100);
      }
    }
  
    close() {
      if (this.modal) {
        this.modal.classList.remove('active');
        document.body.style.overflow = '';
        
        // Clear form if exists
        const form = this.content?.querySelector('form');
        if (form) form.reset();
      }
    }
  
    isOpen() {
      return this.modal?.classList.contains('active');
    }
  }
  
  // Confirmation Dialog
  function confirm(message, title = 'Confirm Action') {
    return new Promise((resolve) => {
      const confirmed = window.confirm(`${title}\n\n${message}`);
      resolve(confirmed);
    });
  }
  
  // Export utilities
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      toast,
      loading,
      validators,
      validateForm,
      apiRequest,
      dateUtils,
      formatCurrency,
      debounce,
      storage,
      ModalManager,
      confirm
    };
  }