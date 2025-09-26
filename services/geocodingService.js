const axios = require('axios');

class GeocodingService {
  constructor() {
    // Using OpenStreetMap Nominatim API (free and reliable for Serbian locations)
    this.baseURL = 'https://nominatim.openstreetmap.org/search';
    this.cache = new Map(); // In-memory cache for coordinates
    this.rateLimitDelay = 1000; // Nominatim requires 1 second between requests
    this.lastRequestTime = 0;
  }

  // Rate limiting helper
  async enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();
  }

  // Clean and normalize municipality name for better geocoding results
  normalizeMunicipalityName(municipality) {
    if (!municipality) return '';

    // Remove extra whitespace and convert to lowercase
    let normalized = municipality.trim().toLowerCase();

    // Handle common variations
    const variations = {
      'sabac': 'šabac',
      'cacak': 'čačak',
      'krusevac': 'kruševac',
      'nis': 'niš',
      'pozarevac': 'požarevac',
      'zajecar': 'zaječar',
      'paracin': 'paraćin',
      'odzaci': 'odžaci',
      'becej': 'bečej',
      'backa topola': 'bačka topola',
      'kanjiza': 'kanjiža',
      'bac': 'bač',
      'vinca': 'vinča',
      'lestane': 'leštane',
      'umcari': 'umčari'
    };

    if (variations[normalized]) {
      normalized = variations[normalized];
    }

    // Capitalize first letter of each word
    return normalized.split(' ').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }

  // Determine region based on coordinates or municipality name
  determineRegion(lat, lng, municipalityName) {
    const municipality = municipalityName.toLowerCase();

    // Belgrade area (including all Belgrade municipalities and neighborhoods)
    if (municipality.includes('beograd') || municipality.includes('belgrade') ||
        municipality.includes('zemun') || municipality.includes('novi beograd') ||
        municipality.includes('zvezdara') || municipality.includes('vračar') ||
        municipality.includes('stari grad') || municipality.includes('palilula') ||
        municipality.includes('savski venac') || municipality.includes('voždovac') ||
        municipality.includes('čukarica') || municipality.includes('rakovica') ||
        municipality.includes('borča') || municipality.includes('krnjača') ||
        municipality.includes('ovča') || municipality.includes('kotež') ||
        municipality.includes('mirijevo') || municipality.includes('karaburma') ||
        municipality.includes('blok') || municipality.includes('centar') ||
        municipality.includes('dorćol') || municipality.includes('grocka') ||
        municipality.includes('lazarevac') || municipality.includes('mladenovac') ||
        municipality.includes('obrenovac') || municipality.includes('sopot') ||
        municipality.includes('surčin') || municipality.includes('barajevo')) {
      return 'Centralna Srbija';
    }

    // Vojvodina region (northern Serbia)
    if (lat > 45.0) {
      return 'Vojvodina';
    }

    // Southern Serbia
    if (lat < 43.5) {
      return 'Južna Srbija';
    }

    // Eastern Serbia
    if (lng > 21.5) {
      return 'Istočna Srbija';
    }

    // Default to Central Serbia
    return 'Centralna Srbija';
  }

  // Get coordinates for a single municipality
  async getCoordinates(municipality) {
    if (!municipality) {
      throw new Error('Municipality name is required');
    }

    // Check cache first
    const cacheKey = municipality.toLowerCase();
    if (this.cache.has(cacheKey)) {
      console.log(`Using cached coordinates for ${municipality}`);
      return this.cache.get(cacheKey);
    }

    // Normalize municipality name
    const normalizedName = this.normalizeMunicipalityName(municipality);

    try {
      // Enforce rate limiting
      await this.enforceRateLimit();

      // Try multiple search strategies for better results
      const searchQueries = [
        `${normalizedName}, Serbia`,
        `${normalizedName}, Belgrade, Serbia`,
        `${normalizedName}, Beograd, Srbija`,
        normalizedName
      ];

      let bestResult = null;

      for (const query of searchQueries) {
        console.log(`Geocoding query: "${query}"`);

        const response = await axios.get(this.baseURL, {
          params: {
            q: query,
            format: 'json',
            limit: 5,
            countrycodes: 'rs', // Restrict to Serbia
            addressdetails: 1,
            'accept-language': 'sr,en'
          },
          headers: {
            'User-Agent': 'ROBOTIK-Dashboard/1.0 (https://localhost:3000)'
          },
          timeout: 10000
        });

        if (response.data && response.data.length > 0) {
          // Find the best result (prefer exact matches or administrative boundaries)
          for (const result of response.data) {
            const lat = parseFloat(result.lat);
            const lng = parseFloat(result.lon);

            if (lat && lng) {
              // Prefer results that are administrative areas (municipalities, cities, etc.)
              if (result.class === 'boundary' || result.class === 'place') {
                bestResult = {
                  lat,
                  lng,
                  region: this.determineRegion(lat, lng, normalizedName),
                  displayName: result.display_name,
                  type: result.type,
                  class: result.class
                };
                break;
              } else if (!bestResult) {
                // Fallback to first available result
                bestResult = {
                  lat,
                  lng,
                  region: this.determineRegion(lat, lng, normalizedName),
                  displayName: result.display_name,
                  type: result.type,
                  class: result.class
                };
              }
            }
          }

          if (bestResult) {
            break; // Found a good result, stop searching
          }
        }

        // Small delay between different query attempts
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (!bestResult) {
        // Fallback to Belgrade center for unknown municipalities
        console.warn(`Could not geocode "${municipality}", using Belgrade center as fallback`);
        bestResult = {
          lat: 44.7866,
          lng: 20.4489,
          region: 'Nepoznat region',
          displayName: `${municipality}, Serbia (fallback)`,
          type: 'fallback',
          class: 'fallback'
        };
      }

      // Cache the result
      this.cache.set(cacheKey, bestResult);
      console.log(`Geocoded "${municipality}" to: ${bestResult.lat}, ${bestResult.lng} (${bestResult.region})`);

      return bestResult;

    } catch (error) {
      console.error(`Error geocoding "${municipality}":`, error.message);

      // Return Belgrade center as fallback on error
      const fallbackResult = {
        lat: 44.7866,
        lng: 20.4489,
        region: 'Nepoznat region',
        displayName: `${municipality}, Serbia (fallback)`,
        type: 'error_fallback',
        class: 'error_fallback'
      };

      this.cache.set(cacheKey, fallbackResult);
      return fallbackResult;
    }
  }

  // Get coordinates for multiple municipalities in batch
  async getBatchCoordinates(municipalities) {
    if (!Array.isArray(municipalities)) {
      throw new Error('Municipalities must be an array');
    }

    const results = {};
    const uniqueMunicipalities = [...new Set(municipalities.filter(m => m && m.trim()))];

    console.log(`Geocoding ${uniqueMunicipalities.length} municipalities...`);

    for (const municipality of uniqueMunicipalities) {
      try {
        const coordinates = await this.getCoordinates(municipality);
        results[municipality] = coordinates;
      } catch (error) {
        console.error(`Failed to geocode "${municipality}":`, error.message);
        // Continue with other municipalities even if one fails
      }
    }

    console.log(`Successfully geocoded ${Object.keys(results).length} out of ${uniqueMunicipalities.length} municipalities`);
    return results;
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
    console.log('Geocoding cache cleared');
  }

  // Get cache statistics
  getCacheStats() {
    return {
      size: this.cache.size,
      municipalities: Array.from(this.cache.keys())
    };
  }
}

module.exports = new GeocodingService();