const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["*"]
  }
});

// Store current state
let currentPages = [{ id: 1, lines: [], shapes: [] }];

// Serve static files from the React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'build')));
}

// Keep the public folder for other static assets
app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('a user connected');
  
  // Send current state to new clients
  socket.emit('draw-update', { pages: currentPages });

  // Handle all drawing updates
  socket.on('draw-update', (data) => {
    if (data.pages) {
      // Process and validate shape data
      const processedPages = data.pages.map(page => ({
        ...page,
        shapes: Array.isArray(page.shapes) ? page.shapes.map(shape => {
          // Ensure shape has required properties
          if (!shape.id) shape.id = Date.now().toString();
          
          // Make sure shape has all required properties based on type
          if (shape.type === 'line' && !shape.points) {
            shape.points = [];
          }
          
          // Ensure numeric properties are valid
          if (shape.x === undefined) shape.x = 0;
          if (shape.y === undefined) shape.y = 0;
          if (shape.width === undefined) shape.width = 10;
          if (shape.height === undefined) shape.height = 10;
          if (shape.strokeWidth === undefined) shape.strokeWidth = 5;
          
          return shape;
        }) : []
      }));
      
      currentPages = processedPages;
      // Broadcast to all clients including sender
      io.emit('draw-update', { pages: currentPages });
    }
  });

  // Keep this handler for backward compatibility
  socket.on('add-page', (data) => {
    if (data.pages) {
      currentPages = data.pages;
      io.emit('draw-update', { pages: currentPages }); // Changed to use draw-update for consistency
    }
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

// Catch-all handler to serve the React app in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  });
}

// Use PORT from environment variable or default to 3001
const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});