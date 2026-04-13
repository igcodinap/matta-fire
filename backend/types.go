package main

import "time"

// GeoJSON Feature Collection structure
type FeatureCollection struct {
	Type     string    `json:"type"`
	Features []Feature `json:"features"`
	Metadata *Metadata `json:"metadata,omitempty"`
}

// Metadata for the collection
type Metadata struct {
	TotalCount  int       `json:"total_count"`
	Sources     []string  `json:"sources"`
	LastUpdated time.Time `json:"last_updated"`
	BoundingBox []float64 `json:"bounding_box"` // [west, south, east, north]
}

// GeoJSON Feature
type Feature struct {
	Type       string     `json:"type"`
	Geometry   Geometry   `json:"geometry"`
	Properties Properties `json:"properties"`
}

// GeoJSON Geometry (Point for fire locations)
type Geometry struct {
	Type        string    `json:"type"`
	Coordinates []float64 `json:"coordinates"` // [longitude, latitude]
}

// Fire properties from NASA FIRMS
type Properties struct {
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
	Brightness float64 `json:"brightness"`
	Scan       float64 `json:"scan"`
	Track      float64 `json:"track"`
	AcqDate    string  `json:"acq_date"`
	AcqTime    string  `json:"acq_time"`
	Satellite  string  `json:"satellite"`
	Instrument string  `json:"instrument"`
	Confidence string  `json:"confidence"`
	Version    string  `json:"version"`
	BrightT31  float64 `json:"bright_t31"`
	FRP        float64 `json:"frp"` // Fire Radiative Power
	DayNight   string  `json:"daynight"`
	// Computed fields
	Timestamp      int64   `json:"timestamp"`       // Unix timestamp for time slider
	Region         string  `json:"region"`          // Chilean region name
	Intensity      string  `json:"intensity"`       // low, medium, high, extreme
	WindSpeed      float64 `json:"wind_speed"`      // km/h at fire location
	WindDirection  float64 `json:"wind_direction"`  // degrees (0=N, 90=E, 180=S, 270=W)
	// Fire history fields (from deduplication)
	GridID         string  `json:"grid_id"`         // 1km grid cell ID
	DetectionCount int     `json:"detection_count"` // Times detected (confidence)
	Severity       string  `json:"severity"`        // minor, moderate, significant, major
	FirstSeen      string  `json:"first_seen"`      // When fire was first detected
	Duration       string  `json:"duration"`        // Human-readable duration
	MaxFRP         float64 `json:"max_frp"`         // Peak intensity recorded
}

// API Response types for Huma
type FiresOutput struct {
	Body FeatureCollection
}

type FiresInput struct {
	// Filter parameters
	Source     string  `query:"source" doc:"Satellite source: all, VIIRS_NOAA20, VIIRS_SNPP, MODIS" default:"all"`
	Confidence string  `query:"confidence" doc:"Confidence level: all, low, nominal, high" default:"all"`
	MinFRP     float64 `query:"min_frp" doc:"Minimum Fire Radiative Power" default:"0"`
	MaxFRP     float64 `query:"max_frp" doc:"Maximum Fire Radiative Power" default:"0"`
	DayNight   string  `query:"daynight" doc:"Day or night: all, D, N" default:"all"`
	Region     string  `query:"region" doc:"Chilean region code" default:"all"`
	Days       int     `query:"days" doc:"Number of days of data (1-10)" default:"1" minimum:"1" maximum:"10"`
}

type HealthOutput struct {
	Body HealthStatus
}

type HealthStatus struct {
	Status       string            `json:"status"`
	FireCount    int               `json:"fire_count"`
	LastUpdated  string            `json:"last_updated"`
	Sources      map[string]int    `json:"sources"`       // Count per satellite
	RefreshRate  string            `json:"refresh_rate"`
	NextRefresh  string            `json:"next_refresh"`
}

type ExportInput struct {
	Format string `query:"format" doc:"Export format: geojson, csv" default:"geojson"`
}

type ExportOutput struct {
	Body []byte
}

// WebSocket message types
type WSMessage struct {
	Type    string      `json:"type"` // update, alert, ping
	Payload interface{} `json:"payload"`
}

type FireAlert struct {
	Feature   Feature `json:"feature"`
	AlertType string  `json:"alert_type"` // high_frp, new_fire
	Message   string  `json:"message"`
}

// Chilean regions for filtering (with realistic polygon boundaries)
var ChileanRegions = map[string]struct {
	Name     string
	Bbox     []float64   // [west, south, east, north] - kept for backward compatibility
	Polygon  [][]float64 // [[lon1, lat1], [lon2, lat2], ...] - actual region boundary
}{
	"XV":  {Name: "Arica y Parinacota", Bbox: []float64{-70.5, -19.5, -68.5, -17.5}, Polygon: [][]float64{{-70.35, -17.37}, {-69.52, -17.42}, {-68.92, -17.85}, {-68.65, -18.32}, {-68.82, -18.98}, {-69.35, -19.15}, {-70.12, -19.08}, {-70.35, -18.45}}},
	"I":   {Name: "Tarapacá", Bbox: []float64{-70.5, -21.5, -68.0, -19.0}, Polygon: [][]float64{{-70.35, -19.08}, {-69.35, -19.15}, {-68.82, -18.98}, {-68.52, -19.52}, {-68.38, -20.15}, {-68.52, -20.78}, {-69.12, -21.35}, {-69.85, -21.52}, {-70.28, -21.15}, {-70.42, -20.45}}},
	"II":  {Name: "Antofagasta", Bbox: []float64{-70.5, -26.5, -67.0, -21.0}, Polygon: [][]float64{{-70.42, -21.15}, {-69.85, -21.52}, {-69.12, -21.35}, {-68.52, -20.78}, {-68.25, -21.82}, {-68.15, -22.95}, {-68.42, -24.12}, {-68.92, -25.35}, {-69.52, -26.15}, {-70.15, -26.35}, {-70.65, -25.82}, {-70.85, -24.95}, {-70.72, -23.85}, {-70.55, -22.75}}},
	"III": {Name: "Atacama", Bbox: []float64{-71.5, -29.5, -68.0, -26.0}, Polygon: [][]float64{{-70.85, -25.82}, {-70.15, -26.35}, {-69.52, -26.15}, {-68.92, -25.35}, {-68.52, -26.52}, {-68.35, -27.65}, {-68.52, -28.45}, {-69.15, -29.12}, {-70.12, -29.35}, {-70.85, -29.15}, {-71.25, -28.52}, {-71.15, -27.45}, {-70.95, -26.52}}},
	"IV":  {Name: "Coquimbo", Bbox: []float64{-72.0, -32.5, -69.5, -29.0}, Polygon: [][]float64{{-71.25, -29.15}, {-70.12, -29.35}, {-69.15, -29.12}, {-68.85, -29.85}, {-69.12, -30.52}, {-69.52, -31.15}, {-70.15, -31.65}, {-70.85, -31.85}, {-71.45, -31.52}, {-71.65, -30.85}, {-71.52, -30.15}}},
	"V":   {Name: "Valparaíso", Bbox: []float64{-72.0, -34.0, -70.0, -32.0}, Polygon: [][]float64{{-71.65, -32.15}, {-70.85, -31.85}, {-70.15, -31.65}, {-69.85, -32.15}, {-69.92, -32.85}, {-70.25, -33.35}, {-70.85, -33.52}, {-71.35, -33.15}, {-71.65, -32.85}, {-71.72, -32.45}}},
	"RM":  {Name: "Metropolitana", Bbox: []float64{-71.5, -34.5, -69.5, -33.0}, Polygon: [][]float64{{-71.35, -33.15}, {-70.85, -33.52}, {-70.25, -33.35}, {-69.92, -32.85}, {-69.72, -33.45}, {-69.85, -34.05}, {-70.35, -34.35}, {-70.85, -34.15}, {-71.25, -33.85}}},
	"VI":  {Name: "O'Higgins", Bbox: []float64{-72.0, -35.0, -70.0, -34.0}, Polygon: [][]float64{{-71.85, -33.95}, {-71.25, -33.85}, {-70.85, -34.15}, {-70.35, -34.35}, {-69.85, -34.05}, {-69.92, -34.65}, {-70.45, -34.95}, {-71.15, -35.05}, {-71.75, -34.75}}},
	"VII": {Name: "Maule", Bbox: []float64{-72.5, -36.5, -70.0, -35.0}, Polygon: [][]float64{{-72.35, -34.95}, {-71.75, -34.75}, {-71.15, -35.05}, {-70.45, -34.95}, {-70.25, -35.45}, {-70.52, -36.05}, {-71.15, -36.35}, {-71.85, -36.45}, {-72.45, -36.15}, {-72.55, -35.55}}},
	"XVI": {Name: "Ñuble", Bbox: []float64{-72.5, -37.5, -71.0, -36.0}, Polygon: [][]float64{{-72.85, -36.25}, {-72.45, -36.15}, {-71.85, -36.45}, {-71.15, -36.35}, {-70.95, -36.85}, {-71.25, -37.35}, {-71.85, -37.55}, {-72.55, -37.45}, {-73.05, -37.05}}},
	"VIII":{Name: "Biobío", Bbox: []float64{-73.5, -38.5, -71.0, -36.5}, Polygon: [][]float64{{-73.55, -37.15}, {-73.05, -37.05}, {-72.55, -37.45}, {-71.85, -37.55}, {-71.25, -37.35}, {-71.05, -37.85}, {-71.35, -38.35}, {-72.05, -38.65}, {-72.85, -38.75}, {-73.45, -38.45}, {-73.65, -37.85}}},
	"IX":  {Name: "La Araucanía", Bbox: []float64{-73.5, -39.5, -71.0, -38.0}, Polygon: [][]float64{{-73.25, -38.35}, {-72.85, -38.75}, {-72.05, -38.65}, {-71.35, -38.35}, {-71.15, -38.85}, {-71.45, -39.35}, {-72.15, -39.65}, {-72.85, -39.55}, {-73.35, -39.15}}},
	"XIV": {Name: "Los Ríos", Bbox: []float64{-73.5, -40.5, -71.5, -39.0}, Polygon: [][]float64{{-73.65, -39.45}, {-73.35, -39.15}, {-72.85, -39.55}, {-72.15, -39.65}, {-71.85, -39.95}, {-72.05, -40.35}, {-72.65, -40.55}, {-73.25, -40.45}, {-73.75, -40.15}}},
	"X":   {Name: "Los Lagos", Bbox: []float64{-74.0, -44.0, -71.0, -40.0}, Polygon: [][]float64{{-74.15, -40.25}, {-73.75, -40.15}, {-73.25, -40.45}, {-72.65, -40.55}, {-72.05, -40.35}, {-71.75, -40.85}, {-71.95, -41.55}, {-72.45, -42.15}, {-73.15, -42.55}, {-73.75, -42.85}, {-74.05, -42.35}, {-74.25, -41.55}, {-74.35, -40.85}}},
	"XI":  {Name: "Aysén", Bbox: []float64{-75.5, -49.0, -71.0, -43.5}, Polygon: [][]float64{{-75.25, -43.65}, {-74.55, -43.45}, {-73.85, -43.75}, {-73.15, -44.15}, {-72.65, -44.75}, {-72.35, -45.55}, {-72.55, -46.35}, {-73.15, -47.15}, {-73.85, -47.75}, {-74.55, -48.15}, {-75.15, -47.65}, {-75.55, -46.85}, {-75.85, -45.95}, {-75.65, -45.05}}},
	"XII": {Name: "Magallanes", Bbox: []float64{-75.5, -56.0, -66.5, -49.0}, Polygon: [][]float64{{-75.15, -48.15}, {-74.55, -48.35}, {-73.85, -48.85}, {-73.15, -49.55}, {-72.35, -50.35}, {-71.55, -51.25}, {-70.85, -52.15}, {-70.15, -53.15}, {-69.55, -53.85}, {-68.95, -54.55}, {-67.85, -55.15}, {-66.85, -54.85}, {-66.35, -54.15}, {-66.85, -53.35}, {-67.55, -52.55}, {-68.35, -51.75}, {-69.25, -50.95}, {-70.15, -50.15}, {-71.05, -49.45}, {-72.05, -48.85}, {-73.05, -48.45}, {-74.05, -48.25}}},
}

// Satellite sources configuration
var SatelliteSources = []struct {
	ID   string
	Name string
}{
	{ID: "VIIRS_NOAA20_NRT", Name: "VIIRS NOAA-20"},
	{ID: "VIIRS_SNPP_NRT", Name: "VIIRS Suomi NPP"},
	{ID: "MODIS_NRT", Name: "MODIS"},
}
