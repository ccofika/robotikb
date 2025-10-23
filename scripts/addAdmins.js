const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Technician Schema
const TechnicianSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  materials: [{
    materialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Material'
    },
    quantity: {
      type: Number,
      default: 0
    }
  }],
  basicEquipment: [{
    basicEquipmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BasicEquipment'
    },
    quantity: {
      type: Number,
      default: 0
    }
  }],
  equipment: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Equipment'
  }],
  role: {
    type: String,
    enum: ['technician', 'admin', 'superadmin', 'supervisor'],
    default: 'technician'
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  gmail: {
    type: String,
    required: false,
    default: ''
  },
  profileImage: {
    type: String,
    required: false,
    default: ''
  },
  paymentType: {
    type: String,
    enum: ['po_statusu', 'plata'],
    default: 'po_statusu'
  },
  monthlySalary: {
    type: Number,
    default: 0,
    min: 0
  },
  pushNotificationToken: {
    type: String,
    required: false,
    default: null
  },
  pushNotificationsEnabled: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

const Technician = mongoose.model('Technician', TechnicianSchema);

// Main function to add admin accounts
const addAdminAccounts = async () => {
  try {
    await connectDB();

    const password = 'Robotik2024!';
    const hashedPassword = await bcrypt.hash(password, 10);

    // Admin accounts to create
    const admins = [
      {
        name: 'Marko',
        password: hashedPassword,
        role: 'admin',
        isAdmin: true,
        gmail: '',
        profileImage: '',
        materials: [],
        equipment: [],
        basicEquipment: []
      },
      {
        name: 'Ana',
        password: hashedPassword,
        role: 'admin',
        isAdmin: true,
        gmail: '',
        profileImage: '',
        materials: [],
        equipment: [],
        basicEquipment: []
      }
    ];

    console.log('\n🔄 Creating admin accounts...\n');

    for (const adminData of admins) {
      // Check if admin already exists
      const existingAdmin = await Technician.findOne({ name: adminData.name });

      if (existingAdmin) {
        console.log(`⚠️  Admin "${adminData.name}" already exists. Skipping...`);
        continue;
      }

      // Create new admin
      const newAdmin = new Technician(adminData);
      await newAdmin.save();

      console.log(`✅ Successfully created admin: ${adminData.name}`);
      console.log(`   - Username: ${adminData.name}`);
      console.log(`   - Password: ${password}`);
      console.log(`   - Role: ${adminData.role}`);
      console.log(`   - ID: ${newAdmin._id}\n`);
    }

    console.log('✅ Admin account creation completed!\n');
    console.log('📋 Summary:');
    console.log('   - Both accounts have admin role');
    console.log('   - Both accounts have the same privileges as "Administrator"');
    console.log(`   - Password for both: ${password}\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin accounts:', error);
    process.exit(1);
  }
};

// Run the script
addAdminAccounts();
