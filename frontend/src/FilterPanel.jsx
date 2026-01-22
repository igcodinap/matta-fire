import React, { useState } from 'react'

function FilterPanel({ filters, setFilters, regions, sources, isMobile, isOpen, onClose }) {
  const [collapsed, setCollapsed] = useState(false)

  const handleChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const resetFilters = () => {
    setFilters({
      source: 'all',
      confidence: 'all',
      intensity: 'all',
      daynight: 'all',
      region: 'all',
      minFrp: 0,
      maxFrp: 0
    })
  }

  const hasActiveFilters = Object.entries(filters).some(([key, value]) => {
    if (key === 'minFrp' || key === 'maxFrp') return value > 0
    return value !== 'all'
  })

  // On mobile, use isOpen prop; on desktop, use collapsed state
  const panelClass = isMobile
    ? `filter-panel mobile ${isOpen ? 'open' : ''}`
    : `filter-panel ${collapsed ? 'collapsed' : ''}`

  return (
    <div className={panelClass}>
      <div className="filter-header" onClick={() => isMobile ? onClose() : setCollapsed(!collapsed)}>
        <h3>Filtros {hasActiveFilters && <span className="filter-badge">Activos</span>}</h3>
        <span className="collapse-icon">
          {isMobile ? '✕' : (collapsed ? '▶' : '▼')}
        </span>
      </div>

      {!collapsed && (
        <div className="filter-content">
          {/* Source */}
          <div className="filter-group">
            <label>Satelite</label>
            <select
              value={filters.source}
              onChange={(e) => handleChange('source', e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="NOAA-20">VIIRS NOAA-20</option>
              <option value="Suomi">VIIRS Suomi NPP</option>
              <option value="MODIS">MODIS</option>
            </select>
          </div>

          {/* Confidence */}
          <div className="filter-group">
            <label>Confianza</label>
            <select
              value={filters.confidence}
              onChange={(e) => handleChange('confidence', e.target.value)}
            >
              <option value="all">Todas</option>
              <option value="high">Alta</option>
              <option value="nominal">Nominal</option>
              <option value="low">Baja</option>
            </select>
          </div>

          {/* Intensity */}
          <div className="filter-group">
            <label>Intensidad</label>
            <select
              value={filters.intensity}
              onChange={(e) => handleChange('intensity', e.target.value)}
            >
              <option value="all">Todas</option>
              <option value="extreme">Extrema (FRP ≥ 100)</option>
              <option value="high">Alta (FRP 50-100)</option>
              <option value="medium">Media (FRP 20-50)</option>
              <option value="low">Baja (FRP &lt; 20)</option>
            </select>
          </div>

          {/* Day/Night */}
          <div className="filter-group">
            <label>Momento</label>
            <select
              value={filters.daynight}
              onChange={(e) => handleChange('daynight', e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="D">Dia</option>
              <option value="N">Noche</option>
            </select>
          </div>

          {/* Region */}
          <div className="filter-group">
            <label>Region</label>
            <select
              value={filters.region}
              onChange={(e) => handleChange('region', e.target.value)}
            >
              <option value="all">Todas</option>
              {Object.entries(regions).sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>

          {/* FRP Range */}
          <div className="filter-group">
            <label>FRP Minimo (MW)</label>
            <input
              type="number"
              min="0"
              step="5"
              value={filters.minFrp || ''}
              onChange={(e) => handleChange('minFrp', parseFloat(e.target.value) || 0)}
              placeholder="0"
            />
          </div>

          <div className="filter-group">
            <label>FRP Maximo (MW)</label>
            <input
              type="number"
              min="0"
              step="5"
              value={filters.maxFrp || ''}
              onChange={(e) => handleChange('maxFrp', parseFloat(e.target.value) || 0)}
              placeholder="Sin limite"
            />
          </div>

          {hasActiveFilters && (
            <button className="reset-btn" onClick={resetFilters}>
              Limpiar filtros
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default FilterPanel
