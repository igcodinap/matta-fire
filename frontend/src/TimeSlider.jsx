import React, { useState, useEffect, useMemo, useRef } from 'react'

function TimeSlider({ fires, onTimeRangeChange }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(100) // percentage
  const [windowSize, setWindowSize] = useState('all') // 'all', '24h', '12h', '6h', '1h'
  const intervalRef = useRef(null)

  // Calculate time bounds from data
  const timeBounds = useMemo(() => {
    if (!fires?.features?.length) return { min: 0, max: Date.now() / 1000 }

    const timestamps = fires.features
      .map(f => f.properties.timestamp)
      .filter(t => t > 0)

    if (timestamps.length === 0) return { min: 0, max: Date.now() / 1000 }

    return {
      min: Math.min(...timestamps),
      max: Math.max(...timestamps)
    }
  }, [fires])

  // Convert window size to seconds
  const getWindowSeconds = (size) => {
    switch (size) {
      case '1h': return 3600
      case '6h': return 6 * 3600
      case '12h': return 12 * 3600
      case '24h': return 24 * 3600
      default: return 0 // 'all'
    }
  }

  // Update time range when slider or window changes
  useEffect(() => {
    const range = timeBounds.max - timeBounds.min
    const endTime = timeBounds.min + (range * currentTime) / 100

    if (windowSize === 'all') {
      onTimeRangeChange({ min: 0, max: endTime })
    } else {
      const windowSecs = getWindowSeconds(windowSize)
      const startTime = endTime - windowSecs
      onTimeRangeChange({
        min: Math.max(startTime, timeBounds.min),
        max: endTime
      })
    }
  }, [currentTime, windowSize, timeBounds, onTimeRangeChange])

  // Animation
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentTime(prev => {
          if (prev >= 100) {
            setIsPlaying(false)
            return 100
          }
          return prev + 1
        })
      }, 200)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isPlaying])

  const handlePlayPause = () => {
    if (currentTime >= 100) {
      setCurrentTime(0)
    }
    setIsPlaying(!isPlaying)
  }

  const handleReset = () => {
    setIsPlaying(false)
    setCurrentTime(100)
    setWindowSize('all')
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--'
    const date = new Date(timestamp * 1000)
    return date.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const range = timeBounds.max - timeBounds.min
  const currentEndTime = timeBounds.min + (range * currentTime) / 100

  return (
    <div className="time-slider">
      <div className="time-controls">
        <button
          className={`play-btn ${isPlaying ? 'playing' : ''}`}
          onClick={handlePlayPause}
          title={isPlaying ? 'Pausar' : 'Ver evolucion en el tiempo'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className="reset-btn"
          onClick={handleReset}
          title="Mostrar todo"
        >
          ↺
        </button>
      </div>

      <div className="slider-container">
        <div className="time-labels">
          <span>{formatTime(timeBounds.min)}</span>
          <span className="current-time">
            {formatTime(currentEndTime)}
          </span>
          <span>{formatTime(timeBounds.max)}</span>
        </div>

        <input
          type="range"
          min="0"
          max="100"
          value={currentTime}
          onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
          className="time-range"
        />

        <div className="window-control">
          <label>Mostrar:</label>
          <select
            value={windowSize}
            onChange={(e) => setWindowSize(e.target.value)}
          >
            <option value="all">Todo</option>
            <option value="24h">Ultimas 24 horas</option>
            <option value="12h">Ultimas 12 horas</option>
            <option value="6h">Ultimas 6 horas</option>
            <option value="1h">Ultima hora</option>
          </select>
        </div>
      </div>
    </div>
  )
}

export default TimeSlider
