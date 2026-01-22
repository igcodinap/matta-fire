package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

// =============================================================================
// Fire History System - 24h in-memory storage with 1km grid deduplication
// =============================================================================

const (
	GridSize      = 0.01  // ~1.1km at Chile's latitude
	MaxFireAge    = 24 * time.Hour
	CleanupInterval = 1 * time.Hour
)

// FireRecord represents a unique fire location with tracking data
type FireRecord struct {
	GridID         string    `json:"grid_id"`
	Latitude       float64   `json:"latitude"`       // Average lat of detections
	Longitude      float64   `json:"longitude"`      // Average lon of detections
	FirstSeen      time.Time `json:"first_seen"`
	LastSeen       time.Time `json:"last_seen"`
	DetectionCount int       `json:"detection_count"`
	MaxFRP         float64   `json:"max_frp"`        // Peak intensity
	CurrentFRP     float64   `json:"current_frp"`    // Latest FRP
	Region         string    `json:"region"`
	Satellites     []string  `json:"satellites"`     // Which satellites detected it
	WindSpeed      float64   `json:"wind_speed"`
	WindDirection  float64   `json:"wind_direction"`
	Severity       string    `json:"severity"`       // minor, moderate, significant, major
}

// FireHistory manages the 24h fire history with deduplication
type FireHistory struct {
	mu     sync.RWMutex
	fires  map[string]*FireRecord // key: grid_id
}

var fireHistory = &FireHistory{
	fires: make(map[string]*FireRecord),
}

// GetGridID returns the grid cell ID for given coordinates
func GetGridID(lat, lon float64) string {
	gridLat := math.Round(lat/GridSize) * GridSize
	gridLon := math.Round(lon/GridSize) * GridSize
	return fmt.Sprintf("%.2f_%.2f", gridLat, gridLon)
}

// AddDetection adds or updates a fire detection
func (h *FireHistory) AddDetection(lat, lon, frp float64, region, satellite string, windSpeed, windDir float64) *FireRecord {
	h.mu.Lock()
	defer h.mu.Unlock()

	gridID := GetGridID(lat, lon)
	now := time.Now()

	if existing, ok := h.fires[gridID]; ok {
		// Update existing fire
		existing.LastSeen = now
		existing.DetectionCount++
		existing.CurrentFRP = frp
		if frp > existing.MaxFRP {
			existing.MaxFRP = frp
		}
		// Update average position
		n := float64(existing.DetectionCount)
		existing.Latitude = (existing.Latitude*(n-1) + lat) / n
		existing.Longitude = (existing.Longitude*(n-1) + lon) / n
		// Track satellites
		if !containsString(existing.Satellites, satellite) {
			existing.Satellites = append(existing.Satellites, satellite)
		}
		existing.WindSpeed = windSpeed
		existing.WindDirection = windDir
		existing.Severity = calculateSeverity(existing.DetectionCount, existing.MaxFRP, existing.DurationHours())
		return existing
	}

	// New fire
	fire := &FireRecord{
		GridID:         gridID,
		Latitude:       lat,
		Longitude:      lon,
		FirstSeen:      now,
		LastSeen:       now,
		DetectionCount: 1,
		MaxFRP:         frp,
		CurrentFRP:     frp,
		Region:         region,
		Satellites:     []string{satellite},
		WindSpeed:      windSpeed,
		WindDirection:  windDir,
		Severity:       "minor",
	}
	h.fires[gridID] = fire
	return fire
}

// DurationHours returns how long the fire has been burning
func (f *FireRecord) DurationHours() float64 {
	return f.LastSeen.Sub(f.FirstSeen).Hours()
}

// DurationString returns human-readable duration
func (f *FireRecord) DurationString() string {
	dur := f.LastSeen.Sub(f.FirstSeen)
	if dur < time.Minute {
		return "reciente"
	}
	if dur < time.Hour {
		return fmt.Sprintf("%d min", int(dur.Minutes()))
	}
	return fmt.Sprintf("%.1f horas", dur.Hours())
}

// calculateSeverity determines fire severity based on multiple factors
func calculateSeverity(detections int, maxFRP, hours float64) string {
	// Score based on detections (confirmed by multiple passes)
	score := 0
	if detections >= 10 {
		score += 3
	} else if detections >= 5 {
		score += 2
	} else if detections >= 3 {
		score += 1
	}

	// Score based on intensity
	if maxFRP >= 100 {
		score += 3
	} else if maxFRP >= 50 {
		score += 2
	} else if maxFRP >= 20 {
		score += 1
	}

	// Score based on duration
	if hours >= 6 {
		score += 2
	} else if hours >= 2 {
		score += 1
	}

	// Determine severity
	switch {
	case score >= 6:
		return "major"       // 🔴 Major fire - high priority
	case score >= 4:
		return "significant" // 🟠 Significant - needs attention
	case score >= 2:
		return "moderate"    // 🟡 Moderate - monitor
	default:
		return "minor"       // 🟢 Minor - new or small
	}
}

// Cleanup removes fires older than 24 hours
func (h *FireHistory) Cleanup() int {
	h.mu.Lock()
	defer h.mu.Unlock()

	cutoff := time.Now().Add(-MaxFireAge)
	removed := 0

	for id, fire := range h.fires {
		if fire.LastSeen.Before(cutoff) {
			delete(h.fires, id)
			removed++
		}
	}

	return removed
}

// GetAll returns all current fires
func (h *FireHistory) GetAll() []*FireRecord {
	h.mu.RLock()
	defer h.mu.RUnlock()

	fires := make([]*FireRecord, 0, len(h.fires))
	for _, fire := range h.fires {
		fires = append(fires, fire)
	}
	return fires
}

// GetStats returns summary statistics
func (h *FireHistory) GetStats() map[string]interface{} {
	h.mu.RLock()
	defer h.mu.RUnlock()

	stats := map[string]int{
		"minor": 0, "moderate": 0, "significant": 0, "major": 0,
	}

	var totalDetections int
	var oldestFire *FireRecord

	for _, fire := range h.fires {
		stats[fire.Severity]++
		totalDetections += fire.DetectionCount
		if oldestFire == nil || fire.FirstSeen.Before(oldestFire.FirstSeen) {
			oldestFire = fire
		}
	}

	result := map[string]interface{}{
		"total_unique_fires": len(h.fires),
		"total_detections":   totalDetections,
		"by_severity":        stats,
	}

	if oldestFire != nil {
		result["oldest_fire_hours"] = oldestFire.DurationHours()
	}

	return result
}

// GetMajorFires returns fires with significant or major severity
func (h *FireHistory) GetMajorFires() []*FireRecord {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var major []*FireRecord
	for _, fire := range h.fires {
		if fire.Severity == "major" || fire.Severity == "significant" {
			major = append(major, fire)
		}
	}
	return major
}

func containsString(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}
