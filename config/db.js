const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB konekcija uspešna');
  } catch (error) {
    console.error('Greška pri povezivanju sa MongoDB:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB; 