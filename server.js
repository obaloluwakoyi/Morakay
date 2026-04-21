const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PORT = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(response, statusCode, payload) {
  setCorsHeaders(response);
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function ensureUserStore() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(USERS_FILE);
  } catch (error) {
    await fsp.writeFile(USERS_FILE, '[]\n', 'utf8');
  }
}

async function readUsers() {
  await ensureUserStore();
  try {
    const raw = await fsp.readFile(USERS_FILE, 'utf8');
    const users = JSON.parse(raw);
    return Array.isArray(users) ? users : [];
  } catch (error) {
    return [];
  }
}

async function writeUsers(users) {
  await ensureUserStore();
  await fsp.writeFile(USERS_FILE, `${JSON.stringify(users, null, 2)}\n`, 'utf8');
}

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function createUserId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, passwordHash = '') {
  const [salt, storedHash] = String(passwordHash).split(':');
  if (!salt || !storedHash) return false;
  const candidateHash = crypto.scryptSync(password, salt, 64);
  const expectedHash = Buffer.from(storedHash, 'hex');
  if (candidateHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

function toSessionUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone || '',
  };
}

async function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large.'));
        request.destroy();
      }
    });

    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });

    request.on('error', reject);
  });
}

async function handleSignup(request, response) {
  const payload = await readJsonBody(request);
  const fullName = String(payload.fullName || '').trim();
  const email = normalizeEmail(payload.email);
  const phone = String(payload.phone || '').trim();
  const password = String(payload.password || '');

  if (!fullName || !email || !password) {
    sendJson(response, 400, { success: false, message: 'Full name, email, and password are required.' });
    return;
  }
  if (password.length < 6) {
    sendJson(response, 400, { success: false, message: 'Password must be at least 6 characters.' });
    return;
  }

  const users = await readUsers();
  const existingUser = users.find(user => normalizeEmail(user.email) === email);
  if (existingUser) {
    sendJson(response, 409, { success: false, message: 'An account with this email already exists.' });
    return;
  }

  const user = {
    id: createUserId(),
    fullName,
    email,
    phone,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  await writeUsers(users);

  sendJson(response, 201, { success: true, user: toSessionUser(user) });
}

async function handleSignin(request, response) {
  const payload = await readJsonBody(request);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');

  if (!email || !password) {
    sendJson(response, 400, { success: false, message: 'Email and password are required.' });
    return;
  }

  const users = await readUsers();
  const user = users.find(entry => normalizeEmail(entry.email) === email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    sendJson(response, 401, { success: false, message: 'Invalid email or password.' });
    return;
  }

  sendJson(response, 200, { success: true, user: toSessionUser(user) });
}

async function handleResetPassword(request, response) {
  const payload = await readJsonBody(request);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');

  if (!email || !password) {
    sendJson(response, 400, { success: false, message: 'Email and new password are required.' });
    return;
  }
  if (password.length < 6) {
    sendJson(response, 400, { success: false, message: 'Password must be at least 6 characters.' });
    return;
  }

  const users = await readUsers();
  const userIndex = users.findIndex(entry => normalizeEmail(entry.email) === email);
  if (userIndex < 0) {
    sendJson(response, 404, { success: false, message: 'No account found for this email.' });
    return;
  }

  users[userIndex].passwordHash = hashPassword(password);
  users[userIndex].updatedAt = new Date().toISOString();
  await writeUsers(users);

  sendJson(response, 200, { success: true, user: toSessionUser(users[userIndex]) });
}

async function serveStaticFile(requestPath, response) {
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const resolvedPath = path.normalize(path.join(ROOT_DIR, relativePath));

  if (!resolvedPath.startsWith(ROOT_DIR)) {
    sendJson(response, 403, { success: false, message: 'Access denied.' });
    return;
  }

  let filePath = resolvedPath;
  try {
    const stats = await fsp.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch (error) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === 'OPTIONS') {
    setCorsHeaders(response);
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (request.method === 'POST' && url.pathname === '/api/auth/signup') {
      await handleSignup(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/signin') {
      await handleSignin(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/reset-password') {
      await handleResetPassword(request, response);
      return;
    }

    if (request.method === 'GET') {
      await serveStaticFile(url.pathname, response);
      return;
    }

    sendJson(response, 404, { success: false, message: 'Route not found.' });
  } catch (error) {
    sendJson(response, 500, { success: false, message: error.message || 'Server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`Morakay server running on http://127.0.0.1:${PORT}`);
});
