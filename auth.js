(function () {
  function getPostAuthRedirect() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    if (!next) return 'products.html';

    const normalized = next.trim();
    const isSafeRelativePage = /^[a-z0-9-]+\.html(?:[?#].*)?$/i.test(normalized);
    if (!isSafeRelativePage) {
      return 'products.html';
    }

    return normalized;
  }

  function preserveNextLinks() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    if (!next) return;

    document.querySelectorAll('a[href="signin.html"], a[href="signup.html"], a[href="forgot-password.html"]').forEach(link => {
      const url = new URL(link.getAttribute('href'), window.location.href);
      url.searchParams.set('next', next);
      link.setAttribute('href', `${url.pathname.split('/').pop()}${url.search}`);
    });
  }

  function normalizeUser(user, emailFallback = '') {
    if (typeof toSessionUser === 'function') return toSessionUser(user);
    const email = (user?.email || emailFallback || '').trim().toLowerCase();
    return {
      id: user?.id || `mk_${email || Date.now()}`,
      fullName: (user?.fullName || user?.name || email || 'Customer').trim(),
      email,
      phone: user?.phone || '',
    };
  }

  function persistSession(user, emailFallback = '') {
    const sessionUser = normalizeUser(user, emailFallback);
    if (typeof saveUser === 'function') {
      saveUser(sessionUser);
      return;
    }
    localStorage.setItem('mkUser', JSON.stringify(sessionUser));
  }

  function resetButton(button, label) {
    button.textContent = label;
    button.disabled = false;
  }

  async function handleSignup(event) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    const fullName = form.querySelector('#su-name').value.trim();
    const email = normalizeEmail(form.querySelector('#su-email').value);
    const phone = form.querySelector('#su-phone')?.value.trim() || '';
    const password = form.querySelector('#su-password').value;
    const confirmPassword = form.querySelector('#su-password-confirm')?.value || '';

    clearAuthMessages();

    if (!fullName || !email || !password) {
      showAuthMessage('auth-error', 'Please fill in all required fields.');
      return;
    }
    if (password.length < 6) {
      showAuthMessage('auth-error', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showAuthMessage('auth-error', 'Passwords do not match.');
      return;
    }

    button.textContent = 'Creating Account...';
    button.disabled = true;

    try {
      let result = null;

      try {
        const remoteResult = await authRequest('signup', { fullName, email, phone, password });
        if (remoteResult?.success) {
          result = remoteResult;
          await upsertLocalUser({ fullName, email, phone, password, id: remoteResult.user?.id });
        }
      } catch (error) {
        if (error.apiFailure) {
          showAuthMessage('auth-error', error.responseData?.message || error.message);
          resetButton(button, 'Register Now');
          return;
        }
      }

      if (!result) {
        result = await createLocalUser({ fullName, email, phone, password });
      }

      if (!result.success) {
        showAuthMessage('auth-error', result.message || 'Could not create your account.');
        resetButton(button, 'Register Now');
        return;
      }

      persistSession(result.user || { fullName, email, phone }, email);
      window.location.href = getPostAuthRedirect();
    } catch (error) {
      showAuthMessage('auth-error', 'Could not create your account right now. Please try again.');
      resetButton(button, 'Register Now');
    }
  }

  async function handleSignin(event) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    const email = normalizeEmail(form.querySelector('#si-email').value);
    const password = form.querySelector('#si-password').value;

    clearAuthMessages();

    if (!email || !password) {
      showAuthMessage('auth-error', 'Please enter your email and password.');
      return;
    }

    button.textContent = 'Signing In...';
    button.disabled = true;

    try {
      let result = null;

      try {
        const remoteResult = await authRequest('signin', { email, password });
        if (remoteResult?.success) {
          result = remoteResult;
          await upsertLocalUser({
            fullName: remoteResult.user?.fullName || remoteResult.user?.name || email,
            email,
            phone: remoteResult.user?.phone || '',
            password,
            id: remoteResult.user?.id,
          });
        }
      } catch (error) {
        if (error.apiFailure) {
          showAuthMessage('auth-error', error.responseData?.message || error.message);
          resetButton(button, 'Sign In');
          return;
        }
      }

      if (!result) {
        result = await signInLocalUser(email, password);
      }

      if (!result.success) {
        showAuthMessage('auth-error', result.message || 'Invalid email or password.');
        resetButton(button, 'Sign In');
        return;
      }

      persistSession(result.user, email);
      window.location.href = getPostAuthRedirect();
    } catch (error) {
      showAuthMessage('auth-error', 'Could not sign you in right now. Please try again.');
      resetButton(button, 'Sign In');
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    const email = normalizeEmail(form.querySelector('#fp-email').value);
    const password = form.querySelector('#fp-password').value;
    const confirmPassword = form.querySelector('#fp-confirm').value;

    clearAuthMessages();

    if (!email || !password || !confirmPassword) {
      showAuthMessage('auth-error', 'Please complete all fields.');
      return;
    }
    if (password.length < 6) {
      showAuthMessage('auth-error', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showAuthMessage('auth-error', 'Passwords do not match.');
      return;
    }

    button.textContent = 'Updating Password...';
    button.disabled = true;

    try {
      let result = null;

      try {
        const remoteResult = await authRequest('reset-password', { email, password });
        if (remoteResult?.success) {
          result = remoteResult;
          await upsertLocalUser({
            fullName: remoteResult.user?.fullName || remoteResult.user?.name || email,
            email,
            phone: remoteResult.user?.phone || '',
            password,
            id: remoteResult.user?.id,
          });
        }
      } catch (error) {
        if (error.apiFailure) {
          showAuthMessage('auth-error', error.responseData?.message || error.message);
          resetButton(button, 'Update Password');
          return;
        }
      }

      if (!result) {
        result = await resetLocalPassword(email, password);
      }

      if (!result.success) {
        showAuthMessage('auth-error', result.message || 'Could not update your password.');
        resetButton(button, 'Update Password');
        return;
      }

      showAuthMessage('auth-success', 'Password updated. Redirecting you to sign in...');
      form.reset();
      window.setTimeout(() => {
        window.location.href = 'signin.html';
      }, 1200);
    } catch (error) {
      showAuthMessage('auth-error', 'Could not update your password right now. Please try again.');
      resetButton(button, 'Update Password');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    preserveNextLinks();

    const signupForm = document.getElementById('signup-form');
    if (signupForm) signupForm.addEventListener('submit', handleSignup);

    const signinForm = document.getElementById('signin-form');
    if (signinForm) signinForm.addEventListener('submit', handleSignin);

    const forgotForm = document.getElementById('forgot-form');
    if (forgotForm) forgotForm.addEventListener('submit', handleResetPassword);
  });
})();
