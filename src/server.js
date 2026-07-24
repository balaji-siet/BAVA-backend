require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const connectMongoDB = require('./config/mongodb');

connectMongoDB();

const apiRouter = require('./routes/api');
const notificationService = require('./services/notificationService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Attach socket.io to the app context so it can be accessed in controllers
app.set('io', io);

const PORT = process.env.PORT || 5000;

const helmet = require('helmet');
const morgan = require('morgan');

// Middleware
app.use(helmet());
app.use(morgan('dev'));
// Strict production CORS origin whitelist
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:8081', 'https://bava-smart-mess.vercel.app'];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: Access denied for this origin.'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Bypass-Tunnel-Reminder', 'x-bypass-windows'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Required Health Routes
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    message: 'Welcome to SMART MESS API',
    version: '1.0.0'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy'
  });
});

// API Routes
app.use('/api', apiRouter);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Initialize Scheduled Notifications (Cutoffs)
notificationService.initializeSchedules();

// Socket.IO event handler
io.on('connection', (socket) => {
  console.log(`WebSocket client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`WebSocket client disconnected: ${socket.id}`);
  });
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`============================================================`);
  console.log(`SRI Shakthi Smart Mess server is running on port ${PORT}`);
  console.log(`Bound to host: 0.0.0.0`);
  console.log(`Env Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`API base URL: http://0.0.0.0:${PORT}/api`);
  console.log(`============================================================`);
});


