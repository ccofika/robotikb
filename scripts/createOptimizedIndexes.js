const mongoose = require('mongoose');
require('dotenv').config();

const Log = require('../models/Log');
const WorkOrder = require('../models/WorkOrder');

async function createOptimizedIndexes() {
  try {
    console.log('🚀 Starting MongoDB index optimization...');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Dobijanje referenci na kolekcije
    const logCollection = mongoose.connection.collection('logs');
    const workOrderCollection = mongoose.connection.collection('workorders');

    console.log('\n📊 Analyzing existing indexes...');

    // Analiza postojećih indeksa
    const existingLogIndexes = await logCollection.indexes();
    const existingWorkOrderIndexes = await workOrderCollection.indexes();

    console.log(`\n📝 Existing Log indexes: ${existingLogIndexes.length}`);
    existingLogIndexes.forEach(index => {
      console.log(`   - ${JSON.stringify(index.key)}`);
    });

    console.log(`\n📝 Existing WorkOrder indexes: ${existingWorkOrderIndexes.length}`);
    existingWorkOrderIndexes.forEach(index => {
      console.log(`   - ${JSON.stringify(index.key)}`);
    });

    console.log('\n🔧 Creating optimized indexes for Log collection...');

    // =============================================
    // LOG COLLECTION OPTIMIZED INDEXES
    // =============================================

    // 1. Glavni dashboard filter kombinacije
    console.log('   Creating compound dashboard filter indexes...');
    await logCollection.createIndex(
      {
        "timestamp": -1,
        "action": 1,
        "performedByName": 1
      },
      {
        name: "dashboard_main_filter",
        background: true
      }
    );

    await logCollection.createIndex(
      {
        "timestamp": -1,
        "workOrderInfo.municipality": 1,
        "action": 1
      },
      {
        name: "dashboard_municipality_filter",
        background: true
      }
    );

    await logCollection.createIndex(
      {
        "timestamp": -1,
        "performedByName": 1,
        "workOrderInfo.municipality": 1
      },
      {
        name: "dashboard_combined_filter",
        background: true
      }
    );

    // 2. KPI optimizacije
    console.log('   Creating KPI-specific indexes...');
    await logCollection.createIndex(
      {
        "action": 1,
        "timestamp": -1,
        "performedByName": 1
      },
      {
        name: "kpi_action_lookup",
        background: true
      }
    );

    // 3. Aggregation optimizacije
    console.log('   Creating aggregation-optimized indexes...');
    await logCollection.createIndex(
      {
        "timestamp": -1,
        "action": 1
      },
      {
        name: "time_action_agg",
        background: true,
        sparse: true
      }
    );

    // 4. WorkOrder join optimizacija
    await logCollection.createIndex(
      {
        "workOrderId": 1,
        "timestamp": -1,
        "action": 1
      },
      {
        name: "workorder_join_opt",
        background: true
      }
    );

    // 5. Response time calculation optimizacija
    await logCollection.createIndex(
      {
        "action": 1,
        "workOrderId": 1,
        "timestamp": -1
      },
      {
        name: "response_time_calc",
        background: true
      }
    );

    // 6. Text search podrška
    console.log('   Creating text search indexes...');
    try {
      await logCollection.createIndex(
        {
          "workOrderInfo.address": "text",
          "workOrderInfo.userName": "text",
          "description": "text"
        },
        {
          name: "text_search_support",
          background: true,
          weights: {
            "workOrderInfo.address": 10,
            "workOrderInfo.userName": 5,
            "description": 1
          }
        }
      );
    } catch (err) {
      console.log('   ⚠️ Text index already exists or error:', err.message);
    }

    // 7. Hourly activity distribution
    await logCollection.createIndex(
      {
        "timestamp": -1,
        "performedByName": 1
      },
      {
        name: "hourly_activity_opt",
        background: true
      }
    );

    console.log('\n🔧 Creating optimized indexes for WorkOrder collection...');

    // =============================================
    // WORKORDER COLLECTION OPTIMIZED INDEXES
    // =============================================

    // 1. Dashboard kombinacije
    console.log('   Creating dashboard filter indexes...');
    await workOrderCollection.createIndex(
      {
        "date": -1,
        "status": 1,
        "municipality": 1
      },
      {
        name: "dashboard_date_status_mun",
        background: true
      }
    );

    await workOrderCollection.createIndex(
      {
        "status": 1,
        "statusChangedAt": -1,
        "technicianId": 1
      },
      {
        name: "status_change_tech",
        background: true
      }
    );

    // 2. Cancellation analysis
    console.log('   Creating cancellation analysis indexes...');
    await workOrderCollection.createIndex(
      {
        "status": 1,
        "statusChangedAt": -1,
        "municipality": 1
      },
      {
        name: "cancellation_analysis",
        background: true
      }
    );

    // 3. Technician comparison
    console.log('   Creating technician comparison indexes...');
    await workOrderCollection.createIndex(
      {
        "technicianId": 1,
        "date": -1,
        "status": 1
      },
      {
        name: "tech_comparison_main",
        background: true
      }
    );

    await workOrderCollection.createIndex(
      {
        "technician2Id": 1,
        "date": -1,
        "status": 1
      },
      {
        name: "tech_comparison_secondary",
        background: true
      }
    );

    // 4. Interactive map optimizacija
    await workOrderCollection.createIndex(
      {
        "municipality": 1,
        "date": -1,
        "status": 1
      },
      {
        name: "interactive_map_opt",
        background: true
      }
    );

    // 5. Financial analysis
    await workOrderCollection.createIndex(
      {
        "verifiedAt": -1,
        "municipality": 1,
        "technicianId": 1
      },
      {
        name: "financial_analysis",
        background: true
      }
    );

    console.log('\n📈 Creating specialized performance indexes...');

    // =============================================
    // PERFORMANCE-SPECIFIC INDEXES
    // =============================================

    // 1. Coverage queries (svi dashboard filter kombinazioni)
    await logCollection.createIndex(
      {
        "timestamp": -1,
        "action": 1,
        "performedByName": 1,
        "workOrderInfo.municipality": 1
      },
      {
        name: "full_dashboard_coverage",
        background: true
      }
    );

    // 2. Sorted result optimizacija
    await logCollection.createIndex(
      {
        "timestamp": -1,
        "_id": 1
      },
      {
        name: "sorted_pagination",
        background: true
      }
    );

    // 3. Distinct operations optimizacija
    await logCollection.createIndex(
      {
        "performedByName": 1
      },
      {
        name: "distinct_technicians",
        background: true,
        sparse: true
      }
    );

    await logCollection.createIndex(
      {
        "workOrderInfo.municipality": 1
      },
      {
        name: "distinct_municipalities",
        background: true,
        sparse: true
      }
    );

    console.log('\n✅ Index creation completed!');

    // Prikaz finalnih statistika
    console.log('\n📊 Final index statistics:');

    const finalLogIndexes = await logCollection.indexes();
    const finalWorkOrderIndexes = await workOrderCollection.indexes();

    console.log(`\n✅ Log collection indexes: ${finalLogIndexes.length}`);
    finalLogIndexes.forEach(index => {
      console.log(`   - ${index.name}: ${JSON.stringify(index.key)}`);
    });

    console.log(`\n✅ WorkOrder collection indexes: ${finalWorkOrderIndexes.length}`);
    finalWorkOrderIndexes.forEach(index => {
      console.log(`   - ${index.name}: ${JSON.stringify(index.key)}`);
    });

    // Prikaz index sizes
    console.log('\n📏 Index size analysis:');
    const logStats = await logCollection.stats();
    const workOrderStats = await workOrderCollection.stats();

    console.log(`   Log collection total size: ${(logStats.totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Log collection index size: ${(logStats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   WorkOrder collection total size: ${(workOrderStats.totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   WorkOrder collection index size: ${(workOrderStats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`);

    console.log('\n🚀 MongoDB optimization completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('   1. Implement Redis caching layer');
    console.log('   2. Optimize aggregation pipelines');
    console.log('   3. Add query performance monitoring');
    console.log('   4. Test with production-like data volume');

  } catch (error) {
    console.error('❌ Error during index creation:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run if called directly
if (require.main === module) {
  createOptimizedIndexes()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = createOptimizedIndexes;