// ============================================================
//  MORAKAY PORK — Master Frontend Script
//  Handles: Nav, Auth, Products, Cart, Checkout → Google Sheets
// ============================================================

// ── CONFIG ───────────────────────────────────────────────────
const CONFIG = {
  BACKEND_URL: 'YOUR_APPS_SCRIPT_URL_HERE', // <-- Paste your deployed Apps Script URL here
  AUTH_API_BASE: '',
  WHATSAPP: '2348065337256',
};

const STORAGE_KEYS = {
  cart: 'mkCart',
  user: 'mkUser',
  users: 'mkUsers',
  orders: 'mkOrders',
};

const PUBLIC_PAGES = ['index.html', 'products.html', 'about.html', 'contact.html', 'signin.html', 'signup.html', 'forgot-password.html', 'thank-you.html'];

// ── STATE ────────────────────────────────────────────────────
let cart = readStorage(STORAGE_KEYS.cart, []);
let currentUser = readStorage(STORAGE_KEYS.user, null);

// ── API HELPER ───────────────────────────────────────────────
async function api(payload) {
  const res = await fetch(CONFIG.BACKEND_URL, {
    method: 'POST',
    mode: 'no-cors', // Required for GAS web app
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
  });
  // no-cors means we can't read the response body, so we trust the action
  return { success: true };
}

async function apiGet(params = '') {
  const res = await fetch(`${CONFIG.BACKEND_URL}?${params}`);
  return res.json();
}

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function hasConfiguredBackend() {
  return Boolean(CONFIG.BACKEND_URL) && !CONFIG.BACKEND_URL.includes('YOUR_');
}

function getAuthApiBase() {
  const configured = (CONFIG.AUTH_API_BASE || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return `${window.location.origin}/api/auth`;
  }
  return '';
}

function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

function getCurrentPageName() {
  const page = window.location.pathname.split('/').pop();
  return (page || 'index.html').toLowerCase();
}

function isPublicPage(pageName = getCurrentPageName()) {
  return PUBLIC_PAGES.includes(pageName);
}

function getSigninRedirectUrl() {
  const currentTarget = `${getCurrentPageName()}${window.location.search || ''}${window.location.hash || ''}`;
  return `signin.html?next=${encodeURIComponent(currentTarget)}`;
}

function getUserDisplayName(user) {
  const rawName = `${user?.fullName || user?.name || user?.email || 'Customer'}`.trim();
  return rawName.split(/\s+/)[0];
}

function toSessionUser(user = {}) {
  const normalizedEmail = normalizeEmail(user.email || '');
  return {
    id: user.id || `mk_${normalizedEmail || Date.now()}`,
    fullName: (user.fullName || user.name || normalizedEmail || 'Customer').trim(),
    email: normalizedEmail,
    phone: user.phone || '',
  };
}

function getStoredUsers() {
  return readStorage(STORAGE_KEYS.users, []);
}

function saveStoredUsers(users) {
  localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(users));
}

function createUserId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `mk_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function simpleHash(value = '') {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a_${(hash >>> 0).toString(16)}`;
}

async function hashPassword(password) {
  if (window.crypto?.subtle && window.TextEncoder) {
    const data = new TextEncoder().encode(password);
    const buffer = await window.crypto.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(buffer));
    return bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return simpleHash(password);
}

async function upsertLocalUser({ fullName, email, phone = '', password, id, createdAt }) {
  const emailKey = normalizeEmail(email);
  const users = getStoredUsers();
  const index = users.findIndex(user => normalizeEmail(user.email) === emailKey);
  const existingUser = index >= 0 ? users[index] : null;

  const nextUser = {
    id: existingUser?.id || id || createUserId(),
    fullName: (fullName || existingUser?.fullName || emailKey || 'Customer').trim(),
    email: emailKey,
    phone: phone || existingUser?.phone || '',
    passwordHash: password ? await hashPassword(password) : existingUser?.passwordHash || '',
    createdAt: existingUser?.createdAt || createdAt || new Date().toISOString(),
  };

  if (index >= 0) users[index] = nextUser;
  else users.push(nextUser);

  saveStoredUsers(users);
  return toSessionUser(nextUser);
}

async function createLocalUser({ fullName, email, phone = '', password }) {
  const emailKey = normalizeEmail(email);
  const users = getStoredUsers();
  const existingUser = users.find(user => normalizeEmail(user.email) === emailKey);

  if (existingUser) {
    return { success: false, message: 'An account with this email already exists. Please sign in.' };
  }

  const user = {
    id: createUserId(),
    fullName: fullName.trim(),
    email: emailKey,
    phone: phone.trim(),
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  saveStoredUsers(users);

  return { success: true, user: toSessionUser(user) };
}

async function signInLocalUser(email, password) {
  const emailKey = normalizeEmail(email);
  const user = getStoredUsers().find(entry => normalizeEmail(entry.email) === emailKey);

  if (!user) {
    return { success: false, message: 'No account found for this email. Please sign up first.' };
  }

  const passwordHash = await hashPassword(password);
  if (user.passwordHash !== passwordHash) {
    return { success: false, message: 'Incorrect password. Please try again.' };
  }

  return { success: true, user: toSessionUser(user) };
}

async function resetLocalPassword(email, password) {
  const emailKey = normalizeEmail(email);
  const users = getStoredUsers();
  const userIndex = users.findIndex(entry => normalizeEmail(entry.email) === emailKey);

  if (userIndex < 0) {
    return { success: false, message: 'No account found for this email yet.' };
  }

  users[userIndex].passwordHash = await hashPassword(password);
  saveStoredUsers(users);

  return { success: true, user: toSessionUser(users[userIndex]) };
}

async function authRequest(endpoint, payload) {
  const base = getAuthApiBase();
  if (!base) throw new Error('Auth API not configured.');

  const response = await fetch(`${base}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(data?.message || `Auth request failed (${response.status}).`);
    error.apiFailure = Boolean(data);
    error.status = response.status;
    error.responseData = data;
    throw error;
  }

  return data;
}

function showAuthMessage(id, message) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message;
  element.style.display = 'block';
}

function clearAuthMessages() {
  ['auth-error', 'auth-success'].forEach(id => {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = '';
    element.style.display = 'none';
  });
}

// ── SAVE STATE ───────────────────────────────────────────────
function saveCart() {
  localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(cart));
  updateCartUI();
}

function saveUser(user) {
  currentUser = toSessionUser(user);
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(currentUser));
}

function logout() {
  currentUser = null;
  localStorage.removeItem(STORAGE_KEYS.user);
  window.location.href = 'signin.html';
}

// ── NAVIGATION ───────────────────────────────────────────────
function buildNav() {
  const nav = document.getElementById('main-nav');
  if (!nav) return;

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const authLinks = currentUser
    ? `<span style="color:var(--text-muted);font-size:0.8rem;font-weight:600;">Hi, ${getUserDisplayName(currentUser)}</span>
       <a href="dashboard.html" class="${isPage('dashboard') ? 'active' : ''}">Dashboard</a>
       <a href="#" onclick="logout()" class="logout-link">Logout</a>`
    : `<a href="signin.html">Sign In</a><a href="signup.html" class="btn-primary" style="padding:10px 18px;">Join</a>`;

  nav.innerHTML = `
    <a href="index.html">
      <img src="images/logo.png" alt="Morakay Pork" class="nav-logo" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'🥩 MORAKAY',style:'font-weight:900;font-size:1.1rem;color:var(--navy);letter-spacing:1px'}))">
    </a>
    <button class="nav-toggle" onclick="this.nextElementSibling.classList.toggle('show')">☰ Menu</button>
    <div class="nav-links">
      <a href="index.html" class="${isPage('index') ? 'active' : ''}">Home</a>
      <a href="products.html" class="${isPage('products') ? 'active' : ''}">Shop</a>
      <a href="about.html" class="${isPage('about') ? 'active' : ''}">About</a>
      <a href="contact.html" class="${isPage('contact') ? 'active' : ''}">Contact</a>
      ${authLinks}
      <button class="cart-btn" onclick="toggleCart()">
        🛒 Basket <span id="cart-count" style="background:var(--gold);color:var(--navy);padding:2px 7px;font-size:0.75rem;margin-left:4px;">${cartCount}</span>
      </button>
    </div>`;
}

function isPage(name) {
  return window.location.pathname.includes(name);
}

// ── FOOTER ───────────────────────────────────────────────────
function buildFooter() {
  const footer = document.getElementById('main-footer') || document.querySelector('footer.main-footer');
  if (!footer) return;
  footer.style.cssText = 'background:var(--navy);color:#fff;padding:50px 8%;';
  footer.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:40px;margin-bottom:40px;">
      <div>
        <h4 style="color:var(--gold);text-transform:uppercase;letter-spacing:2px;margin-bottom:15px;">Morakay Pork</h4>
        <p style="color:#8da1b5;font-size:0.9rem;line-height:1.8;">Premium farm-to-table pork cuts delivered across Lagos. Hygiene. Quality. Flavour.</p>
      </div>
      <div>
        <h4 style="color:var(--gold);text-transform:uppercase;letter-spacing:2px;margin-bottom:15px;">Quick Links</h4>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${['Home:index.html','Shop:products.html','About:about.html','Policies:policies.html','Contact:contact.html'].map(l => {
            const [t,h] = l.split(':');
            return `<a href="${h}" style="color:#8da1b5;text-decoration:none;font-size:0.9rem;transition:0.3s;" onmouseover="this.style.color='var(--gold)'" onmouseout="this.style.color='#8da1b5'">${t}</a>`;
          }).join('')}
        </div>
      </div>
      <div>
        <h4 style="color:var(--gold);text-transform:uppercase;letter-spacing:2px;margin-bottom:15px;">Contact</h4>
        <p style="color:#8da1b5;font-size:0.9rem;line-height:2;">
          📞 <a href="tel:+2348065337256" style="color:#8da1b5;text-decoration:none;">+234 806 533 7256</a><br>
          📸 <a href="https://instagram.com/morakaypork" target="_blank" style="color:#8da1b5;text-decoration:none;">@morakaypork</a><br>
          📍 Lagos, Nigeria<br>
          🕐 Mon–Sat: 7am – 7pm
        </p>
      </div>
    </div>
    <div style="border-top:1px solid #253a50;padding-top:20px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <p style="color:#8da1b5;font-size:0.8rem;">© ${new Date().getFullYear()} Morakay Pork. All rights reserved.</p>
      <a href="policies.html" style="color:#8da1b5;font-size:0.8rem;text-decoration:none;">Policies & Terms</a>
    </div>`;
}

// ── CART DRAWER ───────────────────────────────────────────────
function buildCartDrawer() {
  const aside = document.getElementById('cart-drawer');
  if (!aside) return;
  aside.innerHTML = `
    <div class="cart-header">
      <h3 style="color:var(--navy);font-size:1.1rem;text-transform:uppercase;letter-spacing:1px;">Your Basket</h3>
      <button onclick="toggleCart()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;">✕</button>
    </div>
    <div id="cart-items" style="flex:1;overflow-y:auto;padding:20px;"></div>
    <div id="cart-footer" style="padding:20px;border-top:1px solid var(--border-color);"></div>`;
  updateCartUI();
}

function toggleCart() {
  document.getElementById('cart-drawer')?.classList.toggle('active');
}

function updateCartUI() {
  const countEl = document.getElementById('cart-count');
  if (countEl) countEl.textContent = cart.reduce((s, i) => s + i.qty, 0);

  const itemsEl = document.getElementById('cart-items');
  const footerEl = document.getElementById('cart-footer');
  if (!itemsEl) return;

  if (cart.length === 0) {
    itemsEl.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
      <div style="font-size:3rem;margin-bottom:10px;">🥩</div>
      <p style="font-weight:600;">Your basket is empty</p>
      <a href="products.html" onclick="toggleCart()" style="display:inline-block;margin-top:15px;color:var(--navy);font-weight:800;text-decoration:none;border-bottom:2px solid var(--gold);">Browse Products</a>
    </div>`;
    footerEl.innerHTML = '';
    return;
  }

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);

  itemsEl.innerHTML = cart.map((item, idx) => `
    <div style="display:flex;gap:15px;padding:15px 0;border-bottom:1px solid #eee;align-items:center;">
      <img src="${item.img}" style="width:70px;height:70px;object-fit:cover;" onerror="this.src='https://via.placeholder.com/70x70/1a2a3a/ffcc33?text=🥩'">
      <div style="flex:1;">
        <p style="font-weight:700;font-size:0.85rem;color:var(--navy);text-transform:uppercase;letter-spacing:0.5px;">${item.name}</p>
        <p style="font-size:0.85rem;color:var(--text-muted);">₦${item.price.toLocaleString()}</p>
        <div class="stepper" style="margin-top:8px;">
          <button onclick="changeQty(${idx},-1)" style="width:28px;height:28px;border:1px solid #ddd;background:#fff;cursor:pointer;font-size:1rem;font-weight:700;">−</button>
          <span style="font-weight:700;min-width:20px;text-align:center;">${item.qty}</span>
          <button onclick="changeQty(${idx},1)" style="width:28px;height:28px;border:1px solid #ddd;background:#fff;cursor:pointer;font-size:1rem;font-weight:700;">+</button>
        </div>
      </div>
      <div style="text-align:right;">
        <p style="font-weight:800;color:var(--navy);">₦${(item.price * item.qty).toLocaleString()}</p>
        <button onclick="removeFromCart(${idx})" style="background:none;border:none;color:#ff4d4d;cursor:pointer;font-size:0.75rem;margin-top:5px;font-weight:700;">Remove</button>
      </div>
    </div>`).join('');

  footerEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:15px;">
      <span style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Total</span>
      <span style="font-size:1.3rem;font-weight:800;color:var(--navy);">₦${total.toLocaleString()}</span>
    </div>
    <button onclick="openCheckout()" class="btn-primary" style="width:100%;padding:16px;font-size:1rem;">Proceed to Checkout</button>
    <button onclick="sendWhatsApp()" style="width:100%;padding:12px;margin-top:10px;background:none;border:2px solid #25d366;color:#25d366;font-weight:800;cursor:pointer;letter-spacing:1px;transition:0.3s;" onmouseover="this.style.background='#25d366';this.style.color='#fff'" onmouseout="this.style.background='none';this.style.color='#25d366'">📱 Order via WhatsApp</button>`;
}

function addToCart(id, name, price, img) {
  const existing = cart.find(i => i.id === id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id, name, price, img: img || '', qty: 1 });
  }
  saveCart();

  // Flash feedback
  const btn = event?.target;
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = '✓ Added!';
    btn.style.background = '#25a244';
    btn.style.color = '#fff';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; btn.style.color = ''; }, 1500);
  }

  // Open cart
  document.getElementById('cart-drawer')?.classList.add('active');
}

function changeQty(idx, delta) {
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) cart.splice(idx, 1);
  saveCart();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  saveCart();
}

function saveOrderToHistory(order) {
  if (!currentUser) return;
  const historyKey = `${STORAGE_KEYS.orders}_${currentUser.id}`;
  const history = readStorage(historyKey, []);
  history.push({ ...order, date: new Date().toISOString() });
  localStorage.setItem(historyKey, JSON.stringify(history));
}

function sendWhatsApp() {
  if (cart.length === 0) return;
  if (!currentUser) {
    window.location.href = getSigninRedirectUrl();
    return;
  }
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const items = cart.map(i => `• ${i.name} x${i.qty} = ₦${(i.price*i.qty).toLocaleString()}`).join('%0A');
  const msg = `Hello Morakay Pork! 🥩%0A%0AMy Order:%0A${items}%0A%0ATotal: ₦${total.toLocaleString()}%0A%0APlease confirm my order.`;
  window.open(`https://wa.me/${CONFIG.WHATSAPP}?text=${msg}`, '_blank');
  
  saveOrderToHistory({
    items: cart.map(i => ({ name: i.name, qty: i.qty, price: i.price, subtotal: i.price * i.qty })),
    total: total,
    paymentMethod: 'WhatsApp',
  });
  
  cart = [];
  saveCart();
  toggleCart();
}

// ── CHECKOUT MODAL ────────────────────────────────────────────
function openCheckout() {
  if (cart.length === 0) { alert('Your basket is empty!'); return; }
  if (!currentUser) {
    window.location.href = getSigninRedirectUrl();
    return;
  }

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const delivery = total < 10000 ? 2500 : 0;

  const modal = document.createElement('div');
  modal.id = 'checkout-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(26,42,58,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="background:#fff;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;padding:40px;position:relative;">
      <button onclick="document.getElementById('checkout-modal').remove()" style="position:absolute;top:15px;right:20px;background:none;border:none;font-size:1.5rem;cursor:pointer;color:#999;">✕</button>
      <h2 style="color:var(--navy);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Checkout</h2>
      <p style="color:var(--text-muted);margin-bottom:30px;font-size:0.9rem;">${cart.length} item(s) · ₦${total.toLocaleString()} + ${delivery > 0 ? '₦' + delivery.toLocaleString() + ' delivery' : 'FREE delivery'}</p>

      <div id="checkout-error" style="display:none;background:#fff0f0;border-left:4px solid #ff4d4d;padding:12px 15px;margin-bottom:20px;font-size:0.9rem;color:#c0392b;"></div>

      <div class="input-group">
        <label>Full Name *</label>
        <input type="text" id="co-name" placeholder="Chioma Adeyemi" value="${currentUser?.fullName || ''}" required>
      </div>
      <div class="input-group">
        <label>Email *</label>
        <input type="email" id="co-email" placeholder="email@example.com" value="${currentUser?.email || ''}" required>
      </div>
      <div class="input-group">
        <label>Phone / WhatsApp *</label>
        <input type="tel" id="co-phone" placeholder="+234 800 000 0000" required>
      </div>
      <div class="input-group">
        <label>Delivery Address *</label>
        <textarea id="co-address" rows="3" placeholder="House no., street, estate, LGA — Lagos" required style="width:100%;padding:15px;border:2px solid #edf2f7;background:#f8fafc;font-family:inherit;font-size:1rem;resize:vertical;"></textarea>
      </div>
      <div class="input-group">
        <label>Payment Method</label>
        <select id="co-payment" style="width:100%;padding:15px;border:2px solid #edf2f7;background:#f8fafc;font-family:inherit;font-size:1rem;color:var(--navy);">
          <option>Pay on Delivery</option>
          <option>Bank Transfer</option>
        </select>
      </div>

      <div style="background:#fdfaf5;border:1px solid var(--border-color);padding:20px;margin-bottom:25px;">
        <h4 style="color:var(--navy);margin-bottom:12px;font-size:0.85rem;text-transform:uppercase;letter-spacing:1px;">Order Summary</h4>
        ${cart.map(i => `<div style="display:flex;justify-content:space-between;font-size:0.9rem;margin-bottom:8px;"><span>${i.name} x${i.qty}</span><span style="font-weight:700;">₦${(i.price*i.qty).toLocaleString()}</span></div>`).join('')}
        <div style="border-top:1px solid #ddd;margin-top:10px;padding-top:10px;display:flex;justify-content:space-between;font-size:0.9rem;color:var(--text-muted);">
          <span>Delivery</span><span>${delivery > 0 ? '₦'+delivery.toLocaleString() : 'FREE'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.1rem;color:var(--navy);margin-top:8px;">
          <span>TOTAL</span><span>₦${(total + delivery).toLocaleString()}</span>
        </div>
      </div>

      <button onclick="placeOrder(${total + delivery})" class="btn-primary" id="co-submit-btn" style="width:100%;padding:18px;font-size:1rem;">Place Order →</button>
    </div>`;
  document.body.appendChild(modal);
}

async function placeOrder(grandTotal) {
  const name    = document.getElementById('co-name').value.trim();
  const email   = document.getElementById('co-email').value.trim();
  const phone   = document.getElementById('co-phone').value.trim();
  const address = document.getElementById('co-address').value.trim();
  const payment = document.getElementById('co-payment').value;
  const errEl   = document.getElementById('checkout-error');
  const btn     = document.getElementById('co-submit-btn');

  if (!name || !email || !phone || !address) {
    errEl.textContent = 'Please fill in all required fields.';
    errEl.style.display = 'block';
    return;
  }

  btn.textContent = 'Placing Order…';
  btn.disabled = true;
  errEl.style.display = 'none';

  const orderPayload = {
    action: 'order',
    customerName: name,
    email,
    phone,
    address,
    items: cart.map(i => ({ name: i.name, qty: i.qty, price: i.price, subtotal: i.price * i.qty })),
    total: grandTotal,
    paymentMethod: payment,
  };

  try {
    await api(orderPayload);
  } catch (e) {
    console.warn('Backend unreachable, order logged locally.', e);
  }

  saveOrderToHistory(orderPayload);

  // Clear cart and show success
  cart = [];
  saveCart();
  document.getElementById('checkout-modal')?.remove();

  showSuccess(name, grandTotal, payment);
}

function showSuccess(name, total, payment) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(26,42,58,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="background:#fff;width:100%;max-width:440px;padding:50px;text-align:center;border-top:8px solid var(--gold);">
      <div style="font-size:4rem;margin-bottom:20px;">🥩</div>
      <h2 style="color:var(--navy);text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;">Order Placed!</h2>
      <p style="color:var(--text-muted);margin-bottom:5px;">Thank you, ${name.split(' ')[0]}!</p>
      <p style="color:var(--text-muted);margin-bottom:30px;font-size:0.9rem;">Total: <strong style="color:var(--navy);">₦${total.toLocaleString()}</strong> · ${payment}</p>
      <p style="font-size:0.9rem;color:var(--text-dark);margin-bottom:30px;">Our team will contact you within <strong>30 minutes</strong> to confirm your delivery details.</p>
      <button onclick="this.closest('div').parentElement.remove()" class="btn-primary" style="width:100%;padding:15px;">Done</button>
    </div>`;
  document.body.appendChild(modal);
}

// ── AUTH FORMS ────────────────────────────────────────────────
async function submitSignup(event) {
  event.preventDefault();
  const form = event.target;
  const fullName = form.querySelector('#su-name').value.trim();
  const email    = form.querySelector('#su-email').value.trim();
  const phone    = form.querySelector('#su-phone')?.value.trim() || '';
  const password = form.querySelector('#su-password').value;
  const errEl    = document.getElementById('auth-error');
  const btn      = form.querySelector('button[type=submit]');

  if (!fullName || !email || !password) {
    errEl.textContent = 'Please fill in all fields.'; errEl.style.display = 'block'; return;
  }
  if (password.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return;
  }

  btn.textContent = 'Creating Account…'; btn.disabled = true; errEl.style.display = 'none';

  try {
    await api({ action: 'signup', fullName, email, phone, password });
    saveUser({ fullName, email });
    window.location.href = 'products.html';
  } catch (e) {
    // Fallback: save locally and continue
    saveUser({ fullName, email });
    window.location.href = 'products.html';
  }
}

async function submitSignin(event) {
  event.preventDefault();
  const form = event.target;
  const email    = form.querySelector('#si-email').value.trim();
  const password = form.querySelector('#si-password').value;
  const errEl    = document.getElementById('auth-error');
  const btn      = form.querySelector('button[type=submit]');

  if (!email || !password) {
    errEl.textContent = 'Please enter your email and password.'; errEl.style.display = 'block'; return;
  }

  btn.textContent = 'Signing In…'; btn.disabled = true; errEl.style.display = 'none';

  try {
    const data = await fetch(`${CONFIG.BACKEND_URL}?action=signin&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`).then(r => r.json());
    if (data.success) {
      saveUser(data.user);
      window.location.href = 'products.html';
    } else {
      errEl.textContent = data.message || 'Invalid email or password.';
      errEl.style.display = 'block';
      btn.textContent = 'Sign In'; btn.disabled = false;
    }
  } catch (e) {
    // Fallback for demo / unreachable backend
    errEl.textContent = 'Could not reach server. Try again.';
    errEl.style.display = 'block';
    btn.textContent = 'Sign In'; btn.disabled = false;
  }
}

// ── PRODUCTS PAGE ─────────────────────────────────────────────

// Category accent colours (used for badges & tab highlights)
const CAT_META = {
  'Fresh':             { emoji: '🥩', color: '#e74c3c', desc: 'Raw, unprocessed cuts straight from the farm' },
  'Processed':         { emoji: '🧂', color: '#8e44ad', desc: 'Marinated, seasoned & ready to cook' },
  'Grilled':           { emoji: '🔥', color: '#e67e22', desc: 'Char-grilled to perfection, ready to eat' },
  'Raw':               { emoji: '🫀', color: '#c0392b', desc: 'Pure uncooked cuts — cook your way' },
  'Roasted':           { emoji: '🍖', color: '#d35400', desc: 'Slow-roasted, juicy & full of flavour' },
  'Special Packages':  { emoji: '🎁', color: '#27ae60', desc: 'Promo combos — best value, limited time' },
};

const DEMO_PRODUCTS = [
  // ── FRESH ──────────────────────────────────────────────────
  { id: 'fr1', category: 'Fresh', name: 'Pork Shoulder (Bone-In)', desc: 'Rich marbling, perfect for stews and suya.', price: 4500, img: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600' },
  { id: 'fr2', category: 'Fresh', name: 'Pork Loin Chops', desc: 'Lean and tender, ideal for any cooking method.', price: 5200, img: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=600' },
  { id: 'fr3', category: 'Fresh', name: 'Pork Belly (Skin-On)', desc: 'The classic slab. Fat cap fully intact.', price: 4800, img: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600' },
  { id: 'fr4', category: 'Fresh', name: 'Spare Ribs (Full Rack)', desc: 'Full rack, fall-off-the-bone potential.', price: 6500, img: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600' },
  { id: 'fr5', category: 'Fresh', name: 'Minced Pork (1kg)', desc: '100% pure pork mince, zero fillers.', price: 3800, img: 'https://images.unsplash.com/photo-1602470520998-f4a52199a3d6?w=600' },
  { id: 'fr6', category: 'Fresh', name: 'Pork Neck Bones', desc: 'Great for soups, broths and stews.', price: 3200, img: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600' },

  // ── PROCESSED ──────────────────────────────────────────────
  { id: 'pr1', category: 'Processed', name: 'Smoked Bacon Strips', desc: 'Thick-cut, cold-smoked — no shrinkage guaranteed.', price: 4200, img: 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=600' },
  { id: 'pr2', category: 'Processed', name: 'Pork Sausage Links', desc: 'Hand-linked with bold Nigerian spice blend.', price: 3500, img: 'https://images.unsplash.com/photo-1608039829572-78524f79c4c7?w=600' },
  { id: 'pr3', category: 'Processed', name: 'Marinated Pork Chops', desc: 'Seasoned overnight in our signature blend.', price: 5800, img: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=600' },
  { id: 'pr4', category: 'Processed', name: 'Pork Pepperoni (200g)', desc: 'Pizza-ready, thinly sliced and boldly spiced.', price: 2800, img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600' },
  { id: 'pr5', category: 'Processed', name: 'Smoked Ham Hock', desc: 'Perfect for pepper soup and nkwobi base.', price: 5500, img: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600' },

  // ── GRILLED ────────────────────────────────────────────────
  { id: 'gr1', category: 'Grilled', name: 'Grilled Pork Ribs (Half)', desc: 'Char-grilled, smoky crust, juicy inside. Ready to eat.', price: 7500, img: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600' },
  { id: 'gr2', category: 'Grilled', name: 'Pork Suya Skewers (6pcs)', desc: 'Traditional suya spice on premium pork cuts.', price: 4500, img: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600' },
  { id: 'gr3', category: 'Grilled', name: 'Grilled Pork Belly Strips', desc: 'Caramelised skin, perfectly seasoned. Eat immediately.', price: 5500, img: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600' },
  { id: 'gr4', category: 'Grilled', name: 'BBQ Pork Chops (2pcs)', desc: 'Lagos BBQ-style, basted and flame-finished.', price: 6200, img: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=600' },

  // ── RAW ────────────────────────────────────────────────────
  { id: 'rw1', category: 'Raw', name: 'Whole Pork Leg (Bone-In)', desc: 'Uncut, unprocessed — whole leg for large events.', price: 22000, img: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600' },
  { id: 'rw2', category: 'Raw', name: 'Raw Pork Trotters (1kg)', desc: 'Cleaned trotters, great for jelly stock & stew.', price: 3000, img: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600' },
  { id: 'rw3', category: 'Raw', name: 'Raw Pork Intestines (1kg)', desc: 'Thoroughly cleaned. Used for nkwobi & isiewu style.', price: 2500, img: 'https://images.unsplash.com/photo-1602470520998-f4a52199a3d6?w=600' },
  { id: 'rw4', category: 'Raw', name: 'Pork Fat (Lard, 500g)', desc: 'Pure pork fat for frying, seasoning & pastry.', price: 1800, img: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=600' },
  { id: 'rw5', category: 'Raw', name: 'Raw Pork Liver (500g)', desc: 'Fresh liver, rich in iron. Cook same day.', price: 2200, img: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600' },

  // ── ROASTED ────────────────────────────────────────────────
  { id: 'ro1', category: 'Roasted', name: 'Oven-Roasted Pork Belly', desc: 'Crackling skin, herb-rubbed, slow-roasted 4hrs.', price: 9500, img: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600' },
  { id: 'ro2', category: 'Roasted', name: 'Roasted Spare Ribs (Full)', desc: 'Fall-off-the-bone. Honey-glazed finish.', price: 11000, img: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600' },
  { id: 'ro3', category: 'Roasted', name: 'Pulled Pork (500g)', desc: 'Slow-roasted shoulder, hand-pulled. Sandwich-ready.', price: 6800, img: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600' },
  { id: 'ro4', category: 'Roasted', name: 'Roasted Pork Knuckle', desc: 'Crispy skin, tender meat — German-style preparation.', price: 8200, img: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=600' },
];

// Special Packages (combo promos — separate rendering)
const SPECIAL_PACKAGES = [
  {
    id: 'sp1',
    name: 'Sunday Family Combo',
    tag: 'SAVE ₦3,500',
    desc: 'Pork Shoulder (Bone-In) + Spare Ribs + Smoked Bacon Strips',
    items: ['Pork Shoulder (Bone-In)', 'Spare Ribs (Full Rack)', 'Smoked Bacon Strips'],
    originalPrice: 15200,
    price: 11700,
    img: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600',
  },
  {
    id: 'sp2',
    name: 'Braai Night Pack',
    tag: 'SAVE ₦4,200',
    desc: 'Grilled Pork Ribs + Pork Suya Skewers + BBQ Pork Chops',
    items: ['Grilled Pork Ribs (Half)', 'Pork Suya Skewers (6pcs)', 'BBQ Pork Chops (2pcs)'],
    originalPrice: 18200,
    price: 14000,
    img: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600',
  },
  {
    id: 'sp3',
    name: 'Party Caterer Bundle',
    tag: 'SAVE ₦6,000',
    desc: 'Whole Pork Leg + Roasted Spare Ribs + Pork Sausage Links (x2)',
    items: ['Whole Pork Leg (Bone-In)', 'Roasted Spare Ribs (Full)', 'Pork Sausage Links x2'],
    originalPrice: 40000,
    price: 34000,
    img: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600',
  },
  {
    id: 'sp4',
    name: 'Breakfast Lovers Box',
    tag: 'SAVE ₦2,000',
    desc: 'Smoked Bacon Strips + Pork Sausage Links + Pork Pepperoni',
    items: ['Smoked Bacon Strips', 'Pork Sausage Links', 'Pork Pepperoni (200g)'],
    originalPrice: 10500,
    price: 8500,
    img: 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=600',
  },
  {
    id: 'sp5',
    name: 'Smoke & Roast Duo',
    tag: 'SAVE ₦2,800',
    desc: 'Oven-Roasted Pork Belly + Smoked Ham Hock',
    items: ['Oven-Roasted Pork Belly', 'Smoked Ham Hock'],
    originalPrice: 15000,
    price: 12200,
    img: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600',
  },
];

function searchProducts(query) {
  const q = query.toLowerCase().trim();
  const gridContainer = document.querySelector('.product-grid');
  if (!q) {
      renderProducts(gridContainer, window.allProducts);
      return;
  }
  const filtered = window.allProducts.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.desc.toLowerCase().includes(q) || 
      p.category.toLowerCase().includes(q)
  );
  
  const filteredSpecial = SPECIAL_PACKAGES.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.desc.toLowerCase().includes(q)
  );
  window.filteredSpecial = filteredSpecial.length ? filteredSpecial : null;
  
  renderProducts(gridContainer, filtered);
}

async function loadProducts() {
  const grid = document.querySelector('.product-grid');
  if (!grid) return;

  let wrapper = document.getElementById('products-wrapper');
  if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = 'products-wrapper';
      grid.parentNode.insertBefore(wrapper, grid);
      wrapper.appendChild(grid);
      
      const searchBox = document.createElement('div');
      searchBox.innerHTML = `<input type="text" id="product-search" placeholder="🔍 Search for products, categories, cuts..." style="width:100%; padding: 15px; margin-bottom: 20px; border: 2px solid #edf2f7; background: #f8fafc; font-family: inherit; font-size: 1rem; color: var(--navy); border-radius: 6px;" oninput="searchProducts(this.value)">`;
      wrapper.insertBefore(searchBox, grid);
  }

  let products = DEMO_PRODUCTS;

  try {
    if (!CONFIG.BACKEND_URL.includes('YOUR_')) {
      const fetched = await apiGet('action=products');
      if (Array.isArray(fetched) && fetched.length) products = fetched;
    }
  } catch(e) {}

  window.allProducts = products;
  window.filteredSpecial = null;
  renderProducts(grid, products);
}

function renderProducts(grid, products) {
  const regularCats = Object.keys(CAT_META).filter(c => c !== 'Special Packages');

  // Category tab labels with emojis
  const allTabs = ['All', ...regularCats, 'Special Packages', '🎰 Lucky Draw'];
  const tabs = allTabs.map(c => {
    const meta = CAT_META[c.replace('🎰 ','')];
    const emoji = meta ? meta.emoji + ' ' : '';
    return `<button class="tab-button ${c === 'All' ? 'active' : ''}" onclick="filterCategory(${JSON.stringify(c)},this)">${emoji}${c}</button>`;
  }).join('');

  // Regular category sections
  const catSections = regularCats.map(cat => {
    const items = products.filter(p => p.category === cat);
    if (!items.length) return '';
    const meta = CAT_META[cat];
    return `
      <section class="product-category-section" data-cat="${cat}">
        <div style="padding:10px 8px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <span style="background:${meta.color};color:#fff;font-size:0.7rem;font-weight:800;padding:4px 10px;text-transform:uppercase;letter-spacing:1px;">${meta.emoji} ${cat}</span>
          <span style="color:var(--text-muted);font-size:0.85rem;">${meta.desc}</span>
        </div>
        <div class="arrows">
          <button class="scroll-arrow" onclick="scrollRow(this,-1)">‹</button>
          <div style="flex:1;overflow:hidden;">
            <div class="category-row" id="row-${cat.replace(/\s/g,'_')}">
              ${items.map(p => productCard(p, meta.color)).join('')}
            </div>
          </div>
          <button class="scroll-arrow" onclick="scrollRow(this,1)">›</button>
        </div>
      </section>`;
  }).join('');

  // Special Packages section
  const specialList = window.filteredSpecial || SPECIAL_PACKAGES;
  const spSection = specialList.length ? `
    <section class="product-category-section" data-cat="Special Packages" style="display:none;">
      <div style="padding:10px 8px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
        <span style="background:#27ae60;color:#fff;font-size:0.7rem;font-weight:800;padding:4px 10px;text-transform:uppercase;letter-spacing:1px;">🎁 Special Packages</span>
        <span style="color:var(--text-muted);font-size:0.85rem;">Promo combos — best value, limited time only</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:25px;padding:10px 8px 40px;">
        ${specialList.map(pkg => specialPackageCard(pkg)).join('')}
      </div>
    </section>` : '';

  // Lucky Draw section
  const ldSection = `
    <section class="product-category-section" data-cat="🎰 Lucky Draw" style="display:none;padding:40px 8px;">
      <div id="lucky-draw-panel">${buildLuckyDrawPanel()}</div>
    </section>`;

  grid.innerHTML = `<div class="category-tabs" style="position:sticky;top:74px;z-index:100;background:var(--bg-light);padding:15px 8px;border-bottom:2px solid var(--border-color);">${tabs}</div>` +
    catSections + spSection + ldSection;
}

function productCard(p, accentColor) {
  const inCart = cart.find(i => i.id === p.id);
  const color = accentColor || '#1a2a3a';
  return `
    <div class="item">
      <div style="position:relative;">
        <img src="${p.img}" alt="${p.name}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x250/1a2a3a/ffcc33?text=🥩'" style="width:100%;height:200px;object-fit:cover;">
      </div>
      <div class="item-details">
        <h3 style="border-left:4px solid ${color};padding-left:10px;">${p.name}</h3>
        <p>${p.desc}</p>
        <div class="price-action">
          <span class="price">₦${Number(p.price).toLocaleString()}</span>
          <button class="btn-primary" style="padding:10px 16px;font-size:0.8rem;" onclick="addToCart('${p.id}','${p.name.replace(/'/g,"\\'")}',${p.price},'${p.img}')">
            ${inCart ? `✓ In Basket (${inCart.qty})` : 'Add to Basket'}
          </button>
        </div>
      </div>
    </div>`;
}

function specialPackageCard(pkg) {
  const inCart = cart.find(i => i.id === pkg.id);
  const savings = pkg.originalPrice - pkg.price;
  const pct = Math.round((savings / pkg.originalPrice) * 100);
  return `
    <div style="background:var(--pure-white);border:2px solid #27ae60;position:relative;overflow:hidden;transition:var(--transition);" onmouseover="this.style.transform='translateY(-6px)';this.style.boxShadow='0 20px 40px rgba(0,0,0,0.12)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <!-- Promo ribbon -->
      <div style="position:absolute;top:16px;right:-28px;background:#e74c3c;color:#fff;font-size:0.7rem;font-weight:800;padding:5px 40px;transform:rotate(45deg);letter-spacing:1px;z-index:2;">${pct}% OFF</div>
      <img src="${pkg.img}" alt="${pkg.name}" style="width:100%;height:200px;object-fit:cover;" onerror="this.src='https://via.placeholder.com/300x200/1a2a3a/27ae60?text=🎁'">
      <div style="padding:25px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="background:#27ae60;color:#fff;font-size:0.65rem;font-weight:800;padding:3px 8px;letter-spacing:1px;">${pkg.tag}</span>
        </div>
        <h3 style="color:var(--navy);font-size:1.1rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">${pkg.name}</h3>
        <p style="font-size:0.85rem;color:#666;margin-bottom:12px;">${pkg.desc}</p>
        <div style="background:#f8fffe;border:1px dashed #27ae60;padding:10px 12px;margin-bottom:18px;border-radius:2px;">
          <p style="font-size:0.75rem;font-weight:700;color:#27ae60;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Includes:</p>
          ${pkg.items.map(item => `<p style="font-size:0.8rem;color:var(--text-dark);">✓ ${item}</p>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:15px;border-top:1px solid #eee;">
          <div>
            <span style="font-size:0.85rem;color:var(--text-muted);text-decoration:line-through;">₦${pkg.originalPrice.toLocaleString()}</span>
            <span style="font-size:1.4rem;font-weight:800;color:var(--navy);display:block;line-height:1.2;">₦${pkg.price.toLocaleString()}</span>
          </div>
          <button class="btn-primary" style="padding:12px 18px;font-size:0.8rem;background:#27ae60;color:#fff;" onclick="addToCart('${pkg.id}','${pkg.name.replace(/'/g,"\\'")}',${pkg.price},'${pkg.img}')">
            ${inCart ? '✓ Added!' : 'Grab Deal →'}
          </button>
        </div>
      </div>
    </div>`;
}

// ── LUCKY DRAW ────────────────────────────────────────────────
// Simulated past customers (in production these come from Google Sheets Orders tab)
const MOCK_ORDERS = [
  { name: 'Chioma Adeyemi',   email: 'c.adeyemi@gmail.com',    phone: '080****3421', total: 34500 },
  { name: 'Mr. Segun Bello',  email: 's.bello@gmail.com',      phone: '081****7812', total: 52000 },
  { name: 'Chef Tunde',       email: 'chef.tunde@gmail.com',   phone: '070****9934', total: 44000 },
  { name: 'Amaka O.',         email: 'amaka.o@yahoo.com',      phone: '080****1122', total: 31000 },
  { name: 'Emeka Nwosu',      email: 'emeka.n@gmail.com',      phone: '081****5566', total: 38500 },
  { name: 'Fatima Suleiman',  email: 'f.suleiman@gmail.com',   phone: '070****7788', total: 29000 }, // under 30k — excluded
  { name: 'Kemi Fashola',     email: 'kemi.f@gmail.com',       phone: '080****3344', total: 47000 },
  { name: 'Dayo Akinwale',    email: 'd.akinwale@gmail.com',   phone: '081****9900', total: 30500 },
  { name: 'Ngozi Peters',     email: 'ngozi.p@gmail.com',      phone: '070****6677', total: 25000 }, // excluded
  { name: 'Biodun Martins',   email: 'biodun.m@gmail.com',     phone: '080****4455', total: 61000 },
];

function buildLuckyDrawPanel() {
  const eligible = MOCK_ORDERS.filter(o => o.total >= 30000);
  return `
    <div style="max-width:680px;margin:0 auto;text-align:center;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,var(--navy),#253a50);padding:50px 40px;border-bottom:6px solid var(--gold);">
        <div style="font-size:3.5rem;margin-bottom:15px;">🎰</div>
        <h2 style="color:#fff;font-size:2rem;text-transform:uppercase;letter-spacing:3px;margin-bottom:10px;">Lucky Draw</h2>
        <p style="color:#8da1b5;font-size:0.95rem;">One lucky customer wins a FREE Special Package</p>
        <div style="display:inline-block;background:rgba(255,204,51,0.15);border:1px solid var(--gold);padding:8px 20px;margin-top:15px;">
          <span style="color:var(--gold);font-weight:800;font-size:0.85rem;letter-spacing:1px;">ELIGIBLE: CUSTOMERS WHO SPENT ₦30,000+</span>
        </div>
      </div>

      <!-- Eligible pool -->
      <div style="background:#fff;padding:30px;border-left:1px solid #eee;border-right:1px solid #eee;">
        <p style="font-size:0.8rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:15px;">${eligible.length} Eligible Customers in the Pool</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:25px;">
          ${eligible.map(c => `
            <div id="pool-${c.email.replace(/[@.]/g,'_')}" style="background:var(--bg-light);border:1px solid var(--border-color);padding:6px 14px;font-size:0.8rem;font-weight:600;color:var(--navy);transition:0.3s;">
              ${c.name.split(' ')[0]}
            </div>`).join('')}
        </div>

        <!-- Draw button -->
        <div id="draw-result" style="min-height:160px;display:flex;align-items:center;justify-content:center;">
          <button onclick="runLuckyDraw()" id="draw-btn" style="background:var(--gold);color:var(--navy);border:none;padding:20px 50px;font-size:1.1rem;font-weight:800;text-transform:uppercase;letter-spacing:2px;cursor:pointer;transition:0.3s;" onmouseover="this.style.background='var(--navy)';this.style.color='var(--gold)'" onmouseout="this.style.background='var(--gold)';this.style.color='var(--navy)'">
            🎲 Pick a Winner
          </button>
        </div>
      </div>

      <!-- Note -->
      <div style="background:#fffbea;border:1px solid var(--gold);padding:15px 25px;font-size:0.8rem;color:var(--navy);text-align:left;">
        <strong>Admin Note:</strong> In production, this panel fetches live data from your Google Sheets "Orders" tab and picks from customers with total spend ≥ ₦30,000. The draw result is also logged to a "Winners" sheet.
      </div>
    </div>`;
}

function runLuckyDraw() {
  const eligible = MOCK_ORDERS.filter(o => o.total >= 30000);
  const btn = document.getElementById('draw-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Drawing…'; }

  // Slot-machine shuffle animation
  let count = 0;
  const total = 20; // number of flashes
  const resultEl = document.getElementById('draw-result');
  const names = eligible.map(e => e.name);

  const interval = setInterval(() => {
    const random = names[Math.floor(Math.random() * names.length)];
    if (resultEl) {
      resultEl.innerHTML = `<div style="font-size:1.5rem;font-weight:800;color:var(--navy);opacity:0.4;letter-spacing:2px;">${random}</div>`;
    }
    count++;
    if (count >= total) {
      clearInterval(interval);
      // Pick real winner
      const winner = eligible[Math.floor(Math.random() * eligible.length)];
      showWinner(winner);
    }
  }, 100);
}

function showWinner(winner) {
  // Highlight the winner's chip
  const id = `pool-${winner.email.replace(/[@.]/g,'_')}`;
  document.querySelectorAll('[id^="pool-"]').forEach(el => {
    el.style.opacity = '0.3';
    el.style.background = '#f5f5f5';
  });
  const winnerEl = document.getElementById(id);
  if (winnerEl) {
    winnerEl.style.opacity = '1';
    winnerEl.style.background = 'var(--gold)';
    winnerEl.style.color = 'var(--navy)';
    winnerEl.style.fontWeight = '900';
    winnerEl.style.transform = 'scale(1.15)';
    winnerEl.style.border = '2px solid var(--navy)';
  }

  const resultEl = document.getElementById('draw-result');
  if (resultEl) {
    resultEl.innerHTML = `
      <div style="animation:fadeInSlide 0.5s ease-out;text-align:center;padding:20px;">
        <div style="font-size:3rem;margin-bottom:10px;">🏆</div>
        <h3 style="color:var(--navy);font-size:1.5rem;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">${winner.name}</h3>
        <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:4px;">${winner.phone}</p>
        <p style="color:#27ae60;font-weight:800;font-size:0.85rem;margin-bottom:20px;">Total Spent: ₦${winner.total.toLocaleString()}</p>
        <div style="display:inline-block;background:var(--gold);color:var(--navy);padding:10px 30px;font-weight:800;font-size:0.85rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:15px;">
          🎁 Wins a FREE Special Package!
        </div>
        <br>
        <button onclick="document.getElementById('lucky-draw-panel').innerHTML=buildLuckyDrawPanel()" style="background:none;border:2px solid var(--navy);color:var(--navy);padding:8px 20px;font-weight:700;cursor:pointer;margin-top:10px;font-size:0.8rem;letter-spacing:1px;">↺ Draw Again</button>
      </div>`;
  }
}

function filterCategory(cat, btn) {
  document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Hide all sections
  document.querySelectorAll('.product-category-section').forEach(s => {
    s.style.display = 'none';
  });

  if (cat === 'All') {
    // Show all except Lucky Draw and Special Packages
    document.querySelectorAll('.product-category-section').forEach(s => {
      if (s.dataset.cat !== 'Special Packages' && s.dataset.cat !== '🎰 Lucky Draw') {
        s.style.display = 'block';
      }
    });
  } else {
    const target = document.querySelector(`.product-category-section[data-cat="${cat}"]`);
    if (target) target.style.display = 'block';
  }
}

function scrollRow(btn, dir) {
  const row = btn.closest('.arrows').querySelector('.category-row');
  row.scrollBy({ left: dir * 320, behavior: 'smooth' });
}

// ── CONTACT FORM ──────────────────────────────────────────────
async function submitContact(event) {
  event.preventDefault();
  const form = event.target;
  const name    = form.querySelector('input[type=text]').value.trim();
  const email   = form.querySelector('input[type=email]').value.trim();
  const message = form.querySelector('textarea').value.trim();
  const btn     = form.querySelector('button[type=submit]');

  btn.textContent = 'Sending…'; btn.disabled = true;

  try {
    await api({ action: 'contact', name, email, message });
  } catch(e) {}

  window.location.href = 'thank-you.html';
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const currentPage = getCurrentPageName();

  if (!currentUser && !isPublicPage(currentPage)) {
    window.location.href = getSigninRedirectUrl();
    return;
  }

  if (currentUser && isPublicPage(currentPage)) {
    window.location.href = 'products.html';
    return;
  }

  buildNav();
  buildFooter();
  buildCartDrawer();
  loadProducts();

  // Attach contact form
  const contactForm = document.getElementById('contact-form');
  if (contactForm) contactForm.onsubmit = submitContact;

});
