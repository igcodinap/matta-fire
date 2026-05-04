import { useState } from 'react'

function InfoPanel({ collapsed: controlledCollapsed, onToggle }) {
  const [internalCollapsed, setInternalCollapsed] = useState(false)
  const collapsed = controlledCollapsed ?? internalCollapsed

  const handleToggle = () => {
    if (onToggle) {
      onToggle()
      return
    }
    setInternalCollapsed(prev => !prev)
  }

  return (
    <div className={`info-panel ${collapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="info-header panel-header-button"
        onClick={handleToggle}
        aria-expanded={!collapsed}
      >
        <h3>
          <span className="info-icon">ℹ️</span>
          <span>
            <span className="panel-title">Informacion y Emergencias</span>
            <span className="panel-subtitle">Telefonos y pasos inmediatos</span>
          </span>
        </h3>
        <span className="panel-header-side">
          <span className="panel-header-meta">132</span>
          <span className="info-toggle-icon">{collapsed ? '▶' : '▼'}</span>
        </span>
      </button>

      {!collapsed && (
      <div className="info-content">
        {/* Emergency Numbers — most important, always first */}
        <section className="info-section emergency-section">
          <h4>Numeros de Emergencia</h4>
          <div className="emergency-numbers">
            <a href="tel:132" className="emergency-item bomberos">
              <span className="emergency-number">132</span>
              <span className="emergency-label">Bomberos</span>
            </a>
            <a href="tel:131" className="emergency-item ambulancia">
              <span className="emergency-number">131</span>
              <span className="emergency-label">Ambulancia</span>
            </a>
            <a href="tel:133" className="emergency-item carabineros">
              <span className="emergency-number">133</span>
              <span className="emergency-label">Carabineros</span>
            </a>
            <a href="tel:130" className="emergency-item conaf">
              <span className="emergency-number">130</span>
              <span className="emergency-label">CONAF Incendios</span>
            </a>
          </div>
        </section>

        {/* What to do */}
        <section className="info-section">
          <h4>Si ve humo o fuego</h4>
          <ul className="action-list">
            <li>Llame inmediatamente al <strong>132</strong> (Bomberos) o al <strong>130</strong> (CONAF)</li>
            <li>Alejese en direccion contraria al viento</li>
            <li>No intente apagar el fuego usted mismo</li>
            <li>Avise a sus vecinos</li>
            <li>Si esta en su casa, cierre puertas y ventanas</li>
          </ul>
        </section>

        {/* Prevention */}
        <section className="info-section">
          <h4>Prevencion</h4>
          <ul>
            <li>No haga fogatas en zonas forestales</li>
            <li>No tire colillas de cigarrillo en el campo</li>
            <li>No queme basura ni rastrojos sin autorizacion de CONAF</li>
            <li>En epoca de calor, evite usar herramientas que generen chispas</li>
          </ul>
        </section>

        {/* About this app */}
        <section className="info-section">
          <h4>Sobre este monitor</h4>
          <p>
            Los focos de incendio se detectan por satelites de la NASA (FIRMS)
            y se actualizan automaticamente cada minuto. Los datos meteorologicos
            provienen de estaciones de monitoreo en todo Chile.
          </p>
          <p className="info-note">
            Este monitor es informativo. Ante una emergencia real,
            siempre contacte a Bomberos (132) o CONAF (130).
          </p>
        </section>

        {/* Resources */}
        <section className="info-section">
          <h4>Recursos</h4>
          <a
            href="https://www.conaf.cl/"
            target="_blank"
            rel="noopener noreferrer"
            className="info-link"
          >
            CONAF - Corporacion Nacional Forestal
          </a>
          <a
            href="https://www.onemi.gov.cl/"
            target="_blank"
            rel="noopener noreferrer"
            className="info-link"
          >
            SENAPRED - Servicio Nacional de Prevencion
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
export default InfoPanel
