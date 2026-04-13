import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react'
import FilterPanel from './FilterPanel'
import TimeSlider from './TimeSlider'
import FWIPanel from './FWIPanel'
import InfoPanel from './InfoPanel'
import './App.css'

// Check if mobile on initial render
const isMobileDevice = () => window.innerWidth <= 768

// Lazy load heavy Map component (Leaflet is large)
const Map = lazy(() => import('./Map'))

// Initial filter state (defined outside component to avoid recreation)
const INITIAL_FILTERS = {
  source: 'all',
  confidence: 'all',
  intensity: 'all',
  daynight: 'all',
  region: 'all',
  minFrp: 0,
  maxFrp: 0
}

// Regional risk levels based on CONAF historical data (using Chilean region codes)
const REGIONAL_RISK = {
  'IX': { level: 'critical', label: 'Critico' },      // La Araucanía
  'VIII': { level: 'high', label: 'Alto' },           // Biobío
  'VII': { level: 'high', label: 'Alto' },            // Maule
  'V': { level: 'elevated', label: 'Elevado' },       // Valparaíso
  'VI': { level: 'elevated', label: 'Elevado' },      // O'Higgins
  'RM': { level: 'moderate', label: 'Moderado' },     // Metropolitana
  'XVI': { level: 'elevated', label: 'Elevado' },     // Ñuble
  'IV': { level: 'moderate', label: 'Moderado' },     // Coquimbo
}

// Check if current time is in peak fire hours (Chilean time)
function isPeakFireHours() {
  const now = new Date()
  // Get Chilean time (America/Santiago)
  const chileanTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Santiago' }))
  const hour = chileanTime.getHours()
  return hour >= 13 && hour < 19 // 13:00 - 18:59
}

// Check if in Botón Rojo window (14:00 - 18:59)
function isBotonRojoWindow() {
  const now = new Date()
  const chileanTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Santiago' }))
  const hour = chileanTime.getHours()
  return hour >= 14 && hour < 19 // 14:00 - 18:59
}

function App() {
  // Use function form for state initialization
  const [fires, setFires] = useState(() => null)
  const [filteredFires, setFilteredFires] = useState(() => null)
  const [loading, setLoading] = useState(() => true)
  const [error, setError] = useState(() => null)
  const [lastUpdated, setLastUpdated] = useState(() => null)
  const [theme, setTheme] = useState(() => {
    // Persist theme preference
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
  const [filters, setFilters] = useState(() => INITIAL_FILTERS)
  const [timeRange, setTimeRange] = useState(() => ({ min: 0, max: Infinity }))
  const [regions, setRegions] = useState(() => ({}))
  const [wind, setWind] = useState(() => null)
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours())
  const [mobileFilterOpen, setMobileFilterOpen] = useState(() => false)
  const [isMobile, setIsMobile] = useState(() => isMobileDevice())

  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)

  // Update current hour every minute for time-based risk indicators
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentHour(new Date().getHours())
    }, 60000) // Check every minute
    return () => clearInterval(interval)
  }, [])

  // Handle window resize for mobile detection
  useEffect(() => {
    const handleResize = () => {
      const mobile = isMobileDevice()
      setIsMobile(mobile)
      if (!mobile) setMobileFilterOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Calculate risk indicators
  const riskIndicators = useMemo(() => {
    const peakHours = isPeakFireHours()
    const botonRojoWindow = isBotonRojoWindow()

    // Check if any fire has high wind (≥20 km/h)
    let hasHighWind = false
    let maxWindSpeed = 0
    let majorFiresCount = 0
    let highRiskRegionFires = 0

    if (fires?.features) {
      fires.features.forEach(f => {
        const props = f.properties
        if (props.wind_speed >= 20) hasHighWind = true
        if (props.wind_speed > maxWindSpeed) maxWindSpeed = props.wind_speed
        if (props.severity === 'major' || props.severity === 'significant') majorFiresCount++
        const region = props.region
        if (REGIONAL_RISK[region]?.level === 'critical' || REGIONAL_RISK[region]?.level === 'high') {
          highRiskRegionFires++
        }
      })
    }

    // Botón Rojo lite: peak window + high wind
    const botonRojo = botonRojoWindow && hasHighWind

    return {
      peakHours,
      botonRojoWindow,
      botonRojo,
      hasHighWind,
      maxWindSpeed,
      majorFiresCount,
      highRiskRegionFires
    }
  }, [fires, currentHour])

  // Request notification permission and fetch initial data in parallel
  useEffect(() => {
    // Notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    // Parallel fetch for regions and initial wind data
    const fetchInitialData = async () => {
      try {
        const [regionsRes, windRes] = await Promise.all([
          fetch('/api/regions'),
          fetch('/api/wind?lat=-33.45&lon=-70.65')
        ])

        const [regionsData, windData] = await Promise.all([
          regionsRes.json(),
          windRes.json()
        ])

        setRegions(regionsData)
        if (windData.current) {
          setWind({
            speed: windData.current.wind_speed_10m,
            direction: windData.current.wind_direction_10m
          })
        }
      } catch (err) {
        console.error('Initial data fetch error:', err)
      }
    }

    fetchInitialData()
  }, [])

  // Fetch wind data (for periodic updates after initial load)
  const fetchWind = useCallback(async () => {
    try {
      const res = await fetch('/api/wind?lat=-33.45&lon=-70.65')
      const data = await res.json()
      if (data.current) {
        setWind({
          speed: data.current.wind_speed_10m,
          direction: data.current.wind_direction_10m
        })
      }
    } catch (err) {
      console.error('Wind fetch error:', err)
    }
  }, [])

  // Periodic wind updates (initial fetch is done in parallel above)
  useEffect(() => {
    const interval = setInterval(fetchWind, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchWind])

  // WebSocket connection
  const connectWebSocket = useCallback(() => {
    // Use secure WebSocket in production, regular in development
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host // includes port if non-standard
    const wsUrl = `${protocol}//${host}/ws`
    console.log('Connecting to WebSocket:', wsUrl)

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('WebSocket connected')
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
        if (Notification.permission === 'granted') {
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
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000)
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

  // Extract filter values as primitives for stable dependencies
  const { source, confidence, intensity, daynight, region, minFrp, maxFrp } = filters
  const { min: timeMin, max: timeMax } = timeRange

  // Use useMemo for filtered fires to avoid unnecessary recalculations
  const computedFilteredFires = useMemo(() => {
    if (!fires?.features) return null

    const filtered = fires.features.filter(f => {
      const p = f.properties

      // Source filter
      if (source !== 'all') {
        if (!p.satellite.toUpperCase().includes(source.toUpperCase())) return false
      }

      // Confidence filter
      if (confidence !== 'all') {
        const conf = p.confidence.toLowerCase()
        if (confidence === 'high' && conf !== 'h' && conf !== 'high') return false
        if (confidence === 'nominal' && conf !== 'n' && conf !== 'nominal') return false
        if (confidence === 'low' && conf !== 'l' && conf !== 'low') return false
      }

      // Intensity filter
      if (intensity !== 'all' && p.intensity !== intensity) return false

      // Day/Night filter
      if (daynight !== 'all' && p.daynight !== daynight) return false

      // Region filter
      if (region !== 'all' && p.region !== region) return false

      // FRP filter
      if (minFrp > 0 && p.frp < minFrp) return false
      if (maxFrp > 0 && p.frp > maxFrp) return false

      // Time range filter
      if (p.timestamp < timeMin || p.timestamp > timeMax) return false

      return true
    })

    return {
      ...fires,
      features: filtered,
      metadata: { ...fires.metadata, totalCount: filtered.length }
    }
  }, [fires, source, confidence, intensity, daynight, region, minFrp, maxFrp, timeMin, timeMax])

  // Sync filtered fires state with computed value
  useEffect(() => {
    setFilteredFires(computedFilteredFires)
  }, [computedFilteredFires])

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

  const handleExport = useCallback((format) => {
    window.open(`/api/export?format=${format}`, '_blank')
  }, [])

  const getStatusText = useCallback(() => {
    if (loading && !fires) return 'Cargando datos...'
    if (error) return `Error: ${error}`
    if (filteredFires) {
      const total = fires?.features?.length || 0
      const filtered = filteredFires.features?.length || 0
      const time = lastUpdated?.toLocaleTimeString('es-CL') || ''
      if (filtered !== total) {
        return `${filtered} de ${total} focos · ${time}`
      }
      return `${total} focos activos · ${time}`
    }
    return 'Sin datos'
  }, [loading, fires, error, filteredFires, lastUpdated])

  return (
    <div className={`app-container ${theme}`}>
      <header className="header">
        <div className="header-left">
          {isMobile && (
            <button
              className="mobile-menu-btn"
              onClick={() => setMobileFilterOpen(!mobileFilterOpen)}
              title="Abrir filtros"
            >
              ☰
            </button>
          )}
          <h1>Monitor de Incendios{!isMobile && ' - Chile'}</h1>
          <div className="status-badges">
            <span className={`status-badge ${wsConnected ? 'connected' : 'disconnected'}`}>
              {wsConnected ? 'En vivo' : 'Reconectando...'}
            </span>
            {wind && !isMobile && (
              <span className="wind-badge">
                Viento: {wind.speed} km/h {getWindDirection(wind.direction)}
              </span>
            )}
          </div>
        </div>
        <div className="header-right">
          {!isMobile && <span className="status-text">{getStatusText()}</span>}
          <div className="header-controls">
            <button
              className={`toggle-btn ${showHeatmap ? 'active' : ''}`}
              onClick={() => setShowHeatmap(!showHeatmap)}
              title="Mapa de calor"
            >
              {isMobile ? '🔥' : 'Calor'}
            </button>
            <button
              className={`toggle-btn ${showVegetation ? 'active' : ''}`}
              onClick={() => setShowVegetation(!showVegetation)}
              title="Capa de vegetacion (ESA WorldCover)"
            >
              {isMobile ? '🌿' : 'Vegetacion'}
            </button>
            <button
              className={`toggle-btn ${showClusters ? 'active' : ''}`}
              onClick={() => setShowClusters(!showClusters)}
              title="Agrupar marcadores"
            >
              {isMobile ? '⊕' : 'Clusters'}
            </button>
            {!isMobile && (
              <>
                <button className="export-btn" onClick={() => handleExport('csv')} title="Exportar CSV">
                  CSV
                </button>
                <button className="export-btn" onClick={() => handleExport('geojson')} title="Exportar GeoJSON">
                  GeoJSON
                </button>
              </>
            )}
            <button className="theme-btn" onClick={toggleTheme} title="Cambiar tema">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </header>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="alerts-container">
          {alerts.map((alert, index) => (
            <div key={index} className="alert-item">
              <span className="alert-icon">🔥</span>
              <span className="alert-message">{alert.message}</span>
              <button className="alert-dismiss" onClick={() => dismissAlert(index)}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Risk Banner - Botón Rojo */}
      {riskIndicators.botonRojo && (
        <div className="risk-banner boton-rojo">
          <span className="risk-icon">🚨</span>
          <div className="risk-content">
            <strong>ALERTA BOTON ROJO</strong>
            <span>Ventana de riesgo activa (14:00-19:00) + Vientos fuertes ({riskIndicators.maxWindSpeed.toFixed(0)} km/h)</span>
          </div>
          <span className="risk-source">Basado en criterios CONAF</span>
        </div>
      )}

      {/* Peak Hours Warning (only if not already showing Botón Rojo) */}
      {!riskIndicators.botonRojo && riskIndicators.peakHours && (
        <div className="risk-banner peak-hours">
          <span className="risk-icon">⚠️</span>
          <div className="risk-content">
            <strong>HORARIO DE RIESGO ELEVADO</strong>
            <span>13:00-19:00 hrs - Periodo historico de mayor ocurrencia de incendios</span>
          </div>
          {riskIndicators.majorFiresCount > 0 && (
            <span className="risk-stat">{riskIndicators.majorFiresCount} incendios mayores activos</span>
          )}
          <span className="risk-source">Fuente: Estadisticas CONAF</span>
        </div>
      )}

      <div className="main-content">
        {/* Mobile overlay */}
        {isMobile && mobileFilterOpen && (
          <div className="mobile-overlay" onClick={() => setMobileFilterOpen(false)} />
        )}

        <FilterPanel
          filters={filters}
          setFilters={setFilters}
          regions={regions}
          sources={fires?.metadata?.sources || []}
          isMobile={isMobile}
          isOpen={mobileFilterOpen}
          onClose={() => setMobileFilterOpen(false)}
        />

        <div className="map-wrapper">
          {fires && (
            <TimeSlider
              fires={fires}
              onTimeRangeChange={setTimeRange}
            />
          )}
          <div className="map-container">
            {loading && !fires && (
              <div className="loading-overlay">Cargando datos de NASA FIRMS...</div>
            )}
            <Suspense fallback={<div className="loading-overlay">Cargando mapa...</div>}>
              <Map
                fires={filteredFires}
                theme={theme}
                showHeatmap={showHeatmap}
                showClusters={showClusters}
                showVegetation={showVegetation}
              />
            </Suspense>
          </div>
        </div>

        <InfoPanel isMobile={isMobile} />
        <FWIPanel isMobile={isMobile} />
      </div>

      <footer className="app-footer">
        <span className="footer-message">Fuerza Chile 🇨🇱</span>
      </footer>
    </div>
  )
}

function getWindDirection(degrees) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const index = Math.round(degrees / 45) % 8
  return directions[index]
}

export default App
