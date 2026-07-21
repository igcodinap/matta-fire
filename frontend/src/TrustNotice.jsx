import React from 'react'

const DEFAULT_SOURCE_NOTICE = 'Las detecciones de incendios activos de NASA FIRMS son observaciones satelitales y pueden estar retrasadas o incluir falsos positivos.'
const DEFAULT_OFFICIAL_NOTICE = 'Matta Fire es informativo y no reemplaza a CONAF, SENAPRED, Bomberos ni las instrucciones de las autoridades locales.'

function TrustNotice({ metadata, onClose }) {
  const sourceNotice = metadata?.source_notice || DEFAULT_SOURCE_NOTICE
  const officialNotice = metadata?.official_notice || DEFAULT_OFFICIAL_NOTICE
  const fetchedAt = metadata?.fetched_at ? new Date(metadata.fetched_at).toLocaleString('es-CL') : null

  return (
    <div className="trust-notice">
      <button className="trust-notice-close" onClick={onClose}>×</button>
      <div className="trust-notice-content">
        <div className="trust-notice-item">
          <strong>Nota de fuente:</strong>
          <p>{sourceNotice}</p>
        </div>
        <div className="trust-notice-item">
          <strong>Nota oficial:</strong>
          <p>{officialNotice}</p>
        </div>
        {fetchedAt && (
          <div className="trust-notice-item">
            <strong>Datos obtenidos:</strong>
            <p>{fetchedAt}</p>
          </div>
        )}
        <div className="trust-notice-links">
          <a href="https://www.conaf.cl/" target="_blank" rel="noopener noreferrer">CONAF</a>
          <a href="https://www.senapred.cl/" target="_blank" rel="noopener noreferrer">SENAPRED</a>
          <a href="tel:132" className="emergency-link">Bomberos: 132</a>
        </div>
      </div>
    </div>
  )
}

export default TrustNotice