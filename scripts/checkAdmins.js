const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Technician Schema
const TechnicianSchema = new mongoose.Schema({
  name: String,
  password: String,
  role: String,
  isAdmin: Boolean,
  gmail: String,
  profileImage: String
}, { timestamps: true });

const Technician = mongoose.model('Technician', TechnicianSchema);

// Check admin accounts
const checkAdmins = async () => {
  try {
    await connectDB();

    console.log('\n📋 Checking admin accounts...\n');

    // Find all users with admin-related roles
    const admins = await Technician.find({
      $or: [
        { role: 'admin' },
        { role: 'superadmin' },
        { isAdmin: true },
        { name: { $in: ['Marko', 'Ana', 'Administrator', 'SuperAdministrator'] } }
      ]
    }).select('name role isAdmin gmail createdAt');

    console.log(`Found ${admins.length} admin accounts:\n`);

    admins.forEach((admin, index) => {
      console.log(`${index + 1}. ${admin.name}`);
      console.log(`   - Role: ${admin.role}`);
      console.log(`   - isAdmin: ${admin.isAdmin}`);
      console.log(`   - Gmail: ${admin.gmail || 'Not set'}`);
      console.log(`   - Created: ${admin.createdAt}`);
      console.log(`   - ID: ${admin._id}\n`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking admins:', error);
    process.exit(1);
  }
};

checkAdmins();
