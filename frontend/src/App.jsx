import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react'
import TimeSlider from './TimeSlider'
import FWIPanel from './FWIPanel'
import InfoPanel from './InfoPanel'
import QuemasPanel from './QuemasPanel'
import FilterPanel from './FilterPanel'
import TrustNotice from './TrustNotice'
import SavedPlacesPanel from './SavedPlacesPanel'
import { filterFires } from './fireUtils'
import './App.css'

// Check if mobile on initial render
const isMobileDevice = () => window.innerWidth <= 768

// Lazy load heavy Map component (Leaflet is large)
const Map = lazy(() => import('./Map'))

// Map legend — lightweight, rendered over the map
const MapLegend = () => (
  <div className="map-legend">
    <div className="map-legend-title">Focos de incendio</div>
    <div className="map-legend-item">
      <span className="map-legend-dot" style={{ backgroundColor: '#dc2626' }} />
      <span>Grave</span>
    </div>
    <div className="map-legend-item">
      <span className="map-legend-dot" style={{ backgroundColor: '#f97316' }} />
      <span>Importante</span>
    </div>
    <div className="map-legend-item">
      <span className="map-legend-dot" style={{ backgroundColor: '#eab308' }} />
      <span>Moderado</span>
    </div>
    <div className="map-legend-item">
      <span className="map-legend-dot" style={{ backgroundColor: '#22c55e' }} />
      <span>Menor</span>
    </div>
  </div>
)

// Heatmap mode has no markers — explain what the blobs mean
const HeatLegend = () => (
  <div className="map-legend">
    <div className="map-legend-title">Mapa de calor</div>
    <div className="map-legend-item">
      <span className="map-legend-dot" style={{ backgroundColor: '#eab308' }} />
      <span>Zonas de concentracion de focos</span>
    </div>
    <div className="map-legend-item">
      <span>Colores mas intensos = mayor potencia (FRP)</span>
    </div>
  </div>
)

const getFireCountry = (properties = {}) =>
  properties.country || (properties.region === 'unknown' ? 'Fuera de Chile' : 'Chile')

const defaultFilters = {
  source: 'all',
  confidence: 'all',
  intensity: 'all',
  daynight: 'all',
  region: 'all',
  minFrp: 0,
  maxFrp: 0,
  chileOnly: true
}

function loadStoredFilters() {
  if (typeof window === 'undefined') return defaultFilters

  try {
    const stored = localStorage.getItem('matta.filters.v1')
    if (!stored) return defaultFilters

    const parsed = JSON.parse(stored)
    return { ...defaultFilters, ...parsed }
  } catch (err) {
    console.error('Failed to parse saved filters:', err)
    return defaultFilters
  }
}

// Check if current time is in peak fire hours (Chilean time)
function isPeakFireHours() {
  const now = new Date()
  // Get Chilean time (America/Santiago)
  const chileanTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Santiago' }))
  const hour = chileanTime.getHours()
  return hour >= 13 && hour < 19 // 13:00 - 18:59
}

function App() {
  // Use function form for state initialization
  const [fires, setFires] = useState(() => null)
  const [loading, setLoading] = useState(() => true)
  const [error, setError] = useState(() => null)
  const [lastUpdated, setLastUpdated] = useState(() => null)
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') || 'dark'
    }
    return 'dark'
  })
  const [showHeatmap, setShowHeatmap] = useState(() => false)
  const [showClusters, setShowClusters] = useState(() => true)
  const [showVegetation, setShowVegetation] = useState(() => false)
  const [wsConnected, setWsConnected] = useState(() => false)
  const [alerts, setAlerts] = useState(() => [])
  const [timeRange, setTimeRange] = useState(() => ({ min: 0, max: Infinity }))
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours())
  const [isMobile, setIsMobile] = useState(() => isMobileDevice())
  const [activeSidePanel, setActiveSidePanel] = useState(() => (isMobileDevice() ? null : 'risk'))
  const [regions, setRegions] = useState(() => ({}))
  const [filters, setFilters] = useState(() => loadStoredFilters())
  const [savedPlaces, setSavedPlaces] = useState(() => [])
  const [showFilters, setShowFilters] = useState(() => false)
  const [showTrustNotice, setShowTrustNotice] = useState(() => false)
  const [showSavedPlaces, setShowSavedPlaces] = useState(() => false)
  // Saved-place map picking: user clicks the map to set lat/lng
  const [pickingPlace, setPickingPlace] = useState(() => false)
  const [placeDraft, setPlaceDraft] = useState(() => null)
  // Ticking clock for staleness display
  const [now, setNow] = useState(() => Date.now())

  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const reconnectAttemptsRef = useRef(0)

  // Update current hour every minute for time-based risk indicators,
  // and tick the staleness clock every 30s so "hace X min" stays honest
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentHour(new Date().getHours())
    }, 60000)
    const tick = setInterval(() => setNow(Date.now()), 30000)
    return () => {
      clearInterval(interval)
      clearInterval(tick)
    }
  }, [])

  // Handle window resize for mobile detection
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(isMobileDevice())
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const { min: timeMin, max: timeMax } = timeRange

  // Client-side filtering combining all filters.
  // Everything the user sees (map, counts, indicators) derives from THIS set,
  // so the numbers always match the map.
  const filteredFires = useMemo(() => {
    if (!fires?.features) return null

    const filtered = filterFires(fires.features, filters, timeRange, fires.metadata)

    return {
      ...fires,
      features: filtered,
      metadata: {
        ...fires.metadata,
        total_count: filtered.length,
        totalCount: filtered.length
      }
    }
  }, [fires, filters, timeRange])

  // Calculate risk indicators from the VISIBLE fire set
  const riskIndicators = useMemo(() => {
    const peakHours = isPeakFireHours()

    let hasHighWind = false
    let maxWindSpeed = 0
    let majorFiresCount = 0
    let chileFiresCount = 0

    if (filteredFires?.features) {
      filteredFires.features.forEach(f => {
        const props = f.properties
        if (getFireCountry(props) !== 'Chile') return

        chileFiresCount++
        if (props.wind_speed >= 20) hasHighWind = true
        if (props.wind_speed > maxWindSpeed) maxWindSpeed = props.wind_speed
        if (props.severity === 'major' || props.severity === 'significant') majorFiresCount++
      })
    }

    return {
      peakHours,
      hasHighWind,
      maxWindSpeed,
      majorFiresCount,
      chileFiresCount
    }
  }, [filteredFires, currentHour])

  const sidePanelStatus = useMemo(() => {
    if (riskIndicators.hasHighWind) {
      return {
        label: 'Viento alto',
        detail: `${riskIndicators.maxWindSpeed.toFixed(0)} km/h max`,
        tone: 'warning'
      }
    }

    if (riskIndicators.peakHours) {
      return {
        label: 'Horario critico',
        detail: '13:00-19:00 hrs',
        tone: 'warning'
      }
    }

    return {
      label: 'Vigilancia',
      detail: 'Sin alerta activa',
      tone: 'stable'
    }
  }, [riskIndicators])

  const relevantFiresLabel = useMemo(() => {
    const count = riskIndicators.majorFiresCount
    const total = riskIndicators.chileFiresCount
    return count === 1 ? `1 de ${total} relevante` : `${count} de ${total} relevantes`
  }, [riskIndicators.majorFiresCount, riskIndicators.chileFiresCount])

  useEffect(() => {
    if (!isMobile && activeSidePanel === null) {
      setActiveSidePanel('risk')
    }
  }, [isMobile, activeSidePanel])

  const toggleSidePanel = useCallback((panel) => {
    setActiveSidePanel(prev => (prev === panel ? null : panel))
  }, [])

  // WebSocket connection with exponential backoff reconnect
  const connectWebSocket = useCallback(() => {
    // Use secure WebSocket in production, regular in development
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host // includes port if non-standard
    const wsUrl = `${protocol}//${host}/ws`
    console.log('Connecting to WebSocket:', wsUrl)

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('WebSocket connected')
      reconnectAttemptsRef.current = 0
      setWsConnected(true)
    }

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)

      if (message.type === 'update') {
        setFires(message.payload)
        setLastUpdated(new Date())
        setLoading(false)
      } else if (message.type === 'alert') {
        const alert = message.payload
        setAlerts(prev => [alert, ...prev.slice(0, 9)])

        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Alerta de Incendio', {
            body: alert.message,
            icon: '/fire-icon.png',
            tag: 'fire-alert'
          })
        }
      }
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
      setWsConnected(false)
      // Backoff: 3s, 6s, 12s, 24s, capped at 30s
      const attempt = reconnectAttemptsRef.current++
      const delay = Math.min(3000 * Math.pow(2, attempt), 30000)
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay)
    }

    ws.onerror = (err) => {
      console.error('WebSocket error:', err)
      ws.close()
    }

    wsRef.current = ws
  }, [])

  useEffect(() => {
    connectWebSocket()
    return () => {
      if (wsRef.current) wsRef.current.close()
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
    }
  }, [connectWebSocket])

  // Fallback HTTP fetch
  const fetchFires = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/fires')
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`)
      const data = await response.json()
      setFires(data)
      setLastUpdated(new Date())
      setError(null)
    } catch (err) {
      console.error('Error fetching fire data:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Initial fetch if WebSocket fails
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!fires) fetchFires()
    }, 2000)
    return () => clearTimeout(timeout)
  }, [fires])

  // Fetch regions once
  useEffect(() => {
    fetch('/api/regions')
      .then(r => r.json())
      .then(data => {
        if (data?.body) {
          setRegions(data.body)
        } else if (data) {
          setRegions(data)
        }
      })
      .catch(console.error)
  }, [])

  // Save filters to localStorage
  useEffect(() => {
    localStorage.setItem('matta.filters.v1', JSON.stringify(filters))
  }, [filters])

  // Load saved places from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('matta.savedPlaces.v1')
    if (saved) {
      try {
        setSavedPlaces(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to parse saved places:', e)
      }
    }
  }, [])

  // Save places to localStorage when changed
  useEffect(() => {
    localStorage.setItem('matta.savedPlaces.v1', JSON.stringify(savedPlaces))
  }, [savedPlaces])

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const newTheme = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('theme', newTheme)
      return newTheme
    })
  }, [])

  const dismissAlert = useCallback((index) => {
    setAlerts(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handlePlaceAlert = useCallback((alert) => {
    setAlerts(prev => [alert, ...prev.slice(0, 9)])
  }, [])

  // Data freshness — the single most important trust signal in this app
  const dataAgeMinutes = useMemo(() => {
    if (!lastUpdated) return null
    return Math.max(0, Math.floor((now - lastUpdated.getTime()) / 60000))
  }, [now, lastUpdated])

  // Refresh cadence is 1 min; anything older than 3 min means the pipe is stale
  const isStale = dataAgeMinutes !== null && dataAgeMinutes >= 3

  const formatDataAge = useCallback((minutes) => {
    if (minutes === null) return ''
    if (minutes < 1) return 'ahora'
    if (minutes < 60) return `hace ${minutes} min`
    const hours = Math.floor(minutes / 60)
    return `hace ${hours} h`
  }, [])

  const getStatusText = useCallback(() => {
    if (loading && !fires) return 'Cargando datos...'
    if (error) return `Error: ${error}`
    if (fires?.features) {
      const chileCount = riskIndicators.chileFiresCount
      const time = lastUpdated?.toLocaleTimeString('es-CL') || ''
      const age = dataAgeMinutes !== null ? ` (${formatDataAge(dataAgeMinutes)})` : ''
      return `${chileCount} focos en Chile · Actualizado ${time}${age}`
    }
    return 'Sin datos'
  }, [loading, fires, error, lastUpdated, riskIndicators, dataAgeMinutes, formatDataAge])

  // Saved-place map picking flow
  const handleStartPlacePick = useCallback(() => {
    setPickingPlace(true)
  }, [])

  const handleMapClick = useCallback((latlng) => {
    if (!pickingPlace) return
    setPlaceDraft({ lat: latlng.lat.toFixed(5), lng: latlng.lng.toFixed(5) })
    setPickingPlace(false)
  }, [pickingPlace])

  const buildExportParams = useCallback((format) => {
    const params = new URLSearchParams({ format })
    if (filters.chileOnly) params.set('chile_only', 'true')
    if (filters.source !== 'all') params.set('source', filters.source)
    if (filters.confidence !== 'all') params.set('confidence', filters.confidence)
    if (filters.intensity !== 'all') params.set('intensity', filters.intensity)
    if (filters.daynight !== 'all') params.set('daynight', filters.daynight)
    if (filters.region !== 'all') params.set('region', filters.region)
    if (filters.minFrp > 0) params.set('min_frp', filters.minFrp.toString())
    if (filters.maxFrp > 0) params.set('max_frp', filters.maxFrp.toString())
    if (timeMin > 0) params.set('from_ts', timeMin.toString())
    if (timeMax < Infinity) params.set('to_ts', timeMax.toString())
    return params
  }, [filters, timeMin, timeMax])

  return (
    <div className={`app-container ${theme}`}>
      <header className="header">
        <div className="header-left">
          <h1>Monitor de Incendios{!isMobile && ' - Chile'}</h1>
          <div className="status-badges">
            <span className={`status-badge ${wsConnected ? 'connected' : 'disconnected'}`}>
              {wsConnected ? 'En vivo' : 'Reconectando...'}
            </span>
          </div>
        </div>
        <div className="header-right">
          <span className={`status-text ${isStale ? 'stale' : ''}`} aria-live="polite">{getStatusText()}</span>
          <div className="header-controls">
            <button
              className={`toggle-btn ${showFilters ? 'active' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
              title="Filtrar incendios"
            >
              Filtros
            </button>
            <button
              className="toggle-btn export-btn"
              onClick={() => {
                window.open(`/api/export?${buildExportParams('csv').toString()}`, '_blank')
              }}
              title="Exportar CSV"
            >
              CSV
            </button>
            <button
              className="toggle-btn export-btn"
              onClick={() => {
                window.open(`/api/export?${buildExportParams('geojson').toString()}`, '_blank')
              }}
              title="Exportar GeoJSON"
            >
              GeoJSON
            </button>
            <button
              className={`toggle-btn ${showTrustNotice ? 'active' : ''}`}
              onClick={() => setShowTrustNotice(!showTrustNotice)}
              title="Informacion de fuentes"
            >
              Info
            </button>
            <button
              className={`toggle-btn ${showSavedPlaces ? 'active' : ''}`}
              onClick={() => setShowSavedPlaces(!showSavedPlaces)}
              title="Lugares guardados"
            >
              Lugares
            </button>
            <button
              className={`toggle-btn ${showHeatmap ? 'active' : ''}`}
              onClick={() => setShowHeatmap(!showHeatmap)}
              title="Ver zonas de mayor concentracion de incendios"
            >
              {isMobile ? 'Calor' : 'Mapa de calor'}
            </button>
            <button
              className={`toggle-btn ${showVegetation ? 'active' : ''}`}
              onClick={() => setShowVegetation(!showVegetation)}
              title="Muestra zonas con vegetacion que pueden arder"
            >
              {isMobile ? 'Vegetac.' : 'Vegetacion'}
            </button>
            <button
              className={`toggle-btn ${showClusters ? 'active' : ''}`}
              onClick={() => setShowClusters(!showClusters)}
              title="Agrupa focos cercanos para ver mejor el mapa"
            >
              Agrupar
            </button>
            <button className="theme-btn" onClick={toggleTheme} title="Cambiar tema claro/oscuro">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </header>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="alerts-container" role="log" aria-live="polite" aria-label="Alertas de incendio">
          {alerts.map((alert, index) => (
            <div key={index} className="alert-item" role="alert">
              <span className="alert-icon">🔥</span>
              <span className="alert-message">{alert.message}</span>
              <button className="alert-dismiss" onClick={() => dismissAlert(index)} aria-label="Descartar alerta">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Stale data warning — a dead feed must degrade loudly */}
      {isStale && (
        <div className="risk-banner stale-data" role="alert">
          <span className="risk-icon">📡</span>
          <div className="risk-content">
            <strong>DATOS DESACTUALIZADOS</strong>
            <span>
              {wsConnected
                ? `Sin datos nuevos ${formatDataAge(dataAgeMinutes)}. Los focos mostrados pueden haber cambiado.`
                : `Sin conexion en vivo. Mostrando datos de ${lastUpdated?.toLocaleTimeString('es-CL')} (${formatDataAge(dataAgeMinutes)}).`}
            </span>
          </div>
        </div>
      )}

      {/* Peak Hours Warning */}
      {riskIndicators.peakHours && (
        <div className="risk-banner peak-hours">
          <span className="risk-icon">⚠️</span>
          <div className="risk-content">
            <strong>HORARIO DE MAYOR RIESGO</strong>
            <span>Entre las 13:00 y 19:00 hrs ocurren la mayoria de los incendios forestales</span>
          </div>
          {riskIndicators.majorFiresCount > 0 && (
            <span className="risk-stat">{relevantFiresLabel} activos</span>
          )}
        </div>
      )}

      <div className="main-content">
        <div className="map-wrapper">
          {showSavedPlaces && (
            <SavedPlacesPanel
              places={savedPlaces}
              setPlaces={setSavedPlaces}
              fires={fires}
              onPlaceAlert={handlePlaceAlert}
              draftCoords={placeDraft}
              pickingPlace={pickingPlace}
              onStartPlacePick={handleStartPlacePick}
            />
          )}
          {showTrustNotice && fires?.metadata && (
            <TrustNotice metadata={fires.metadata} onClose={() => setShowTrustNotice(false)} />
          )}
          {fires && (
            <TimeSlider
              fires={fires}
              onTimeRangeChange={setTimeRange}
            />
          )}
          <div className="map-container">
            {showFilters && (
              <FilterPanel
                filters={filters}
                setFilters={setFilters}
                regions={regions}
                isMobile={isMobile}
                isOpen={showFilters}
                onClose={() => setShowFilters(false)}
              />
            )}
            {loading && !fires && (
              <div className="loading-overlay">Cargando datos satelitales...</div>
            )}
            <Suspense fallback={<div className="loading-overlay">Cargando mapa...</div>}>
              <Map
                fires={filteredFires}
                theme={theme}
                showHeatmap={showHeatmap}
                showClusters={showClusters}
                showVegetation={showVegetation}
                savedPlaces={savedPlaces}
                onMapClick={handleMapClick}
                pickingPlace={pickingPlace}
              />
            </Suspense>
            {showHeatmap ? <HeatLegend /> : <MapLegend />}
          </div>
        </div>

        <div className="side-panels" aria-label="Panel lateral de emergencia y riesgo">
          <div className="side-panel-overview">
            <div className="side-panel-title-row">
              <div>
                <span className="side-panel-kicker">Chile en vivo</span>
                <h2>Panel de accion</h2>
              </div>
              <a className="side-panel-call" href="tel:132" aria-label="Llamar a Bomberos 132">
                <span>132</span>
                <small>SOS</small>
              </a>
            </div>
            <div className="side-panel-status">
              <div className="side-panel-status-row">
                <span>Condicion</span>
                <strong className={`side-panel-status-value ${sidePanelStatus.tone}`}>
                  {sidePanelStatus.label}
                </strong>
              </div>
              <div className="side-panel-status-row">
                <span>{sidePanelStatus.detail}</span>
                <strong>{relevantFiresLabel}</strong>
              </div>
            </div>
          </div>
          <InfoPanel
            collapsed={activeSidePanel !== 'info'}
            onToggle={() => toggleSidePanel('info')}
          />
          <FWIPanel
            isMobile={isMobile}
            collapsed={activeSidePanel !== 'risk'}
            onToggle={() => toggleSidePanel('risk')}
          />
          <QuemasPanel
            collapsed={activeSidePanel !== 'burns'}
            onToggle={() => toggleSidePanel('burns')}
          />
        </div>
      </div>

      <footer className="app-footer">
        <span className="footer-message">Fuerza Chile 🇨🇱</span>
      </footer>
    </div>
  )
}

export default App
