import React, { useMemo, useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, GeoJSON, WMSTileLayer, LayersControl, LayerGroup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import chroma from 'chroma-js'
import parseGeoraster from 'georaster'
import GeoRasterLayer from 'georaster-layer-for-leaflet'
import { useLeafletContext } from '@react-leaflet/core'
import { getFillColor, getRadius, getSeverityIcon, getSeverityLabel, getWindDirectionLabel, WindArrowMarker, getRegionalRisk } from './Aux'

import CHILE_REGIONS from './layers/chile-geojson-master/regiones.json'


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

// Heatmap Layer Component
function HeatmapLayer({ fires }) {
  const layerRef = React.useRef(null)

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return

    layer.clearLayers()

    if (!fires?.features?.length) {
      return
    }

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
    })

    layer.addLayer(heat)

  }, [fires])

  return <LayerGroup ref={layerRef} />
}

function GeoTiffLayer({ url, options }) {
  const context = useLeafletContext()
  const layerRef = React.useRef(null)

  useEffect(() => {
    const container = context.layerContainer || context.map
    let layer = null
    let cancelled = false

    fetch(url)
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => parseGeoraster(arrayBuffer))
      .then(georaster => {
        if (cancelled) return

        // Create dynamic scale based on data range
        const min = georaster.mins[0]
        const max = georaster.maxs[0]
        const range = [min !== undefined ? min : 0, max !== undefined ? max : 1]

        const scale = chroma.scale(['#4caf50', '#ffeb3b', '#f44336'])
          .mode('lch')
          .domain(range)
          .classes(9)

        layer = new GeoRasterLayer({
          georaster,
          resolution: 512,
          ...options,
          pixelValuesToColorFn: (values) => {
            const val = values[0]
            if (val === null || isNaN(val) || val === georaster.noDataValue) return null
            return scale(val).hex()
          }
        })
        container.addLayer(layer)
        layerRef.current = layer
      })
      .catch(error => console.error("Error loading GeoTIFF:", error))

    return () => {
      cancelled = true
      if (layer) {
        container.removeLayer(layer)
      }
    }
  }, [url, context, options])

  return null
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

const SUSCEPTIBILITY_OPTIONS = { opacity: 0.7 }

function Map({ fires, theme }) {
  const tileLayer = TILE_LAYERS[theme] || TILE_LAYERS.dark

  const markers = useMemo(() => {
    if (!fires?.features) return []

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
          radius={getRadius(props.severity)}
          // radius={getRadius(props.frp, props.severity)}
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
                  <br />
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
                  <hr style={{ margin: '8px 0', borderColor: '#444' }} />
                  <p><strong>🌬️ Viento:</strong> {props.wind_speed?.toFixed(1)} km/h {windDir}</p>
                  {props.wind_speed >= 20 && (
                    <p style={{ fontSize: '11px', color: '#f97316', fontWeight: 'bold' }}>⚠️ Viento fuerte - Mayor propagacion</p>
                  )}
                </>
              )}
            </div>
          </Popup>
        </CircleMarker>
      )
    })
  }, [fires])

  const windArrows = useMemo(() => {
    if (!fires?.features) return []

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
  }, [fires])

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
      <LayersControl>
        <LayersControl.BaseLayer name="Dark" checked>
          <TileLayer
            attribution={tileLayer.attribution}
            url={tileLayer.url}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Light">
          <TileLayer
            attribution={tileLayer.attribution}
            url={tileLayer.url}
          />
        </LayersControl.BaseLayer>
        <LayersControl.Overlay name="Regiones de Chile">
          <GeoJSON
            data={CHILE_REGIONS}
            style={regionStyle}
            onEachFeature={(feature, layer) => {
              layer.bindTooltip(feature.properties.Region, {
                permanent: false,
                direction: 'center',
              })
            }}
          />
        </LayersControl.Overlay>
        <LayersControl.Overlay name="Susceptibilidad de Incendio">
          <GeoTiffLayer url="/layers/susceptibility/fire_susceptibility_chile.tif" options={SUSCEPTIBILITY_OPTIONS} />
        </LayersControl.Overlay>
        <LayersControl.Overlay name="Vegetación">
          <WMSTileLayer
            url={VEGETATION_WMS.url}
            layers={VEGETATION_WMS.layers}
            format="image/png"
            transparent={true}
            opacity={0.6}
            attribution={VEGETATION_WMS.attribution}
          />
        </LayersControl.Overlay>
        <LayersControl.Overlay name="Mapa de calor" checked>
          <HeatmapLayer fires={fires} />
        </LayersControl.Overlay>
        <LayersControl.Overlay name="Focos Detectados" checked>
          <LayerGroup>
            {windArrows}
            {markers}
          </LayerGroup>
        </LayersControl.Overlay>
      </LayersControl>
    </MapContainer>
  )
}

export default Map
