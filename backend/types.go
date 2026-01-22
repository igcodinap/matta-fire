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

// Chilean regions for filtering
var ChileanRegions = map[string]struct {
	Name string
	Bbox []float64 // [west, south, east, north]
}{
	"XV":  {Name: "Arica y Parinacota", Bbox: []float64{-70.5, -19.5, -68.5, -17.5}},
	"I":   {Name: "Tarapacá", Bbox: []float64{-70.5, -21.5, -68.0, -19.0}},
	"II":  {Name: "Antofagasta", Bbox: []float64{-70.5, -26.5, -67.0, -21.0}},
	"III": {Name: "Atacama", Bbox: []float64{-71.5, -29.5, -68.0, -26.0}},
	"IV":  {Name: "Coquimbo", Bbox: []float64{-72.0, -32.5, -69.5, -29.0}},
	"V":   {Name: "Valparaíso", Bbox: []float64{-72.0, -34.0, -70.0, -32.0}},
	"RM":  {Name: "Metropolitana", Bbox: []float64{-71.5, -34.5, -69.5, -33.0}},
	"VI":  {Name: "O'Higgins", Bbox: []float64{-72.0, -35.0, -70.0, -34.0}},
	"VII": {Name: "Maule", Bbox: []float64{-72.5, -36.5, -70.0, -35.0}},
	"XVI": {Name: "Ñuble", Bbox: []float64{-72.5, -37.5, -71.0, -36.0}},
	"VIII":{Name: "Biobío", Bbox: []float64{-73.5, -38.5, -71.0, -36.5}},
	"IX":  {Name: "La Araucanía", Bbox: []float64{-73.5, -39.5, -71.0, -38.0}},
	"XIV": {Name: "Los Ríos", Bbox: []float64{-73.5, -40.5, -71.5, -39.0}},
	"X":   {Name: "Los Lagos", Bbox: []float64{-74.0, -44.0, -71.0, -40.0}},
	"XI":  {Name: "Aysén", Bbox: []float64{-75.5, -49.0, -71.0, -43.5}},
	"XII": {Name: "Magallanes", Bbox: []float64{-75.5, -56.0, -66.5, -49.0}},
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
