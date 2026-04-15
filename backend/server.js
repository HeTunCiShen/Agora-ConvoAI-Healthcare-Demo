require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const agoraRoutes = require('./routes/agora_routes');
const { router: healthcareRouter } = require('./routes/healthcare_routes');
const { addClient } = require('./sse');
const basicAuth = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// IP Whitelist middleware (optional)
const allowedIPs = process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',') : [];
if (allowedIPs.length > 0) {
  app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    if (!allowedIPs.includes(clientIP)) {
      return res.status(403).json({ error: 'Access denied from this IP address' });
    }
    next();
  });
}

// Health check (no auth)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// SSE endpoint — must be BEFORE basicAuth so EventSource can connect without auth headers
app.get('/events', (req, res) => addClient(res));

// Static files
app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
    else if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
  }
}));
app.use('/src', express.static(path.join(__dirname, '../src')));
app.use('/lib', express.static(path.join(__dirname, '../node_modules'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
  }
}));

// Auth on all /api routes
app.use('/api', basicAuth);
app.use('/api/agora', agoraRoutes);
app.use('/api/healthcare', healthcareRouter);

// Helper: serve an HTML file with injected auth credentials
function serveHtml(filePath, res) {
  let html = fs.readFileSync(filePath, 'utf8');
  const authScript = `<script>
    window.APP_AUTH_USERNAME = ${JSON.stringify(process.env.AUTH_USERNAME || '')};
    window.APP_AUTH_PASSWORD = ${JSON.stringify(process.env.AUTH_PASSWORD || '')};
  </script>`;
  html = html.replace('</head>', `${authScript}</head>`);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}

app.get('/patient', (req, res) => {
  serveHtml(path.join(__dirname, '../frontend/patient.html'), res);
});

app.get('/doctor', (req, res) => {
  serveHtml(path.join(__dirname, '../frontend/doctor.html'), res);
});

app.get('/', basicAuth, (req, res) => {
  serveHtml(path.join(__dirname, '../frontend/index.html'), res);
});

// Only start listening when run directly (not during tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Patient page: http://localhost:${PORT}/patient`);
    console.log(`Doctor page:  http://localhost:${PORT}/doctor`);
  });
}

module.exports = app;
