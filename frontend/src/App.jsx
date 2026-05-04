import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react'
import TimeSlider from './TimeSlider'
import FWIPanel from './FWIPanel'
import InfoPanel from './InfoPanel'
import QuemasPanel from './QuemasPanel'
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
      setIsMobile(isMobileDevice())
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Calculate risk indicators
  const riskIndicators = useMemo(() => {
    const peakHours = isPeakFireHours()
    const botonRojoWindow = isBotonRojoWindow()

    let hasHighWind = false
    let maxWindSpeed = 0
    let majorFiresCount = 0

    if (fires?.features) {
      fires.features.forEach(f => {
        const props = f.properties
        if (props.wind_speed >= 20) hasHighWind = true
        if (props.wind_speed > maxWindSpeed) maxWindSpeed = props.wind_speed
        if (props.severity === 'major' || props.severity === 'significant') majorFiresCount++
      })
    }

    const botonRojo = botonRojoWindow && hasHighWind

    return { peakHours, botonRojo, hasHighWind, maxWindSpeed, majorFiresCount }
  }, [fires, currentHour])

  const sidePanelStatus = useMemo(() => {
    if (riskIndicators.botonRojo) {
      return {
        label: 'Boton Rojo',
        detail: `${riskIndicators.maxWindSpeed.toFixed(0)} km/h de viento`,
        tone: 'critical'
      }
    }

    if (riskIndicators.peakHours) {
      return {
        label: 'Horario critico',
        detail: '13:00-19:00 hrs',
        tone: 'warning'
      }
    }

    if (riskIndicators.hasHighWind) {
      return {
        label: 'Viento alto',
        detail: `${riskIndicators.maxWindSpeed.toFixed(0)} km/h max`,
        tone: 'warning'
      }
    }

    return {
      label: 'Vigilancia',
      detail: 'Sin alerta activa',
      tone: 'stable'
    }
  }, [riskIndicators])

  useEffect(() => {
    if (!isMobile && activeSidePanel === null) {
      setActiveSidePanel('risk')
    }
  }, [isMobile, activeSidePanel])

  const toggleSidePanel = useCallback((panel) => {
    setActiveSidePanel(prev => (prev === panel ? null : panel))
  }, [])

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

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

  const { min: timeMin, max: timeMax } = timeRange

  // Filter fires by time range only
  const computedFilteredFires = useMemo(() => {
    if (!fires?.features) return null

    const filtered = fires.features.filter(f => {
      const p = f.properties
      if (p.timestamp < timeMin || p.timestamp > timeMax) return false
      return true
    })

    return {
      ...fires,
      features: filtered,
      metadata: { ...fires.metadata, totalCount: filtered.length }
    }
  }, [fires, timeMin, timeMax])

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

  const getStatusText = useCallback(() => {
    if (loading && !fires) return 'Cargando datos...'
    if (error) return `Error: ${error}`
    if (fires?.features) {
      const total = fires.features.length
      const time = lastUpdated?.toLocaleTimeString('es-CL') || ''
      return `${total} focos detectados · Actualizado ${time}`
    }
    return 'Sin datos'
  }, [loading, fires, error, lastUpdated])

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
          {!isMobile && <span className="status-text">{getStatusText()}</span>}
          <div className="header-controls">
            <button
              className={`toggle-btn ${showHeatmap ? 'active' : ''}`}
              onClick={() => setShowHeatmap(!showHeatmap)}
              title="Ver zonas de mayor concentracion de incendios"
            >
              {isMobile ? '🔥' : 'Mapa de calor'}
            </button>
            <button
              className={`toggle-btn ${showVegetation ? 'active' : ''}`}
              onClick={() => setShowVegetation(!showVegetation)}
              title="Muestra zonas con vegetacion que pueden arder"
            >
              {isMobile ? '🌿' : 'Vegetacion'}
            </button>
            <button
              className={`toggle-btn ${showClusters ? 'active' : ''}`}
              onClick={() => setShowClusters(!showClusters)}
              title="Agrupa focos cercanos para ver mejor el mapa"
            >
              {isMobile ? '⊕' : 'Agrupar'}
            </button>
            <button className="theme-btn" onClick={toggleTheme} title="Cambiar tema claro/oscuro">
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
            <strong>ALERTA: CONDICIONES EXTREMAS DE INCENDIO</strong>
            <span>Horario de mayor riesgo (14:00-19:00) con vientos fuertes de {riskIndicators.maxWindSpeed.toFixed(0)} km/h. Extreme precaucion.</span>
          </div>
          {riskIndicators.majorFiresCount > 0 && (
            <span className="risk-stat">{riskIndicators.majorFiresCount} incendios graves activos</span>
          )}
        </div>
      )}

      {/* Peak Hours Warning */}
      {!riskIndicators.botonRojo && riskIndicators.peakHours && (
        <div className="risk-banner peak-hours">
          <span className="risk-icon">⚠️</span>
          <div className="risk-content">
            <strong>HORARIO DE MAYOR RIESGO</strong>
            <span>Entre las 13:00 y 19:00 hrs ocurren la mayoria de los incendios forestales</span>
          </div>
          {riskIndicators.majorFiresCount > 0 && (
            <span className="risk-stat">{riskIndicators.majorFiresCount} incendios graves activos</span>
          )}
        </div>
      )}

      <div className="main-content">
        <div className="map-wrapper">
          {fires && (
            <TimeSlider
              fires={fires}
              onTimeRangeChange={setTimeRange}
            />
          )}
          <div className="map-container">
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
              />
            </Suspense>
            {!showHeatmap && <MapLegend />}
          </div>
        </div>

        <div className="side-panels" aria-label="Panel lateral de emergencia y riesgo">
          <div className="side-panel-overview">
            <div className="side-panel-title-row">
              <div>
                <span className="side-panel-kicker">Chile en vivo</span>
                <h2>Panel de accion</h2>
              </div>
              <a className="side-panel-call" href="tel:130" aria-label="Llamar a Bomberos 130">
                <span>130</span>
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
                <strong>{riskIndicators.majorFiresCount} graves</strong>
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
