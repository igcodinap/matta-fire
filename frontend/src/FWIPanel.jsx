import React, { useState, useEffect } from 'react'

function FWIPanel({ isMobile }) {
  const [fwiData, setFwiData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedCity, setSelectedCity] = useState('Santiago')
  const [collapsed, setCollapsed] = useState(isMobile) // Collapsed by default on mobile

  // Update collapsed state when isMobile changes
  useEffect(() => {
    if (isMobile) setCollapsed(true)
  }, [isMobile])

  useEffect(() => {
    fetchFWI()
    const interval = setInterval(fetchFWI, 5 * 60 * 1000) // Update every 5 minutes
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
    // Scale FWI to percentage (max around 50 for extreme)
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
          <h3>Indice de Clima de Fuego (FWI)</h3>
        </div>
        <div className="fwi-loading">Calculando...</div>
      </div>
    )
  }

  return (
    <div className={`fwi-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="fwi-header" onClick={() => setCollapsed(!collapsed)}>
        <h3>
          Indice de Clima de Fuego
          {selectedData && (
            <span
              className="fwi-badge"
              style={{ backgroundColor: selectedData.danger_color }}
            >
              {selectedData.danger_class}
            </span>
          )}
        </h3>
        <span className="collapse-icon">{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && selectedData && (
        <div className="fwi-content">
          {/* City Selector */}
          <div className="fwi-city-select">
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
              {selectedData.fwi}
            </div>
            <div className="fwi-label">Fire Weather Index</div>
            <div className="fwi-bar-container">
              <div
                className="fwi-bar"
                style={{
                  width: `${getFWIBarWidth(selectedData.fwi)}%`,
                  backgroundColor: selectedData.danger_color
                }}
              />
            </div>
            <div className="fwi-spread">{selectedData.spread_potential}</div>
          </div>

          {/* Weather Inputs */}
          <div className="fwi-weather">
            <div className="weather-item">
              <span className="weather-icon">🌡️</span>
              <span className="weather-value">{selectedData.temperature}°C</span>
            </div>
            <div className="weather-item">
              <span className="weather-icon">💧</span>
              <span className="weather-value">{selectedData.humidity}%</span>
            </div>
            <div className="weather-item">
              <span className="weather-icon">💨</span>
              <span className="weather-value">{selectedData.wind_speed} km/h</span>
            </div>
            <div className="weather-item">
              <span className="weather-icon">🌧️</span>
              <span className="weather-value">{selectedData.precipitation} mm</span>
            </div>
          </div>

          {/* FWI Components */}
          <div className="fwi-components">
            <h4>Componentes del Indice</h4>

            <div className="component-group">
              <div className="component-label">Codigos de Humedad</div>

              <div className="component-item">
                <span className="component-name" title="Fine Fuel Moisture Code - Humedad de combustibles finos">
                  FFMC
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
                <span className="component-value">{selectedData.ffmc}</span>
              </div>

              <div className="component-item">
                <span className="component-name" title="Duff Moisture Code - Humedad de materia organica">
                  DMC
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
                <span className="component-value">{selectedData.dmc}</span>
              </div>

              <div className="component-item">
                <span className="component-name" title="Drought Code - Codigo de sequia">
                  DC
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
                <span className="component-value">{selectedData.dc}</span>
              </div>
            </div>

            <div className="component-group">
              <div className="component-label">Indices de Comportamiento</div>

              <div className="component-item">
                <span className="component-name" title="Initial Spread Index - Tasa de propagacion inicial">
                  ISI
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
                <span className="component-value">{selectedData.isi}</span>
              </div>

              <div className="component-item">
                <span className="component-name" title="Buildup Index - Combustible disponible">
                  BUI
                </span>
                <div className="component-bar-bg">
                  <div
                    className="component-bar"
                    style={{
                      width: `${Math.min(selectedData.bui, 100)}%`,
                      backgroundColor: getComponentColor(selectedData.bui, 'bui')
                    }}
                  />
                </div>
                <span className="component-value">{selectedData.bui}</span>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="fwi-legend">
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#22c55e' }}></span>
              <span>Bajo (&lt;5)</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#eab308' }}></span>
              <span>Moderado (5-12)</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#f97316' }}></span>
              <span>Alto (12-21)</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#ef4444' }}></span>
              <span>Muy Alto (21-38)</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#dc2626' }}></span>
              <span>Extremo (&gt;38)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FWIPanel
