const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve a basic welcome message on root path
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Welcome to the SRI Shakthi Smart Mess API Server',
    status: 'online',
    version: '1.0.0',
    documentation: 'See API spec sheet'
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


