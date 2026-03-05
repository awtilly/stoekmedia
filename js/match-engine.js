/* ============================================================
   GreenDoor — Match Engine
   Calculates listing ↔ client preference match scores.
   ============================================================ */

const WEIGHTS = {
  price: 30,
  location: 25,
  type: 10,
  beds: 10,
  baths: 10,
  sqft: 10,
  features: 5
};

/**
 * Calculate a match score between a listing and client preferences.
 * @param {Object} listing — Firestore listing doc data
 * @param {Object} prefs  — Client preference fields from clients doc
 * @returns {{ score: number, breakdown: Object, dealBreakerHits: string[] }}
 */
export function calculateMatchScore(listing, prefs) {
  if (!listing || !prefs) return { score: 0, breakdown: {}, dealBreakerHits: [] };

  const breakdown = {};
  const dealBreakerHits = [];
  const dealBreakers = (prefs.dealBreakers || []).map(d => d.toLowerCase().trim());
  let totalWeight = 0;
  let weightedScore = 0;

  // --- Price ---
  if (prefs.budgetMin || prefs.budgetMax) {
    totalWeight += WEIGHTS.price;
    const price = listing.listingPrice;
    if (price && (prefs.budgetMin || prefs.budgetMax)) {
      const min = prefs.budgetMin || 0;
      const max = prefs.budgetMax || Infinity;
      if (price >= min && price <= max) {
        breakdown.price = 100;
      } else if (price < min) {
        const diff = (min - price) / min;
        breakdown.price = Math.max(0, 100 - diff * 200);
      } else {
        const diff = (price - max) / max;
        breakdown.price = Math.max(0, 100 - diff * 200);
      }
    } else {
      breakdown.price = 50;
    }
    weightedScore += breakdown.price * WEIGHTS.price;
  }

  // --- Location ---
  const locs = (prefs.preferredLocations || []).map(l => l.toLowerCase().trim());
  if (locs.length > 0) {
    totalWeight += WEIGHTS.location;
    const addr = listing.address || {};
    const addrStr = [addr.city, addr.neighborhood, addr.county, addr.state, addr.full]
      .filter(Boolean).join(" ").toLowerCase();
    const match = locs.some(l => addrStr.includes(l));
    breakdown.location = match ? 100 : 0;
    weightedScore += breakdown.location * WEIGHTS.location;
  }

  // --- Property Type ---
  const types = (prefs.propertyTypes || []).map(t => t.toLowerCase().trim());
  if (types.length > 0) {
    totalWeight += WEIGHTS.type;
    const listingType = (listing.propertyType || "").toLowerCase().trim();
    breakdown.type = types.includes(listingType) ? 100 : 0;
    weightedScore += breakdown.type * WEIGHTS.type;
  }

  // --- Beds ---
  if (prefs.bedsMin || prefs.bedsMax) {
    totalWeight += WEIGHTS.beds;
    const beds = listing.bedrooms;
    if (beds != null) {
      const min = prefs.bedsMin || 0;
      const max = prefs.bedsMax || Infinity;
      if (beds >= min && beds <= max) {
        breakdown.beds = 100;
      } else {
        const diff = Math.min(Math.abs(beds - min), Math.abs(beds - max));
        breakdown.beds = Math.max(0, 100 - diff * 40);
      }
    } else {
      breakdown.beds = 50;
    }
    weightedScore += breakdown.beds * WEIGHTS.beds;
  }

  // --- Baths ---
  if (prefs.bathsMin || prefs.bathsMax) {
    totalWeight += WEIGHTS.baths;
    const baths = listing.bathrooms;
    if (baths != null) {
      const min = prefs.bathsMin || 0;
      const max = prefs.bathsMax || Infinity;
      if (baths >= min && baths <= max) {
        breakdown.baths = 100;
      } else {
        const diff = Math.min(Math.abs(baths - min), Math.abs(baths - max));
        breakdown.baths = Math.max(0, 100 - diff * 40);
      }
    } else {
      breakdown.baths = 50;
    }
    weightedScore += breakdown.baths * WEIGHTS.baths;
  }

  // --- Square Footage ---
  if (prefs.sqftMin || prefs.sqftMax) {
    totalWeight += WEIGHTS.sqft;
    const sqft = listing.squareFeet;
    if (sqft != null) {
      const min = prefs.sqftMin || 0;
      const max = prefs.sqftMax || Infinity;
      if (sqft >= min && sqft <= max) {
        breakdown.sqft = 100;
      } else if (sqft < min) {
        const diff = (min - sqft) / min;
        breakdown.sqft = Math.max(0, 100 - diff * 200);
      } else {
        const diff = (sqft - max) / max;
        breakdown.sqft = Math.max(0, 100 - diff * 200);
      }
    } else {
      breakdown.sqft = 50;
    }
    weightedScore += breakdown.sqft * WEIGHTS.sqft;
  }

  // --- Features ---
  const mustHave = (prefs.mustHaveFeatures || []).map(f => f.toLowerCase().trim());
  if (mustHave.length > 0) {
    totalWeight += WEIGHTS.features;
    const listingFeatures = (listing.features || []).map(f => f.toLowerCase().trim());
    const description = (listing.description || "").toLowerCase();
    let matched = 0;
    mustHave.forEach(f => {
      if (listingFeatures.includes(f) || description.includes(f)) matched++;
    });
    breakdown.features = Math.round((matched / mustHave.length) * 100);
    weightedScore += breakdown.features * WEIGHTS.features;
  }

  // --- Deal Breakers ---
  if (dealBreakers.length > 0) {
    const listingFeatures = (listing.features || []).map(f => f.toLowerCase().trim());
    const description = (listing.description || "").toLowerCase();
    dealBreakers.forEach(db => {
      if (listingFeatures.includes(db) || description.includes(db)) {
        dealBreakerHits.push(db);
      }
    });
  }

  const score = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;

  return { score, breakdown, dealBreakerHits };
}

/**
 * Returns a CSS color for a match score.
 */
export function matchScoreColor(score) {
  if (score >= 80) return "#22c55e"; // green — excellent
  if (score >= 60) return "#eab308"; // yellow — good
  if (score >= 40) return "#f97316"; // orange — fair
  return "#ef4444"; // red — poor
}

/**
 * Returns a label for a match score.
 */
export function matchScoreLabel(score) {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Fair";
  return "Poor";
}
