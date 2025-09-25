// Create database indexes for optimal user queries performance
const { connectDB } = require('../config/db');
const { User, WorkOrder, Equipment } = require('../models');
const mongoose = require('mongoose');

async function addUserIndexes() {
  try {
    console.log('🔍 Adding database indexes for user queries...');

    // User collection indexes
    console.log('📊 Adding User collection indexes...');
    await User.collection.createIndex({ name: 1 });
    await User.collection.createIndex({ tisId: 1 }, { unique: true });
    await User.collection.createIndex({ address: 1 });
    await User.collection.createIndex({ phone: 1 });
    await User.collection.createIndex({ createdAt: -1 });

    // Compound index for search
    await User.collection.createIndex({
      name: 'text',
      address: 'text',
      phone: 'text',
      tisId: 'text'
    }, { name: 'search_text_index' });

    // WorkOrder collection indexes for user lookups
    console.log('📊 Adding WorkOrder collection indexes...');
    await WorkOrder.collection.createIndex({ userId: 1, date: -1 });
    await WorkOrder.collection.createIndex({ userId: 1, status: 1 });

    // Equipment collection indexes for user lookups
    console.log('📊 Adding Equipment collection indexes...');
    await Equipment.collection.createIndex({ location: 1, status: 1 });

    console.log('✅ All indexes created successfully!');

    // List all indexes to verify
    const userIndexes = await User.collection.indexes();
    const workOrderIndexes = await WorkOrder.collection.indexes();
    const equipmentIndexes = await Equipment.collection.indexes();

    console.log('\n📋 Created indexes:');
    console.log('User indexes:', userIndexes.map(i => i.name));
    console.log('WorkOrder indexes:', workOrderIndexes.map(i => i.name));
    console.log('Equipment indexes:', equipmentIndexes.map(i => i.name));

  } catch (error) {
    console.error('❌ Error creating indexes:', error);
  } finally {
    mongoose.disconnect();
    process.exit(0);
  }
}

// Connect to database and add indexes
connectDB().then(() => {
  addUserIndexes();
});