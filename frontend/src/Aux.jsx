import { useMap, Marker } from 'react-leaflet'
import { useEffect } from 'react'
import L from 'leaflet'
// Color scale based on Fire Radiative Power (FRP)
const getFillColor = (frp) => {
    if (frp >= 100) return '#ff0000'
    if (frp >= 50) return '#ff4500'
    if (frp >= 20) return '#ff8c00'
    if (frp >= 10) return '#ffa500'
    return '#ffcc00'
}

const getRadius = (severity) => {
    // const getRadius = (frp, severity) => {
    // Major/significant fires get larger radius for visibility
    if (severity === 'major') return 12
    if (severity === 'significant') return 8
    if (severity === 'moderate') return 4
    // Default FRP-based sizing
    // if (frp >= 100) return 12
    // if (frp >= 50) return 10
    // if (frp >= 20) return 8
    return 2
}

const getConfidenceLabel = (confidence) => {
    const conf = String(confidence).toLowerCase()
    if (conf === 'h' || conf === 'high') return 'Alta'
    if (conf === 'n' || conf === 'nominal') return 'Nominal'
    if (conf === 'l' || conf === 'low') return 'Baja'
    return confidence
}

const getWindDirectionLabel = (degrees) => {
    if (degrees === undefined || degrees === null) return ''
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
    const index = Math.round(degrees / 45) % 8
    return `→ ${directions[index]}`
}

const getSeverityIcon = (severity) => {
    switch (severity) {
        case 'major': return '🔴'
        case 'significant': return '🟠'
        case 'moderate': return '🟡'
        default: return '🟢'
    }
}

const getSeverityLabel = (severity) => {
    switch (severity) {
        case 'major': return 'MAYOR'
        case 'significant': return 'SIGNIFICATIVO'
        case 'moderate': return 'MODERADO'
        default: return 'MENOR'
    }
}

// Regional risk levels based on CONAF historical data (using Chilean region codes)
const REGIONAL_RISK = {
    'IX': { level: 'critical', label: 'Zona Critica', icon: '🔴' },      // La Araucanía
    'VIII': { level: 'high', label: 'Riesgo Alto', icon: '🟠' },         // Biobío
    'VII': { level: 'high', label: 'Riesgo Alto', icon: '🟠' },          // Maule
    'V': { level: 'elevated', label: 'Riesgo Elevado', icon: '🟡' },     // Valparaíso
    'VI': { level: 'elevated', label: 'Riesgo Elevado', icon: '🟡' },    // O'Higgins
    'RM': { level: 'moderate', label: 'Riesgo Moderado', icon: '🟢' },   // Metropolitana
    'XVI': { level: 'elevated', label: 'Riesgo Elevado', icon: '🟡' },   // Ñuble
    'IV': { level: 'moderate', label: 'Riesgo Moderado', icon: '🟢' },   // Coquimbo
}
const getRegionalRisk = (region) => {
    return REGIONAL_RISK[region] || { level: 'low', label: 'Riesgo Normal', icon: '🟢' }
}

// Wind direction arrow as SVG (points in direction wind is blowing TO)
const getWindArrowSVG = (direction, speed) => {
    // Rotate arrow to show wind direction (direction wind blows TO)
    const rotation = direction
    const color = speed > 30 ? '#ef4444' : speed > 15 ? '#f97316' : '#3b82f6'

    return `
    <svg width="24" height="24" viewBox="0 0 24 24" style="transform: rotate(${rotation}deg);">
      <path d="M12 2L8 10h3v10h2V10h3L12 2z" fill="white" stroke="${color}" stroke-width="0.2"/>
    </svg>
  `
}



// Wind Arrow Marker Component
function WindArrowMarker({ lat, lng, direction, speed }) {
    if (!direction && direction !== 0) return null

    const icon = L.divIcon({
        className: 'wind-arrow-icon',
        html: getWindArrowSVG(direction, speed),
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    })

    // Offset the wind arrow slightly from the fire marker
    const offsetLat = lat + 0.015
    const offsetLng = lng + 0.015

    return (
        <Marker
            position={[offsetLat, offsetLng]}
            icon={icon}
            interactive={false}
            zIndexOffset={-100}
        />
    )
}

export { getFillColor, getRadius, getSeverityIcon, getSeverityLabel, getConfidenceLabel, getWindDirectionLabel, WindArrowMarker, getRegionalRisk }