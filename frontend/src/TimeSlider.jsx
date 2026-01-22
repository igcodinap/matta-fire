import React, { useState, useEffect, useMemo, useRef } from 'react'

function TimeSlider({ fires, onTimeRangeChange }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(100) // percentage
  const [windowSize, setWindowSize] = useState(100) // percentage of total range
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

  // Update time range when slider changes
  useEffect(() => {
    const range = timeBounds.max - timeBounds.min
    const windowDuration = (range * windowSize) / 100
    const endTime = timeBounds.min + (range * currentTime) / 100
    const startTime = endTime - windowDuration

    onTimeRangeChange({
      min: windowSize === 100 ? 0 : Math.max(startTime, timeBounds.min),
      max: endTime
    })
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
    setWindowSize(100)
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
  const windowDuration = (range * windowSize) / 100
  const currentStartTime = Math.max(currentEndTime - windowDuration, timeBounds.min)

  return (
    <div className="time-slider">
      <div className="time-controls">
        <button
          className={`play-btn ${isPlaying ? 'playing' : ''}`}
          onClick={handlePlayPause}
          title={isPlaying ? 'Pausar' : 'Reproducir'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className="reset-btn"
          onClick={handleReset}
          title="Reiniciar"
        >
          ↺
        </button>
      </div>

      <div className="slider-container">
        <div className="time-labels">
          <span>{formatTime(timeBounds.min)}</span>
          <span className="current-time">
            {windowSize < 100
              ? `${formatTime(currentStartTime)} - ${formatTime(currentEndTime)}`
              : formatTime(currentEndTime)
            }
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
          <label>Ventana de tiempo:</label>
          <select
            value={windowSize}
            onChange={(e) => setWindowSize(parseFloat(e.target.value))}
          >
            <option value="100">Todo</option>
            <option value="50">50%</option>
            <option value="25">25%</option>
            <option value="10">10%</option>
            <option value="5">5%</option>
          </select>
        </div>
      </div>
    </div>
  )
}

export default TimeSlider
