import React, { useMemo, useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap, GeoJSON, WMSTileLayer } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
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

// Severity-based color scale (replaces FRP-based colors)
// Industry standard: color = severity/status, not raw intensity
const getFillColor = (severity) => {
  switch (severity) {
    case 'major':       return '#dc2626'  // red
    case 'significant': return '#f97316'  // orange
    case 'moderate':    return '#eab308'  // yellow
    default:            return '#22c55e'  // green
  }
}

// Smaller radii — one marker per fire, not per detection
const getRadius = (severity) => {
  switch (severity) {
    case 'major':       return 8
    case 'significant': return 6
    case 'moderate':    return 5
    default:            return 4
  }
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
  return directions[index]
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

// Heatmap Layer Component — now uses deduplicated fires
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

// Regional risk levels based on CONAF historical data
const REGIONAL_RISK = {
  'IX': { level: 'critical', label: 'Zona Critica', icon: '🔴' },
  'VIII': { level: 'high', label: 'Riesgo Alto', icon: '🟠' },
  'VII': { level: 'high', label: 'Riesgo Alto', icon: '🟠' },
  'V': { level: 'elevated', label: 'Riesgo Elevado', icon: '🟡' },
  'VI': { level: 'elevated', label: 'Riesgo Elevado', icon: '🟡' },
  'RM': { level: 'moderate', label: 'Riesgo Moderado', icon: '🟢' },
  'XVI': { level: 'elevated', label: 'Riesgo Elevado', icon: '🟡' },
  'IV': { level: 'moderate', label: 'Riesgo Moderado', icon: '🟢' },
}

const getRegionalRisk = (region) => {
  return REGIONAL_RISK[region] || { level: 'low', label: 'Riesgo Normal', icon: '🟢' }
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

// ESA WorldCover WMS configuration
const VEGETATION_WMS = {
  url: 'https://services.terrascope.be/wms/v2',
  layers: 'WORLDCOVER_2020_MAP',
  attribution: '© ESA WorldCover 2020'
}

// HTML-based fire icon for MarkerClusterGroup (CircleMarker can't be clustered)
// Renders a colored circle with optional white ring for new fires
const fireIcon = (severity, isNew, cluster) => {
  const radius = getRadius(severity) * 1.5 // Scale up for divIcon visibility
  const color = getFillColor(severity)
  const ring = isNew ? 'border: 2px solid #fff; box-shadow: 0 0 4px rgba(255,255,255,0.5);' : ''

  return L.divIcon({
    html: `<div style="width:${radius * 2}px;height:${radius * 2}px;border-radius:50%;background:${color};opacity:0.85;${ring}"></div>`,
    iconSize: [radius * 2, radius * 2],
    iconAnchor: [radius, radius],
    className: `fire-cluster-marker${isNew ? ' new-fire-marker' : ''}`,
  })
}

// Reusable popup content (same for CircleMarker and Marker)
const FirePopupContent = ({ props, lat, lng }) => {
  const regionalRisk = getRegionalRisk(props.region)

  return (
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
      {props.wind_speed > 0 && (
        <>
          <hr style={{margin: '8px 0', borderColor: '#444'}} />
          <p><strong>🌬️ Viento:</strong> {props.wind_speed?.toFixed(1)} km/h {getWindDirectionLabel(props.wind_direction)}</p>
          {props.wind_speed >= 20 && (
            <p style={{fontSize: '11px', color: '#f97316', fontWeight: 'bold'}}>⚠️ Viento fuerte - Mayor propagacion</p>
          )}
        </>
      )}
    </div>
  )
}

function Map({ fires, theme, showHeatmap, showClusters, showVegetation }) {
  const tileLayer = TILE_LAYERS[theme] || TILE_LAYERS.dark

  // Group fires by grid_id — one marker per unique fire
  // Falls back to individual markers for features without grid_id
  const fireGroups = useMemo(() => {
    if (!fires?.features) return []

    const groups = {}
    const ungrouped = []

    fires.features.forEach(feature => {
      const gridId = feature.properties.grid_id
      if (!gridId) {
        ungrouped.push(feature)
        return
      }
      if (!groups[gridId]) groups[gridId] = []
      groups[gridId].push(feature)
    })

    // For each group, sort by timestamp — latest is the "main" marker
    const grouped = Object.values(groups).map(group => {
      group.sort((a, b) => b.properties.timestamp - a.properties.timestamp)
      return {
        main: group[0],
        trail: group.slice(1, 6), // max 5 trail dots
      }
    })

    // Ungrouped features become single-element groups (fallback)
    ungrouped.forEach(f => grouped.push({ main: f, trail: [] }))

    return grouped
  }, [fires])

  // Trail dots — past detection positions, rendered behind main markers
  const trailMarkers = useMemo(() => {
    return fireGroups.flatMap(({ trail }) =>
      trail.map((feature, i) => {
        const [lng, lat] = feature.geometry.coordinates
        return (
          <CircleMarker
            key={`trail-${feature.properties.grid_id || `${lat}-${lng}`}-${i}`}
            center={[lat, lng]}
            radius={2}
            fillColor={getFillColor(feature.properties.severity)}
            fillOpacity={0.25}
            color="transparent"
            weight={0}
            interactive={false}
          />
        )
      })
    )
  }, [fireGroups])

  // Main fire markers — one per unique fire (CircleMarker for non-clustered mode)
  const markers = useMemo(() => {
    return fireGroups.map(({ main }) => {
      const [lng, lat] = main.geometry.coordinates
      const props = main.properties
      const isNew = props.detection_count <= 2

      return (
        <CircleMarker
          key={`fire-${props.grid_id || `${lat}-${lng}-${props.timestamp}`}`}
          center={[lat, lng]}
          radius={getRadius(props.severity)}
          fillColor={getFillColor(props.severity)}
          fillOpacity={0.85}
          color={isNew ? '#ffffff' : 'transparent'}
          weight={isNew ? 2 : 0}
          className={isNew ? 'new-fire-marker' : ''}
        >
          <Popup><FirePopupContent props={props} lat={lat} lng={lng} /></Popup>
        </CircleMarker>
      )
    })
  }, [fireGroups])

  // Clustered markers — use Marker + divIcon since MarkerClusterGroup can't cluster CircleMarker
  const clusteredMarkers = useMemo(() => {
    return fireGroups.map(({ main }) => {
      const [lng, lat] = main.geometry.coordinates
      const props = main.properties
      const isNew = props.detection_count <= 2

      return (
        <Marker
          key={`fire-cluster-${props.grid_id || `${lat}-${lng}-${props.timestamp}`}`}
          position={[lat, lng]}
          icon={fireIcon(props.severity, isNew)}
        >
          <Popup><FirePopupContent props={props} lat={lat} lng={lng} /></Popup>
        </Marker>
      )
    })
  }, [fireGroups])

  // Heatmap uses deduplicated fires (main marker of each group)
  const heatmapFires = useMemo(() => {
    if (!fireGroups.length) return null
    return { features: fireGroups.map(g => g.main) }
  }, [fireGroups])

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
      {showHeatmap && heatmapFires && <HeatmapLayer fires={heatmapFires} />}

      {/* Fire markers — clustered or flat */}
      {!showHeatmap && showClusters ? (
        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={50}
          spiderfyOnMaxZoom
        >
          {clusteredMarkers}
        </MarkerClusterGroup>
      ) : (
        <>
          {!showHeatmap && trailMarkers}
          {!showHeatmap && markers}
        </>
      )}
    </MapContainer>
  )
}

export default Map
