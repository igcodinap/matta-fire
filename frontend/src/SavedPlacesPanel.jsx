import React, { useState, useEffect, useCallback } from 'react'
import { isFireNearPlace, getFireAlertKey, haversineKm } from './fireUtils'

function SavedPlacesPanel({ places, setPlaces, fires, onPlaceAlert, draftCoords, pickingPlace, onStartPlacePick }) {
  const [showAdd, setShowAdd] = useState(false)
  const [newPlace, setNewPlace] = useState({
    name: '',
    lat: '',
    lng: '',
    radiusKm: 10,
    notify: true
  })

  // Fill coordinates picked on the map
  useEffect(() => {
    if (draftCoords) {
      setNewPlace(prev => ({ ...prev, lat: draftCoords.lat, lng: draftCoords.lng }))
      setShowAdd(true)
    }
  }, [draftCoords])
  const [geolocationError, setGeolocationError] = useState(null)
  const [notificationMessage, setNotificationMessage] = useState(null)
  const [alertSeen, setAlertSeen] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('matta.alertSeen.v1') || '[]'))
    } catch {
      return new Set()
    }
  })

  // Request browser notification permission when user tries to add a notify-enabled place
  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      setNotificationMessage('Este navegador no soporta notificaciones')
      return 'unsupported'
    }
    if (Notification.permission === 'granted') {
      setNotificationMessage(null)
      return 'granted'
    }
    if (Notification.permission === 'denied') {
      setNotificationMessage('Permiso de notificaciones rechazado')
      return 'denied'
    }
    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      setNotificationMessage(null)
    } else if (permission === 'denied') {
      setNotificationMessage('Permiso de notificaciones rechazado')
    } else {
      setNotificationMessage('Permiso de notificaciones pendiente')
    }
    return permission
  }, [])

  // Use current location
  const useCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeolocationError('Geolocation no soportada')
      return
    }

    setGeolocationError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setNewPlace(prev => ({
          ...prev,
          lat: position.coords.latitude.toFixed(5),
          lng: position.coords.longitude.toFixed(5)
        }))
      },
      (error) => {
        let message = 'Error de geolocalizacion'
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = 'Permiso rechazado'
            break
          case error.POSITION_UNAVAILABLE:
            message = 'Ubicacion no disponible'
            break
          case error.TIMEOUT:
            message = 'Tiempo agotado'
            break
        }
        setGeolocationError(message)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  const addPlace = useCallback(() => {
    if (!newPlace.name || !newPlace.lat || !newPlace.lng) {
      return
    }

    const place = {
      id: crypto.randomUUID(),
      name: newPlace.name,
      lat: parseFloat(newPlace.lat),
      lng: parseFloat(newPlace.lng),
      radiusKm: parseFloat(newPlace.radiusKm) || 10,
      notify: newPlace.notify,
      createdAt: new Date().toISOString()
    }

    setPlaces(prev => [...prev, place])
    setNewPlace({ name: '', lat: '', lng: '', radiusKm: 10, notify: true })
    setShowAdd(false)

    if (place.notify) {
      requestNotificationPermission()
    }
  }, [newPlace, setPlaces, requestNotificationPermission])

  const removePlace = useCallback((id) => {
    setPlaces(prev => prev.filter(p => p.id !== id))
  }, [setPlaces])

  const toggleNotify = useCallback((id) => {
    const currentPlace = places.find(p => p.id === id)
    const shouldRequestPermission = currentPlace ? !currentPlace.notify : false
    setPlaces(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, notify: !p.notify }
      }
      return p
    }))
    if (shouldRequestPermission) {
      requestNotificationPermission()
    }
  }, [places, setPlaces, requestNotificationPermission])

  // Check for fires near places and alert
  useEffect(() => {
    if (!fires?.features?.length || !places?.length) return

    const newAlerts = []
    const notifyPlaces = places.filter(p => p.notify)

    fires.features.forEach(fire => {
      if (fire.properties.country !== 'Chile') return

      notifyPlaces.forEach(place => {
        if (isFireNearPlace(place, fire)) {
          const key = getFireAlertKey(place, fire)
          if (!alertSeen.has(key)) {
            newAlerts.push({ place, fire, key })
          }
        }
      })
    })

    if (newAlerts.length > 0) {
      newAlerts.forEach(({ place, fire, key }) => {
        const distanceKm = haversineKm(place.lat, place.lng, fire.geometry.coordinates[1], fire.geometry.coordinates[0])

        onPlaceAlert?.({
          alert_type: 'saved_place',
          message: `Incendio cerca de ${place.name}: ${distanceKm.toFixed(1)} km`,
          feature: fire
        })

        // Show browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`Alerta: ${place.name}`, {
            body: `Incendio detectado a ${distanceKm.toFixed(1)} km`,
            icon: '/fire-icon.png',
            tag: key
          })
        }

        // Mark as seen
        setAlertSeen(prev => {
          const updated = new Set(prev)
          updated.add(key)
          localStorage.setItem('matta.alertSeen.v1', JSON.stringify([...updated]))
          return updated
        })
      })
    }
  }, [fires, places, alertSeen, onPlaceAlert])

  if (pickingPlace) {
    return (
      <div className="saved-places-panel picking">
        <div className="saved-places-header">
          <h3>Elegir ubicacion</h3>
        </div>
        <p className="picking-hint">Haz clic en el mapa para fijar la ubicacion del lugar.</p>
      </div>
    )
  }

  return (
    <div className="saved-places-panel">
      <div className="saved-places-header">
        <h3>Lugares guardados</h3>
        <button className="add-btn" onClick={() => setShowAdd(!showAdd)} aria-label={showAdd ? 'Cerrar formulario' : 'Agregar lugar'}>
          {showAdd ? '✕' : '+'}
        </button>
      </div>

      {notificationMessage && (
        <p className="notification-status">{notificationMessage}</p>
      )}

      {showAdd && (
        <div className="saved-places-form">
          <div className="filter-group">
            <label>Nombre</label>
            <input
              type="text"
              value={newPlace.name}
              onChange={(e) => setNewPlace(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Mi casa, parcela, etc."
            />
          </div>
          <button className="use-location-btn" onClick={onStartPlacePick}>
            📍 Elegir en el mapa
          </button>
          <div className="filter-group">
            <label>Latitud</label>
            <input
              type="text"
              value={newPlace.lat}
              onChange={(e) => setNewPlace(prev => ({ ...prev, lat: e.target.value }))}
              placeholder="-33.44"
            />
          </div>
          <div className="filter-group">
            <label>Longitud</label>
            <input
              type="text"
              value={newPlace.lng}
              onChange={(e) => setNewPlace(prev => ({ ...prev, lng: e.target.value }))}
              placeholder="-70.65"
            />
          </div>
          <div className="filter-group">
            <label>Radio (km)</label>
            <input
              type="number"
              min="1"
              max="100"
              value={newPlace.radiusKm}
              onChange={(e) => setNewPlace(prev => ({ ...prev, radiusKm: e.target.value }))}
            />
          </div>
          <div className="filter-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={newPlace.notify}
                onChange={(e) => setNewPlace(prev => ({ ...prev, notify: e.target.checked }))}
              />
              Notificar
            </label>
          </div>
          <button className="use-location-btn" onClick={useCurrentLocation}>
            Usar mi ubicacion
          </button>
          {geolocationError && (
            <p className="geolocation-error">{geolocationError}</p>
          )}
          <button className="save-btn" onClick={addPlace}>
            Guardar
          </button>
        </div>
      )}

      {places.length === 0 && !showAdd && (
        <p className="no-places">Agrega lugares para recibir alertas</p>
      )}

      <ul className="saved-places-list">
        {places.map(place => (
          <li key={place.id} className="saved-place-item">
            <div className="place-info">
              <strong>{place.name}</strong>
              <span>Radio: {place.radiusKm} km</span>
            </div>
            <div className="place-actions">
              <button
                className={`notify-btn ${place.notify ? 'active' : ''}`}
                onClick={() => toggleNotify(place.id)}
                title={place.notify ? 'Notificaciones activadas' : 'Notificaciones desactivadas'}
              >
                {place.notify ? '🔔' : '🔕'}
              </button>
              <button
                className="remove-btn"
                onClick={() => removePlace(place.id)}
                title="Eliminar"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default SavedPlacesPanel
