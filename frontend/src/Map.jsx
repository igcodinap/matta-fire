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

// Chilean Regions GeoJSON (simplified but realistic boundaries)
const CHILE_REGIONS = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Arica y Parinacota', code: 'XV' }, geometry: { type: 'Polygon', coordinates: [[[-70.35, -17.37], [-69.52, -17.42], [-68.92, -17.85], [-68.65, -18.32], [-68.82, -18.98], [-69.35, -19.15], [-70.12, -19.08], [-70.35, -18.45], [-70.35, -17.37]]] }},
    { type: 'Feature', properties: { name: 'Tarapacá', code: 'I' }, geometry: { type: 'Polygon', coordinates: [[[-70.35, -19.08], [-69.35, -19.15], [-68.82, -18.98], [-68.52, -19.52], [-68.38, -20.15], [-68.52, -20.78], [-69.12, -21.35], [-69.85, -21.52], [-70.28, -21.15], [-70.42, -20.45], [-70.35, -19.08]]] }},
    { type: 'Feature', properties: { name: 'Antofagasta', code: 'II' }, geometry: { type: 'Polygon', coordinates: [[[-70.42, -21.15], [-69.85, -21.52], [-69.12, -21.35], [-68.52, -20.78], [-68.25, -21.82], [-68.15, -22.95], [-68.42, -24.12], [-68.92, -25.35], [-69.52, -26.15], [-70.15, -26.35], [-70.65, -25.82], [-70.85, -24.95], [-70.72, -23.85], [-70.55, -22.75], [-70.42, -21.15]]] }},
    { type: 'Feature', properties: { name: 'Atacama', code: 'III' }, geometry: { type: 'Polygon', coordinates: [[[-70.85, -25.82], [-70.15, -26.35], [-69.52, -26.15], [-68.92, -25.35], [-68.52, -26.52], [-68.35, -27.65], [-68.52, -28.45], [-69.15, -29.12], [-70.12, -29.35], [-70.85, -29.15], [-71.25, -28.52], [-71.15, -27.45], [-70.95, -26.52], [-70.85, -25.82]]] }},
    { type: 'Feature', properties: { name: 'Coquimbo', code: 'IV' }, geometry: { type: 'Polygon', coordinates: [[[-71.25, -29.15], [-70.12, -29.35], [-69.15, -29.12], [-68.85, -29.85], [-69.12, -30.52], [-69.52, -31.15], [-70.15, -31.65], [-70.85, -31.85], [-71.45, -31.52], [-71.65, -30.85], [-71.52, -30.15], [-71.25, -29.15]]] }},
    { type: 'Feature', properties: { name: 'Valparaíso', code: 'V' }, geometry: { type: 'Polygon', coordinates: [[[-71.65, -32.15], [-70.85, -31.85], [-70.15, -31.65], [-69.85, -32.15], [-69.92, -32.85], [-70.25, -33.35], [-70.85, -33.52], [-71.35, -33.15], [-71.65, -32.85], [-71.72, -32.45], [-71.65, -32.15]]] }},
    { type: 'Feature', properties: { name: 'Metropolitana', code: 'RM' }, geometry: { type: 'Polygon', coordinates: [[[-71.35, -33.15], [-70.85, -33.52], [-70.25, -33.35], [-69.92, -32.85], [-69.72, -33.45], [-69.85, -34.05], [-70.35, -34.35], [-70.85, -34.15], [-71.25, -33.85], [-71.35, -33.15]]] }},
    { type: 'Feature', properties: { name: "O'Higgins", code: 'VI' }, geometry: { type: 'Polygon', coordinates: [[[-71.85, -33.95], [-71.25, -33.85], [-70.85, -34.15], [-70.35, -34.35], [-69.85, -34.05], [-69.92, -34.65], [-70.45, -34.95], [-71.15, -35.05], [-71.75, -34.75], [-71.85, -33.95]]] }},
    { type: 'Feature', properties: { name: 'Maule', code: 'VII' }, geometry: { type: 'Polygon', coordinates: [[[-72.35, -34.95], [-71.75, -34.75], [-71.15, -35.05], [-70.45, -34.95], [-70.25, -35.45], [-70.52, -36.05], [-71.15, -36.35], [-71.85, -36.45], [-72.45, -36.15], [-72.55, -35.55], [-72.35, -34.95]]] }},
    { type: 'Feature', properties: { name: 'Ñuble', code: 'XVI' }, geometry: { type: 'Polygon', coordinates: [[[-72.85, -36.25], [-72.45, -36.15], [-71.85, -36.45], [-71.15, -36.35], [-70.95, -36.85], [-71.25, -37.35], [-71.85, -37.55], [-72.55, -37.45], [-73.05, -37.05], [-72.85, -36.25]]] }},
    { type: 'Feature', properties: { name: 'Biobío', code: 'VIII' }, geometry: { type: 'Polygon', coordinates: [[[-73.55, -37.15], [-73.05, -37.05], [-72.55, -37.45], [-71.85, -37.55], [-71.25, -37.35], [-71.05, -37.85], [-71.35, -38.35], [-72.05, -38.65], [-72.85, -38.75], [-73.45, -38.45], [-73.65, -37.85], [-73.55, -37.15]]] }},
    { type: 'Feature', properties: { name: 'La Araucanía', code: 'IX' }, geometry: { type: 'Polygon', coordinates: [[[-73.25, -38.35], [-72.85, -38.75], [-72.05, -38.65], [-71.35, -38.35], [-71.15, -38.85], [-71.45, -39.35], [-72.15, -39.65], [-72.85, -39.55], [-73.35, -39.15], [-73.25, -38.35]]] }},
    { type: 'Feature', properties: { name: 'Los Ríos', code: 'XIV' }, geometry: { type: 'Polygon', coordinates: [[[-73.65, -39.45], [-73.35, -39.15], [-72.85, -39.55], [-72.15, -39.65], [-71.85, -39.95], [-72.05, -40.35], [-72.65, -40.55], [-73.25, -40.45], [-73.75, -40.15], [-73.65, -39.45]]] }},
    { type: 'Feature', properties: { name: 'Los Lagos', code: 'X' }, geometry: { type: 'Polygon', coordinates: [[[-74.15, -40.25], [-73.75, -40.15], [-73.25, -40.45], [-72.65, -40.55], [-72.05, -40.35], [-71.75, -40.85], [-71.95, -41.55], [-72.45, -42.15], [-73.15, -42.55], [-73.75, -42.85], [-74.05, -42.35], [-74.25, -41.55], [-74.35, -40.85], [-74.15, -40.25]]] }},
    { type: 'Feature', properties: { name: 'Aysén', code: 'XI' }, geometry: { type: 'Polygon', coordinates: [[[-75.25, -43.65], [-74.55, -43.45], [-73.85, -43.75], [-73.15, -44.15], [-72.65, -44.75], [-72.35, -45.55], [-72.55, -46.35], [-73.15, -47.15], [-73.85, -47.75], [-74.55, -48.15], [-75.15, -47.65], [-75.55, -46.85], [-75.85, -45.95], [-75.65, -45.05], [-75.25, -43.65]]] }},
    { type: 'Feature', properties: { name: 'Magallanes', code: 'XII' }, geometry: { type: 'Polygon', coordinates: [[[-75.15, -48.15], [-74.55, -48.35], [-73.85, -48.85], [-73.15, -49.55], [-72.35, -50.35], [-71.55, -51.25], [-70.85, -52.15], [-70.15, -53.15], [-69.55, -53.85], [-68.95, -54.55], [-67.85, -55.15], [-66.85, -54.85], [-66.35, -54.15], [-66.85, -53.35], [-67.55, -52.55], [-68.35, -51.75], [-69.25, -50.95], [-70.15, -50.15], [-71.05, -49.45], [-72.05, -48.85], [-73.05, -48.45], [-74.05, -48.25], [-75.15, -48.15]]] }}
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

      {/* Trail dots — always visible outside heatmap mode */}
      {!showHeatmap && trailMarkers}

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
        !showHeatmap && markers
      )}
    </MapContainer>
  )
}

export default Map
