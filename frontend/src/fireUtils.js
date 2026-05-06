// Haversine formula to calculate distance between two coordinates in kilometers
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371 // Earth's radius in km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(deg) {
  return deg * (Math.PI / 180)
}

// Filter fires by multiple criteria
export function filterFires(features, filters, timeRange, metadata) {
  if (!features) return []

  return features.filter(f => {
    const p = f.properties

    // Chile-only filter (default enabled)
    if (filters.chileOnly && p.country !== 'Chile') {
      return false
    }

    // Source filter
    if (filters.source && filters.source !== 'all') {
      const sat = (p.satellite || '').toLowerCase()
      const src = filters.source.toLowerCase()
      if (!sat.includes(src)) return false
    }

    // Confidence filter
    if (filters.confidence && filters.confidence !== 'all') {
      const conf = (p.confidence || '').toLowerCase()
      const filterConf = filters.confidence.toLowerCase()
      if (filterConf === 'high' && conf !== 'h' && conf !== 'high') return false
      if (filterConf === 'nominal' && conf !== 'n' && conf !== 'nominal') return false
      if (filterConf === 'low' && conf !== 'l' && conf !== 'low') return false
    }

    // Intensity filter (based on FRP)
    if (filters.intensity && filters.intensity !== 'all') {
      const frp = p.frp || 0
      switch (filters.intensity) {
        case 'extreme':
          if (frp < 100) return false
          break
        case 'high':
          if (frp < 50 || frp >= 100) return false
          break
        case 'medium':
          if (frp < 20 || frp >= 50) return false
          break
        case 'low':
          if (frp >= 20) return false
          break
        default:
          break
      }
    }

    // Day/Night filter
    if (filters.daynight && filters.daynight !== 'all') {
      if (p.daynight?.toUpperCase() !== filters.daynight.toUpperCase()) return false
    }

    // Region filter
    if (filters.region && filters.region !== 'all') {
      if (p.region !== filters.region) return false
    }

    // FRP range filter
    if (filters.minFrp > 0 && (p.frp || 0) < filters.minFrp) return false
    if (filters.maxFrp > 0 && (p.frp || 0) > filters.maxFrp) return false

    // Time range filter
    if (timeRange?.min > 0 && p.timestamp < timeRange.min) return false
    if (timeRange?.max < Infinity && p.timestamp > timeRange.max) return false

    return true
  })
}

// Generate unique key for a fire alert
// Uses place ID + grid ID + fire timestamp for uniqueness across days
export function getFireAlertKey(place, fire) {
  const props = fire.properties
  const gridId = props.grid_id || `${fire.geometry.coordinates[1]}-${fire.geometry.coordinates[0]}`
  // Use timestamp or acq_date+acq_time combo for uniqueness across days
  const fireKey = props.timestamp
    ? `${gridId}:${props.timestamp}`
    : `${gridId}:${props.acq_date}:${props.acq_time}`
  return `${place.id}:${fireKey}`
}

// Check if a fire is within a place's radius
export function isFireNearPlace(place, fire) {
  const [lon, lat] = fire.geometry.coordinates
  const distance = haversineKm(place.lat, place.lng, lat, lon)
  return distance <= place.radiusKm
}
