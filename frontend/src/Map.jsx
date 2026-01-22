import React, { useMemo, useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap, GeoJSON, WMSTileLayer } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'

// Chile center coordinates
const CHILE_CENTER = [-33.45, -70.65]
const DEFAULT_ZOOM = 5

// Tile layers for themes
const TILE_LAYERS = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
  }
}

// Color scale based on Fire Radiative Power (FRP)
const getFillColor = (frp) => {
  if (frp >= 100) return '#ff0000'
  if (frp >= 50) return '#ff4500'
  if (frp >= 20) return '#ff8c00'
  if (frp >= 10) return '#ffa500'
  return '#ffcc00'
}

const getRadius = (frp, severity) => {
  // Major/significant fires get larger radius for visibility
  if (severity === 'major') return 16
  if (severity === 'significant') return 14
  // Default FRP-based sizing
  if (frp >= 100) return 12
  if (frp >= 50) return 10
  if (frp >= 20) return 8
  return 6
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

// Heatmap Layer Component
function HeatmapLayer({ fires }) {
  const map = useMap()

  useEffect(() => {
    if (!fires?.features?.length) return

    const points = fires.features.map(f => {
      const [lng, lat] = f.geometry.coordinates
      const intensity = Math.min(f.properties.frp / 100, 1)
      return [lat, lng, intensity]
    })

    const heat = L.heatLayer(points, {
      radius: 25,
      blur: 15,
      maxZoom: 10,
      max: 1.0,
      gradient: {
        0.0: 'yellow',
        0.25: 'orange',
        0.5: 'red',
        0.75: 'darkred',
        1.0: 'purple'
      }
    }).addTo(map)

    return () => {
      map.removeLayer(heat)
    }
  }, [map, fires])

  return null
}

// Wind direction arrow as SVG (points in direction wind is blowing TO)
const getWindArrowSVG = (direction, speed) => {
  // Rotate arrow to show wind direction (direction wind blows TO)
  const rotation = direction
  const color = speed > 30 ? '#ef4444' : speed > 15 ? '#f97316' : '#3b82f6'

  return `
    <svg width="24" height="24" viewBox="0 0 24 24" style="transform: rotate(${rotation}deg); filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5));">
      <path d="M12 2L8 10h3v10h2V10h3L12 2z" fill="${color}" stroke="white" stroke-width="0.5"/>
    </svg>
  `
}

// Chilean Regions GeoJSON (simplified boundaries)
const CHILE_REGIONS = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Arica y Parinacota', code: 'XV' }, geometry: { type: 'Polygon', coordinates: [[[-70.5, -17.5], [-68.5, -17.5], [-68.5, -19.5], [-70.5, -19.5], [-70.5, -17.5]]] }},
    { type: 'Feature', properties: { name: 'Tarapaca', code: 'I' }, geometry: { type: 'Polygon', coordinates: [[[-70.5, -19.0], [-68.0, -19.0], [-68.0, -21.5], [-70.5, -21.5], [-70.5, -19.0]]] }},
    { type: 'Feature', properties: { name: 'Antofagasta', code: 'II' }, geometry: { type: 'Polygon', coordinates: [[[-70.5, -21.0], [-67.0, -21.0], [-67.0, -26.5], [-70.5, -26.5], [-70.5, -21.0]]] }},
    { type: 'Feature', properties: { name: 'Atacama', code: 'III' }, geometry: { type: 'Polygon', coordinates: [[[-71.5, -26.0], [-68.0, -26.0], [-68.0, -29.5], [-71.5, -29.5], [-71.5, -26.0]]] }},
    { type: 'Feature', properties: { name: 'Coquimbo', code: 'IV' }, geometry: { type: 'Polygon', coordinates: [[[-72.0, -29.0], [-69.5, -29.0], [-69.5, -32.5], [-72.0, -32.5], [-72.0, -29.0]]] }},
    { type: 'Feature', properties: { name: 'Valparaiso', code: 'V' }, geometry: { type: 'Polygon', coordinates: [[[-72.0, -32.0], [-70.0, -32.0], [-70.0, -34.0], [-72.0, -34.0], [-72.0, -32.0]]] }},
    { type: 'Feature', properties: { name: 'Metropolitana', code: 'RM' }, geometry: { type: 'Polygon', coordinates: [[[-71.5, -33.0], [-69.5, -33.0], [-69.5, -34.5], [-71.5, -34.5], [-71.5, -33.0]]] }},
    { type: 'Feature', properties: { name: "O'Higgins", code: 'VI' }, geometry: { type: 'Polygon', coordinates: [[[-72.0, -34.0], [-70.0, -34.0], [-70.0, -35.0], [-72.0, -35.0], [-72.0, -34.0]]] }},
    { type: 'Feature', properties: { name: 'Maule', code: 'VII' }, geometry: { type: 'Polygon', coordinates: [[[-72.5, -35.0], [-70.0, -35.0], [-70.0, -36.5], [-72.5, -36.5], [-72.5, -35.0]]] }},
    { type: 'Feature', properties: { name: 'Nuble', code: 'XVI' }, geometry: { type: 'Polygon', coordinates: [[[-72.5, -36.0], [-71.0, -36.0], [-71.0, -37.5], [-72.5, -37.5], [-72.5, -36.0]]] }},
    { type: 'Feature', properties: { name: 'Biobio', code: 'VIII' }, geometry: { type: 'Polygon', coordinates: [[[-73.5, -36.5], [-71.0, -36.5], [-71.0, -38.5], [-73.5, -38.5], [-73.5, -36.5]]] }},
    { type: 'Feature', properties: { name: 'La Araucania', code: 'IX' }, geometry: { type: 'Polygon', coordinates: [[[-73.5, -38.0], [-71.0, -38.0], [-71.0, -39.5], [-73.5, -39.5], [-73.5, -38.0]]] }},
    { type: 'Feature', properties: { name: 'Los Rios', code: 'XIV' }, geometry: { type: 'Polygon', coordinates: [[[-73.5, -39.0], [-71.5, -39.0], [-71.5, -40.5], [-73.5, -40.5], [-73.5, -39.0]]] }},
    { type: 'Feature', properties: { name: 'Los Lagos', code: 'X' }, geometry: { type: 'Polygon', coordinates: [[[-74.0, -40.0], [-71.0, -40.0], [-71.0, -44.0], [-74.0, -44.0], [-74.0, -40.0]]] }},
    { type: 'Feature', properties: { name: 'Aysen', code: 'XI' }, geometry: { type: 'Polygon', coordinates: [[[-75.5, -43.5], [-71.0, -43.5], [-71.0, -49.0], [-75.5, -49.0], [-75.5, -43.5]]] }},
    { type: 'Feature', properties: { name: 'Magallanes', code: 'XII' }, geometry: { type: 'Polygon', coordinates: [[[-75.5, -49.0], [-66.5, -49.0], [-66.5, -56.0], [-75.5, -56.0], [-75.5, -49.0]]] }}
  ]
}

const regionStyle = {
  color: '#e94560',
  weight: 1,
  opacity: 0.5,
  fillOpacity: 0.05
}

// Wind Arrow Marker Component
function WindArrowMarker({ lat, lng, direction, speed }) {
  const map = useMap()

  useEffect(() => {
    if (!direction && direction !== 0) return

    const icon = L.divIcon({
      className: 'wind-arrow-icon',
      html: getWindArrowSVG(direction, speed),
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    })

    // Offset the wind arrow slightly from the fire marker
    const offsetLat = lat + 0.015
    const offsetLng = lng + 0.015

    const marker = L.marker([offsetLat, offsetLng], {
      icon,
      interactive: false,
      zIndexOffset: -100
    }).addTo(map)

    return () => {
      map.removeLayer(marker)
    }
  }, [map, lat, lng, direction, speed])

  return null
}

// ESA WorldCover WMS configuration
const VEGETATION_WMS = {
  url: 'https://services.terrascope.be/wms/v2',
  layers: 'WORLDCOVER_2020_MAP',
  attribution: '© ESA WorldCover 2020'
}

function Map({ fires, theme, showHeatmap, showClusters, showVegetation }) {
  const tileLayer = TILE_LAYERS[theme] || TILE_LAYERS.dark

  const markers = useMemo(() => {
    if (!fires?.features || showHeatmap) return []

    return fires.features.map((feature, index) => {
      const { coordinates } = feature.geometry
      const props = feature.properties
      const [lng, lat] = coordinates

      const windDir = getWindDirectionLabel(props.wind_direction)
      const hasWind = props.wind_speed > 0
      const regionalRisk = getRegionalRisk(props.region)
      const isMajorFire = props.severity === 'major' || props.severity === 'significant'

      return (
        <CircleMarker
          key={`fire-${index}-${lat}-${lng}-${props.timestamp}`}
          center={[lat, lng]}
          radius={getRadius(props.frp, props.severity)}
          fillColor={getFillColor(props.frp)}
          fillOpacity={isMajorFire ? 0.95 : 0.8}
          color={isMajorFire ? '#fff' : '#fff'}
          weight={isMajorFire ? 2 : 1}
          opacity={0.9}
          className={isMajorFire ? 'major-fire-marker' : ''}
        >
          <Popup>
            <div className="fire-popup">
              <h3>
                {getSeverityIcon(props.severity)} Foco de Incendio
                <span className={`severity-badge ${props.severity}`}>
                  {getSeverityLabel(props.severity)}
                </span>
              </h3>
              {props.detection_count > 1 && (
                <p className="fire-duration">
                  🕐 Activo desde {props.first_seen} ({props.duration})
                  <br/>
                  <small>Detectado {props.detection_count} veces</small>
                </p>
              )}
              <p><strong>Coordenadas:</strong> {lat.toFixed(4)}, {lng.toFixed(4)}</p>
              <p><strong>FRP actual:</strong> {props.frp?.toFixed(1) || 'N/A'} MW</p>
              {props.max_frp > props.frp && (
                <p><strong>FRP maximo:</strong> {props.max_frp?.toFixed(1)} MW</p>
              )}
              <p><strong>Satelite:</strong> {props.satellite}</p>
              <p>
                <strong>Region:</strong> {props.region || 'N/A'}
                {regionalRisk.level !== 'low' && (
                  <span
                    className={`popup-region-risk ${regionalRisk.level}`}
                    title="Clasificacion basada en estadisticas historicas de CONAF (2002-2025)"
                  >
                    {regionalRisk.icon} {regionalRisk.label}
                  </span>
                )}
              </p>
              <p><strong>Dia/Noche:</strong> {props.daynight === 'D' ? 'Dia' : 'Noche'}</p>
              {hasWind && (
                <>
                  <hr style={{margin: '8px 0', borderColor: '#444'}} />
                  <p><strong>🌬️ Viento:</strong> {props.wind_speed?.toFixed(1)} km/h {windDir}</p>
                  {props.wind_speed >= 20 && (
                    <p style={{fontSize: '11px', color: '#f97316', fontWeight: 'bold'}}>⚠️ Viento fuerte - Mayor propagacion</p>
                  )}
                </>
              )}
            </div>
          </Popup>
        </CircleMarker>
      )
    })
  }, [fires, showHeatmap])

  // Wind arrows - rendered separately for better layering
  const windArrows = useMemo(() => {
    if (!fires?.features || showHeatmap) return []

    return fires.features
      .filter(f => f.properties.wind_speed > 0)
      .map((feature, index) => {
        const [lng, lat] = feature.geometry.coordinates
        const { wind_speed, wind_direction } = feature.properties

        return (
          <WindArrowMarker
            key={`wind-${index}-${lat}-${lng}`}
            lat={lat}
            lng={lng}
            direction={wind_direction}
            speed={wind_speed}
          />
        )
      })
  }, [fires, showHeatmap])

  return (
    <MapContainer
      center={CHILE_CENTER}
      zoom={DEFAULT_ZOOM}
      scrollWheelZoom={true}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution={tileLayer.attribution}
        url={tileLayer.url}
      />

      {/* Vegetation layer (ESA WorldCover) */}
      {showVegetation && (
        <WMSTileLayer
          url={VEGETATION_WMS.url}
          layers={VEGETATION_WMS.layers}
          format="image/png"
          transparent={true}
          opacity={0.6}
          attribution={VEGETATION_WMS.attribution}
        />
      )}

      {/* Region boundaries */}
      <GeoJSON
        data={CHILE_REGIONS}
        style={regionStyle}
        onEachFeature={(feature, layer) => {
          layer.bindTooltip(feature.properties.name, {
            permanent: false,
            direction: 'center',
            className: 'region-tooltip'
          })
        }}
      />

      {/* Heatmap layer */}
      {showHeatmap && fires && <HeatmapLayer fires={fires} />}

      {/* Wind arrows for each fire */}
      {!showHeatmap && windArrows}

      {/* Fire markers */}
      {!showHeatmap && markers}
    </MapContainer>
  )
}

export default Map
