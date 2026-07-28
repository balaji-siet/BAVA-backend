require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const { connectMongoDB, getMongoError } = require('./config/mongodb');

const apiRouter = require('./routes/api');
const notificationService = require('./services/notificationService');

const app = express();
const server = http.createServer(app);
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:8081', 'https://bava-smart-mess.vercel.app', 'http://localhost:19006'];

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || (origin && origin.match(/^https?:\/\/localhost(:\d+)?$/)) || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('CORS policy violation for WebSocket connection.'));
      }
    },
    methods: ['GET', 'POST']
  }
});

app.set('io', io);

const PORT = process.env.PORT || 5000;

const helmet = require('helmet');
const morgan = require('morgan');

app.use(helmet());
app.use(morgan('dev'));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }
    // Allow all localhost origins (any port) for development
    if (origin.match(/^https?:\/\/localhost(:\d+)?$/)) {
      return callback(null, true);
    }
    // Allow configured origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // In non-production, allow everything
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    callback(new Error('CORS policy: Access denied for this origin.'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Bypass-Tunnel-Reminder', 'x-bypass-windows'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const mongoose = require('mongoose');

// Required Root Health Routes
app.get('/', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  const errorReason = getMongoError();

  if (isConnected) {
    res.status(200).json({
      status: 'healthy',
      server: 'SMART MESS Backend',
      database: 'connected'
    });
  } else {
    res.status(200).json({
      status: 'healthy',
      server: 'SMART MESS Backend',
      database: 'disconnected',
      reason: errorReason || 'MongoDB Atlas connection in progress or unreachable'
    });
  }
});

app.get('/health', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  const errorReason = getMongoError();

  if (isConnected) {
    res.status(200).json({
      status: 'healthy',
      server: 'SMART MESS Backend',
      database: 'connected'
    });
  } else {
    res.status(200).json({
      status: 'healthy',
      server: 'SMART MESS Backend',
      database: 'disconnected',
      reason: errorReason || 'MongoDB Atlas connection in progress or unreachable'
    });
  }
});

// API Routes
app.use('/api', apiRouter);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

notificationService.initializeSchedules();

// Periodic 60-second check for dynamic meal reservation cut-offs and automatic SMS dispatches
const { checkCutoffsAndSendSMS } = require('./controllers/mealSettingsController');
setInterval(() => {
  checkCutoffsAndSendSMS();
}, 60000);

io.on('connection', (socket) => {
  console.log(`WebSocket client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`WebSocket client disconnected: ${socket.id}`);
  });
});

// Connect to MongoDB and then start Server
(async () => {
  await connectMongoDB();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`============================================================`);
    console.log(`SRI Shakthi Smart Mess server is running on port ${PORT}`);
    console.log(`Bound to host: 0.0.0.0`);
    console.log(`Env Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`API base URL: http://0.0.0.0:${PORT}/api`);
    console.log(`============================================================`);
  });
})();
