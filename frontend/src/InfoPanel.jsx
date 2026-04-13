function InfoPanel() {
  return (
    <div className="info-panel">
      <div className="info-header">
        <h3>
          <span className="info-icon">📋</span>
          <span>Quemas Agrícolas</span>
        </h3>
      </div>

      <div className="info-content">
        <section className="info-section">
          <h4>🔥 Calendario de Quemas CONAF 2025–2026</h4>
          <p>
            CONAF autoriza la quema controlada de residuos agrícolas (rastrojos)
            en períodos específicos por zona para prevenir incendios forestales.
          </p>

          <div className="info-table">
            <div className="info-table-row header">
              <span>Zona</span>
              <span>Período Autorizado</span>
              <span>Regiones</span>
            </div>
            <div className="info-table-row">
              <strong>Norte</strong>
              <span>Oct 2025 – Abr 2026</span>
              <span>Arica → Metropolitana</span>
            </div>
            <div className="info-table-row">
              <strong>Sur</strong>
              <span>Mar 2026 – Nov 2026</span>
              <span>O'Higgins → Magallanes</span>
            </div>
          </div>
        </section>

        <section className="info-section">
          <h4>⚠️ Importante</h4>
          <ul>
            <li>
              <strong>~60% de las quemas autorizadas</strong> ocurren en marzo, abril y mayo,
              justo después de la cosecha.
            </li>
            <li>
              <strong>Prohibición total</strong> durante diciembre–febrero
              (temporada crítica de incendios forestales).
            </li>
            <li>
              Todas las quemas requieren <strong>aviso previo a CONAF</strong>
              y deben cumplir condiciones meteorológicas aprobadas.
            </li>
            <li>
              Las quemas agrícolas son una de las principales causas de
              incendios forestales que escapan de control en Chile.
            </li>
          </ul>
        </section>

        <section className="info-section">
          <h4>🔗 Recursos</h4>
          <a
            href="https://www.conaf.cl/centro-documental/calendario-de-quemas-controladas-zona-norte/"
            target="_blank"
            rel="noopener noreferrer"
            className="info-link"
          >
            📄 Calendario Zona Norte (CONAF)
          </a>
          <a
            href="https://www.conaf.cl/centro-documental/calendario-de-quemas-controladas-2024-2025-zona-sur/"
            target="_blank"
            rel="noopener noreferrer"
            className="info-link"
          >
            📄 Calendario Zona Sur (CONAF)
          </a>
          <a
            href="https://www.chileatiende.gob.cl/fichas/742-aviso-de-quema-controlada"
            target="_blank"
            rel="noopener noreferrer"
            className="info-link"
          >
            🏛️ Aviso de Quema Controlada (ChileAtiende)
          </a>
        </section>
      </div>
    </div>
  )
}

export default InfoPanel
