/**
 * Form Validation & Accessibility Synchronization Utilities
 *
 * Implements deferred post-interaction validation (:user-invalid) and synchronizes
 * programmatic ARIA states (aria-invalid) so screen readers only announce errors
 * after the user has interacted with a field.
 */

export const UserInvalidFallback = (() => {
  const dirtyState = new WeakMap();

  const updateState = (input) => {
    if (typeof input.checkValidity !== 'function') return;
    const isValid = input.checkValidity();

    input.classList.toggle('user-invalid-fallback', !isValid);
    input.classList.toggle('user-valid-fallback', isValid);

    if (!isValid) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  };

  const handleEvent = (event) => {
    const target = event.target;

    if (event.type === 'reset' && target?.matches?.('form')) {
      const controls = target.elements || [];
      for (const control of controls) {
        dirtyState.delete(control);
        control.classList?.remove('user-invalid-fallback', 'user-valid-fallback');
        control.removeAttribute?.('aria-invalid');
      }
      return;
    }

    if (!target?.matches?.('input, textarea, select')) return;

    if (event.type === 'input' || event.type === 'change') {
      const state = dirtyState.get(target) || { hasInteracted: false, hasBlurred: false };
      state.hasInteracted = true;
      dirtyState.set(target, state);
      if (state.hasBlurred) {
        updateState(target);
      }
    } else if (event.type === 'blur') {
      const state = dirtyState.get(target) || { hasInteracted: false, hasBlurred: false };
      state.hasBlurred = true;
      dirtyState.set(target, state);
      if (state.hasInteracted) {
        updateState(target);
      }
    }
  };

  const init = (root = document) => {
    if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('selector(:user-invalid)')) {
      return;
    }

    root.addEventListener('blur', handleEvent, true);
    root.addEventListener('input', handleEvent, true);
    root.addEventListener('change', handleEvent, true);
    root.addEventListener('reset', handleEvent, true);
  };

  return { init, updateState };
})();

/**
 * Synchronizes `aria-invalid` with `:user-invalid` and custom validity states.
 */
export function initAccessibleValidation(root = document) {
  UserInvalidFallback.init(root);

  const updateAriaState = (input) => {
    if (!input?.matches?.('input, textarea, select')) return;

    const supportsUserInvalid =
      typeof CSS !== 'undefined' && CSS.supports && CSS.supports('selector(:user-invalid)');

    const isUserInvalid = supportsUserInvalid
      ? input.matches(':user-invalid') || input.classList.contains('force-invalid')
      : input.classList.contains('user-invalid-fallback') || input.classList.contains('force-invalid');

    if (isUserInvalid) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  };

  root.addEventListener(
    'blur',
    (event) => {
      const input = event.target;
      if (!input?.matches?.('input, textarea, select')) return;
      validateControlConstraints(input);
      updateAriaState(input);
    },
    true
  );

  root.addEventListener(
    'focus',
    (event) => {
      updateAriaState(event.target);
    },
    true
  );

  root.addEventListener(
    'input',
    (event) => {
      const input = event.target;
      if (!input?.matches?.('input, textarea, select')) return;

      // Clear custom error message while typing so native validity updates cleanly
      if (input.dataset.customErrorActive === 'true') {
        validateControlConstraints(input);
      }

      // If this is the new-password field, also re-verify confirm-password if non-empty
      if (input.id === 'new-password') {
        const form = input.closest('form');
        const confirmInput = form?.querySelector('#confirm-password');
        if (confirmInput && confirmInput.value.length > 0) {
          validateControlConstraints(confirmInput);
          updateAriaState(confirmInput);
        }
      }

      if (input.hasAttribute('aria-invalid') || input.classList.contains('force-invalid')) {
        if (input.checkValidity()) {
          input.classList.remove('force-invalid');
        }
        updateAriaState(input);
      }
    },
    true
  );
}

/**
 * Validates field-specific constraints and sets descriptive error text in the
 * paired error element (`aria-errormessage`).
 */
export function validateControlConstraints(input) {
  if (!input || typeof input.setCustomValidity !== 'function') return true;

  input.setCustomValidity('');
  delete input.dataset.customErrorActive;

  const value = input.value;
  const trimmed = value.trim();

  if (input.name === 'fullName' && input.required) {
    if (!trimmed) {
      input.setCustomValidity('Please enter your full name.');
      input.dataset.customErrorActive = 'true';
    } else if (!/\p{L}/u.test(trimmed)) {
      input.setCustomValidity('Please include at least one letter in your name.');
      input.dataset.customErrorActive = 'true';
    }
  }

  if (input.type === 'email' && trimmed.length > 0) {
    // Additional sanity check beyond basic browser @ check (require domain dot)
    const emailParts = trimmed.split('@');
    if (emailParts.length !== 2 || !emailParts[1].includes('.') || emailParts[1].startsWith('.') || emailParts[1].endsWith('.')) {
      input.setCustomValidity('Please enter a complete email address (e.g., name@campus.edu).');
      input.dataset.customErrorActive = 'true';
    }
  }

  if (input.id === 'confirm-password') {
    const form = input.closest('form');
    const passwordInput = form?.querySelector('#new-password');
    if (passwordInput && value !== passwordInput.value) {
      input.setCustomValidity('Passwords do not match. Please re-enter your password.');
      input.dataset.customErrorActive = 'true';
    }
  }

  // Update visible error message text if paired
  const errorId = input.getAttribute('aria-errormessage');
  if (errorId) {
    const errorEl = document.getElementById(errorId);
    if (errorEl) {
      const textSpan = errorEl.querySelector('.error-text') || errorEl;
      textSpan.textContent = getReadableErrorMessage(input);
    }
  }

  return input.checkValidity();
}

/**
 * Produces human-friendly validation messages for campus riders.
 */
export function getReadableErrorMessage(input) {
  if (input.dataset.customErrorActive === 'true' && input.validationMessage) {
    return input.validationMessage;
  }

  const validity = input.validity;
  if (!validity || validity.valid) return '';

  if (validity.valueMissing) {
    switch (input.name) {
      case 'fullName':
        return 'Please enter your full name.';
      case 'email':
        return 'Please enter your email address.';
      case 'password':
        return input.id === 'new-password'
          ? 'Please create a password.'
          : 'Please enter your password.';
      case 'confirmPassword':
        return 'Please confirm your password.';
      case 'reviewText':
        return 'Please write a brief review of your campus parking experience before submitting.';
      default:
        return 'This field is required.';
    }
  }

  if (validity.typeMismatch && input.type === 'email') {
    return 'Please enter a valid email address (for example, name@campus.edu).';
  }

  if (validity.tooShort) {
    return `Password must be at least ${input.minLength} characters long.`;
  }

  if (validity.patternMismatch && input.id === 'new-password') {
    return 'Use at least 8 characters with letters and numbers.';
  }

  return input.validationMessage || 'Please check this field.';
}

/**
 * Validates all controls inside a form on submission and marks invalid fields
 * so error messages and focus states appear immediately.
 */
export function validateFormOnSubmit(form) {
  const controls = Array.from(form.querySelectorAll('input, textarea, select'));
  let firstInvalid = null;

  for (const control of controls) {
    const valid = validateControlConstraints(control);
    if (!valid) {
      control.classList.add('force-invalid', 'user-invalid-fallback');
      control.setAttribute('aria-invalid', 'true');
      if (!firstInvalid) {
        firstInvalid = control;
      }
    } else {
      control.classList.remove('force-invalid', 'user-invalid-fallback');
      control.removeAttribute('aria-invalid');
    }
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return false;
  }

  return true;
}

