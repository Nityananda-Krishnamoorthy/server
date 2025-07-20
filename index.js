require('dotenv').config();

const express = require('express');
const { connect } = require('mongoose');

const cors = require('cors');
const upload = require('express-fileupload');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

const app = express();

// Middleware
app.use(cors());
// app.use(cors({ credentials: true, origin: process.env.CLIENT_URL }));
app.use(express.json()); //{ extended: true }
app.use(express.urlencoded({ extended: true }));
app.use(upload()); // move this AFTER json/urlencoded


// Debug check
// console.log('Mongo URI:', process.env.MONGO_URI);
// app.post('/test', (req, res) => {
//   console.log("Hit /test");
//   console.log("Body:", req.body);
//   res.send("Test OK");
// });

// Routes
app.use('/api/v1.1', require('./routes/index.js'));

// error handling
app.use(notFound);
app.use(errorHandler)

// MongoDB Connection + Server Startup
connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () =>
      console.log(`Server is running on http://localhost:${PORT} `)
    );
  })
  .catch((err) => console.log('MongoDB connection error:', err));
