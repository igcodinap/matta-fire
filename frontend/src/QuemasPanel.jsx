import { useState } from 'react'

function QuemasPanel({ collapsed: controlledCollapsed, onToggle }) {
  const [internalCollapsed, setInternalCollapsed] = useState(true)
  const collapsed = controlledCollapsed ?? internalCollapsed

  const handleToggle = () => {
    if (onToggle) {
      onToggle()
      return
    }
    setInternalCollapsed(prev => !prev)
  }

  return (
    <div className={`quemas-panel ${collapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="quemas-header panel-header-button"
        onClick={handleToggle}
        aria-expanded={!collapsed}
      >
        <h3>
          <span className="info-icon">🌾</span>
          <span>
            <span className="panel-title">Quemas Agricolas</span>
            <span className="panel-subtitle">Calendario CONAF</span>
          </span>
        </h3>
        <span className="panel-header-side">
          <span className="panel-header-meta">CONAF vigente</span>
          <span className="info-toggle-icon">{collapsed ? '▶' : '▼'}</span>
        </span>
      </button>

      {!collapsed && (
        <div className="info-content">
          <section className="info-section">
            <h4>Estado oficial CONAF</h4>
            <p>
              Las quemas controladas dependen del calendario vigente por region o comuna
              y pueden cambiar por resolucion de CONAF, condiciones meteorologicas,
              PPDA/PDA o Boton Rojo.
            </p>

            <div className="info-table">
              <div className="info-table-row header">
                <span>Fuente</span>
                <span>Revision</span>
                <span>Uso recomendado</span>
              </div>
              <div className="info-table-row">
                <strong>CONAF</strong>
                <span>Actualizacion continua</span>
                <span>Ver estado vigente antes de cualquier aviso</span>
              </div>
              <div className="info-table-row">
                <strong>Calendarios</strong>
                <span>Modificables</span>
                <span>No usar esta app como autorizacion</span>
              </div>
            </div>
          </section>

          <section className="info-section">
            <h4>Importante</h4>
            <ul>
              <li>
                El aviso de quema controlada no autoriza quemar si existe restriccion
                vigente para la region, comuna o predio.
              </li>
              <li>
                Revise el estado actualizado de CONAF el mismo dia de la actividad.
              </li>
              <li>
                Todas las quemas requieren <strong>aviso previo a CONAF</strong>
                y deben cumplir las condiciones indicadas por la autoridad.
              </li>
              <li>
                Las quemas agricolas son una de las principales causas de
                incendios forestales que escapan de control en Chile.
              </li>
            </ul>
          </section>

          <section className="info-section">
            <h4>Recursos</h4>
            <a
              href="https://www.conaf.cl/actualizacion-situacion-uso-del-fuego-en-regiones/"
              target="_blank"
              rel="noopener noreferrer"
              className="info-link"
            >
              Restricciones vigentes por region (CONAF)
            </a>
            <a
              href="https://www.conaf.cl/incendios/prevencion-y-mitigacion/uso-del-fuego/"
              target="_blank"
              rel="noopener noreferrer"
              className="info-link"
            >
              Uso del fuego y calendarios oficiales (CONAF)
            </a>
            <a
              href="https://www.chileatiende.gob.cl/fichas/742-aviso-de-quema-controlada"
              target="_blank"
              rel="noopener noreferrer"
              className="info-link"
            >
              Aviso de Quema Controlada (ChileAtiende)
            </a>
          </section>
        </div>
      )}
    </div>
  )
}

export default QuemasPanel
