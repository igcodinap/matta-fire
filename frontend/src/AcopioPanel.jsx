import React, { useState, useMemo } from 'react'
import { centrosAcopio, fuentesInfo, queDonar, noDonar } from './acopioData'

function AcopioPanel({ isMobile }) {
  const [collapsed, setCollapsed] = useState(isMobile)
  const [selectedRegion, setSelectedRegion] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  // Get unique regions
  const regiones = useMemo(() => {
    const unique = [...new Set(centrosAcopio.map(c => c.region))]
    return unique.sort()
  }, [])

  // Filter centers
  const filteredCentros = useMemo(() => {
    return centrosAcopio.filter(centro => {
      const matchRegion = selectedRegion === 'all' || centro.region === selectedRegion
      const matchSearch = searchTerm === '' ||
        centro.comuna.toLowerCase().includes(searchTerm.toLowerCase()) ||
        centro.lugares.some(l =>
          l.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
          l.direccion.toLowerCase().includes(searchTerm.toLowerCase())
        )
      return matchRegion && matchSearch
    })
  }, [selectedRegion, searchTerm])

  // Group by region
  const centrosPorRegion = useMemo(() => {
    const grouped = {}
    filteredCentros.forEach(centro => {
      if (!grouped[centro.region]) {
        grouped[centro.region] = []
      }
      grouped[centro.region].push(centro)
    })
    return grouped
  }, [filteredCentros])

  const totalLugares = useMemo(() => {
    return filteredCentros.reduce((acc, c) => acc + c.lugares.length, 0)
  }, [filteredCentros])

  return (
    <div className={`acopio-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="acopio-header" onClick={() => setCollapsed(!collapsed)}>
        <h3>
          <span className="acopio-icon">🤝</span>
          Centros de Acopio
          <span className="acopio-badge">{totalLugares}</span>
        </h3>
        <span className="collapse-icon">{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <div className="acopio-content">
          {/* Search and filter */}
          <div className="acopio-filters">
            <input
              type="text"
              placeholder="Buscar comuna o lugar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="acopio-search"
            />
            <select
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              className="acopio-region-select"
            >
              <option value="all">Todas las regiones</option>
              {regiones.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* What to donate */}
          <div className="acopio-donate-info">
            <div className="donate-yes">
              <strong>✅ Qué donar:</strong>
              <span>{queDonar.slice(0, 4).join(', ')}...</span>
            </div>
            <div className="donate-no">
              <strong>❌ No donar:</strong>
              <span>{noDonar.join(', ')}</span>
            </div>
          </div>

          {/* Centers list */}
          <div className="acopio-list">
            {Object.entries(centrosPorRegion).map(([region, centros]) => (
              <div key={region} className="acopio-region-group">
                <h4 className="region-title">{region}</h4>
                {centros.map((centro, idx) => (
                  <div key={idx} className="acopio-comuna">
                    <div className="comuna-header">
                      <span className="comuna-name">{centro.comuna}</span>
                      <span className="comuna-horario">{centro.horario}</span>
                    </div>
                    <ul className="lugares-list">
                      {centro.lugares.map((lugar, lidx) => (
                        <li key={lidx} className="lugar-item">
                          <span className="lugar-nombre">{lugar.nombre}</span>
                          <span className="lugar-direccion">{lugar.direccion}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Sources */}
          <div className="acopio-sources">
            <span>Fuentes: </span>
            {fuentesInfo.map((f, idx) => (
              <span key={idx}>
                <a href={f.url} target="_blank" rel="noopener noreferrer">{f.nombre}</a>
                {idx < fuentesInfo.length - 1 && ', '}
              </span>
            ))}
          </div>

          {/* Last update */}
          <div className="acopio-update">
            Última actualización: 21 de Enero 2026
          </div>
        </div>
      )}
    </div>
  )
}

export default AcopioPanel
