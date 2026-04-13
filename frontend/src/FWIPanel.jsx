import React, { useState, useEffect } from 'react'

// Plain-language danger descriptions for civilians
const getDangerSummary = (dangerClass) => {
  switch (dangerClass?.toLowerCase()) {
    case 'extreme':
    case 'extremo':
      return 'Condiciones extremadamente peligrosas. Evite zonas rurales y forestales.'
    case 'very high':
    case 'muy alto':
      return 'Riesgo muy alto de incendio. Extreme las precauciones al aire libre.'
    case 'high':
    case 'alto':
      return 'Condiciones favorables para incendios. No haga fogatas ni quemas.'
    case 'moderate':
    case 'moderado':
      return 'Riesgo moderado. Precaucion con fuentes de calor al aire libre.'
    default:
      return 'Condiciones normales. Mantenga precauciones basicas.'
  }
}

const getDangerLabel = (dangerClass) => {
  switch (dangerClass?.toLowerCase()) {
    case 'extreme': return 'Extremo'
    case 'very high': return 'Muy Alto'
    case 'high': return 'Alto'
    case 'moderate': return 'Moderado'
    case 'low': return 'Bajo'
    default: return dangerClass || 'Bajo'
  }
}

function FWIPanel({ isMobile }) {
  const [fwiData, setFwiData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedCity, setSelectedCity] = useState('Santiago')
  const [collapsed, setCollapsed] = useState(isMobile)

  useEffect(() => {
    if (isMobile) setCollapsed(true)
  }, [isMobile])

  useEffect(() => {
    fetchFWI()
    const interval = setInterval(fetchFWI, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const fetchFWI = async () => {
    try {
      const res = await fetch('/api/fwi')
      const data = await res.json()
      setFwiData(data)
    } catch (err) {
      console.error('FWI fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  const selectedData = fwiData?.[selectedCity]

  const getFWIBarWidth = (fwi) => {
    return Math.min((fwi / 50) * 100, 100)
  }

  const getComponentColor = (value, type) => {
    switch (type) {
      case 'ffmc':
        if (value > 90) return '#ef4444'
        if (value > 85) return '#f97316'
        if (value > 80) return '#eab308'
        return '#22c55e'
      case 'dmc':
        if (value > 60) return '#ef4444'
        if (value > 40) return '#f97316'
        if (value > 20) return '#eab308'
        return '#22c55e'
      case 'dc':
        if (value > 400) return '#ef4444'
        if (value > 200) return '#f97316'
        if (value > 100) return '#eab308'
        return '#22c55e'
      case 'isi':
        if (value > 15) return '#ef4444'
        if (value > 10) return '#f97316'
        if (value > 5) return '#eab308'
        return '#22c55e'
      case 'bui':
        if (value > 80) return '#ef4444'
        if (value > 40) return '#f97316'
        if (value > 20) return '#eab308'
        return '#22c55e'
      default:
        return '#eab308'
    }
  }

  if (loading) {
    return (
      <div className="fwi-panel loading">
        <div className="fwi-header">
          <h3>Riesgo de Incendio</h3>
        </div>
        <div className="fwi-loading">Calculando...</div>
      </div>
    )
  }

  return (
    <div className={`fwi-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="fwi-header" onClick={() => setCollapsed(!collapsed)}>
        <h3>
          Riesgo de Incendio
          {selectedData && (
            <span
              className="fwi-badge"
              style={{ backgroundColor: selectedData.danger_color }}
            >
              {getDangerLabel(selectedData.danger_class)}
            </span>
          )}
        </h3>
        <span className="collapse-icon">{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && selectedData && (
        <div className="fwi-content">
          {/* City Selector */}
          <div className="fwi-city-select">
            <label className="fwi-city-label">Ciudad de referencia</label>
            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
            >
              {Object.keys(fwiData || {}).sort().map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </div>

          {/* Main FWI Display */}
          <div className="fwi-main">
            <div className="fwi-value" style={{ color: selectedData.danger_color }}>
              {getDangerLabel(selectedData.danger_class)}
            </div>
            <div className="fwi-bar-container">
              <div
                className="fwi-bar"
                style={{
                  width: `${getFWIBarWidth(selectedData.fwi)}%`,
                  backgroundColor: selectedData.danger_color
                }}
              />
            </div>
            <div className="fwi-summary">{getDangerSummary(selectedData.danger_class)}</div>
          </div>

          {/* Weather conditions — plain language */}
          <div className="fwi-weather">
            <div className="weather-item">
              <span className="weather-label">Temperatura</span>
              <span className="weather-value">{selectedData.temperature}°C</span>
            </div>
            <div className="weather-item">
              <span className="weather-label">Humedad</span>
              <span className="weather-value">{selectedData.humidity}%</span>
            </div>
            <div className="weather-item">
              <span className="weather-label">Viento</span>
              <span className="weather-value">{selectedData.wind_speed} km/h</span>
            </div>
            <div className="weather-item">
              <span className="weather-label">Lluvia</span>
              <span className="weather-value">{selectedData.precipitation} mm</span>
            </div>
          </div>

          {/* Simplified components — Spanish names, no acronyms */}
          <div className="fwi-components">
            <h4>Detalle de condiciones</h4>

            <div className="component-item">
              <span className="component-name" title="Que tan seca esta la vegetacion fina como pasto y hojas">
                Pasto y hojas
              </span>
              <div className="component-bar-bg">
                <div
                  className="component-bar"
                  style={{
                    width: `${selectedData.ffmc}%`,
                    backgroundColor: getComponentColor(selectedData.ffmc, 'ffmc')
                  }}
                />
              </div>
              <span className="component-value">{selectedData.ffmc > 85 ? 'Seco' : 'Normal'}</span>
            </div>

            <div className="component-item">
              <span className="component-name" title="Humedad de la capa organica del suelo">
                Suelo organico
              </span>
              <div className="component-bar-bg">
                <div
                  className="component-bar"
                  style={{
                    width: `${Math.min(selectedData.dmc / 1.5, 100)}%`,
                    backgroundColor: getComponentColor(selectedData.dmc, 'dmc')
                  }}
                />
              </div>
              <span className="component-value">{selectedData.dmc > 40 ? 'Seco' : 'Normal'}</span>
            </div>

            <div className="component-item">
              <span className="component-name" title="Nivel de sequia acumulada en la zona">
                Sequia
              </span>
              <div className="component-bar-bg">
                <div
                  className="component-bar"
                  style={{
                    width: `${Math.min(selectedData.dc / 8, 100)}%`,
                    backgroundColor: getComponentColor(selectedData.dc, 'dc')
                  }}
                />
              </div>
              <span className="component-value">{selectedData.dc > 200 ? 'Alta' : 'Normal'}</span>
            </div>

            <div className="component-item">
              <span className="component-name" title="Velocidad a la que un incendio puede crecer">
                Propagacion
              </span>
              <div className="component-bar-bg">
                <div
                  className="component-bar"
                  style={{
                    width: `${Math.min(selectedData.isi / 0.3, 100)}%`,
                    backgroundColor: getComponentColor(selectedData.isi, 'isi')
                  }}
                />
              </div>
              <span className="component-value">{selectedData.isi > 10 ? 'Rapida' : 'Normal'}</span>
            </div>
          </div>

          {/* Legend */}
          <div className="fwi-legend">
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#22c55e' }}></span>
              <span>Bajo</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#eab308' }}></span>
              <span>Moderado</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#f97316' }}></span>
              <span>Alto</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#ef4444' }}></span>
              <span>Muy Alto</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#dc2626' }}></span>
              <span>Extremo</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FWIPanel
